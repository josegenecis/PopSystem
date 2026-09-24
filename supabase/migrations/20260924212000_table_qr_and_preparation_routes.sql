-- Destinos de preparo por produto e cardapio QR seguro por mesa.

alter table public.products
  add column if not exists preparation_route text;

update public.products
   set preparation_route = case when coalesce(send_to_kds, false) then 'kitchen' else 'none' end
 where preparation_route is null;

alter table public.products
  alter column preparation_route set default 'none',
  alter column preparation_route set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_preparation_route_check'
  ) then
    alter table public.products
      add constraint products_preparation_route_check
      check (preparation_route in ('kitchen', 'bar', 'none'));
  end if;
end $$;

alter table public.tables
  add column if not exists qr_token uuid not null default gen_random_uuid(),
  add column if not exists qr_ordering_enabled boolean not null default true;

create unique index if not exists tables_qr_token_uidx on public.tables(qr_token);

create table if not exists public.table_qr_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'ordering' check (mode in ('ordering', 'view_only')),
  message text not null default 'Escaneie para ver o cardapio e fazer seu pedido.',
  updated_at timestamptz not null default now()
);

alter table public.table_qr_settings enable row level security;

drop policy if exists table_qr_settings_owner_all on public.table_qr_settings;
create policy table_qr_settings_owner_all
  on public.table_qr_settings for all to authenticated
  using (public.can_access_store(user_id))
  with check (public.can_access_store(user_id));

grant select, insert, update, delete on public.table_qr_settings to authenticated;

create or replace function public.resolve_table_qr(
  p_user_id uuid,
  p_qr_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_table public.tables%rowtype;
  v_mode text := 'ordering';
  v_message text := 'Escaneie para ver o cardapio e fazer seu pedido.';
begin
  select * into v_table
    from public.tables
   where user_id = p_user_id
     and qr_token = p_qr_token
     and archived_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_table_qr');
  end if;

  select mode, message into v_mode, v_message
    from public.table_qr_settings
   where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'table_id', v_table.id,
    'table_number', v_table.table_number,
    'location', v_table.location,
    'ordering_enabled', coalesce(v_mode, 'ordering') = 'ordering' and v_table.qr_ordering_enabled,
    'message', coalesce(v_message, 'Escaneie para ver o cardapio e fazer seu pedido.')
  );
end;
$$;

revoke all on function public.resolve_table_qr(uuid, uuid) from public;
grant execute on function public.resolve_table_qr(uuid, uuid) to anon, authenticated;

