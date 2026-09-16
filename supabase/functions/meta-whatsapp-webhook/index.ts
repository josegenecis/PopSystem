// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { processPopAiMessage } from '../_shared/pop-ai/whatsappAiWebhookHandler.ts';
import { logWhatsAppBotStep } from '../_shared/whatsapp-bot.ts';
import { metaGraphBaseUrl, normalizeWhatsAppPhone } from '../_shared/whatsapp-provider.ts';
import { decryptMetaToken } from '../_shared/meta-token.ts';

const headers = { 'Content-Type': 'application/json' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function validSignature(rawBody: string, signature: string, secret: string) {
  if (!secret) return true;
  if (!signature.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = `sha256=${hex(digest)}`;
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

function messageText(message: any) {
  if (message?.text?.body) return String(message.text.body).trim();
  if (message?.button?.text) return String(message.button.text).trim();
  if (message?.interactive?.button_reply?.title) return String(message.interactive.button_reply.title).trim();
  if (message?.interactive?.list_reply?.title) return String(message.interactive.list_reply.title).trim();
  if (message?.location) {
    const { latitude, longitude } = message.location;
    return `Localização compartilhada: https://maps.google.com/?q=${latitude},${longitude}`;
  }
  if (message?.contacts?.length) return `Contato compartilhado: ${message.contacts.map((item: any) => item?.name?.formatted_name).filter(Boolean).join(', ')}`;
  const captions = ['image', 'video', 'document'].map((type) => message?.[type]?.caption).filter(Boolean);
  if (captions.length) return String(captions[0]).trim();
  const labels: Record<string, string> = { image: 'imagem', video: 'vídeo', audio: 'áudio', document: 'documento', sticker: 'figurinha' };
  return labels[message?.type] ? `[${labels[message.type]} recebido]` : '';
}

function messageMedia(message: any) {
  const type = ['image', 'video', 'audio', 'document', 'sticker'].find((candidate) => message?.[candidate]?.id);
  if (!type) return null;
  const payload = message[type];
  return {
    id: String(payload.id),
    type,
    mimeType: String(payload.mime_type || ''),
    fileName: String(payload.filename || ''),
    caption: String(payload.caption || ''),
  };
}

async function loadMedia(supabase: any, account: any, media: any, providerMessageId: string) {
  try {
    const metadataResponse = await fetch(`${metaGraphBaseUrl()}/${encodeURIComponent(media.id)}`, {
      headers: { Authorization: `Bearer ${account.access_token}` },
    });
    const metadata = await metadataResponse.json().catch(() => ({}));
    if (!metadataResponse.ok || !metadata?.url) return { ...media, url: '', hasInlineBytes: false };

    const download = await fetch(metadata.url, { headers: { Authorization: `Bearer ${account.access_token}` } });
    if (!download.ok) return { ...media, url: '', hasInlineBytes: false };
    const bytes = await download.arrayBuffer();
    const extension = String(media.fileName || '').split('.').pop() || String(media.mimeType || '').split('/').pop() || 'bin';
    const path = `${account.restaurant_id}/meta-inbound/${providerMessageId}.${extension.replace(/[^a-z0-9]/gi, '') || 'bin'}`;
    const upload = await supabase.storage.from('whatsapp-media').upload(path, bytes, {
      contentType: media.mimeType || download.headers.get('content-type') || 'application/octet-stream',
      upsert: true,
    });
    if (upload.error) return { ...media, url: '', hasInlineBytes: false };
    const signed = await supabase.storage.from('whatsapp-media').createSignedUrl(path, 60 * 60);
    return {
      ...media,
      url: signed.data?.signedUrl || '',
      path,
      size: bytes.byteLength,
      hasInlineBytes: false,
    };
  } catch (error) {
    console.warn('[meta-whatsapp-webhook] media download failed', error);
    return { ...media, url: '', hasInlineBytes: false };
  }
}

async function recordStatus(supabase: any, restaurantId: string, status: any) {
  const deliveryStatus = String(status?.status || '').toLowerCase();
  if (!['sent', 'delivered', 'read', 'failed'].includes(deliveryStatus)) return;
  await supabase.rpc('record_whatsapp_delivery_receipt', {
    p_user_id: restaurantId,
    p_provider_message_id: String(status?.id || ''),
    p_delivery_status: deliveryStatus,
    p_delivery_error: deliveryStatus === 'failed' ? String(status?.errors?.[0]?.title || status?.errors?.[0]?.message || 'Falha informada pela Meta') : null,
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') || '';
    const expected = String(Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || '').trim();
    if (mode === 'subscribe' && expected && token === expected) return new Response(challenge, { status: 200 });
    return new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const rawBody = await req.text();
  const appSecret = String(Deno.env.get('META_APP_SECRET') || '').trim();
  const signature = req.headers.get('x-hub-signature-256') || '';
  if (!appSecret) return json({ error: 'Webhook not configured' }, 503);
  if (!(await validSignature(rawBody, signature, appSecret))) return json({ error: 'Invalid signature' }, 401);

  let body: any;
  try { body = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase env missing' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const changes = (body?.entry || []).flatMap((entry: any) => entry?.changes || []);
  for (const change of changes) {
    const value = change?.value || {};
    const phoneNumberId = String(value?.metadata?.phone_number_id || '').trim();
    if (!phoneNumberId) continue;
    const { data: account } = await supabase
      .from('whatsapp_provider_accounts')
      .select('*')
      .eq('provider', 'meta_cloud')
      .eq('phone_number_id', phoneNumberId)
      .eq('status', 'connected')
      .maybeSingle();
    if (!account?.restaurant_id) continue;
    account.access_token = await decryptMetaToken(account.access_token_encrypted);

    for (const status of value?.statuses || []) await recordStatus(supabase, account.restaurant_id, status);

    for (const message of value?.messages || []) {
      const customerPhone = normalizeWhatsAppPhone(message?.from);
      const providerMessageId = String(message?.id || '').trim();
      let text = messageText(message);
      if (!customerPhone || !providerMessageId || !text) continue;
      const rawMedia = messageMedia(message);
      const media = rawMedia ? await loadMedia(supabase, account, rawMedia, providerMessageId) : null;
      const customerName = String(value?.contacts?.find((contact: any) => normalizeWhatsAppPhone(contact?.wa_id) === customerPhone)?.profile?.name || '').trim();

      await logWhatsAppBotStep(supabase, account.restaurant_id, 'whatsapp_webhook_received', 'Webhook oficial da Meta recebido', {
        provider: 'meta_cloud', phoneNumberId, customerPhone, customerName, messageType: message?.type || 'text',
      });
      const result = await processPopAiMessage({
        supabase,
        restaurantId: account.restaurant_id,
        instanceName: `meta:${phoneNumberId}`,
        customerPhone,
        text,
        media,
        providerMessageId,
        messageType: media?.type || message?.type || 'text',
        quotedProviderMessageId: String(message?.context?.id || '').trim(),
      });
      if (!result.ok) console.error('[meta-whatsapp-webhook] message processing failed', result);
    }
  }
  return json({ received: true });
});
