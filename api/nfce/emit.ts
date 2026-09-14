import { getSupabaseRuntimeEnv } from '../_lib/runtime-env.js';

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = getSupabaseRuntimeEnv();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Método não permitido.' });
  }

  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Login não confirmado para emitir NFC-e.' });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/nfce-operations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        operation: 'emitir',
        order_id: req.body?.order_id,
        consumer_data: req.body?.consumer_data,
        observacoes: req.body?.observacoes,
      }),
    });
    const data = await response.json().catch(() => null);
    return res.status(response.status).json(data || { success: false, error: 'Resposta fiscal inválida.' });
  } catch (error: any) {
    return res.status(502).json({
      success: false,
      error: error?.message || 'Não foi possível acessar o motor fiscal.',
    });
  }
}
