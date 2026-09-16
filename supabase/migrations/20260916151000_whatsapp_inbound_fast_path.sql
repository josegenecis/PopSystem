create or replace function public.persist_whatsapp_inbound_fast(
  p_restaurant_id uuid,
  p_customer_phone text,
  p_customer_name text,
  p_content text,
  p_provider_message_id text,
  p_instance_name text default null,
  p_message_type text default 'text',
  p_provider_sent_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g');
  v_phone_legacy text;
  v_phone_modern text;
  v_conversation public.whatsapp_conversations%rowtype;
  v_message_id uuid;
  v_customer_name text := nullif(trim(coalesce(p_customer_name, '')), '');
begin
  if p_restaurant_id is null or v_phone = '' or trim(coalesce(p_content, '')) = '' then
    return jsonb_build_object('claimed', false, 'reason', 'missing_input');
  end if;

  if public.claim_whatsapp_inbound_message(
    p_restaurant_id,
    v_phone,
    p_content,
    p_provider_message_id,
    p_instance_name,
    30
  ) is not true then
    return jsonb_build_object('claimed', false, 'reason', 'duplicate');
  end if;

  -- Serialize creation of the customer's conversation even when different
  -- messages arrive concurrently.
  perform pg_advisory_xact_lock(hashtext(p_restaurant_id::text || '|conversation|' || v_phone));

  if length(v_phone) = 13 and left(v_phone, 2) = '55' and substring(v_phone from 5 for 1) = '9' then
    v_phone_legacy := left(v_phone, 4) || substring(v_phone from 6);
  elsif length(v_phone) = 12 and left(v_phone, 2) = '55' then
    v_phone_modern := left(v_phone, 4) || '9' || substring(v_phone from 5);
  end if;

  select conversation.*
    into v_conversation
    from public.whatsapp_conversations conversation
   where conversation.user_id = p_restaurant_id
     and regexp_replace(coalesce(conversation.customer_phone, ''), '\D', '', 'g') in (
       v_phone,
       coalesce(v_phone_legacy, v_phone),
       coalesce(v_phone_modern, v_phone)
     )
   order by conversation.updated_at desc
   limit 1;

  if v_conversation.id is null then
    if v_customer_name is null then
      select customer.name
        into v_customer_name
        from public.customers customer
       where customer.user_id = p_restaurant_id
         and regexp_replace(coalesce(customer.phone, ''), '\D', '', 'g') in (
           v_phone,
           coalesce(v_phone_legacy, v_phone),
           coalesce(v_phone_modern, v_phone)
         )
       limit 1;
    end if;

    insert into public.whatsapp_conversations (user_id, customer_phone, customer_name, status)
    values (p_restaurant_id, v_phone, coalesce(v_customer_name, 'Cliente WhatsApp'), 'open')
    returning * into v_conversation;
  elsif v_customer_name is not null
    and (v_conversation.customer_name is null or v_conversation.customer_name in ('Cliente', 'Cliente WhatsApp')) then
    update public.whatsapp_conversations
       set customer_name = v_customer_name
     where id = v_conversation.id
     returning * into v_conversation;
  end if;

  insert into public.whatsapp_messages (
    conversation_id,
    content,
    sender,
    message_type,
    sent_at,
    delivered,
    provider_message_id,
    external_message_id,
    delivery_status
  ) values (
    v_conversation.id,
    trim(p_content),
    'customer',
    coalesce(nullif(trim(p_message_type), ''), 'text'),
    coalesce(p_provider_sent_at, now()),
    true,
    nullif(trim(coalesce(p_provider_message_id, '')), ''),
    nullif(trim(coalesce(p_provider_message_id, '')), ''),
    'received'
  )
  returning id into v_message_id;

  return jsonb_build_object(
    'claimed', true,
    'conversation_id', v_conversation.id,
    'message_id', v_message_id
  );
end;
$$;

revoke all on function public.persist_whatsapp_inbound_fast(uuid, text, text, text, text, text, text, timestamptz) from public;
grant execute on function public.persist_whatsapp_inbound_fast(uuid, text, text, text, text, text, text, timestamptz) to service_role;

comment on function public.persist_whatsapp_inbound_fast(uuid, text, text, text, text, text, text, timestamptz)
  is 'Atomically deduplicates and persists an inbound WhatsApp text message for low-latency Realtime delivery.';
