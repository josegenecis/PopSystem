create table if not exists public.print_agent_tokens (
  id uuid primary key default gen_random_uuid(),
  restaurant_user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  token_hash text not null unique,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  restaurant_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued',
  job_type text not null default 'receipt',
  payload jsonb not null,
  attempts integer not null default 0,
  error text,
  picked_at timestamptz,
  picked_by uuid references public.print_agent_tokens(id),
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.print_jobs
  add column if not exists idempotency_key text;

create index if not exists print_jobs_restaurant_status_created_idx
  on public.print_jobs (restaurant_user_id, status, created_at);

create unique index if not exists print_jobs_restaurant_idempotency_key_uidx
  on public.print_jobs (restaurant_user_id, idempotency_key);

create or replace function public.claim_print_jobs(
  p_token_hash text,
  p_limit integer default 5
)
returns setof public.print_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent public.print_agent_tokens%rowtype;
begin
  select *
    into v_agent
    from public.print_agent_tokens
   where token_hash = p_token_hash
     and revoked = false
   limit 1;

  if not found then
    return;
  end if;

  return query
  with candidates as (
    select job.id
      from public.print_jobs as job
     where job.restaurant_user_id = v_agent.restaurant_user_id
       and (
         job.status = 'queued'
         or (job.status = 'processing' and job.picked_at < now() - interval '45 seconds')
       )
     order by job.created_at asc
     for update skip locked
     limit least(20, greatest(1, coalesce(p_limit, 5)))
  )
  update public.print_jobs as job
     set status = 'processing',
         picked_at = now(),
         picked_by = v_agent.id,
         attempts = coalesce(job.attempts, 0) + 1,
         updated_at = now()
    from candidates
   where job.id = candidates.id
  returning job.*;
end;
$$;

revoke all on function public.claim_print_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_print_jobs(text, integer) to service_role;

alter table public.print_agent_tokens enable row level security;
alter table public.print_jobs enable row level security;

drop policy if exists print_agent_tokens_owner_all on public.print_agent_tokens;
create policy print_agent_tokens_owner_all
  on public.print_agent_tokens for all
  to authenticated
  using (auth.uid() = restaurant_user_id)
  with check (auth.uid() = restaurant_user_id);

drop policy if exists print_jobs_owner_all on public.print_jobs;
create policy print_jobs_owner_all
  on public.print_jobs for all
  to authenticated
  using (auth.uid() = restaurant_user_id)
  with check (auth.uid() = restaurant_user_id);
