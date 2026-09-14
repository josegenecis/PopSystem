alter table public.whatsapp_conversations
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists channel text not null default 'WHATSAPP',
  add column if not exists channel_instance_id text,
  add column if not exists external_chat_id text;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_channel_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_channel_check
  check (channel in ('WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'WEBCHAT', 'OTHER'));

create unique index if not exists whatsapp_conversations_external_chat_unique
  on public.whatsapp_conversations (user_id, channel, channel_instance_id, external_chat_id)
  where external_chat_id is not null;

alter table public.whatsapp_messages
  add column if not exists external_message_id text,
  add column if not exists sender_id text,
  add column if not exists quoted_message_id uuid references public.whatsapp_messages(id) on delete set null;

update public.whatsapp_messages
set external_message_id = provider_message_id
where external_message_id is null and provider_message_id is not null;

create unique index if not exists whatsapp_messages_external_id_unique
  on public.whatsapp_messages (conversation_id, external_message_id)
  where external_message_id is not null;

alter table public.orders
  add column if not exists source text,
  add column if not exists conversation_id uuid references public.whatsapp_conversations(id) on delete set null;

create index if not exists orders_whatsapp_conversation_idx
  on public.orders (user_id, conversation_id, created_at desc)
  where conversation_id is not null;

comment on column public.whatsapp_conversations.channel is
  'Canal normalizado da central. WHATSAPP é o canal ativo; os demais preparam evolução omnichannel.';
