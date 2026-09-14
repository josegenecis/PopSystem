create table if not exists public.whatsapp_message_delivery_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_message_id text not null,
  delivery_status text not null,
  delivery_error text,
  received_at timestamptz not null default now(),
  primary key (user_id, provider_message_id),
  constraint whatsapp_delivery_receipts_status_check
    check (delivery_status in ('sent', 'delivered', 'read', 'failed'))
);

alter table public.whatsapp_message_delivery_receipts enable row level security;

create or replace function public.whatsapp_delivery_status_rank(value text)
returns integer
language sql
immutable
as $$
  select case value
    when 'sending' then 0
    when 'sent' then 1
    when 'received' then 1
    when 'delivered' then 2
    when 'read' then 3
    when 'failed' then 4
    else -1
  end;
$$;

create or replace function public.record_whatsapp_delivery_receipt(
  p_user_id uuid,
  p_provider_message_id text,
  p_delivery_status text,
  p_delivery_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_count integer := 0;
begin
  if p_provider_message_id is null or btrim(p_provider_message_id) = '' then return false; end if;
  if p_delivery_status not in ('sent', 'delivered', 'read', 'failed') then return false; end if;

  insert into public.whatsapp_message_delivery_receipts (
    user_id, provider_message_id, delivery_status, delivery_error, received_at
  ) values (
    p_user_id, p_provider_message_id, p_delivery_status, p_delivery_error, now()
  )
  on conflict (user_id, provider_message_id) do update
    set delivery_status = case
          when public.whatsapp_delivery_status_rank(excluded.delivery_status) >=
               public.whatsapp_delivery_status_rank(whatsapp_message_delivery_receipts.delivery_status)
            then excluded.delivery_status
          else whatsapp_message_delivery_receipts.delivery_status
        end,
        delivery_error = coalesce(excluded.delivery_error, whatsapp_message_delivery_receipts.delivery_error),
        received_at = greatest(whatsapp_message_delivery_receipts.received_at, excluded.received_at);

  update public.whatsapp_messages message
     set delivery_status = receipt.delivery_status,
         delivered = receipt.delivery_status in ('delivered', 'read'),
         delivery_error = receipt.delivery_error
    from public.whatsapp_message_delivery_receipts receipt,
         public.whatsapp_conversations conversation
   where receipt.user_id = p_user_id
     and receipt.provider_message_id = p_provider_message_id
     and message.provider_message_id = receipt.provider_message_id
     and conversation.id = message.conversation_id
     and conversation.user_id = receipt.user_id
     and public.whatsapp_delivery_status_rank(receipt.delivery_status) >=
         public.whatsapp_delivery_status_rank(message.delivery_status);
  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end;
$$;

create or replace function public.apply_whatsapp_delivery_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_receipt public.whatsapp_message_delivery_receipts%rowtype;
begin
  if new.provider_message_id is null then return new; end if;
  select user_id into v_user_id from public.whatsapp_conversations where id = new.conversation_id;
  select * into v_receipt
    from public.whatsapp_message_delivery_receipts
   where user_id = v_user_id and provider_message_id = new.provider_message_id;

  if found and public.whatsapp_delivery_status_rank(v_receipt.delivery_status) >=
               public.whatsapp_delivery_status_rank(new.delivery_status) then
    new.delivery_status := v_receipt.delivery_status;
    new.delivered := v_receipt.delivery_status in ('delivered', 'read');
    new.delivery_error := v_receipt.delivery_error;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_whatsapp_delivery_receipt_before_write on public.whatsapp_messages;
create trigger apply_whatsapp_delivery_receipt_before_write
before insert or update of provider_message_id on public.whatsapp_messages
for each row execute function public.apply_whatsapp_delivery_receipt();

revoke all on function public.record_whatsapp_delivery_receipt(uuid, text, text, text) from public;
grant execute on function public.record_whatsapp_delivery_receipt(uuid, text, text, text) to service_role;

comment on table public.whatsapp_message_delivery_receipts is
  'Confirmações da Evolution mantidas temporariamente para evitar perda quando o webhook chega antes da gravação da mensagem.';
