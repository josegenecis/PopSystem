alter table public.whatsapp_conversations
  add column if not exists last_message_preview text,
  add column if not exists last_message_sender text,
  add column if not exists last_message_at timestamptz;

with latest as (
  select distinct on (message.conversation_id)
    message.conversation_id, message.content, message.sender, message.sent_at
  from public.whatsapp_messages message
  where coalesce(message.message_type, 'text') <> 'order_draft'
  order by message.conversation_id, message.sent_at desc
)
update public.whatsapp_conversations conversation
set last_message_preview = latest.content,
    last_message_sender = latest.sender,
    last_message_at = latest.sent_at
from latest
where conversation.id = latest.conversation_id
  and conversation.last_message_at is null;

create index if not exists whatsapp_conversations_inbox_order_idx
  on public.whatsapp_conversations (user_id, last_message_at desc nulls last);

create or replace function public.increment_whatsapp_conversation_unread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.message_type, 'text') = 'order_draft' then
    return new;
  end if;

  if new.sender = 'customer' then
    update public.whatsapp_conversations
       set unread_count = coalesce(unread_count, 0) + 1,
           last_customer_message_at = new.sent_at,
           last_message_preview = left(new.content, 500),
           last_message_sender = new.sender,
           last_message_at = new.sent_at,
           queue_status = case when assigned_operator_id is null then 'new' else 'assigned' end,
           resolved_at = null,
           updated_at = greatest(coalesce(updated_at, new.sent_at), new.sent_at)
     where id = new.conversation_id;
  elsif new.sender in ('agent', 'bot') then
    update public.whatsapp_conversations
       set unread_count = case when new.sender = 'agent' then 0 else unread_count end,
           first_response_at = case when new.sender = 'agent' then coalesce(first_response_at, new.sent_at) else first_response_at end,
           queue_status = case when new.sender = 'agent' then 'waiting_customer' else queue_status end,
           last_message_preview = left(new.content, 500),
           last_message_sender = new.sender,
           last_message_at = new.sent_at,
           updated_at = greatest(coalesce(updated_at, new.sent_at), new.sent_at)
     where id = new.conversation_id;
  end if;
  return new;
end;
$$;

comment on column public.whatsapp_conversations.last_message_preview is
  'Resumo materializado da última mensagem para a caixa de entrada em tempo real.';
