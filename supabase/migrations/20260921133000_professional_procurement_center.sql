-- Central profissional de compras, fornecedores, recebimentos, custos e validade.

alter table public.ingredients
  add column if not exists safety_stock numeric(18,6) not null default 0;

create table if not exists public.procurement_suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  document text,
  phone text,
  whatsapp text,
  email text,
  payment_terms text,
  minimum_order_amount numeric(18,2) not null default 0,
  average_lead_time_days integer not null default 1 check (average_lead_time_days between 0 and 365),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists procurement_suppliers_document_unique
  on public.procurement_suppliers(user_id, document) where document is not null and document <> '';
create index if not exists procurement_suppliers_user_name_idx on public.procurement_suppliers(user_id, name);

create table if not exists public.procurement_supplier_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.procurement_suppliers(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  supplier_sku text,
  purchase_unit text not null default 'un',
  conversion_factor numeric(18,6) not null default 1 check (conversion_factor > 0),
  minimum_order_quantity numeric(18,3) not null default 1 check (minimum_order_quantity > 0),
  package_multiple numeric(18,3) not null default 1 check (package_multiple > 0),
  last_unit_price numeric(18,6),
  lead_time_days integer check (lead_time_days between 0 and 365),
  preferred boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((ingredient_id is not null and product_id is null) or (ingredient_id is null and product_id is not null))
);
create unique index if not exists procurement_supplier_ingredient_unique
  on public.procurement_supplier_items(supplier_id, ingredient_id) where ingredient_id is not null;
create unique index if not exists procurement_supplier_product_unique
  on public.procurement_supplier_items(supplier_id, product_id) where product_id is not null;
create index if not exists procurement_supplier_items_lookup_idx
  on public.procurement_supplier_items(user_id, ingredient_id, product_id, preferred);

create table if not exists public.procurement_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid references public.procurement_suppliers(id) on delete set null,
  order_number text not null,
  status text not null default 'draft' check (status in ('draft','sent','confirmed','partial','received','cancelled')),
  expected_date date,
  notes text,
  subtotal numeric(18,2) not null default 0,
  freight numeric(18,2) not null default 0,
  discount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  sent_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, order_number)
);
create index if not exists procurement_orders_user_status_idx on public.procurement_orders(user_id, status, created_at desc);

create table if not exists public.procurement_order_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.procurement_orders(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  item_name text not null,
  purchase_unit text not null default 'un',
  conversion_factor numeric(18,6) not null default 1 check (conversion_factor > 0),
  ordered_quantity numeric(18,3) not null check (ordered_quantity > 0),
  received_quantity numeric(18,3) not null default 0 check (received_quantity >= 0),
  unit_price numeric(18,6) not null default 0,
  created_at timestamptz not null default now(),
  check ((ingredient_id is not null and product_id is null) or (ingredient_id is null and product_id is not null))
);
create index if not exists procurement_order_items_order_idx on public.procurement_order_items(order_id);

create table if not exists public.procurement_price_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid references public.procurement_suppliers(id) on delete set null,
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  purchase_order_id uuid references public.procurement_orders(id) on delete set null,
  invoice_import_id uuid references public.smart_invoice_imports(id) on delete set null,
  invoice_item_id uuid references public.smart_invoice_import_items(id) on delete set null,
  item_name text not null,
  purchase_unit text not null default 'un',
  quantity numeric(18,3) not null default 1,
  unit_price numeric(18,6) not null,
  recorded_at timestamptz not null default now(),
  check ((ingredient_id is not null and product_id is null) or (ingredient_id is null and product_id is not null))
);
create index if not exists procurement_price_history_lookup_idx
  on public.procurement_price_history(user_id, ingredient_id, product_id, recorded_at desc);
create unique index if not exists procurement_price_history_invoice_item_unique
  on public.procurement_price_history(invoice_item_id) where invoice_item_id is not null;

create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  purchase_order_id uuid references public.procurement_orders(id) on delete set null,
  batch_code text,
  expiration_date date,
  initial_quantity numeric(18,6) not null check (initial_quantity > 0),
  current_quantity numeric(18,6) not null check (current_quantity >= 0),
  unit text not null default 'un',
  unit_cost numeric(18,6) not null default 0,
  status text not null default 'active' check (status in ('active','consumed','expired','discarded')),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((ingredient_id is not null and product_id is null) or (ingredient_id is null and product_id is not null))
);
create index if not exists inventory_batches_expiration_idx on public.inventory_batches(user_id, status, expiration_date);

alter table public.smart_invoice_imports
  add column if not exists supplier_id uuid references public.procurement_suppliers(id) on delete set null;

