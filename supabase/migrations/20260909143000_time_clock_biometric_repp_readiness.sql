create extension if not exists pgcrypto;

alter table public.employee_time_clock_settings
  add column if not exists biometric_enabled boolean not null default false,
  add column if not exists rep_mode text not null default 'internal'
    check (rep_mode in ('internal', 'rep_p')),
  add column if not exists legal_activation_status text not null default 'draft'
    check (legal_activation_status in ('draft', 'technical_review', 'ready')),
  add column if not exists inpi_registration text,
  add column if not exists employer_name text,
  add column if not exists employer_document text,
  add column if not exists caepf text,
  add column if not exists cno text,
  add column if not exists establishment_address text,
  add column if not exists legal_timezone text not null default 'America/Fortaleza',
  add column if not exists biometric_policy_version text not null default '2026-09-biometria-v1',
  add column if not exists biometric_retention_days integer not null default 1825
    check (biometric_retention_days between 30 and 3650),
  add column if not exists biometric_legal_basis text not null default 'obrigacao_legal_regulatoria',
  add column if not exists pades_signing_key_id text,
  add column if not exists afd_signing_key_id text,
  add column if not exists technical_responsibility_document_url text,
  add column if not exists legal_validation_at timestamptz,
  add column if not exists legal_validated_by uuid references auth.users(id) on delete set null;

create table if not exists public.employee_time_clock_collectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  label text not null,
  provider text not null,
  model text,
  serial_number text,
  software_version text,
  installation_location text,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create table if not exists public.employee_biometric_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  waiter_id uuid not null references public.waiters(id) on delete cascade,
  collector_id uuid references public.employee_time_clock_collectors(id) on delete set null,
  provider text not null,
  provider_reference text not null,
  template_hash text not null,
  finger_position text not null default 'unknown',
  quality_score numeric(6,4),
  status text not null default 'active' check (status in ('active', 'revoked', 'replaced')),
  policy_version text not null,
  legal_basis text not null,
  privacy_notice_accepted_at timestamptz not null,
  enrolled_by uuid not null,
  enrolled_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  metadata jsonb not null default '{}'::jsonb,
  constraint employee_biometric_template_hash_format check (template_hash ~ '^[a-f0-9]{64}$'),
  constraint employee_biometric_no_raw_cloud_data check (
    not (metadata ?| array['template', 'raw_template', 'biometric_template', 'image', 'fingerprint_image'])
  )
);

create unique index if not exists idx_employee_biometric_active_finger
  on public.employee_biometric_enrollments(user_id, waiter_id, finger_position)
  where status = 'active';

create unique index if not exists idx_employee_biometric_provider_reference
  on public.employee_biometric_enrollments(user_id, provider, provider_reference)
  where status = 'active';

