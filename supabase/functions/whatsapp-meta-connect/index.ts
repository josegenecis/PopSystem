import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { metaGraphBaseUrl, metaGraphVersion } from '../_shared/whatsapp-provider.ts';
import { resolveStoreUserId } from '../_shared/multi-store.ts';
import { encryptMetaToken } from '../_shared/meta-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: corsHeaders });

async function readMeta(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error?.message || `meta_http_${response.status}`));
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const restaurantId = await resolveStoreUserId(admin, user.id, body?._storeId);
    const action = String(body?.action || 'config');
    const appId = String(Deno.env.get('META_APP_ID') || '').trim();
    const appSecret = String(Deno.env.get('META_APP_SECRET') || '').trim();
    // O Embedded Signup do WhatsApp precisa de uma configuracao propria.
    // Nao reutilize META_LOGIN_CONFIG_ID: ela pertence ao OAuth de anuncios.
    const configId = String(Deno.env.get('META_WHATSAPP_CONFIG_ID') || '').trim();
    const rolloutEnabled = String(Deno.env.get('META_WHATSAPP_ROLLOUT_ENABLED') || '').trim().toLowerCase() === 'true';

    if (action === 'config') {
      const available = Boolean(appId && appSecret && configId && rolloutEnabled);
      return json({
        available,
        appId: available ? appId : null,
        configId: available ? configId : null,
        graphVersion: metaGraphVersion(),
        webhookUrl: `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/meta-whatsapp-webhook`,
      });
    }

    if (action === 'disconnect') {
      await admin.from('whatsapp_provider_accounts').update({
        status: 'disconnected', updated_at: new Date().toISOString(),
      }).eq('restaurant_id', restaurantId).eq('provider', 'meta_cloud');
      await admin.from('whatsapp_settings').update({
        provider: 'evolution', updated_at: new Date().toISOString(),
      }).eq('user_id', restaurantId);
      return json({ ok: true, provider: 'evolution' });
    }

    if (action !== 'complete') return json({ error: 'Invalid action' }, 400);
    if (!rolloutEnabled || !appId || !appSecret || !configId) {
      return json({ error: 'Meta Embedded Signup ainda não está liberado para conexão.' }, 503);
    }

    const code = String(body?.code || '').trim();
    const wabaId = String(body?.wabaId || body?.waba_id || '').trim();
    const phoneNumberId = String(body?.phoneNumberId || body?.phone_number_id || '').trim();
    if (!code || !wabaId || !phoneNumberId) return json({ error: 'A Meta não retornou todos os dados da conta. Refaça a conexão.' }, 400);

    const tokenUrl = new URL(`${metaGraphBaseUrl()}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('code', code);
    const tokenData = await readMeta(await fetch(tokenUrl));
    const accessToken = String(tokenData?.access_token || '').trim();
    if (!accessToken) throw new Error('A Meta não devolveu um token de acesso.');
    const encryptedAccessToken = await encryptMetaToken(accessToken);

    const phoneData = await readMeta(await fetch(
      `${metaGraphBaseUrl()}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    ));
    await readMeta(await fetch(`${metaGraphBaseUrl()}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
    }));

    const now = new Date().toISOString();
    const expiresIn = Number(tokenData?.expires_in || 0);
    const tokenExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    const { error: accountError } = await admin.from('whatsapp_provider_accounts').upsert({
      restaurant_id: restaurantId,
      provider: 'meta_cloud',
      status: 'connected',
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      display_phone_number: phoneData?.display_phone_number || null,
      verified_name: phoneData?.verified_name || null,
      access_token_encrypted: encryptedAccessToken,
      token_expires_at: tokenExpiresAt,
      last_verified_at: now,
      last_error: null,
      metadata: { quality_rating: phoneData?.quality_rating || null },
      updated_at: now,
    }, { onConflict: 'restaurant_id,provider' });
    if (accountError) throw accountError;

    const settingsPayload = {
      provider: 'meta_cloud', enabled: true, phone_number: phoneData?.display_phone_number || '', updated_at: now,
    };
    const existing = await admin.from('whatsapp_settings').select('id').eq('user_id', restaurantId).maybeSingle();
    if (existing.data?.id) {
      const { error } = await admin.from('whatsapp_settings').update(settingsPayload).eq('id', existing.data.id);
      if (error) throw error;
    } else {
      const { error } = await admin.from('whatsapp_settings').insert({
        user_id: restaurantId,
        default_message: 'Olá! Bem-vindo ao nosso restaurante. Como posso ajudar?',
        ...settingsPayload,
      });
      if (error) throw error;
    }

    return json({ ok: true, provider: 'meta_cloud', phone: phoneData?.display_phone_number || null, verifiedName: phoneData?.verified_name || null });
  } catch (error) {
    console.error('[whatsapp-meta-connect]', error);
    return json({ error: String((error as any)?.message || error || 'meta_connect_failed') }, 500);
  }
});