do $$
declare table_name text;
begin
  foreach table_name in array array['procurement_suppliers','procurement_supplier_items','procurement_orders','procurement_order_items','procurement_price_history','inventory_batches']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists procurement_store_access on public.%I', table_name);
    execute format('create policy procurement_store_access on public.%I for all to authenticated using (public.can_access_store(user_id)) with check (public.can_access_store(user_id))', table_name);
  end loop;
end $$;

-- A entrada de compra também precisa funcionar quando um operador autorizado
-- está atuando na loja selecionada (auth.uid pode ser diferente do dono).
create or replace function public.record_ingredient_purchase(
  p_ingredient_id uuid, p_purchase_quantity numeric, p_purchase_unit_cost numeric,
  p_reason text default 'Entrada manual pelo estoque', p_owner_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  ingredient_row public.ingredients%rowtype;
  stock_added numeric(18,6); purchase_total numeric(18,6); converted_unit_cost numeric(18,6);
  previous_stock numeric(18,6); previous_value numeric(18,6); next_stock numeric(18,6); next_average_cost numeric(18,6);
  effective_owner uuid;
begin
  effective_owner := coalesce(p_owner_id, auth.uid());
  if effective_owner is null then raise exception 'Sessão expirada. Entre novamente.'; end if;
  if auth.role()<>'service_role' and not public.can_access_store(effective_owner) then raise exception 'Restaurante inválido para esta sessão.'; end if;
  if coalesce(p_purchase_quantity,0)<=0 then raise exception 'A quantidade comprada deve ser maior que zero.'; end if;
  if coalesce(p_purchase_unit_cost,0)<0 then raise exception 'O custo da compra não pode ser negativo.'; end if;

  select * into ingredient_row from public.ingredients
    where id=p_ingredient_id and user_id=effective_owner for update;
  if not found then raise exception 'Insumo não encontrado para este restaurante.'; end if;

  stock_added := round(p_purchase_quantity*coalesce(ingredient_row.purchase_conversion,1)*(coalesce(ingredient_row.yield_percentage,100)/100),6);
  if stock_added<=0 then raise exception 'A conversão da compra resultou em estoque zero.'; end if;
  purchase_total := round(p_purchase_quantity*p_purchase_unit_cost,6);
  converted_unit_cost := round(purchase_total/stock_added,6);
  previous_stock := greatest(coalesce(ingredient_row.current_stock,0),0);
  previous_value := round(previous_stock*coalesce(ingredient_row.cost_price,0),6);
  next_stock := round(coalesce(ingredient_row.current_stock,0)+stock_added,6);
  next_average_cost := case when previous_stock+stock_added>0
    then round((previous_value+purchase_total)/(previous_stock+stock_added),6) else converted_unit_cost end;

  update public.ingredients set current_stock=next_stock,cost_price=next_average_cost,
    last_purchase_cost=p_purchase_unit_cost,updated_at=now() where id=ingredient_row.id;
  insert into public.stock_movements(user_id,ingredient_id,movement_type,quantity,unit_cost,total_cost,balance_after,average_cost_after,reason)
    values(effective_owner,ingredient_row.id,'in',stock_added,converted_unit_cost,purchase_total,next_stock,next_average_cost,
      coalesce(nullif(trim(p_reason),''),'Entrada de estoque'));
  return jsonb_build_object('ingredient_id',ingredient_row.id,'stock_added',stock_added,'current_stock',next_stock,
    'average_cost',next_average_cost,'purchase_total',purchase_total);
end; $$;
revoke all on function public.record_ingredient_purchase(uuid,numeric,numeric,text,uuid) from public;
grant execute on function public.record_ingredient_purchase(uuid,numeric,numeric,text,uuid) to authenticated,service_role;

create or replace function public.receive_procurement_order(
  p_order_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.procurement_orders%rowtype;
  v_line public.procurement_order_items%rowtype;
  v_payload jsonb;
  v_qty numeric;
  v_stock_qty numeric;
  v_received_count integer := 0;
begin
  select * into v_order from public.procurement_orders where id = p_order_id for update;
  if not found or not public.can_access_store(v_order.user_id) then raise exception 'Pedido de compra não encontrado.'; end if;
  if v_order.status in ('received','cancelled') then raise exception 'Este pedido não aceita novos recebimentos.'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Informe os itens recebidos.'; end if;

  for v_payload in select value from jsonb_array_elements(p_items)
  loop
    select * into v_line from public.procurement_order_items
      where id = nullif(v_payload->>'item_id','')::uuid and order_id = v_order.id for update;
    if not found then raise exception 'Item de recebimento inválido.'; end if;
    v_qty := greatest(coalesce(nullif(v_payload->>'quantity','')::numeric, 0), 0);
    if v_qty <= 0 then continue; end if;
    if v_line.received_quantity + v_qty > v_line.ordered_quantity then
      raise exception 'A quantidade recebida de % supera a quantidade pedida.', v_line.item_name;
    end if;

    if v_line.ingredient_id is not null then
      perform public.record_ingredient_purchase(v_line.ingredient_id, v_qty, v_line.unit_price,
        'Recebimento do pedido de compra ' || v_order.order_number, v_order.user_id);
      select v_qty * coalesce(purchase_conversion, 1) * (coalesce(yield_percentage, 100) / 100)
        into v_stock_qty from public.ingredients where id = v_line.ingredient_id;
    else
      v_stock_qty := v_qty * v_line.conversion_factor;
      update public.products set stock_quantity = coalesce(stock_quantity,0) + v_stock_qty, updated_at = now()
        where id = v_line.product_id and user_id = v_order.user_id;
      insert into public.inventory_movements(user_id,product_id,type,quantity)
        values(v_order.user_id,v_line.product_id,'purchase',v_stock_qty);
    end if;

    update public.procurement_order_items set received_quantity = received_quantity + v_qty where id = v_line.id;
    insert into public.procurement_price_history(user_id,supplier_id,ingredient_id,product_id,purchase_order_id,item_name,purchase_unit,quantity,unit_price)
      values(v_order.user_id,v_order.supplier_id,v_line.ingredient_id,v_line.product_id,v_order.id,v_line.item_name,v_line.purchase_unit,v_qty,v_line.unit_price);

    if nullif(v_payload->>'batch_code','') is not null or nullif(v_payload->>'expiration_date','') is not null then
      insert into public.inventory_batches(user_id,ingredient_id,product_id,purchase_order_id,batch_code,expiration_date,initial_quantity,current_quantity,unit,unit_cost)
      values(v_order.user_id,v_line.ingredient_id,v_line.product_id,v_order.id,nullif(v_payload->>'batch_code',''),
        nullif(v_payload->>'expiration_date','')::date,v_stock_qty,v_stock_qty,
        case when v_line.ingredient_id is not null then (select unit from public.ingredients where id=v_line.ingredient_id) else 'un' end,
        case when v_stock_qty > 0 then v_line.unit_price / v_line.conversion_factor else v_line.unit_price end);
    end if;
    v_received_count := v_received_count + 1;
  end loop;

  update public.procurement_orders order_row set
    status = case when not exists(select 1 from public.procurement_order_items line where line.order_id=v_order.id and line.received_quantity < line.ordered_quantity) then 'received' else 'partial' end,
    received_at = case when not exists(select 1 from public.procurement_order_items line where line.order_id=v_order.id and line.received_quantity < line.ordered_quantity) then now() else received_at end,
    updated_at = now()
  where order_row.id=v_order.id;
  return jsonb_build_object('ok',true,'received_items',v_received_count,'order_id',v_order.id);
end;
$$;
revoke all on function public.receive_procurement_order(uuid,jsonb) from public;
grant execute on function public.receive_procurement_order(uuid,jsonb) to authenticated, service_role;

create or replace function public.get_procurement_purchase_suggestions(
  p_store_user_id uuid, p_history_days integer default 30, p_cover_days integer default 7
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_base jsonb; v_item jsonb; v_result jsonb := '[]'::jsonb; v_link record; v_on_order numeric; v_target numeric; v_needed numeric; v_purchase numeric; v_max_lead integer;
begin
  if auth.role() <> 'service_role' and not public.can_access_store(p_store_user_id) then raise exception 'Acesso negado.'; end if;
  select coalesce(max(coalesce(link.lead_time_days,supplier.average_lead_time_days,1)),1)
    into v_max_lead
    from public.procurement_supplier_items link
    join public.procurement_suppliers supplier on supplier.id=link.supplier_id and supplier.active=true
    where link.user_id=p_store_user_id and link.active=true;
  -- Busca uma janela ampla e recalcula cada item com seu prazo real. Assim um
  -- item que ainda cobre 7 dias, mas não cobre o prazo do fornecedor, não some.
  v_base := public.get_inventory_purchase_suggestions(p_store_user_id,p_history_days,least(p_cover_days+v_max_lead,60));
  for v_item in select value from jsonb_array_elements(v_base)
  loop
    select link.*, supplier.name supplier_name, supplier.whatsapp supplier_whatsapp,
      coalesce(link.lead_time_days,supplier.average_lead_time_days,1) effective_lead
    into v_link from public.procurement_supplier_items link
    join public.procurement_suppliers supplier on supplier.id=link.supplier_id and supplier.active=true
    where link.user_id=p_store_user_id and link.active=true
      and ((v_item->>'item_type'='ingredient' and link.ingredient_id=(v_item->>'item_id')::uuid)
        or (v_item->>'item_type'='product' and link.product_id=(v_item->>'item_id')::uuid))
    order by link.preferred desc, link.updated_at desc limit 1;

    select coalesce(sum(greatest(line.ordered_quantity-line.received_quantity,0) * line.conversion_factor),0)
    into v_on_order from public.procurement_order_items line join public.procurement_orders purchase on purchase.id=line.order_id
    where purchase.user_id=p_store_user_id and purchase.status in ('draft','sent','confirmed','partial')
      and ((v_item->>'item_type'='ingredient' and line.ingredient_id=(v_item->>'item_id')::uuid)
        or (v_item->>'item_type'='product' and line.product_id=(v_item->>'item_id')::uuid));

    v_target := greatest((v_item->>'target_stock')::numeric,
      (v_item->>'average_daily_consumption')::numeric * (p_cover_days + coalesce(v_link.effective_lead,1)) +
      case when v_item->>'item_type'='ingredient' then coalesce((select safety_stock from public.ingredients where id=(v_item->>'item_id')::uuid),0) else 0 end);
    v_needed := greatest(v_target-(v_item->>'current_stock')::numeric-v_on_order,0);
    v_purchase := ceil(v_needed/greatest(coalesce(v_link.conversion_factor,(v_item->>'purchase_conversion')::numeric,1),0.000001));
    if coalesce(v_link.package_multiple,1)>1 then v_purchase := ceil(v_purchase/v_link.package_multiple)*v_link.package_multiple; end if;
    v_purchase := greatest(v_purchase,case when v_needed>0 then coalesce(v_link.minimum_order_quantity,1) else 0 end);
    if v_purchase>0 then
      v_result := v_result || jsonb_build_array(v_item || jsonb_build_object(
        'target_stock',round(v_target,3),'on_order_stock',round(v_on_order,3),'suggested_stock_quantity',round(v_needed,3),
        'suggested_purchase_quantity',v_purchase,'supplier_id',v_link.supplier_id,'supplier_name',v_link.supplier_name,
        'supplier_whatsapp',v_link.supplier_whatsapp,'last_unit_price',v_link.last_unit_price,'lead_time_days',coalesce(v_link.effective_lead,1),
        'estimated_total',round(v_purchase*coalesce(v_link.last_unit_price,0),2),'cover_days',p_cover_days));
    end if;
  end loop;
  return v_result;
end; $$;
revoke all on function public.get_procurement_purchase_suggestions(uuid,integer,integer) from public;
grant execute on function public.get_procurement_purchase_suggestions(uuid,integer,integer) to authenticated,service_role;

create or replace function public.get_procurement_alerts(p_store_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_suggestions jsonb; v_expiring jsonb; v_price_increases jsonb; v_missing integer; v_pending integer; v_overdue integer;
begin
  if auth.role()<>'service_role' and not public.can_access_store(p_store_user_id) then raise exception 'Acesso negado.'; end if;
  v_suggestions:=public.get_procurement_purchase_suggestions(p_store_user_id,30,7);
  select coalesce(jsonb_agg(jsonb_build_object('id',batch.id,'name',coalesce(ingredient.name,product.name),'expiration_date',batch.expiration_date,'quantity',batch.current_quantity,'unit',batch.unit) order by batch.expiration_date),'[]'::jsonb)
    into v_expiring from public.inventory_batches batch left join public.ingredients ingredient on ingredient.id=batch.ingredient_id left join public.products product on product.id=batch.product_id
    where batch.user_id=p_store_user_id and batch.status='active' and batch.current_quantity>0 and batch.expiration_date<=current_date+14;
  select count(*) into v_missing from public.ingredients where user_id=p_store_user_id and coalesce(is_active,true) and min_stock<=0;
  select count(*) into v_pending from public.smart_invoice_imports where user_id=p_store_user_id and status='draft';
  select count(*) into v_overdue from public.procurement_orders where user_id=p_store_user_id and status in('sent','confirmed','partial') and expected_date<current_date;
  with ranked as (
    select history.*, supplier.name supplier_name,
      row_number() over(partition by coalesce(history.ingredient_id,history.product_id) order by history.recorded_at desc) position,
      lead(history.unit_price) over(partition by coalesce(history.ingredient_id,history.product_id) order by history.recorded_at desc) previous_price
    from public.procurement_price_history history
    left join public.procurement_suppliers supplier on supplier.id=history.supplier_id
    where history.user_id=p_store_user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('item_name',item_name,'supplier_name',supplier_name,'unit_price',unit_price,
      'previous_price',previous_price,'increase_percent',round(((unit_price-previous_price)/previous_price)*100,1))), '[]'::jsonb)
    into v_price_increases from ranked
    where position=1 and previous_price>0 and unit_price>previous_price*1.05;
  return jsonb_build_object('suggestions',v_suggestions,'suggestion_count',jsonb_array_length(v_suggestions),'expiring_batches',v_expiring,
    'expiring_count',jsonb_array_length(v_expiring),'missing_minimum_count',v_missing,'pending_invoice_count',v_pending,'overdue_order_count',v_overdue,
    'price_increases',v_price_increases,'price_increase_count',jsonb_array_length(v_price_increases));
end; $$;
revoke all on function public.get_procurement_alerts(uuid) from public;
grant execute on function public.get_procurement_alerts(uuid) to authenticated,service_role;

create or replace function public.capture_purchase_invoice_procurement()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_supplier public.procurement_suppliers%rowtype; v_item public.smart_invoice_import_items%rowtype; v_link_id uuid;
begin
  if new.status <> 'committed' then return new; end if;
  if new.supplier_id is not null then
    select * into v_supplier from public.procurement_suppliers where id=new.supplier_id;
  end if;
  if v_supplier.id is null and new.supplier_document is not null then
    select * into v_supplier from public.procurement_suppliers where user_id=new.user_id and document=regexp_replace(new.supplier_document,'\D','','g') limit 1;
  end if;
  if v_supplier.id is null and new.supplier_name is not null then
    select * into v_supplier from public.procurement_suppliers where user_id=new.user_id and lower(trim(name))=lower(trim(new.supplier_name)) limit 1;
  end if;
  if v_supplier.id is null and new.supplier_name is not null then
    insert into public.procurement_suppliers(user_id,name,document)
      values(new.user_id,trim(new.supplier_name),nullif(regexp_replace(coalesce(new.supplier_document,''),'\D','','g'),'')) returning * into v_supplier;
  end if;
  if v_supplier.id is null then return new; end if;
  update public.smart_invoice_imports set supplier_id=v_supplier.id where id=new.id and supplier_id is distinct from v_supplier.id;

  for v_item in select * from public.smart_invoice_import_items where import_id=new.id and control_stock=true
  loop
    select id into v_link_id from public.procurement_supplier_items
      where supplier_id=v_supplier.id and ((ingredient_id is not null and ingredient_id=v_item.ingredient_id) or (product_id is not null and product_id=v_item.product_id)) limit 1;
    if v_link_id is null and (v_item.ingredient_id is not null or v_item.product_id is not null) then
      insert into public.procurement_supplier_items(user_id,supplier_id,ingredient_id,product_id,purchase_unit,conversion_factor,last_unit_price,preferred)
      values(new.user_id,v_supplier.id,v_item.ingredient_id,v_item.product_id,v_item.unit,v_item.conversion_factor,v_item.unit_price,
        not exists(select 1 from public.procurement_supplier_items existing where existing.user_id=new.user_id and existing.preferred=true
          and ((v_item.ingredient_id is not null and existing.ingredient_id=v_item.ingredient_id) or (v_item.product_id is not null and existing.product_id=v_item.product_id))));
    elsif v_link_id is not null then
      update public.procurement_supplier_items set last_unit_price=v_item.unit_price,purchase_unit=v_item.unit,
        conversion_factor=v_item.conversion_factor,updated_at=now() where id=v_link_id;
    end if;
    if v_item.ingredient_id is not null or v_item.product_id is not null then
      insert into public.procurement_price_history(user_id,supplier_id,ingredient_id,product_id,invoice_import_id,invoice_item_id,item_name,purchase_unit,quantity,unit_price,recorded_at)
      values(new.user_id,v_supplier.id,v_item.ingredient_id,v_item.product_id,new.id,v_item.id,v_item.normalized_name,v_item.unit,v_item.quantity,v_item.unit_price,coalesce(new.committed_at,new.updated_at,now()))
      on conflict (invoice_item_id) where invoice_item_id is not null do nothing;
    end if;
  end loop;
  return new;
end; $$;

drop trigger if exists capture_purchase_invoice_procurement_trigger on public.smart_invoice_imports;
create trigger capture_purchase_invoice_procurement_trigger
after insert or update of status on public.smart_invoice_imports
for each row execute function public.capture_purchase_invoice_procurement();

-- Backfill active committed invoices so the professional module starts with useful history.
update public.smart_invoice_imports set status=status where status='committed';
