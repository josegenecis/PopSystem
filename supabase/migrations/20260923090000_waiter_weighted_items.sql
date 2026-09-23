-- Permite que o App Garcom registre produtos vendidos por peso sem converter
-- gramas em unidades. A quantidade canonica permanece em quilogramas.
alter table public.order_items
  alter column quantity drop default;

alter table public.order_items
  alter column quantity type numeric(12, 3)
  using quantity::numeric;

alter table public.order_items
  alter column quantity set default 1,
  alter column quantity set not null;

alter table public.order_items
  add column if not exists sale_unit text not null default 'un';

alter table public.order_items
  drop constraint if exists order_items_sale_unit_check;

alter table public.order_items
  add constraint order_items_sale_unit_check
  check (sale_unit in ('un', 'kg'));

comment on column public.order_items.quantity is
  'Quantidade vendida; para sale_unit=kg aceita ate tres casas decimais.';

comment on column public.order_items.sale_unit is
  'Unidade de venda congelada no lancamento da comanda: un ou kg.';
