import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveStoreUserId } from '../_shared/multi-store.ts';
import { sendWhatsAppByConfiguredProvider } from '../_shared/whatsapp-provider.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const evolutionBaseUrl = () => String(Deno.env.get('EVOLUTION_BASE_URL') || Deno.env.get('EVOGO_BASE_URL') || 'https://api.boracume.com').replace(/\/+$/, '');
const evolutionApiKey = () => String(Deno.env.get('EVOLUTION_API_KEY') || Deno.env.get('EVOGO_API_KEY') || '').trim();

function normalizePhone(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function buildPhoneCandidates(value: string | null | undefined) {
  const normalized = normalizePhone(value);
  const withoutCountry = normalized.startsWith("55") ? normalized.slice(2) : normalized;
  const localVariants = [withoutCountry];
  if (withoutCountry.length === 11 && withoutCountry[2] === "9") {
    localVariants.push(`${withoutCountry.slice(0, 2)}${withoutCountry.slice(3)}`);
  } else if (withoutCountry.length === 10) {
    localVariants.push(`${withoutCountry.slice(0, 2)}9${withoutCountry.slice(2)}`);
  }
  const candidates = localVariants.flatMap((item) => [item, `55${item}`]).filter(Boolean);

  return Array.from(new Set(candidates));
}

function getManualPauseWindow() {
  const rawMinutes = Number(Deno.env.get('WHATSAPP_MANUAL_PAUSE_MINUTES') || '60');
  const minutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 60;
  const now = new Date();
  const resumeAt = new Date(now.getTime() + minutes * 60000);

  return {
    nowIso: now.toISOString(),
    resumeAtIso: resumeAt.toISOString(),
    status: `bot_paused_until:${resumeAt.toISOString()}`
  };
}

function pickProviderMessageId(data: any) {
  return String(data?.key?.id || data?.data?.key?.id || data?.messageId || data?.id || '').trim();
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function sendEvolutionMessage(params: {
  baseUrl: string;
  globalApiKey: string;
  instanceName: string;
  instanceToken: string;
  number: string;
  message: string;
  mediaUrl?: string;
  mediaType?: string;
  mimeType?: string;
  fileName?: string;
}) {
  const normalizedNumber = normalizePhone(params.number);
  if (!params.mediaUrl) {
    const response = await fetch(`${params.baseUrl}/message/sendText/${encodeURIComponent(params.instanceName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: params.globalApiKey },
      body: JSON.stringify({ number: normalizedNumber, text: params.message, delay: 300 })
    });
    if (response.ok) return { response, data: await readJson(response) };

    const fallback = await fetch(`${params.baseUrl}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: params.instanceToken },
      body: JSON.stringify({ number: normalizedNumber, text: params.message })
    });
    return { response: fallback, data: await readJson(fallback) };
  }

  const mediaType = ['image', 'video', 'audio', 'document'].includes(String(params.mediaType)) ? String(params.mediaType) : 'document';
  const standardUrl = mediaType === 'audio'
    ? `${params.baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(params.instanceName)}`
    : `${params.baseUrl}/message/sendMedia/${encodeURIComponent(params.instanceName)}`;
  const standardBody = mediaType === 'audio'
    ? { number: normalizedNumber, audio: params.mediaUrl, delay: 300, encoding: true }
    : {
        number: normalizedNumber,
        mediatype: mediaType,
        mimetype: params.mimeType || 'application/octet-stream',
        media: params.mediaUrl,
        caption: params.message,
        fileName: params.fileName || 'arquivo',
        delay: 300
      };
  const response = await fetch(standardUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: params.globalApiKey },
    body: JSON.stringify(standardBody)
  });
  if (response.ok) return { response, data: await readJson(response) };

  const fallback = await fetch(`${params.baseUrl}/send/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: params.instanceToken },
    body: JSON.stringify({
      number: normalizedNumber,
      url: params.mediaUrl,
      type: mediaType,
      mimetype: params.mimeType,
      fileName: params.fileName,
      caption: params.message
    })
  });
  return { response: fallback, data: await readJson(fallback) };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const requestBody = await req.json().catch(() => ({}));
    const restaurant_id = await resolveStoreUserId(supabaseAdmin, user.id, requestBody?._storeId);
    const instanceSuffix = restaurant_id.replace(/-/g, '');
    const instanceName = `rest_${instanceSuffix}`;
    const instanceToken = `token_${instanceSuffix}`;
    const baseUrl = evolutionBaseUrl();
    const globalApiKey = evolutionApiKey();

    const { number, message = '', mediaUrl, mediaType, mimeType, fileName } = requestBody;

    if (!number || (!String(message).trim() && !mediaUrl)) {
      return new Response(JSON.stringify({ error: 'Missing number or content' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const configuredProvider = await sendWhatsAppByConfiguredProvider({
      supabase: supabaseAdmin,
      restaurantId: restaurant_id,
      phone: number,
      text: String(message || '').trim(),
      mediaUrl: String(mediaUrl || '').trim() || undefined,
      mediaType,
      mimeType,
      fileName,
    });
    let providerResult: any = configuredProvider;
    if (!providerResult) {
      const sent = await sendEvolutionMessage({
        baseUrl,
        globalApiKey,
        instanceName,
        instanceToken,
        number,
        message: String(message || '').trim(),
        mediaUrl: String(mediaUrl || '').trim() || undefined,
        mediaType,
        mimeType,
        fileName
      });
      providerResult = {
        ok: sent.response.ok,
        status: sent.response.status,
        data: sent.data,
        providerMessageId: pickProviderMessageId(sent.data) || null,
        transport: 'evolution',
      };
    }

    if (!providerResult.ok) {
      console.error("WhatsApp provider send error:", providerResult);
      if (providerResult.transport === 'meta_cloud') {
        const providerError = String(
          providerResult.data?.error?.message ||
          providerResult.error ||
          `HTTP ${providerResult.status || 500}`
        ).slice(0, 1000);
        await supabaseAdmin
          .from('whatsapp_provider_accounts')
          .update({ last_error: providerError, updated_at: new Date().toISOString() })
          .eq('restaurant_id', restaurant_id)
          .eq('provider', 'meta_cloud');
      }
      return new Response(JSON.stringify({ error: true, message: 'Failed to send message', details: providerResult.data || providerResult.error, status: providerResult.status }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const pause = getManualPauseWindow();
    const phoneCandidates = buildPhoneCandidates(number);
    const pausePayload = {
      status: pause.status,
      bot_paused: true,
      bot_paused_at: pause.nowIso,
      bot_paused_by: user.id,
      owner: 'HUMAN',
      current_state: 'HUMAN_ATTENDING',
      last_human_message_at: pause.nowIso,
      ai_resume_at: pause.resumeAtIso,
      metadata: {
        reason: 'manual_agent_message',
        aiResumeAt: pause.resumeAtIso,
        lastHumanMessageAt: pause.nowIso,
        handoffMode: 'temporary_human_owner'
      },
      updated_at: pause.nowIso
    };

    const aiPausePayload = {
      status: 'human_active',
      owner: 'HUMAN',
      current_state: 'HUMAN_ATTENDING',
      last_human_message_at: pause.nowIso,
      ai_resume_at: pause.resumeAtIso,
      metadata: {
        reason: 'manual_agent_message',
        pausedAt: pause.nowIso,
        aiResumeAt: pause.resumeAtIso,
        lastHumanMessageAt: pause.nowIso,
        handoffMode: 'temporary_human_owner'
      },
      last_message_at: pause.nowIso
    };

    const postSendTask = (async () => {
      if (providerResult.transport === 'meta_cloud') {
        await supabaseAdmin
          .from('whatsapp_provider_accounts')
          .update({ last_error: null, updated_at: new Date().toISOString() })
          .eq('restaurant_id', restaurant_id)
          .eq('provider', 'meta_cloud');
      }

      let pauseResult = await supabaseAdmin
        .from('whatsapp_conversations')
        .update(pausePayload)
        .eq('user_id', restaurant_id)
        .in('customer_phone', phoneCandidates);

      if (pauseResult.error && /bot_paused|owner|current_state|last_human_message_at|ai_resume_at|metadata|schema cache|column/i.test(String(pauseResult.error.message || ''))) {
        pauseResult = await supabaseAdmin
          .from('whatsapp_conversations')
          .update({ status: pause.status, updated_at: pause.nowIso })
          .eq('user_id', restaurant_id)
          .in('customer_phone', phoneCandidates);
      }

      const aiPauseResult = await supabaseAdmin
        .from('ai_conversations')
        .update(aiPausePayload)
        .eq('restaurant_id', restaurant_id)
        .in('phone', phoneCandidates);

      if (aiPauseResult.error && /owner|current_state|last_human_message_at|ai_resume_at|metadata|schema cache|column/i.test(String(aiPauseResult.error.message || ''))) {
        await supabaseAdmin
          .from('ai_conversations')
          .update({ status: 'human_active', metadata: aiPausePayload.metadata, last_message_at: pause.nowIso })
          .eq('restaurant_id', restaurant_id)
          .in('phone', phoneCandidates);
      }
    })().catch((error) => console.error('WhatsApp post-send state update error:', error));

    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(postSendTask);

    return new Response(JSON.stringify({ success: true, data: providerResult.data, providerMessageId: providerResult.providerMessageId || pickProviderMessageId(providerResult.data) || null, provider: providerResult.transport }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("Internal Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
