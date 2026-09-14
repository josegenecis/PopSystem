-- Central Operacional de Clientes PopSystem.
-- Mantem profiles/subscriptions como fontes principais e adiciona somente dados internos.

create table if not exists public.internal_admin_members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  role text not null default 'support' check (role in ('owner','finance','success','support','operations','viewer')),
  permissions jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.internal_client_assignments (
  client_user_id uuid primary key references auth.users(id) on delete cascade,
  owner_member_id uuid references public.internal_admin_members(id) on delete set null,
  commercial_stage text not null default 'customer' check (commercial_stage in ('lead','trial','customer','expansion','churn_risk','churned')),
  onboarding_stage text not null default 'registered' check (onboarding_stage in ('registered','configuring','first_sale','operational','paused')),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  next_action text,
  next_action_at timestamptz,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.internal_client_notes (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'general' check (category in ('general','commercial','financial','success','support','technical')),
  content text not null check (char_length(btrim(content)) between 1 and 5000),
  created_by_member_id uuid references public.internal_admin_members(id) on delete set null,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.internal_client_tasks (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text,
  type text not null default 'follow_up' check (type in ('follow_up','collection','onboarding','support','renewal','technical')),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  due_at timestamptz,
  assigned_member_id uuid references public.internal_admin_members(id) on delete set null,
  created_by_email text not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_activity_events (
  id bigint generated always as identity primary key,
  client_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  source text not null default 'app',
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text not null default 'asaas',
  provider_payment_id text not null,
  provider_subscription_id text,
  status text not null,
  amount numeric(12,2) not null default 0,
  net_amount numeric(12,2),
  billing_type text,
  due_date date,
  paid_at timestamptz,
  invoice_url text,
  pix_copy_paste text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create table if not exists public.client_health_snapshots (
  id bigint generated always as identity primary key,
  client_user_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  classification text not null check (classification in ('healthy','attention','risk','critical')),
  reasons jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  snapshot_date date not null default current_date,
  calculated_at timestamptz not null default now()
);

create table if not exists public.internal_admin_audit_events (
  id bigint generated always as identity primary key,
  actor_email text not null,
  actor_member_id uuid references public.internal_admin_members(id) on delete set null,
  action text not null,
  client_user_id uuid references auth.users(id) on delete set null,
  entity_type text,
  entity_id text,
  reason text,
  before_data jsonb,
  after_data jsonb,
  request_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists internal_client_tasks_queue_idx on public.internal_client_tasks (status, due_at, priority);
create index if not exists internal_client_tasks_client_idx on public.internal_client_tasks (client_user_id, created_at desc);
create index if not exists internal_client_notes_client_idx on public.internal_client_notes (client_user_id, created_at desc);
create index if not exists client_activity_events_client_idx on public.client_activity_events (client_user_id, occurred_at desc);
create index if not exists subscription_invoices_user_due_idx on public.subscription_invoices (user_id, due_date desc);
create index if not exists subscription_invoices_status_due_idx on public.subscription_invoices (status, due_date);
create index if not exists client_health_snapshots_client_idx on public.client_health_snapshots (client_user_id, calculated_at desc);
create unique index if not exists client_health_snapshots_daily_unique on public.client_health_snapshots (client_user_id, snapshot_date);
create index if not exists internal_admin_audit_client_idx on public.internal_admin_audit_events (client_user_id, created_at desc);

alter table public.internal_admin_members enable row level security;
alter table public.internal_client_assignments enable row level security;
alter table public.internal_client_notes enable row level security;
alter table public.internal_client_tasks enable row level security;
alter table public.client_activity_events enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.client_health_snapshots enable row level security;
alter table public.internal_admin_audit_events enable row level security;

revoke all on public.internal_admin_members, public.internal_client_assignments,
  public.internal_client_notes, public.internal_client_tasks, public.subscription_invoices,
  public.client_health_snapshots, public.internal_admin_audit_events from anon, authenticated;
grant all on public.internal_admin_members, public.internal_client_assignments,
  public.internal_client_notes, public.internal_client_tasks, public.subscription_invoices,
  public.client_health_snapshots, public.internal_admin_audit_events to service_role;

-- A própria conta pode apenas registrar telemetria funcional sem ler dados internos.
revoke all on public.client_activity_events from anon, authenticated;
grant insert on public.client_activity_events to authenticated;
grant all on public.client_activity_events to service_role;
create policy client_activity_insert_own on public.client_activity_events
  for insert to authenticated with check (auth.uid() = client_user_id);

create or replace function public.record_client_activity(p_event_type text, p_source text default 'app', p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  insert into public.client_activity_events(client_user_id,event_type,source,metadata)
  values(auth.uid(), left(btrim(p_event_type),80), left(coalesce(nullif(btrim(p_source),''),'app'),40), coalesce(p_metadata,'{}'::jsonb));
end;
$$;
revoke all on function public.record_client_activity(text,text,jsonb) from public, anon;
grant execute on function public.record_client_activity(text,text,jsonb) to authenticated;
