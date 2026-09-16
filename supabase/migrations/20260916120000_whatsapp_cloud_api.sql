alter table public.whatsapp_settings
  add column if not exists provider text not null default 'evolution';

alter table public.whatsapp_settings
  drop constraint if exists whatsapp_settings_provider_check;

alter table public.whatsapp_settings
  add constraint whatsapp_settings_provider_check
  check (provider in ('evolution', 'meta_cloud'));

-- Credenciais da Cloud API nunca ficam expostas ao navegador. Esta tabela não
-- possui policies: somente funções com service role podem ler ou alterar dados.
create table if not exists public.whatsapp_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  provider text not null,
  status text not null default 'connected',
  waba_id text,
  phone_number_id text,
  display_phone_number text,
  verified_name text,
  access_token_encrypted text not null,
  token_expires_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, provider),
  constraint whatsapp_provider_accounts_provider_check
    check (provider in ('meta_cloud')),
  constraint whatsapp_provider_accounts_status_check
    check (status in ('connected', 'disconnected', 'error'))
);

create unique index if not exists whatsapp_provider_accounts_phone_number_idx
  on public.whatsapp_provider_accounts (provider, phone_number_id)
  where phone_number_id is not null and status = 'connected';

alter table public.whatsapp_provider_accounts enable row level security;

comment on table public.whatsapp_provider_accounts is
  'Credenciais privadas de provedores WhatsApp, acessíveis somente pelo backend com service role.';

comment on column public.whatsapp_settings.provider is
  'Provedor ativo do restaurante. Evolution permanece como padrão para migração sem interrupção.';
