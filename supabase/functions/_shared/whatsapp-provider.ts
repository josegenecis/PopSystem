import { decryptMetaToken } from './meta-token.ts';

export type WhatsAppProvider = 'evolution' | 'meta_cloud';

export function normalizeWhatsAppPhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? digits : `55${digits}`;
}

export function metaGraphVersion() {
  const configured = String(Deno.env.get('META_GRAPH_API_VERSION') || Deno.env.get('META_GRAPH_VERSION') || 'v23.0').trim();
  return configured.startsWith('v') ? configured : `v${configured}`;
}

export function metaGraphBaseUrl() {
  return `https://graph.facebook.com/${metaGraphVersion()}`;
}

export async function getActiveWhatsAppProvider(supabase: any, restaurantId: string): Promise<WhatsAppProvider> {
  if (!supabase || !restaurantId) return 'evolution';
  const { data } = await supabase
    .from('whatsapp_settings')
    .select('provider')
    .eq('user_id', restaurantId)
    .maybeSingle();
  return data?.provider === 'meta_cloud' ? 'meta_cloud' : 'evolution';
}

export async function getMetaWhatsAppAccount(supabase: any, restaurantId: string) {
  if (!supabase || !restaurantId) return null;
  const { data, error } = await supabase
    .from('whatsapp_provider_accounts')
    .select('restaurant_id, provider, status, waba_id, phone_number_id, display_phone_number, verified_name, access_token_encrypted, token_expires_at')
    .eq('restaurant_id', restaurantId)
    .eq('provider', 'meta_cloud')
    .neq('status', 'disconnected')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, access_token: await decryptMetaToken(data.access_token_encrypted) };
}

async function parseMetaResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  const providerMessageId = String(data?.messages?.[0]?.id || '').trim() || null;
  return {
    ok: response.ok,
    status: response.status,
    data,
    providerMessageId,
    transport: 'meta_cloud',
    error: response.ok ? null : String(data?.error?.message || data?.error || `http_${response.status}`),
  };
}

export async function sendMetaWhatsAppMessage(params: {
  account: any;
  phone: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  mimeType?: string;
  fileName?: string;
}) {
  const phoneNumberId = String(params.account?.phone_number_id || '').trim();
  const accessToken = String(params.account?.access_token || '').trim();
  const to = normalizeWhatsAppPhone(params.phone);
  const text = String(params.text || '').trim();
  if (!phoneNumberId || !accessToken || !to || (!text && !params.mediaUrl)) {
    return { ok: false, skipped: true, transport: 'meta_cloud', error: 'missing_meta_message_config' };
  }

  let payload: Record<string, unknown>;
  if (!params.mediaUrl) {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: true, body: text },
    };
  } else {
    const supported = ['image', 'video', 'audio', 'document'];
    const type = supported.includes(String(params.mediaType)) ? String(params.mediaType) : 'document';
    const media: Record<string, unknown> = { link: params.mediaUrl };
    if (text && type !== 'audio') media.caption = text;
    if (type === 'document' && params.fileName) media.filename = params.fileName;
    payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to, type, [type]: media };
  }

  const response = await fetch(`${metaGraphBaseUrl()}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseMetaResponse(response);
}

export async function sendWhatsAppByConfiguredProvider(params: {
  supabase: any;
  restaurantId: string;
  phone: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  mimeType?: string;
  fileName?: string;
}) {
  const provider = await getActiveWhatsAppProvider(params.supabase, params.restaurantId);
  if (provider !== 'meta_cloud') return null;
  const account = await getMetaWhatsAppAccount(params.supabase, params.restaurantId);
  if (!account || account.status !== 'connected') {
    return { ok: false, status: 503, transport: 'meta_cloud', error: 'meta_account_not_connected' };
  }
  return sendMetaWhatsAppMessage({ ...params, account });
}
