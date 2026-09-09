-- Allow a promotional price table to target more than one sales surface.
-- Existing rules keep their exact legacy behavior through the backfill below.

alter table public.price_tables
  add column if not exists channels text[];

update public.price_tables
set channels = case
  when channel = 'all' then array['all']::text[]
  else array[channel]::text[]
end
where channels is null or cardinality(channels) = 0;

alter table public.price_tables
  alter column channels set default array['all']::text[],
  alter column channels set not null;

alter table public.price_tables
  drop constraint if exists price_tables_channels_check;

alter table public.price_tables
  add constraint price_tables_channels_check check (
    cardinality(channels) > 0
    and channels <@ array['all', 'pdv', 'delivery', 'waiter', 'totem', 'whatsapp', 'dine_in', 'pickup']::text[]
  );

create index if not exists idx_price_tables_channels
  on public.price_tables using gin (channels);

create or replace function public.resolve_product_prices(
  p_user_id uuid,
  p_channel text default 'all',
  p_product_ids uuid[] default null,
  p_at timestamptz default now()
)
returns table (
  product_id uuid,
  base_price numeric,
  effective_price numeric,
  price_table_id uuid,
  price_rule_id uuid,
  price_table_name text,
  price_source text,
  discount_percentage numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with product_base as (
    select p.id, p.category_id, greatest(0, coalesce(p.price, 0))::numeric as base_price
    from public.products p
    where p.user_id = p_user_id
      and (p_product_ids is null or p.id = any(p_product_ids))
  ), candidates as (
    select
      pb.id as product_id,
      pb.base_price,
      pt.id as table_id,
      pti.id as rule_id,
      pt.name as table_name,
      pti.adjustment_type,
      pti.adjustment_value,
      row_number() over (
        partition by pb.id
        order by
          (pti.product_id is not null) desc,
          (pti.category_id is not null) desc,
          (not ('all' = any(pt.channels))) desc,
          pt.priority desc,
          pt.updated_at desc,
          pti.updated_at desc
      ) as position
    from product_base pb
    join public.price_table_items pti
      on pti.user_id = p_user_id
     and pti.active
     and (pti.product_id = pb.id or pti.category_id = pb.category_id or (pti.product_id is null and pti.category_id is null))
    join public.price_tables pt
      on pt.id = pti.price_table_id
     and pt.user_id = p_user_id
     and pt.active
     and (
       'all' = any(pt.channels)
       or coalesce(nullif(lower(p_channel), ''), 'all') = any(pt.channels)
     )
     and (pt.starts_at is null or p_at >= pt.starts_at)
     and (pt.ends_at is null or p_at < pt.ends_at)
     and (
       pt.days_of_week is null or
       extract(dow from (p_at at time zone pt.timezone))::smallint = any(pt.days_of_week)
     )
     and (
       pt.start_time is null or pt.end_time is null or
       case
         when pt.start_time <= pt.end_time then
           (p_at at time zone pt.timezone)::time >= pt.start_time and
           (p_at at time zone pt.timezone)::time < pt.end_time
         else
           (p_at at time zone pt.timezone)::time >= pt.start_time or
           (p_at at time zone pt.timezone)::time < pt.end_time
       end
     )
  ), winner as (
    select * from candidates where position = 1
  )
  select
    pb.id,
    round(pb.base_price, 2),
    round(greatest(0, case w.adjustment_type
      when 'fixed_price' then w.adjustment_value
      when 'percentage_discount' then pb.base_price * (1 - w.adjustment_value / 100)
      when 'percentage_markup' then pb.base_price * (1 + w.adjustment_value / 100)
      when 'amount_discount' then pb.base_price - w.adjustment_value
      else pb.base_price
    end), 2),
    w.table_id,
    w.rule_id,
    w.table_name,
    case when w.rule_id is null then 'base' else 'price_table' end,
    case when w.adjustment_type = 'percentage_discount' then w.adjustment_value else null end
  from product_base pb
  left join winner w on w.product_id = pb.id;
$$;

revoke all on function public.resolve_product_prices(uuid, text, uuid[], timestamptz) from public;
grant execute on function public.resolve_product_prices(uuid, text, uuid[], timestamptz) to anon, authenticated, service_role;
