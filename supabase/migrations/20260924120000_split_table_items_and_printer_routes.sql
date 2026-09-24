-- Redistribuicao segura de itens entre comandas da mesma mesa.
-- A operacao preserva o vinculo original com a cozinha e altera apenas quem paga.
create table if not exists public.table_item_splits (
  id uuid primary key default gen_random_uuid(),
  restaurant_user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  source_account_id uuid not null references public.table_accounts(id) on delete cascade,
  target_account_id uuid not null references public.table_accounts(id) on delete cascade,
  source_item_id uuid not null references public.order_items(id) on delete cascade,
  created_item_id uuid references public.order_items(id) on delete set null,
  moved_quantity numeric(12,3) not null check (moved_quantity > 0),
  created_by_waiter_id uuid references public.waiters(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists table_item_splits_session_created_idx
  on public.table_item_splits (session_id, created_at desc);

alter table public.table_item_splits enable row level security;

drop policy if exists table_item_splits_owner_select on public.table_item_splits;
create policy table_item_splits_owner_select
  on public.table_item_splits for select
  to authenticated
  using (auth.uid() = restaurant_user_id);

create or replace function public.redistribute_table_order_item(
  p_restaurant_user_id uuid,
  p_waiter_id uuid,
  p_item_id uuid,
  p_target_account_id uuid,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.order_items%rowtype;
  v_source_account public.table_accounts%rowtype;
  v_target_account public.table_accounts%rowtype;
  v_source_quantity numeric(12,3);
  v_move_quantity numeric(12,3);
  v_created_item_id uuid;
  v_source_total numeric(12,2);
  v_target_total numeric(12,2);
  v_source_paid numeric(12,2);
begin
  if p_restaurant_user_id is null or p_item_id is null or p_target_account_id is null then
    raise exception 'Informe o item e a comanda de destino.';
  end if;

  select * into v_item
    from public.order_items
   where id = p_item_id
   for update;
  if not found or v_item.status = 'cancelled' then
    raise exception 'Item nao encontrado ou cancelado.';
  end if;

  select * into v_source_account
    from public.table_accounts
   where id = v_item.account_id
     and user_id = p_restaurant_user_id
     and status in ('open', 'payment_pending')
   for update;
  if not found then
    raise exception 'A comanda de origem nao esta aberta.';
  end if;

  select * into v_target_account
    from public.table_accounts
   where id = p_target_account_id
     and user_id = p_restaurant_user_id
     and status in ('open', 'payment_pending')
   for update;
  if not found then
    raise exception 'A comanda de destino nao esta aberta.';
  end if;

  if v_source_account.id = v_target_account.id then
    raise exception 'Escolha outra comanda.';
  end if;
  if v_source_account.session_id is distinct from v_target_account.session_id then
    raise exception 'So e possivel dividir itens entre comandas da mesma mesa.';
  end if;

  v_source_quantity := round(greatest(v_item.quantity, 0), 3);
  v_move_quantity := round(greatest(coalesce(p_quantity, 0), 0), 3);
  if v_move_quantity <= 0 or v_move_quantity > v_source_quantity then
    raise exception 'Informe uma quantidade valida, de ate %.', v_source_quantity;
  end if;

  -- Evita que uma redistribuicao deixe uma comanda com pagamento maior que o total.
  select coalesce(sum(amount), 0) into v_source_paid
    from public.payments
   where account_id = v_source_account.id;

  select round(coalesce(sum(
           item.unit_price * greatest(item.quantity, 0) + coalesce(options.option_total, 0)
         ), 0), 2)
    into v_source_total
    from public.order_items item
    left join lateral (
      select sum(option.price * greatest(option.quantity, 1)) as option_total
        from public.order_item_options option
       where option.order_item_id = item.id
    ) options on true
   where item.account_id = v_source_account.id
     and item.status <> 'cancelled'
     and item.id <> v_item.id;

  v_source_total := round(v_source_total +
    v_item.unit_price * greatest(v_source_quantity - v_move_quantity, 0) + coalesce((
      select sum(option.price * greatest(option.quantity, 1))
             * greatest(v_source_quantity - v_move_quantity, 0) / v_source_quantity
        from public.order_item_options option
       where option.order_item_id = v_item.id
    ), 0), 2);

  if v_source_total + 0.009 < v_source_paid then
    raise exception 'Esta comanda ja possui pagamento. O valor que permaneceria nela seria menor que o recebido.';
  end if;

  if v_move_quantity = v_source_quantity then
    update public.order_items
       set account_id = v_target_account.id,
           updated_at = now()
     where id = v_item.id;
    v_created_item_id := v_item.id;
  else
    insert into public.order_items (
      session_id, account_id, order_id, product_id, product_name, quantity,
      sale_unit, unit_price, notes, status, sent_at, created_at, updated_at
    ) values (
      v_item.session_id, v_target_account.id, v_item.order_id, v_item.product_id,
      v_item.product_name, v_move_quantity, v_item.sale_unit, v_item.unit_price,
      v_item.notes, v_item.status, v_item.sent_at, now(), now()
    ) returning id into v_created_item_id;

    insert into public.order_item_options (order_item_id, option_name, price, quantity, created_at)
    select v_created_item_id, option_name,
           round(price * v_move_quantity / v_source_quantity, 2), quantity, now()
      from public.order_item_options
     where order_item_id = v_item.id;

    update public.order_item_options
       set price = round(price * (v_source_quantity - v_move_quantity) / v_source_quantity, 2)
     where order_item_id = v_item.id;

    update public.order_items
       set quantity = round(v_source_quantity - v_move_quantity, 3),
           updated_at = now()
     where id = v_item.id;
  end if;

  select round(coalesce(sum(
           item.unit_price * greatest(item.quantity, 0) + coalesce(options.option_total, 0)
         ), 0), 2)
    into v_source_total
    from public.order_items item
    left join lateral (
      select sum(option.price * greatest(option.quantity, 1)) as option_total
        from public.order_item_options option
       where option.order_item_id = item.id
    ) options on true
   where item.account_id = v_source_account.id
     and item.status <> 'cancelled';

  select round(coalesce(sum(
           item.unit_price * greatest(item.quantity, 0) + coalesce(options.option_total, 0)
         ), 0), 2)
    into v_target_total
    from public.order_items item
    left join lateral (
      select sum(option.price * greatest(option.quantity, 1)) as option_total
        from public.order_item_options option
       where option.order_item_id = item.id
    ) options on true
   where item.account_id = v_target_account.id
     and item.status <> 'cancelled';

  update public.table_accounts set total = v_source_total, updated_at = now()
   where id = v_source_account.id;
  update public.table_accounts set total = v_target_total, updated_at = now()
   where id = v_target_account.id;

  insert into public.table_item_splits (
    restaurant_user_id, session_id, source_account_id, target_account_id,
    source_item_id, created_item_id, moved_quantity, created_by_waiter_id
  ) values (
    p_restaurant_user_id, v_item.session_id, v_source_account.id, v_target_account.id,
    v_item.id, v_created_item_id, v_move_quantity, p_waiter_id
  );

  return jsonb_build_object(
    'source_account_id', v_source_account.id,
    'target_account_id', v_target_account.id,
    'source_item_id', v_item.id,
    'created_item_id', v_created_item_id,
    'moved_quantity', v_move_quantity,
    'source_total', v_source_total,
    'target_total', v_target_total
  );
end;
$$;

revoke all on function public.redistribute_table_order_item(uuid, uuid, uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.redistribute_table_order_item(uuid, uuid, uuid, uuid, numeric)
  to service_role;

comment on function public.redistribute_table_order_item(uuid, uuid, uuid, uuid, numeric) is
  'Divide ou move a cobranca de um item entre comandas da mesma mesa sem reenviar o pedido para producao.';

notify pgrst, 'reload schema';
