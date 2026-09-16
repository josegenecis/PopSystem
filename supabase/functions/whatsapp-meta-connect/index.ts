import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { metaGraphBaseUrl, metaGraphVersion } from '../_shared/whatsapp-provider.ts';
import { resolveStoreUserId } from '../_shared/multi-store.ts';
import { encryptMetaToken } from '../_shared/meta-token.ts';
import { hasMetaWhatsAppAccess } from '../_shared/meta-rollout.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: corsHeaders });

async function readMeta(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data?.error?.message || `meta_http_${response.status}`));
    (error as Error & { code?: number }).code = Number(data?.error?.code || 0) || undefined;
    throw error;
  }
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
    const accessEnabled = hasMetaWhatsAppAccess({
      userId: user.id,
      userEmail: user.email,
      restaurantId,
    });
    const testAccessToken = String(Deno.env.get('META_WHATSAPP_TEST_TOKEN') || '').trim();
    const testWabaId = String(Deno.env.get('META_WHATSAPP_TEST_WABA_ID') || '').trim();
    const testPhoneNumberId = String(Deno.env.get('META_WHATSAPP_TEST_PHONE_NUMBER_ID') || '').trim();
    const testModeAvailable = Boolean(accessEnabled && testAccessToken && testWabaId && testPhoneNumberId);

    const exchangeForLongLivedToken = async (accessToken: string) => {
      if (!appId || !appSecret) return { accessToken, tokenExpiresAt: null as string | null };
      const tokenUrl = new URL(`${metaGraphBaseUrl()}/oauth/access_token`);
      tokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
      tokenUrl.searchParams.set('client_id', appId);
      tokenUrl.searchParams.set('client_secret', appSecret);
      tokenUrl.searchParams.set('fb_exchange_token', accessToken);
      const response = await fetch(tokenUrl);
      if (!response.ok) return { accessToken, tokenExpiresAt: null as string | null };
      const data = await response.json().catch(() => ({}));
      const exchangedToken = String(data?.access_token || '').trim();
      const expiresIn = Number(data?.expires_in || 0);
      return {
        accessToken: exchangedToken || accessToken,
        tokenExpiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
      };
    };

    const activateSettings = async (phoneNumber: string) => {
      const now = new Date().toISOString();
      const settingsPayload = {
        provider: 'meta_cloud', enabled: true, phone_number: phoneNumber, updated_at: now,
      };
      const existing = await admin
        .from('whatsapp_settings')
        .select('id')
        .eq('user_id', restaurantId)
        .limit(1)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data?.id) {
        // Atualiza todas as linhas legadas para impedir que uma duplicata antiga
        // faça o sistema voltar silenciosamente para o Evolution.
        const { error } = await admin.from('whatsapp_settings').update(settingsPayload).eq('user_id', restaurantId);
        if (error) throw error;
        return;
      }
      const { error } = await admin.from('whatsapp_settings').insert({
        user_id: restaurantId,
        default_message: 'Olá! Bem-vindo ao nosso restaurante. Como posso ajudar?',
        ...settingsPayload,
      });
      if (error) throw error;
    };

    const persistAccount = async (params: {
      accessToken: string;
      wabaId: string;
      phoneNumberId: string;
      tokenExpiresAt?: string | null;
      testMode?: boolean;
    }) => {
      const phoneData = await readMeta(await fetch(
        `${metaGraphBaseUrl()}/${encodeURIComponent(params.phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${params.accessToken}` } },
      ));
      await readMeta(await fetch(`${metaGraphBaseUrl()}/${encodeURIComponent(params.wabaId)}/subscribed_apps`, {
        method: 'POST', headers: { Authorization: `Bearer ${params.accessToken}` },
      }));

      const now = new Date().toISOString();
      const encryptedAccessToken = await encryptMetaToken(params.accessToken);
      const { error: accountError } = await admin.from('whatsapp_provider_accounts').upsert({
        restaurant_id: restaurantId,
        provider: 'meta_cloud',
        status: 'connected',
        waba_id: params.wabaId,
        phone_number_id: params.phoneNumberId,
        display_phone_number: phoneData?.display_phone_number || null,
        verified_name: phoneData?.verified_name || null,
        access_token_encrypted: encryptedAccessToken,
        token_expires_at: params.tokenExpiresAt || null,
        last_verified_at: now,
        last_error: null,
        metadata: { quality_rating: phoneData?.quality_rating || null, test_mode: Boolean(params.testMode) },
        updated_at: now,
      }, { onConflict: 'restaurant_id,provider' });
      if (accountError) throw accountError;

      await activateSettings(phoneData?.display_phone_number || '');
      return phoneData;
    };

    if (action === 'config') {
      const available = Boolean(appId && appSecret && configId && accessEnabled);
      return json({
        available,
        testModeAvailable,
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

    if (action === 'activate_test') {
      if (!testModeAvailable) return json({ error: 'Ambiente de teste da Meta não configurado.' }, 503);
      let phoneData;
      try {
        const durableToken = await exchangeForLongLivedToken(testAccessToken);
        phoneData = await persistAccount({
          accessToken: durableToken.accessToken,
          wabaId: testWabaId,
          phoneNumberId: testPhoneNumberId,
          tokenExpiresAt: durableToken.tokenExpiresAt,
          testMode: true,
        });
      } catch (error) {
        if ((error as Error & { code?: number })?.code === 190) {
          return json({ error: 'O token de teste da Meta expirou. Gere um novo token no painel da Meta e tente novamente.' }, 401);
        }
        throw error;
      }
      return json({
        ok: true,
        provider: 'meta_cloud',
        testMode: true,
        phone: phoneData?.display_phone_number || null,
        verifiedName: phoneData?.verified_name || 'Meta Test Number',
      });
    }

    if (action !== 'complete') return json({ error: 'Invalid action' }, 400);
    if (!accessEnabled || !appId || !appSecret || !configId) {
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
    const expiresIn = Number(tokenData?.expires_in || 0);
    const tokenExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    const phoneData = await persistAccount({ accessToken, wabaId, phoneNumberId, tokenExpiresAt });

    return json({ ok: true, provider: 'meta_cloud', phone: phoneData?.display_phone_number || null, verifiedName: phoneData?.verified_name || null });
  } catch (error) {
    console.error('[whatsapp-meta-connect]', error);
    return json({ error: String((error as any)?.message || error || 'meta_connect_failed') }, 500);
  }
});
