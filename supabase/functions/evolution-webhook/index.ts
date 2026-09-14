// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { isRecentAutomatedBotReply, logWhatsAppBotStep, pauseRestaurantBotForConversation } from '../_shared/whatsapp-bot.ts';
import { processPopAiMessage } from '../_shared/pop-ai/whatsappAiWebhookHandler.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-evolution-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function json(res: any, status = 200) {
  return new Response(JSON.stringify(res), { status, headers: corsHeaders });
}

function toTextFromMessage(msg: any): string {
  if (typeof msg === 'string') return msg.trim();
  if (!msg || typeof msg !== 'object') return '';
  if (typeof msg.text === 'string') return msg.text.trim();
  if (typeof msg.content === 'string') return msg.content.trim();
  if (typeof msg.conversation === 'string') return msg.conversation;
  if (msg.extendedTextMessage?.text) return String(msg.extendedTextMessage.text);
  if (msg.imageMessage?.caption) return String(msg.imageMessage.caption);
  if (msg.videoMessage?.caption) return String(msg.videoMessage.caption);
  if (msg.documentMessage?.caption) return String(msg.documentMessage.caption);
  if (msg.buttonsResponseMessage?.selectedDisplayText) return String(msg.buttonsResponseMessage.selectedDisplayText);
  if (msg.listResponseMessage?.title) return String(msg.listResponseMessage.title);
  if (msg.locationMessage) {
    const latitude = Number(msg.locationMessage.degreesLatitude ?? msg.locationMessage.latitude);
    const longitude = Number(msg.locationMessage.degreesLongitude ?? msg.locationMessage.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) return `Localização compartilhada: https://maps.google.com/?q=${latitude},${longitude}`;
  }
  if (msg.contactMessage) return `Contato compartilhado: ${String(msg.contactMessage.displayName || msg.contactMessage.vcard || '').trim()}`;
  if (msg.contactsArrayMessage?.contacts?.length) return `Contatos compartilhados: ${msg.contactsArrayMessage.contacts.map((contact: any) => contact.displayName || contact.vcard || '').filter(Boolean).join(', ')}`;
  return '';
}

function pickStructuredMessageType(msg: any) {
  if (msg?.locationMessage) return 'location';
  if (msg?.contactMessage || msg?.contactsArrayMessage) return 'contact';
  return '';
}

function pickQuotedProviderMessageId(msg: any) {
  const context = msg?.extendedTextMessage?.contextInfo || msg?.imageMessage?.contextInfo || msg?.videoMessage?.contextInfo || msg?.documentMessage?.contextInfo || {};
  return String(context?.stanzaId || context?.quotedMessageId || '').trim();
}

function pickMediaFromMessage(msg: any) {
  if (!msg || typeof msg !== 'object') return null;

  const candidates = [
    { type: 'audio', payload: msg.audioMessage },
    { type: 'image', payload: msg.imageMessage },
    { type: 'video', payload: msg.videoMessage },
    { type: 'document', payload: msg.documentMessage },
    { type: 'sticker', payload: msg.stickerMessage }
  ];
  const found = candidates.find((item) => item.payload && typeof item.payload === 'object');
  if (!found) return null;

  const payload = found.payload;
  return {
    type: found.type,
    mimeType: String(payload?.mimetype || payload?.mimeType || ''),
    caption: String(payload?.caption || ''),
    url: String(payload?.url || payload?.mediaUrl || payload?.directPath || payload?.jpegThumbnail || ''),
    fileName: String(payload?.fileName || payload?.title || ''),
    seconds: Number(payload?.seconds || payload?.duration || 0) || null,
    hasInlineBytes: Boolean(payload?.base64 || payload?.mediaBase64),
    base64: payload?.base64 || payload?.mediaBase64 || ''
  };
}

