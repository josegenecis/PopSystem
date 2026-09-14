create table if not exists public.whatsapp_conversation_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 4000),
  created_by_id text,
  created_by_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_conversation_notes_timeline_idx
  on public.whatsapp_conversation_notes (user_id, conversation_id, created_at desc);

alter table public.whatsapp_conversation_notes enable row level security;

drop policy if exists "whatsapp_notes_owner_all" on public.whatsapp_conversation_notes;
create policy "whatsapp_notes_owner_all"
  on public.whatsapp_conversation_notes
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.whatsapp_conversations conversation
      where conversation.id = whatsapp_conversation_notes.conversation_id
        and conversation.user_id = auth.uid()
    )
  );

comment on table public.whatsapp_conversation_notes is
  'Notas internas do atendimento; nunca são enviadas ao cliente.';
