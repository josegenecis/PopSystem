-- Purchase invoice reversals are accounting corrections, not operational usage.

create or replace function public.get_inventory_purchase_suggestions(
  p_store_user_id uuid,
  p_history_days integer default 30,
  p_cover_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_history_days integer := greatest(least(coalesce(p_history_days, 30), 180), 7);
  v_cover_days integer := greatest(least(coalesce(p_cover_days, 7), 60), 1);
  v_result jsonb;
begin
  if p_store_user_id is null then raise exception 'Restaurante não informado.'; end if;
  if auth.role() <> 'service_role' and auth.uid() is distinct from p_store_user_id then
    raise exception 'Você não possui acesso às sugestões deste restaurante.';
  end if;

  with ingredient_consumption as (
    select movement.ingredient_id,
      coalesce(sum(case
        when movement.movement_type in ('sale', 'out', 'loss')
          and not (movement.movement_type = 'out' and coalesce(movement.reason, '') ilike 'Estorno da nota de compra%')
          then abs(movement.quantity)
        when movement.movement_type = 'return' then -abs(movement.quantity)
        else 0 end), 0)::numeric as consumed
    from public.stock_movements movement
    where movement.user_id = p_store_user_id
      and movement.created_at >= now() - make_interval(days => v_history_days)
    group by movement.ingredient_id
  ),
  ingredient_rows as (
    select 'ingredient'::text item_type, ingredient.id item_id, ingredient.name,
      coalesce(ingredient.current_stock, 0)::numeric current_stock,
      coalesce(ingredient.min_stock, 0)::numeric minimum_stock,
      ingredient.unit stock_unit,
      coalesce(nullif(ingredient.purchase_unit, ''), ingredient.unit) purchase_unit,
      greatest(coalesce(ingredient.purchase_conversion, 1), 0.000001)::numeric purchase_conversion,
      greatest(coalesce(consumption.consumed, 0), 0)::numeric consumed_in_period,
      (greatest(coalesce(consumption.consumed, 0), 0) / v_history_days)::numeric average_daily_consumption
    from public.ingredients ingredient
    left join ingredient_consumption consumption on consumption.ingredient_id = ingredient.id
    where ingredient.user_id = p_store_user_id
      and coalesce(ingredient.is_active, true) = true
      and coalesce(ingredient.stock_controlled, true) = true
  ),
  product_consumption as (
    select movement.product_id,
      coalesce(sum(case when movement.type = 'sale' then abs(movement.quantity)
        when movement.type = 'return' then -abs(movement.quantity) else 0 end), 0)::numeric consumed
    from public.inventory_movements movement
    where movement.user_id = p_store_user_id
      and movement.created_at >= now() - make_interval(days => v_history_days)
    group by movement.product_id
  ),
  product_rows as (
    select 'product'::text item_type, product.id item_id, product.name,
      coalesce(product.stock_quantity, 0)::numeric current_stock,
      coalesce(product.low_stock_threshold, 0)::numeric minimum_stock,
      'un'::text stock_unit, 'un'::text purchase_unit, 1::numeric purchase_conversion,
      greatest(coalesce(consumption.consumed, 0), 0)::numeric consumed_in_period,
      (greatest(coalesce(consumption.consumed, 0), 0) / v_history_days)::numeric average_daily_consumption
    from public.products product
    left join product_consumption consumption on consumption.product_id = product.id
    where product.user_id = p_store_user_id and product.track_stock = true
  ),
  candidates as (select * from ingredient_rows union all select * from product_rows),
  calculated as (
    select *, greatest(minimum_stock, average_daily_consumption * v_cover_days)::numeric target_stock
    from candidates
  ),
  suggestions as (
    select *, greatest(target_stock - current_stock, 0)::numeric suggested_stock_quantity,
      ceil(greatest(target_stock - current_stock, 0) / purchase_conversion)::numeric suggested_purchase_quantity,
      case when current_stock <= 0 then 'Sem estoque'
        when current_stock <= minimum_stock then 'Abaixo do estoque mínimo'
        else 'Cobertura abaixo de ' || v_cover_days || ' dias' end reason,
      case when average_daily_consumption > 0 then round(current_stock / average_daily_consumption, 1) else null end days_remaining
    from calculated
    where target_stock > current_stock and (minimum_stock > 0 or average_daily_consumption > 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_type', item_type, 'item_id', item_id, 'name', name,
    'current_stock', round(current_stock, 3), 'minimum_stock', round(minimum_stock, 3),
    'stock_unit', stock_unit, 'purchase_unit', purchase_unit,
    'purchase_conversion', round(purchase_conversion, 6),
    'consumed_in_period', round(consumed_in_period, 3),
    'average_daily_consumption', round(average_daily_consumption, 3),
    'target_stock', round(target_stock, 3),
    'suggested_stock_quantity', round(suggested_stock_quantity, 3),
    'suggested_purchase_quantity', round(suggested_purchase_quantity, 3),
    'days_remaining', days_remaining, 'reason', reason,
    'history_days', v_history_days, 'cover_days', v_cover_days
  ) order by case when current_stock <= 0 then 0 when current_stock <= minimum_stock then 1 else 2 end,
    days_remaining nulls last, name), '[]'::jsonb)
  into v_result from suggestions;

  return v_result;
end;
$$;

revoke all on function public.get_inventory_purchase_suggestions(uuid, integer, integer) from public;
grant execute on function public.get_inventory_purchase_suggestions(uuid, integer, integer) to authenticated, service_role;
