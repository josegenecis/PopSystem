import { decryptMetaToken } from './meta-token.ts';

export type WhatsAppProvider = 'evolution' | 'meta_cloud';

export function normalizeWhatsAppPhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? digits : `55${digits}`;
}

export function buildMetaRecipientCandidates(value: unknown) {
  const normalized = normalizeWhatsAppPhone(value);
  if (!normalized) return [];

  const local = normalized.startsWith('55') ? normalized.slice(2) : normalized;
  const candidates: string[] = [];

  // A Meta ainda pode devolver o wa_id brasileiro no formato legado, sem o
  // nono dígito. O número cadastrado para envio, porém, continua usando o 9.
  // Priorize o formato atual: algumas chamadas para o wa_id legado demoram
  // até expirar antes de a Meta responder, impedindo a tentativa correta.
  if (local.length === 10) candidates.push(`55${local.slice(0, 2)}9${local.slice(2)}`);
  candidates.push(normalized);
  if (local.length === 11 && local[2] === '9') candidates.push(`55${local.slice(0, 2)}${local.slice(3)}`);

  return Array.from(new Set(candidates));
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
    .order('updated_at', { ascending: false })
    .limit(1)
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
  const recipients = buildMetaRecipientCandidates(params.phone);
  const text = String(params.text || '').trim();
  if (!phoneNumberId || !accessToken || recipients.length === 0 || (!text && !params.mediaUrl)) {
    return { ok: false, skipped: true, transport: 'meta_cloud', error: 'missing_meta_message_config' };
  }

  let lastResult: Awaited<ReturnType<typeof parseMetaResponse>> | null = null;
  for (const to of recipients) {
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

    try {
      const response = await fetch(`${metaGraphBaseUrl()}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      lastResult = await parseMetaResponse(response);
    } catch (error) {
      lastResult = {
        ok: false,
        status: 504,
        data: {},
        providerMessageId: null,
        transport: 'meta_cloud',
        error: error instanceof Error ? error.message : 'meta_request_timeout',
      };
    }
    if (lastResult.ok) return lastResult;
  }

  return lastResult || { ok: false, skipped: true, transport: 'meta_cloud', error: 'missing_meta_recipient' };
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
  const account = await getMetaWhatsAppAccount(params.supabase, params.restaurantId);
  if (!account) return null;
  if (account.status !== 'connected') return null;
  return sendMetaWhatsAppMessage({ ...params, account });
}