create table if not exists public.employee_time_clock_nsr_sequences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  next_nsr bigint not null default 1 check (next_nsr > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_time_clock_audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  waiter_id uuid references public.waiters(id) on delete set null,
  collector_id uuid references public.employee_time_clock_collectors(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  actor_user_id uuid,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);

alter table public.employee_time_clock_events
  add column if not exists nsr bigint,
  add column if not exists recorded_at timestamptz,
  add column if not exists collector_id uuid references public.employee_time_clock_collectors(id) on delete restrict,
  add column if not exists source text not null default 'web'
    check (source in ('web', 'face', 'biometric', 'manual', 'offline_biometric')),
  add column if not exists offline_id uuid,
  add column if not exists previous_hash text,
  add column if not exists mark_hash text,
  add column if not exists timezone_name text,
  add column if not exists employee_name_snapshot text,
  add column if not exists employee_cpf_snapshot text,
  add column if not exists employer_name_snapshot text,
  add column if not exists employer_document_snapshot text,
  add column if not exists establishment_address_snapshot text,
  add column if not exists receipt_payload jsonb,
  add column if not exists receipt_available boolean not null default false,
  add column if not exists is_rep_record boolean not null default false;

create unique index if not exists idx_time_clock_events_user_nsr
  on public.employee_time_clock_events(user_id, nsr)
  where nsr is not null;

create unique index if not exists idx_time_clock_events_user_offline_id
  on public.employee_time_clock_events(user_id, offline_id)
  where offline_id is not null;

create index if not exists idx_time_clock_events_collector
  on public.employee_time_clock_events(collector_id, occurred_at desc)
  where collector_id is not null;

alter table public.employee_time_clock_collectors enable row level security;
alter table public.employee_biometric_enrollments enable row level security;
alter table public.employee_time_clock_nsr_sequences enable row level security;
alter table public.employee_time_clock_audit_log enable row level security;

drop policy if exists time_clock_collectors_owner_all on public.employee_time_clock_collectors;
create policy time_clock_collectors_owner_all
  on public.employee_time_clock_collectors for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists biometric_enrollments_owner_all on public.employee_biometric_enrollments;
create policy biometric_enrollments_owner_all
  on public.employee_biometric_enrollments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists time_clock_nsr_owner_select on public.employee_time_clock_nsr_sequences;
create policy time_clock_nsr_owner_select
  on public.employee_time_clock_nsr_sequences for select
  using (auth.uid() = user_id);

drop policy if exists time_clock_audit_owner_select on public.employee_time_clock_audit_log;
create policy time_clock_audit_owner_select
  on public.employee_time_clock_audit_log for select
  using (auth.uid() = user_id);

create or replace function public.prevent_rep_record_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_rep_record then
    raise exception 'Registros REP-P são imutáveis. Correções devem ser lançadas no programa de tratamento.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_prevent_rep_record_mutation on public.employee_time_clock_events;
create trigger trg_prevent_rep_record_mutation
before update or delete on public.employee_time_clock_events
for each row execute function public.prevent_rep_record_mutation();

create or replace function public.prevent_time_clock_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'A trilha de auditoria do ponto é somente de acréscimo.';
end;
$$;

drop trigger if exists trg_prevent_time_clock_audit_mutation on public.employee_time_clock_audit_log;
create trigger trg_prevent_time_clock_audit_mutation
before update or delete on public.employee_time_clock_audit_log
for each row execute function public.prevent_time_clock_audit_mutation();

create or replace function public.protect_biometric_enrollment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Cadastros biométricos não podem ser apagados; use a revogação.';
  end if;

  if row(
    old.user_id, old.waiter_id, old.collector_id, old.provider,
    old.provider_reference, old.template_hash, old.finger_position,
    old.policy_version, old.legal_basis, old.privacy_notice_accepted_at,
    old.enrolled_by, old.enrolled_at
  ) is distinct from row(
    new.user_id, new.waiter_id, new.collector_id, new.provider,
    new.provider_reference, new.template_hash, new.finger_position,
    new.policy_version, new.legal_basis, new.privacy_notice_accepted_at,
    new.enrolled_by, new.enrolled_at
  ) then
    raise exception 'Os dados originais do cadastro biométrico são imutáveis; revogue e cadastre novamente.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_biometric_enrollment on public.employee_biometric_enrollments;
create trigger trg_protect_biometric_enrollment
before update or delete on public.employee_biometric_enrollments
for each row execute function public.protect_biometric_enrollment();

create or replace function public.validate_repp_legal_activation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.legal_activation_status = 'ready' and (
    nullif(trim(coalesce(new.inpi_registration, '')), '') is null
    or nullif(trim(coalesce(new.employer_name, '')), '') is null
    or nullif(trim(coalesce(new.employer_document, '')), '') is null
    or nullif(trim(coalesce(new.establishment_address, '')), '') is null
    or nullif(trim(coalesce(new.pades_signing_key_id, '')), '') is null
    or nullif(trim(coalesce(new.afd_signing_key_id, '')), '') is null
    or nullif(trim(coalesce(new.technical_responsibility_document_url, '')), '') is null
    or new.legal_validation_at is null
    or new.legal_validated_by is null
  ) then
    raise exception 'Ativação REP-P bloqueada: conclua INPI, ICP-Brasil/PAdES, AFD e validação técnica.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_repp_legal_activation on public.employee_time_clock_settings;
create trigger trg_validate_repp_legal_activation
before insert or update of legal_activation_status on public.employee_time_clock_settings
for each row execute function public.validate_repp_legal_activation();

create or replace function public.audit_biometric_enrollment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.employee_time_clock_audit_log (
    user_id, waiter_id, collector_id, action, entity_type, entity_id, actor_user_id, payload
  ) values (
    new.user_id,
    new.waiter_id,
    new.collector_id,
    case when tg_op = 'INSERT' then 'biometric_enrolled' else 'biometric_status_changed' end,
    'biometric_enrollment',
    new.id::text,
    auth.uid(),
    jsonb_build_object(
      'provider', new.provider,
      'finger_position', new.finger_position,
      'status', new.status,
      'template_hash', new.template_hash,
      'policy_version', new.policy_version
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_biometric_enrollment on public.employee_biometric_enrollments;
create trigger trg_audit_biometric_enrollment
after insert or update of status on public.employee_biometric_enrollments
for each row execute function public.audit_biometric_enrollment_change();

create or replace function public.register_biometric_time_clock_event(
  p_waiter_id uuid,
  p_collector_id uuid,
  p_provider_reference text,
  p_offline_id uuid default null,
  p_occurred_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns setof public.employee_time_clock_events
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_waiter public.waiters%rowtype;
  v_collector public.employee_time_clock_collectors%rowtype;
  v_settings public.employee_time_clock_settings%rowtype;
  v_enrollment public.employee_biometric_enrollments%rowtype;
  v_occurred_at timestamptz := coalesce(p_occurred_at, clock_timestamp());
  v_recorded_at timestamptz := clock_timestamp();
  v_event_type text;
  v_last_type text;
  v_nsr bigint;
  v_previous_hash text;
  v_mark_hash text;
  v_receipt jsonb;
  v_event public.employee_time_clock_events%rowtype;
  v_canonical text;
begin
  if v_user_id is null then
    raise exception 'Sessão autenticada obrigatória.';
  end if;

  if p_offline_id is not null then
    select * into v_event
    from public.employee_time_clock_events
    where user_id = v_user_id and offline_id = p_offline_id;
    if found then
      return next v_event;
      return;
    end if;
  end if;

  if v_occurred_at > v_recorded_at + interval '5 minutes'
     or v_occurred_at < v_recorded_at - interval '7 days' then
    raise exception 'Horário da marcação fora da janela de sincronização permitida.';
  end if;

  select * into v_waiter
  from public.waiters
  where id = p_waiter_id and user_id = v_user_id and coalesce(active, true)
  for share;
  if not found then raise exception 'Funcionário não encontrado ou inativo.'; end if;

  if length(regexp_replace(coalesce(v_waiter.cpf, ''), '\D', '', 'g')) <> 11 then
    raise exception 'Cadastre um CPF válido para emitir o comprovante legal do ponto.';
  end if;

  select * into v_collector
  from public.employee_time_clock_collectors
  where id = p_collector_id and user_id = v_user_id and enabled
  for update;
  if not found then raise exception 'Coletor biométrico não autorizado.'; end if;

  select * into v_enrollment
  from public.employee_biometric_enrollments
  where user_id = v_user_id
    and waiter_id = p_waiter_id
    and provider = v_collector.provider
    and provider_reference = p_provider_reference
    and status = 'active'
  limit 1;
  if not found then raise exception 'Biometria não cadastrada ou revogada.'; end if;

  select * into v_settings
  from public.employee_time_clock_settings
  where user_id = v_user_id;
  if not found or not v_settings.enabled or not v_settings.biometric_enabled then
    raise exception 'Ponto biométrico não está habilitado para este estabelecimento.';
  end if;

  if exists (
    select 1
    from public.employee_time_clock_events
    where user_id = v_user_id
      and waiter_id = p_waiter_id
      and occurred_at >= v_occurred_at - interval '60 seconds'
      and status <> 'rejected'
  ) then
    raise exception 'Ponto já registrado há menos de 60 segundos.';
  end if;

  select event_type into v_last_type
  from public.employee_time_clock_events
  where user_id = v_user_id
    and waiter_id = p_waiter_id
    and status <> 'rejected'
    and (occurred_at at time zone v_settings.legal_timezone)::date =
        (v_occurred_at at time zone v_settings.legal_timezone)::date
  order by occurred_at desc
  limit 1;

  v_event_type := case v_last_type
    when 'clock_in' then 'break_start'
    when 'break_start' then 'break_end'
    when 'break_end' then 'clock_out'
    when 'clock_out' then 'clock_in'
    else 'clock_in'
  end;

  insert into public.employee_time_clock_nsr_sequences(user_id, next_nsr)
  values (v_user_id, 2)
  on conflict (user_id) do update
    set next_nsr = public.employee_time_clock_nsr_sequences.next_nsr + 1,
        updated_at = clock_timestamp()
  returning next_nsr - 1 into v_nsr;

  select mark_hash into v_previous_hash
  from public.employee_time_clock_events
  where user_id = v_user_id and nsr is not null
  order by nsr desc
  limit 1;

  v_canonical := concat_ws('|',
    v_nsr::text,
    v_user_id::text,
    p_waiter_id::text,
    to_char(v_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    to_char(v_recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    p_collector_id::text,
    v_collector.device_id,
    coalesce(v_previous_hash, '')
  );
  v_mark_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  v_receipt := jsonb_build_object(
    'title', 'Comprovante de Registro de Ponto do Trabalhador',
    'nsr', v_nsr,
    'employer_name', coalesce(v_settings.employer_name, ''),
    'employer_document', regexp_replace(coalesce(v_settings.employer_document, ''), '\D', '', 'g'),
    'caepf', regexp_replace(coalesce(v_settings.caepf, ''), '\D', '', 'g'),
    'cno', regexp_replace(coalesce(v_settings.cno, ''), '\D', '', 'g'),
    'establishment_address', coalesce(v_settings.establishment_address, ''),
    'employee_name', coalesce(v_waiter.name, ''),
    'employee_cpf', regexp_replace(coalesce(v_waiter.cpf, ''), '\D', '', 'g'),
    'occurred_at', v_occurred_at,
    'timezone', v_settings.legal_timezone,
    'inpi_registration', regexp_replace(coalesce(v_settings.inpi_registration, ''), '\D', '', 'g'),
    'sha256', v_mark_hash,
    'signature_status', case when v_settings.legal_activation_status = 'ready' then 'pending_pades' else 'homologation' end
  );

  insert into public.employee_time_clock_events (
    user_id, waiter_id, event_type, status, occurred_at, recorded_at,
    collector_id, source, offline_id, previous_hash, mark_hash, timezone_name,
    device_fingerprint, device_trusted, face_status, metadata,
    employee_name_snapshot, employee_cpf_snapshot, employer_name_snapshot,
    employer_document_snapshot, establishment_address_snapshot,
    receipt_payload, receipt_available, is_rep_record, nsr
  ) values (
    v_user_id, p_waiter_id, v_event_type, 'approved', v_occurred_at, v_recorded_at,
    p_collector_id,
    case when p_occurred_at is null then 'biometric' else 'offline_biometric' end,
    p_offline_id, v_previous_hash, v_mark_hash, v_settings.legal_timezone,
    v_collector.device_id, true, 'not_configured', coalesce(p_metadata, '{}'::jsonb),
    v_waiter.name, regexp_replace(v_waiter.cpf, '\D', '', 'g'),
    v_settings.employer_name, regexp_replace(coalesce(v_settings.employer_document, ''), '\D', '', 'g'),
    v_settings.establishment_address, v_receipt, true, true, v_nsr
  ) returning * into v_event;

  update public.employee_time_clock_collectors
  set last_seen_at = v_recorded_at, updated_at = v_recorded_at
  where id = p_collector_id;

  insert into public.employee_time_clock_audit_log (
    user_id, waiter_id, collector_id, action, entity_type, entity_id, actor_user_id, payload
  ) values (
    v_user_id, p_waiter_id, p_collector_id, 'time_clock_punched', 'time_clock_event',
    v_event.id::text, v_user_id,
    jsonb_build_object('nsr', v_nsr, 'event_type', v_event_type, 'mark_hash', v_mark_hash, 'source', v_event.source)
  );

  return next v_event;
end;
$$;

revoke all on function public.register_biometric_time_clock_event(uuid, uuid, text, uuid, timestamptz, jsonb) from public;
grant execute on function public.register_biometric_time_clock_event(uuid, uuid, text, uuid, timestamptz, jsonb) to authenticated;

comment on table public.employee_biometric_enrollments is
  'Mantém somente referência e hash do template biométrico; imagem e template bruto não devem ser enviados à nuvem.';
comment on column public.employee_time_clock_events.mark_hash is
  'SHA-256 encadeado da marcação REP-P para evidenciar integridade.';
comment on function public.register_biometric_time_clock_event is
  'Registra marcação biométrica atômica, atribui NSR, cria hash SHA-256 e preserva instantâneos do comprovante.';
