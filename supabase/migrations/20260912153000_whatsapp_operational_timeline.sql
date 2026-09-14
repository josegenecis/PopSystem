alter table public.whatsapp_conversations
  add column if not exists operational_status text not null default 'NEW';

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_operational_status_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_operational_status_check
  check (operational_status in (
    'NEW', 'OPEN', 'WAITING_CUSTOMER', 'WAITING_RESTAURANT',
    'AI_ACTIVE', 'HUMAN_ACTIVE', 'RESOLVED', 'ARCHIVED'
  ));

update public.whatsapp_conversations
set operational_status = case
  when queue_status = 'resolved' then 'RESOLVED'
  when owner = 'HUMAN' then 'HUMAN_ACTIVE'
  when owner = 'AI' then 'AI_ACTIVE'
  when queue_status = 'waiting_customer' then 'WAITING_CUSTOMER'
  when queue_status = 'assigned' then 'OPEN'
  else 'NEW'
end;

create table if not exists public.whatsapp_conversation_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  event_type text not null,
  description text not null,
  actor_id text,
  actor_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_conversation_events_timeline_idx
  on public.whatsapp_conversation_events (user_id, conversation_id, created_at desc);

alter table public.whatsapp_conversation_events enable row level security;
drop policy if exists "whatsapp_events_owner_read" on public.whatsapp_conversation_events;
create policy "whatsapp_events_owner_read"
  on public.whatsapp_conversation_events for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.log_whatsapp_conversation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_description text;
begin
  if old.operational_status is distinct from new.operational_status then
    v_type := 'status_changed';
    v_description := 'Status alterado de ' || old.operational_status || ' para ' || new.operational_status;
  elsif old.assigned_operator_id is distinct from new.assigned_operator_id then
    v_type := 'assignment_changed';
    v_description := case when new.assigned_operator_id is null
      then 'Atendimento devolvido para a fila'
      else 'Atendimento atribuído a ' || coalesce(new.assigned_operator_name, 'operador') end;
  elsif old.owner is distinct from new.owner then
    v_type := 'owner_changed';
    v_description := case when new.owner = 'AI' then 'Atendimento devolvido para a IA' else 'Atendimento humano ativado' end;
  else
    return new;
  end if;

  insert into public.whatsapp_conversation_events (
    user_id, conversation_id, event_type, description, actor_id, actor_name, metadata
  ) values (
    new.user_id, new.id, v_type, v_description, new.assigned_operator_id,
    new.assigned_operator_name,
    jsonb_build_object('previousStatus', old.operational_status, 'status', new.operational_status, 'owner', new.owner)
  );
  return new;
end;
$$;

drop trigger if exists whatsapp_conversation_change_event on public.whatsapp_conversations;
create trigger whatsapp_conversation_change_event
after update on public.whatsapp_conversations
for each row execute function public.log_whatsapp_conversation_change();

create or replace function public.increment_whatsapp_conversation_unread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.message_type, 'text') = 'order_draft' then return new; end if;
  if new.sender = 'customer' then
    update public.whatsapp_conversations
       set unread_count = coalesce(unread_count, 0) + 1,
           last_customer_message_at = new.sent_at,
           last_message_preview = left(new.content, 500), last_message_sender = new.sender, last_message_at = new.sent_at,
           queue_status = case when assigned_operator_id is null then 'new' else 'assigned' end,
           operational_status = case when assigned_operator_id is null then 'NEW' else 'WAITING_RESTAURANT' end,
           resolved_at = null, updated_at = greatest(coalesce(updated_at, new.sent_at), new.sent_at)
     where id = new.conversation_id;
  elsif new.sender in ('agent', 'bot') then
    update public.whatsapp_conversations
       set unread_count = case when new.sender = 'agent' then 0 else unread_count end,
           first_response_at = case when new.sender = 'agent' then coalesce(first_response_at, new.sent_at) else first_response_at end,
           queue_status = case when new.sender = 'agent' then 'waiting_customer' else queue_status end,
           operational_status = case when new.sender = 'agent' then 'WAITING_CUSTOMER' else 'AI_ACTIVE' end,
           last_message_preview = left(new.content, 500), last_message_sender = new.sender, last_message_at = new.sent_at,
           updated_at = greatest(coalesce(updated_at, new.sent_at), new.sent_at)
     where id = new.conversation_id;
  end if;
  return new;
end;
$$;
