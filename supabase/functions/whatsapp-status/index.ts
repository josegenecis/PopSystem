import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveStoreUserId } from "../_shared/multi-store.ts";
import { getActiveWhatsAppProvider, getMetaWhatsAppAccount, metaGraphBaseUrl } from '../_shared/whatsapp-provider.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const evolutionBaseUrl = () => String(Deno.env.get('EVOLUTION_BASE_URL') || Deno.env.get('EVOGO_BASE_URL') || 'https://api.boracume.com').replace(/\/+$/, '');
const evolutionApiKey = () => String(Deno.env.get('EVOLUTION_API_KEY') || Deno.env.get('EVOGO_API_KEY') || '').trim();
const SUPABASE_PROJECT_REF = 'gcfyrcpugmducptktjic';
const functionsBaseUrl = () => {
  const explicit = String(Deno.env.get('SUPABASE_FUNCTIONS_URL') || Deno.env.get('PUBLIC_FUNCTIONS_URL') || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1`;
};
const buildWebhookUrl = () => `${functionsBaseUrl()}/evogo-webhook`;

const getInstancesFromPayload = (payload: any) => {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
};

const safeFetchJson = async (url: string, init: RequestInit) => {
  try {
    const response = await fetch(url, init);
    let data: any = {};
    try {
      data = await response.json();
    } catch {
      data = { message: 'Could not parse JSON from Evolution API' };
    }
    return { ok: true, response, data };
  } catch (error: any) {
    return {
      ok: false,
      response: null,
      data: { message: error?.message || 'Network request failed' }
    };
  }
};

const configureEvolutionWebhook = async (baseUrl: string, globalApiKey: string, instanceName: string, instanceToken: string) => {
  const webhookUrl = buildWebhookUrl();
  const events = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'];
  const attempts = [
    {
      label: 'webhook-set-standard',
      url: `${baseUrl}/webhook/set/${encodeURIComponent(instanceName)}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: globalApiKey },
        body: JSON.stringify({
          webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: true, events }
        })
      }
    },
    {
      label: 'webhook-set-flat',
      url: `${baseUrl}/webhook/set/${encodeURIComponent(instanceName)}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: globalApiKey },
        body: JSON.stringify({ enabled: true, url: webhookUrl, webhookUrl, byEvents: false, base64: true, events })
      }
    }
  ];

  const results = [];
  for (const attempt of attempts) {
    const result = await safeFetchJson(attempt.url, attempt.init);
    const ok = Boolean(result.response?.ok);
    results.push({ label: attempt.label, ok, status: result.response?.status || null, data: result.data });
    if (ok) return { ok: true, webhookUrl, results };
  }
  return { ok: false, webhookUrl, results };
};

const configureEvolutionWebhooks = async (baseUrl: string, globalApiKey: string, instanceNames: string[], instanceToken: string) => {
  const names = Array.from(new Set(instanceNames.map((item) => String(item || '').trim()).filter(Boolean)));
  const results = [];
  for (const name of names) {
    const result = await configureEvolutionWebhook(baseUrl, globalApiKey, name, instanceToken);
    results.push({ instanceName: name, ...result });
    if (result.ok) return { ok: true, webhookUrl: result.webhookUrl, results };
  }
  return { ok: false, webhookUrl: buildWebhookUrl(), results };
};

const ensureWhatsAppSettingsEnabled = async (supabaseAdmin: any, restaurantId: string, baseUrl: string, globalApiKey: string) => {
  const defaultMessage = 'Olá! Bem-vindo ao nosso restaurante. Como posso ajudar você hoje?';
  const payload = {
    enabled: true,
    ai_enabled: true,
    evolution_url: baseUrl,
    evolution_api_key: globalApiKey,
    updated_at: new Date().toISOString()
  };
  const existing = await supabaseAdmin
    .from('whatsapp_settings')
    .select('id, enabled, ai_enabled, evolution_url, evolution_api_key')
    .eq('user_id', restaurantId)
    .limit(1)
    .maybeSingle();

  if (existing?.data?.id) {
    const settingsAlreadyEnabled = existing.data.enabled === true &&
      existing.data.ai_enabled === true &&
      existing.data.evolution_url === baseUrl &&
      existing.data.evolution_api_key === globalApiKey;
    if (settingsAlreadyEnabled) return;

    const updated = await supabaseAdmin.from('whatsapp_settings').update(payload).eq('id', existing.data.id);
    if (updated.error && String(updated.error.message || '').includes('ai_enabled')) {
      await supabaseAdmin.from('whatsapp_settings').update({
        enabled: true,
        evolution_url: baseUrl,
        evolution_api_key: globalApiKey,
        updated_at: new Date().toISOString()
      }).eq('id', existing.data.id);
    }
    return;
  }

  const inserted = await supabaseAdmin.from('whatsapp_settings').insert({
    user_id: restaurantId,
    phone_number: '',
    default_message: defaultMessage,
    ...payload
  });
  if (inserted.error && String(inserted.error.message || '').includes('ai_enabled')) {
    const fallbackInsert = await supabaseAdmin.from('whatsapp_settings').insert({
      user_id: restaurantId,
      phone_number: '',
      default_message: defaultMessage,
      enabled: true,
      evolution_url: baseUrl,
      evolution_api_key: globalApiKey,
      updated_at: new Date().toISOString()
    });
    if (fallbackInsert.error) {
      console.error('Failed to create WhatsApp settings:', fallbackInsert.error);
    }
  } else if (inserted.error) {
    console.error('Failed to create WhatsApp settings:', inserted.error);
  }
};

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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '',
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
    const provider = await getActiveWhatsAppProvider(supabaseAdmin, restaurant_id);
    if (provider === 'meta_cloud') {
      const account = await getMetaWhatsAppAccount(supabaseAdmin, restaurant_id);
      if (!account) {
        return new Response(JSON.stringify({ status: 'disconnected', provider: 'meta_cloud', error: 'Conta oficial não encontrada.' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const response = await fetch(
        `${metaGraphBaseUrl()}/${encodeURIComponent(account.phone_number_id)}?fields=id,display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${account.access_token}` } },
      ).catch(() => null);
      const data = response ? await response.json().catch(() => ({})) : {};
      const connected = Boolean(response?.ok && data?.id);
      await supabaseAdmin.from('whatsapp_provider_accounts').update({
        status: connected ? 'connected' : 'error',
        display_phone_number: data?.display_phone_number || account.display_phone_number || null,
        verified_name: data?.verified_name || account.verified_name || null,
        last_verified_at: new Date().toISOString(),
        last_error: connected ? null : String(data?.error?.message || 'Não foi possível validar a conexão com a Meta.'),
        updated_at: new Date().toISOString(),
      }).eq('restaurant_id', restaurant_id).eq('provider', 'meta_cloud');
      return new Response(JSON.stringify({
        status: connected ? 'connected' : 'disconnected',
        provider: 'meta_cloud',
        phone: data?.display_phone_number || account.display_phone_number || null,
        verifiedName: data?.verified_name || account.verified_name || null,
        qualityRating: data?.quality_rating || null,
        error: connected ? null : String(data?.error?.message || 'Conexão oficial inválida.'),
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const instanceSuffix = restaurant_id.replace(/-/g, '');
    const instanceName = `rest_${instanceSuffix}`;
    const instanceToken = `token_${instanceSuffix}`;
    const baseUrl = evolutionBaseUrl();
    const globalApiKey = evolutionApiKey();
    if (!globalApiKey) {
      return new Response(JSON.stringify({ status: 'disconnected', error: 'EVOLUTION_API_KEY não configurada.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const evoRes = await fetch(`${baseUrl}/instance/all`, {
      method: 'GET',
      headers: {
        'apikey': globalApiKey
      }
    });

    let evoData;
    try {
      evoData = await evoRes.json();
    } catch(e) {
      evoData = {};
    }

    if (!evoRes.ok) {
        console.log("Evolution API status error", evoData);
        // Não falha fatalmente, só retorna disconnected para não dar 500 no polling
        return new Response(JSON.stringify({ status: 'disconnected', details: evoData }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const instances = getInstancesFromPayload(evoData);
    const currentInstance = instances.find((instance: any) => (
      instance?.token === instanceToken ||
      instance?.instanceName === instanceName ||
      instance?.name === instanceName ||
      instance?.instance === instanceName
    ));

    let newStatus = 'disconnected';
    let phone = null;
    const state = String(currentInstance?.connectionStatus || currentInstance?.state || currentInstance?.status || currentInstance?.connection || '').toLowerCase();
    const hasQr = Boolean(
      currentInstance?.qrcode ||
      currentInstance?.Qrcode ||
      currentInstance?.qr ||
      currentInstance?.QrCode ||
      currentInstance?.base64 ||
      currentInstance?.code
    );

    if (currentInstance?.connected || ['open', 'connected', 'online'].includes(state)) {
      newStatus = 'connected';
    } else if (hasQr) {
      newStatus = 'connecting';
    }

    const jid = currentInstance?.jid || currentInstance?.ownerJid || currentInstance?.owner || currentInstance?.number || currentInstance?.phone;
    if (jid) {
      phone = String(jid).split('@')[0] || null;
    }

    // Update database
    const updateData: any = { status: newStatus };
    if (phone) updateData.phone = phone;

    const providerNames = Array.from(new Set([
      instanceName,
      currentInstance?.name,
      currentInstance?.instanceName,
      currentInstance?.instance
    ].filter(Boolean).map((item) => String(item).trim()).filter(Boolean)));

    const { data: existingInstances } = providerNames.length
      ? await supabaseAdmin
        .from('whatsapp_instances')
        .select('instance_name, restaurant_id, status, phone')
        .in('instance_name', providerNames)
      : { data: [] };
    const existingByName = new Map(
      (existingInstances || []).map((instance: any) => [String(instance.instance_name), instance]),
    );
    const connectionChanged = providerNames.some((name) => {
      const existing = existingByName.get(name) as any;
      return !existing || existing.restaurant_id !== restaurant_id || existing.status !== newStatus;
    });

    const webhookResult = newStatus === 'connected' && connectionChanged
      ? await configureEvolutionWebhooks(baseUrl, globalApiKey, providerNames, instanceToken)
      : null;

    for (const name of providerNames) {
      const existing = existingByName.get(name) as any;
      const phoneChanged = Boolean(phone) && String(existing?.phone || '') !== String(phone);
      const instanceChanged = !existing ||
        existing.restaurant_id !== restaurant_id ||
        existing.status !== newStatus ||
        phoneChanged;
      if (!instanceChanged) continue;

      await supabaseAdmin
        .from('whatsapp_instances')
        .upsert({
          restaurant_id,
          instance_name: name,
          ...updateData
        }, { onConflict: 'instance_name' });
    }

    if (newStatus === 'connected') {
      await ensureWhatsAppSettingsEnabled(supabaseAdmin, restaurant_id, baseUrl, globalApiKey);
    }

    return new Response(JSON.stringify({ status: newStatus, phone, provider: 'evolution', webhook: webhookResult, instanceNames: providerNames }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("Internal Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
