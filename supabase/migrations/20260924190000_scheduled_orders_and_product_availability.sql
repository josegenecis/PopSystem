alter table public.products
  add column if not exists is_daily_special boolean not null default false,
  add column if not exists availability_schedule jsonb;

alter table public.orders
  add column if not exists scheduled_at timestamptz;

create index if not exists products_daily_special_idx
  on public.products (user_id, is_daily_special)
  where is_daily_special = true;

create index if not exists orders_scheduled_pending_idx
  on public.orders (user_id, scheduled_at)
  where scheduled_at is not null and status = 'pending';

comment on column public.products.is_daily_special is
  'Destaca o produto como prato do dia quando sua agenda de disponibilidade estiver ativa.';

comment on column public.products.availability_schedule is
  'Agenda opcional do produto: {enabled, days:[0..6], start_time, end_time}.';

comment on column public.orders.scheduled_at is
  'Data e hora escolhidas pelo cliente para entrega ou retirada futura.';
