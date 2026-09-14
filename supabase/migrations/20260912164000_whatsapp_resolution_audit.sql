alter table public.whatsapp_conversations
  add column if not exists resolution_reason text,
  add column if not exists resolved_by uuid,
  add column if not exists resolved_by_name text;

create index if not exists whatsapp_conversations_resolution_reporting_idx
  on public.whatsapp_conversations (user_id, resolved_at desc, resolution_reason)
  where resolved_at is not null;

comment on column public.whatsapp_conversations.resolution_reason is
  'Motivo operacional escolhido pelo atendente ao encerrar a conversa.';
