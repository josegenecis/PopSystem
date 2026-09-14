import { getSupabaseRuntimeEnv } from '../_lib/runtime-env.js';

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = getSupabaseRuntimeEnv();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, motivo: 'Método não permitido.' });
  }

  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, motivo: 'Login não confirmado para testar a SEFAZ.' });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/nfce-operations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ operation: 'testar_conexao' }),
    });
    const data = await response.json().catch(() => null);
    return res.status(response.status).json(data || { success: false, motivo: 'Resposta fiscal inválida.' });
  } catch (error: any) {
    return res.status(502).json({
      success: false,
      motivo: error?.message || 'Não foi possível acessar o motor fiscal.',
    });
  }
}