create or replace function public.place_table_qr_order(
  p_user_id uuid,
  p_qr_token uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_total numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table public.tables%rowtype;
  v_mode text := 'ordering';
  v_flow_mode text := 'all_items';
  v_show_manager boolean := true;
  v_auto_accept boolean := true;
  v_order_id uuid;
  v_order_number text;
  v_account_id uuid;
  v_existing_items jsonb := '[]'::jsonb;
  v_existing_total numeric := 0;
  v_invalid_products integer := 0;
  v_customer_name text;
  v_normalized_items jsonb := '[]'::jsonb;
  v_items_total numeric := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'Pedido sem itens validos.';
  end if;
  if p_total < 0 or p_total > 100000 then
    raise exception 'Total do pedido invalido.';
  end if;

  select * into v_table
    from public.tables
   where user_id = p_user_id
     and qr_token = p_qr_token
     and archived_at is null
   for update;
  if not found then raise exception 'QR Code da mesa invalido.'; end if;

  select mode into v_mode from public.table_qr_settings where user_id = p_user_id;
  if coalesce(v_mode, 'ordering') <> 'ordering' or not v_table.qr_ordering_enabled then
    raise exception 'Esta mesa esta configurada somente para visualizar o cardapio.';
  end if;

  select count(*) into v_invalid_products
    from jsonb_array_elements(p_items) item
   where nullif(item->>'product_id', '') is null
      or not exists (
        select 1 from public.products product
         where product.id = (item->>'product_id')::uuid
           and product.user_id = p_user_id
           and coalesce(product.available, product.is_available, true) = true
           and coalesce(product.show_in_delivery, true) = true
      );
  if v_invalid_products > 0 then raise exception 'Um ou mais produtos nao estao disponiveis.'; end if;

  select
    coalesce(jsonb_agg(
      item || jsonb_build_object(
        'product_name', product.name,
        'name', product.name,
        'preparation_route', product.preparation_route,
        'send_to_kds', product.preparation_route <> 'none'
      )
    ), '[]'::jsonb),
    coalesce(sum(coalesce(nullif(item->>'subtotal', '')::numeric, nullif(item->>'total', '')::numeric, 0)), 0)
  into v_normalized_items, v_items_total
    from jsonb_array_elements(p_items) item
    join public.products product on product.id = (item->>'product_id')::uuid
   where product.user_id = p_user_id;

  if v_items_total < 0 or abs(v_items_total - p_total) > 0.02 then
    raise exception 'O total do pedido nao confere com os itens.';
  end if;

  select table_order_mode, show_table_orders_in_manager, auto_accept_table_orders
    into v_flow_mode, v_show_manager, v_auto_accept
    from public.table_order_flow_settings
   where user_id = p_user_id;

  v_customer_name := coalesce(nullif(trim(p_customer_name), ''), 'Cliente da Mesa ' || v_table.table_number);
  v_order_number := 'MESA-' || v_table.table_number || '-' || right(extract(epoch from clock_timestamp())::bigint::text, 6);

  insert into public.orders (
    user_id, order_number, customer_name, customer_phone, items, total,
    payment_method, order_type, table_id, status, acceptance_status,
    delivery_instructions, variations
  ) values (
    p_user_id, v_order_number, v_customer_name, nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), ''),
    v_normalized_items, v_items_total, 'pendente', 'dine_in', v_table.id,
    case when coalesce(v_auto_accept, true) then 'preparing' else 'pending' end,
    case when coalesce(v_auto_accept, true) then 'accepted' else 'pending_acceptance' end,
    nullif(trim(coalesce(p_notes, '')), ''),
    jsonb_build_object(
      'source', 'TABLE_QR',
      'table_order_flow', coalesce(v_flow_mode, 'all_items'),
      'show_in_manager', coalesce(v_show_manager, true),
      'auto_accept', coalesce(v_auto_accept, true),
      'table_number', v_table.table_number
    )
  ) returning id into v_order_id;

  select id, items, total into v_account_id, v_existing_items, v_existing_total
    from public.table_accounts
   where table_id = v_table.id and status in ('open', 'payment_pending')
   order by updated_at desc
   limit 1
   for update;

  if v_account_id is null then
    insert into public.table_accounts (user_id, table_id, items, total, status, name)
    values (p_user_id, v_table.id, v_normalized_items, v_items_total, 'open', v_customer_name)
    returning id into v_account_id;
  else
    update public.table_accounts
       set items = coalesce(v_existing_items, '[]'::jsonb) || v_normalized_items,
           total = coalesce(v_existing_total, 0) + v_items_total,
           updated_at = now()
     where id = v_account_id;
  end if;

  update public.orders set account_id = v_account_id where id = v_order_id;
  update public.tables set status = 'occupied', updated_at = now() where id = v_table.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'table_id', v_table.id,
    'table_number', v_table.table_number,
    'status', case when coalesce(v_auto_accept, true) then 'preparing' else 'pending' end
  );
end;
$$;

revoke all on function public.place_table_qr_order(uuid, uuid, text, text, jsonb, numeric, text) from public;
grant execute on function public.place_table_qr_order(uuid, uuid, text, text, jsonb, numeric, text) to anon, authenticated;

create or replace function public.send_order_to_kds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_preparation_items jsonb;
begin
  select coalesce(jsonb_agg(
    item || jsonb_build_object(
      'preparation_route', coalesce(product.preparation_route, case when product.send_to_kds then 'kitchen' else 'none' end)
    )
  ), '[]'::jsonb)
  into v_preparation_items
  from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) item
  join public.products product on product.id = (item->>'product_id')::uuid
  where product.user_id = new.user_id
    and coalesce(product.preparation_route, case when product.send_to_kds then 'kitchen' else 'none' end) <> 'none';

  if jsonb_array_length(v_preparation_items) > 0 then
    insert into public.kitchen_orders (
      user_id, order_number, customer_name, customer_phone, items, priority, status
    ) values (
      new.user_id, new.order_number, new.customer_name, new.customer_phone,
      v_preparation_items, 'normal', 'pending'
    );
  end if;
  return new;
end;
$$;

comment on column public.products.preparation_route is 'Destino operacional: kitchen, bar ou none.';
comment on column public.tables.qr_token is 'Token publico nao sequencial usado no QR exclusivo da mesa.';
