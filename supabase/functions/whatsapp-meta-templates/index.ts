import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveStoreUserId } from '../_shared/multi-store.ts';
import { getMetaWhatsAppAccount, metaGraphBaseUrl } from '../_shared/whatsapp-provider.ts';
import { hasMetaWhatsAppAccess } from '../_shared/meta-rollout.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: corsHeaders });

const templateNamePattern = /^[a-z0-9_]{3,512}$/;
const allowedCategories = new Set(['UTILITY', 'MARKETING', 'AUTHENTICATION']);
const allowedLanguages = new Set(['pt_BR', 'en_US', 'es']);

async function readMeta(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.error?.error_user_msg || data?.error?.message || `meta_http_${response.status}`);
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
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
    const account = await getMetaWhatsAppAccount(admin, restaurantId);
    const hasAccess = hasMetaWhatsAppAccess({ userId: user.id, userEmail: user.email, restaurantId });
    if (!hasAccess && !account) return json({ error: 'Meta WhatsApp não liberado para esta conta.' }, 403);
    if (!account || account.status !== 'connected') return json({ error: 'Conecte o WhatsApp oficial antes de gerenciar modelos.' }, 409);

    const action = String(body?.action || 'list').trim().toLowerCase();
    const url = `${metaGraphBaseUrl()}/${encodeURIComponent(account.waba_id)}/message_templates`;
    const headers = { Authorization: `Bearer ${account.access_token}`, 'Content-Type': 'application/json' };

    if (action === 'list') {
      const query = new URL(url);
      query.searchParams.set('fields', 'id,name,status,category,language,components,rejected_reason');
      query.searchParams.set('limit', '100');
      const result = await readMeta(await fetch(query, { headers }));
      return json({ ok: true, templates: Array.isArray(result?.data) ? result.data : [] });
    }

    if (action !== 'create') return json({ error: 'Invalid action' }, 400);
    const name = String(body?.name || '').trim().toLowerCase();
    const category = String(body?.category || 'UTILITY').trim().toUpperCase();
    const language = String(body?.language || 'pt_BR').trim();
    const text = String(body?.text || '').trim();
    if (!templateNamePattern.test(name)) {
      return json({ error: 'Use apenas letras minúsculas, números e sublinhado no nome.' }, 400);
    }
    if (!allowedCategories.has(category)) return json({ error: 'Categoria de modelo inválida.' }, 400);
    if (!allowedLanguages.has(language)) return json({ error: 'Idioma de modelo inválido.' }, 400);
    if (text.length < 10 || text.length > 1024) return json({ error: 'O texto deve ter entre 10 e 1024 caracteres.' }, 400);

    const variableNumbers = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    const uniqueVariables = [...new Set(variableNumbers)].sort((a, b) => a - b);
    if (uniqueVariables.some((value, index) => value !== index + 1)) {
      return json({ error: 'As variáveis precisam ser sequenciais, começando em {{1}}.' }, 400);
    }
    const bodyComponent: Record<string, unknown> = { type: 'BODY', text };
    if (uniqueVariables.length > 0) {
      const examples = uniqueVariables.map((value) => value === 1 ? 'Cliente Teste' : value === 2 ? '1234' : `Exemplo ${value}`);
      bodyComponent.example = { body_text: [examples] };
    }

    const result = await readMeta(await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        category,
        language,
        allow_category_change: true,
        components: [bodyComponent],
      }),
    }));
    return json({ ok: true, template: { id: result?.id || null, name, category, language, status: result?.status || 'PENDING', text } }, 201);
  } catch (error) {
    console.error('[whatsapp-meta-templates]', error);
    const status = Number((error as { status?: number })?.status || 500);
    return json({ error: String((error as Error)?.message || error || 'meta_template_failed') }, status >= 400 && status < 600 ? status : 500);
  }
});