function normalizeNumber(remoteJid: string): string {
  const digits = String(remoteJid || '').split('@')[0].replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return '';
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function pickCustomerJid(data: any): string {
  const key = data?.key || data?.data?.key || {};
  const candidates = [
    key?.remoteJidAlt,
    data?.remoteJidAlt,
    data?.data?.remoteJidAlt,
    data?.senderPn,
    data?.data?.senderPn,
    key?.participantAlt,
    data?.participantAlt,
    data?.data?.participantAlt,
    key?.remoteJid,
    data?.remoteJid,
    data?.data?.remoteJid,
    data?.sender,
    data?.data?.sender
  ].map((value) => String(value || '').trim()).filter(Boolean);

  const phoneJid = candidates.find((value) => /@(s\.whatsapp\.net|c\.us)$/i.test(value));
  if (phoneJid) return phoneJid;

  return candidates.find((value) => !/@lid$/i.test(value) && Boolean(normalizeNumber(value))) || '';
}

function pickInstanceName(body: any): string {
  const fromBody = String(body?.instance || body?.instanceName || body?.data?.instance || body?.data?.instanceName || body?.name || body?.data?.name || '').trim();
  if (fromBody) return fromBody;
  // @ts-ignore
  return String(Deno.env.get('EVOLUTION_DEFAULT_INSTANCE') || '').trim();
}

function getMappedUserIdForInstance(instance: string): string {
  // @ts-ignore
  const mapRaw = Deno.env.get('EVOLUTION_INSTANCE_USER_MAP') || '';
  // @ts-ignore
  const fallback = Deno.env.get('EVOLUTION_DEFAULT_USER_ID') || '';
  if (mapRaw) {
    try {
      const parsed = JSON.parse(mapRaw);
      const v = parsed?.[instance];
      if (typeof v === 'string' && v.trim()) return v.trim();
    } catch {}
  }
  return String(fallback || '').trim();
}

function parseRestaurantIdFromToken(value: unknown) {
  const token = String(value || '').trim();
  const raw = token.startsWith('token_') ? token.slice(6) : '';
  if (!/^[a-f0-9]{32}$/i.test(raw)) return '';
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function parseRestaurantIdFromInstanceName(value: unknown) {
  const instance = String(value || '').trim();
  const raw = instance.startsWith('rest_') ? instance.slice(5) : '';
  if (!/^[a-f0-9]{32}$/i.test(raw)) return '';
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function normalizeLookupKey(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isLikelyBotEcho(text: string) {
  const value = String(text || '').toLowerCase();
  return value.includes('/share/menu/') ||
    value.includes('/share/track/') ||
    value.includes('sou o assistente') ||
    value.includes('bem-vindo ao') ||
    value.includes('como posso te ajudar') ||
    value.includes('posso te mandar o cardápio') ||
    value.includes('posso te mandar o cardapio') ||
    value.includes('clique aqui e faça seu pedido') ||
    value.includes('clique aqui e faca seu pedido') ||
    value.includes('funciona neste horário') ||
    value.includes('funciona neste horario') ||
    value.includes('faço seu pedido por aqui') ||
    value.includes('faco seu pedido por aqui') ||
    value.includes('acompanhe seu pedido') ||
    value.includes('cardápio completo') ||
    value.includes('cardapio completo');
}

function firstDefined(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null);
}

function toBooleanFlag(value: any) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'sim', 's'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nao', 'não', 'n', ''].includes(normalized)) return false;
  }
  return false;
}

function getFromMeRaw(data: any) {
  const key = data?.key || data?.data?.key || {};
  return firstDefined(
    key?.fromMe,
    data?.fromMe,
    data?.data?.fromMe,
    data?.Info?.IsFromMe,
    data?.data?.Info?.IsFromMe,
    data?.info?.isFromMe,
    data?.data?.info?.isFromMe
  );
}

function isMessageFromRestaurant(data: any) {
  return toBooleanFlag(getFromMeRaw(data));
}

function pickProviderMessageId(data: any): string {
  const key = data?.key || data?.data?.key || {};
  const info = data?.Info || data?.info || data?.data?.Info || data?.data?.info || {};
  const source = info?.MessageSource || info?.messageSource || {};
  const candidates = [
    key?.id,
    key?.ID,
    key?.Id,
    data?.id,
    data?.ID,
    data?.Id,
    info?.id,
    info?.ID,
    info?.Id,
    source?.id,
    source?.ID,
    source?.Id,
    data?.messageId,
    data?.messageID,
    data?.data?.messageId,
    data?.data?.messageID
  ];

  return candidates.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function pickDeliveryStatus(body: any, data: any) {
  const raw = firstDefined(
    data?.update?.status, data?.status, data?.ack, data?.data?.status,
    body?.status, body?.ack, body?.data?.update?.status
  );
  if (typeof raw === 'number') {
    if (raw >= 4) return 'read';
    if (raw === 3) return 'delivered';
    if (raw >= 1) return 'sent';
  }
  const value = String(raw || '').trim().toLowerCase();
  if (/(read|played)/.test(value)) return 'read';
  if (/(deliver)/.test(value)) return 'delivered';
  if (/(error|fail)/.test(value)) return 'failed';
  if (/(sent|server_ack|pending)/.test(value)) return 'sent';
  return '';
}

function pickIncomingEnvelope(body: any) {
  const direct = body?.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : body;
  const list = body?.data?.messages || body?.messages || body?.data;
  if (Array.isArray(list)) {
    const found = list.find((item: any) => {
      const key = item?.key || item?.data?.key || {};
      const remoteJid = String(key?.remoteJid || item?.remoteJid || '');
      return remoteJid && !remoteJid.includes('@g.us');
    });
    if (found) return found;
  }
  return direct;
}

type NormalizedChannelEvent = {
  provider: 'evolution';
  channel: 'WHATSAPP';
  rawEvent: string;
  event: string;
  instanceName: string;
  customerPhone: string;
  fromMe: boolean;
  rawFromMe: unknown;
  providerMessageId: string;
  deliveryStatus: string;
  text: string;
  messageType: string;
  quotedProviderMessageId: string;
  media: ReturnType<typeof pickMediaFromMessage>;
  data: any;
};

interface ChannelAdapter<TPayload> {
  normalize(payload: TPayload): NormalizedChannelEvent;
}

class EvolutionWhatsAppAdapter implements ChannelAdapter<any> {
  normalize(body: any): NormalizedChannelEvent {
    const rawEvent = String(body?.event || body?.type || '').trim();
    const event = rawEvent.toUpperCase().replace(/[.\-\s]+/g, '_');
    const instanceName = pickInstanceName(body);
    const data = pickIncomingEnvelope(body);
    const rawFromMe = getFromMeRaw(data);
    const fromMe = isMessageFromRestaurant(data);
    const customerJid = pickCustomerJid(data);
    const messagePayload = data?.message || data?.text || data?.content || data;
    const media = pickMediaFromMessage(messagePayload);
    const structuredMessageType = pickStructuredMessageType(messagePayload);

    return {
      provider: 'evolution',
      channel: 'WHATSAPP',
      rawEvent,
      event,
      instanceName,
      customerPhone: customerJid.includes('@g.us') ? '' : normalizeNumber(customerJid),
      fromMe,
      rawFromMe,
      providerMessageId: pickProviderMessageId(data),
      deliveryStatus: pickDeliveryStatus(body, data),
      text: toTextFromMessage(messagePayload) || (media ? `[${media.type === 'audio' ? 'áudio recebido' : media.type === 'image' ? 'imagem recebida' : 'mídia recebida'}]` : ''),
      messageType: structuredMessageType || media?.type || 'text',
      quotedProviderMessageId: pickQuotedProviderMessageId(messagePayload),
      media,
      data,
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method Not Allowed' }, 405);

  // @ts-ignore
  const EVOLUTION_WEBHOOK_SECRET = Deno.env.get('EVOLUTION_WEBHOOK_SECRET') || '';
  const headerToken = req.headers.get('x-evolution-token') || '';
  const urlToken = new URL(req.url).searchParams.get('token') || '';
  const token = headerToken || urlToken;
  if (EVOLUTION_WEBHOOK_SECRET && token !== EVOLUTION_WEBHOOK_SECRET) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  // @ts-ignore
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  // @ts-ignore
  const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  // @ts-ignore
  const EVOLUTION_BASE_URL = Deno.env.get('EVOLUTION_BASE_URL') || '';
  // @ts-ignore
  const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY') || '';
  // @ts-ignore
  const BORACUME_INTERNAL_KEY = Deno.env.get('BORACUME_INTERNAL_KEY') || Deno.env.get('BOT_WEBHOOK_SECRET') || '';

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ success: false, error: 'Supabase env missing' }, 500);
  if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY) return json({ success: false, error: 'Evolution env missing' }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON' }, 400);
  }

  const normalizedEvent = new EvolutionWhatsAppAdapter().normalize(body);
  const { rawEvent, event, instanceName: instance, data, rawFromMe, fromMe, customerPhone, media, messageType, quotedProviderMessageId } = normalizedEvent;
  let { text } = normalizedEvent;
  if (!customerPhone) return json({ success: true, ignored: true });

  let userId = getMappedUserIdForInstance(instance);
  if (!userId && instance) {
    const { data: instanceRow } = await supabase
      .from('whatsapp_instances')
      .select('restaurant_id')
      .eq('instance_name', instance)
      .maybeSingle();
    userId = String(instanceRow?.restaurant_id || '').trim();
  }
  if (!userId) {
    userId = parseRestaurantIdFromToken(body?.token || body?.data?.token || body?.apikey || body?.data?.apikey);
  }
  if (!userId && instance) {
    userId = parseRestaurantIdFromInstanceName(instance);
    if (userId) {
      await supabase
        .from('whatsapp_instances')
        .upsert(
          { restaurant_id: userId, instance_name: instance, status: 'connected' },
          { onConflict: 'instance_name' }
        );
    }
  }
  if (!userId && isUuid(instance)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', instance)
      .maybeSingle();
    userId = String(profile?.id || '').trim();
  }
  if (!userId && instance) {
    const normalizedInstance = normalizeLookupKey(instance);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, restaurant_name')
      .limit(2000);
    const matchedProfile = (profiles || []).find((profile: any) => normalizeLookupKey(profile?.restaurant_name) === normalizedInstance);
    userId = String(matchedProfile?.id || '').trim();
    if (userId) {
      await supabase
        .from('whatsapp_instances')
        .upsert(
          { restaurant_id: userId, instance_name: instance, status: 'connected' },
          { onConflict: 'instance_name' }
        );
    }
  }
  if (!userId) return json({ success: false, error: 'User not mapped for instance' }, 400);

  const { providerMessageId, deliveryStatus } = normalizedEvent;
  if (providerMessageId && deliveryStatus && event.includes('UPDATE')) {
    const deliveryError = deliveryStatus === 'failed'
      ? String(data?.error || body?.error || 'Falha informada pelo provedor')
      : null;
    const { data: messageUpdated, error: receiptError } = await supabase.rpc('record_whatsapp_delivery_receipt', {
      p_user_id: userId,
      p_provider_message_id: providerMessageId,
      p_delivery_status: deliveryStatus,
      p_delivery_error: deliveryError,
    });

    if (!receiptError) return json({ success: true, deliveryStatus, messageUpdated: Boolean(messageUpdated) });

    // Compatibilidade durante a publicação gradual, antes da migration chegar ao banco.
    const { data: storedMessage } = await supabase
      .from('whatsapp_messages')
      .select('id, conversation_id, whatsapp_conversations!inner(user_id)')
      .eq('provider_message_id', providerMessageId)
      .eq('whatsapp_conversations.user_id', userId)
      .maybeSingle();
    if (storedMessage?.id) await supabase.from('whatsapp_messages').update({
      delivery_status: deliveryStatus,
      delivered: deliveryStatus === 'delivered' || deliveryStatus === 'read',
      delivery_error: deliveryError,
    }).eq('id', storedMessage.id);
    return json({ success: true, deliveryStatus, messageUpdated: Boolean(storedMessage?.id), receiptFallback: true });
  }

  if (!text && fromMe) text = '[mensagem enviada pelo restaurante]';
  if (!text) return json({ success: true, ignored: true });

  if (fromMe) {
    if (isLikelyBotEcho(text) || await isRecentAutomatedBotReply({
      supabase,
      restaurantId: userId,
      customerPhone,
      text
    })) {
      return json({ success: true, ignored: true, reason: 'bot_echo' });
    }

    const pauseResult = await pauseRestaurantBotForConversation({
      supabase,
      restaurantId: userId,
      customerPhone,
      reason: 'from_me_webhook'
    });

    await logWhatsAppBotStep(supabase, userId, 'whatsapp_webhook_outgoing', 'Mensagem enviada pelo restaurante detectada no webhook', {
      provider: 'evolution',
      event,
      rawEvent,
      instanceName: instance,
      customerPhone,
      rawFromMe,
      parsedFromMe: fromMe,
      pauseResult
    });

    return json({ success: true, paused: Boolean(pauseResult?.ok), result: pauseResult });
  }

  await logWhatsAppBotStep(supabase, userId, 'whatsapp_webhook_received', 'Webhook evolution recebido', {
    provider: 'evolution',
    event,
    rawEvent,
    instanceName: instance,
    customerPhone,
    rawFromMe,
    parsedFromMe: fromMe,
    textPreview: text.slice(0, 120),
    media: media ? { type: media.type, mimeType: media.mimeType, hasInlineBytes: media.hasInlineBytes, hasUrl: Boolean(media.url) } : null
  });

  const result = await processPopAiMessage({
    supabase,
    restaurantId: userId,
    instanceName: instance,
    customerPhone,
    text,
    media,
    providerMessageId,
    messageType,
    quotedProviderMessageId,
  });

  if (!result.ok) {
    await logWhatsAppBotStep(supabase, userId, 'whatsapp_webhook_error', 'Webhook evolution falhou ao processar', {
      provider: 'evolution',
      event,
      rawEvent,
      instanceName: instance,
      customerPhone,
      error: result.error || null,
      details: result.details || null
    });
    return json({ success: true, handled: true, botOk: false, error: result.error || 'bot_failed', details: result.details || null });
  }

  await logWhatsAppBotStep(supabase, userId, 'whatsapp_webhook_processed', 'Webhook evolution processado com sucesso', {
    provider: 'evolution',
    event,
    rawEvent,
    instanceName: instance,
    customerPhone,
    rawFromMe,
    parsedFromMe: fromMe
  });

  return json({ success: true, message: result.replyText });
});
