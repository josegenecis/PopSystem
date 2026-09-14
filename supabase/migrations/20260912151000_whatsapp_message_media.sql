alter table public.whatsapp_messages
  add column if not exists media_path text,
  add column if not exists media_mime_type text,
  add column if not exists media_name text,
  add column if not exists media_size bigint,
  add column if not exists media_duration_seconds integer,
  add column if not exists transcription text,
  add column if not exists provider_message_id text,
  add column if not exists delivery_status text not null default 'sent',
  add column if not exists delivery_error text;

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_delivery_status_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_delivery_status_check
  check (delivery_status in ('sending', 'sent', 'delivered', 'read', 'received', 'failed'));

create index if not exists whatsapp_messages_provider_message_idx
  on public.whatsapp_messages (provider_message_id)
  where provider_message_id is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-media',
  'whatsapp-media',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/ogg', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav',
    'video/mp4', 'application/pdf', 'text/plain'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "whatsapp_media_owner_select" on storage.objects;
create policy "whatsapp_media_owner_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "whatsapp_media_owner_insert" on storage.objects;
create policy "whatsapp_media_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "whatsapp_media_owner_delete" on storage.objects;
create policy "whatsapp_media_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

comment on column public.whatsapp_messages.media_path is
  'Caminho privado no bucket whatsapp-media; o cliente gera URL assinada curta para visualização.';
