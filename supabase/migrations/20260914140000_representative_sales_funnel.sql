-- Representative field-sales portal and auditable lead funnel.
alter table public.internal_admin_members
  drop constraint if exists internal_admin_members_role_check;

alter table public.internal_admin_members
  add constraint internal_admin_members_role_check
  check (role in ('owner','finance','success','support','operations','viewer','representative'));

create table if not exists public.commercial_leads (
  id uuid primary key default gen_random_uuid(),
  representative_member_id uuid not null references public.internal_admin_members(id) on delete restrict,
  restaurant_name text not null check (char_length(btrim(restaurant_name)) between 2 and 160),
  owner_name text not null check (char_length(btrim(owner_name)) between 2 and 120),
  owner_phone text not null check (owner_phone ~ '^55[0-9]{10,11}$'),
  email text,
  postal_code text not null check (postal_code ~ '^[0-9]{8}$'),
  city text not null,
  state text not null check (state ~ '^[A-Z]{2}$'),
  neighborhood text,
  street text,
  street_number text,
  complement text,
  interest_level text not null default 'warm' check (interest_level in ('cold','warm','hot')),
  commercial_stage text not null default 'new' check (commercial_stage in ('new','contacting','demo_scheduled','proposal','won','lost')),
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  marketing_consent_source text,
  marketing_status text not null default 'awaiting_consent' check (marketing_status in ('awaiting_consent','enrolled','unsubscribed')),
  funnel_entered_at timestamptz not null default now(),
  converted_user_id uuid references auth.users(id) on delete set null,
  last_visit_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_phone)
);

create table if not exists public.representative_visits (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.commercial_leads(id) on delete cascade,
  representative_member_id uuid not null references public.internal_admin_members(id) on delete restrict,
  visited_at timestamptz not null default now(),
  outcome text not null default 'registered' check (outcome in ('registered','interested','demo_scheduled','follow_up','not_interested','closed')),
  notes text check (notes is null or char_length(notes) <= 5000),
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz not null default now()
);

create index if not exists commercial_leads_representative_idx
  on public.commercial_leads (representative_member_id, updated_at desc);
create index if not exists commercial_leads_stage_idx
  on public.commercial_leads (commercial_stage, interest_level, updated_at desc);
create index if not exists commercial_leads_location_idx
  on public.commercial_leads (state, city);
create index if not exists representative_visits_member_idx
  on public.representative_visits (representative_member_id, visited_at desc);
create index if not exists representative_visits_lead_idx
  on public.representative_visits (lead_id, visited_at desc);

alter table public.commercial_leads enable row level security;
alter table public.representative_visits enable row level security;

revoke all on public.commercial_leads, public.representative_visits from public, anon, authenticated;
grant all on public.commercial_leads, public.representative_visits to service_role;

comment on table public.commercial_leads is
  'Prospects cadastrados em visitas de representantes e enviados ao funil comercial.';
comment on table public.representative_visits is
  'Histórico auditável das visitas realizadas por cada representante.';
comment on column public.commercial_leads.marketing_consent is
  'Consentimento explícito do contato para receber comunicações comerciais.';
