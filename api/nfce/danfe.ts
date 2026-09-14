import { gerarPDF } from '@mmachadosantos/nfe-danfe-pdf';
import { getSupabaseRuntimeEnv } from '../_lib/runtime-env.js';

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = getSupabaseRuntimeEnv();

function pdfToBuffer(document: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const authorization = String(req.headers.authorization || '');
  const cupomId = String(req.body?.cupom_id || '').trim();
  if (!authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Login não confirmado.' });
  if (!cupomId) return res.status(400).json({ error: 'Documento fiscal não informado.' });

  try {
    const query = new URLSearchParams({
      id: `eq.${cupomId}`,
      select: 'id,numero,serie,status,model_code,xml_processado',
      limit: '1',
    });
    const fiscalResponse = await fetch(`${SUPABASE_URL}/rest/v1/nfce_cupons?${query.toString()}`, {
      headers: {
        Authorization: authorization,
        apikey: SUPABASE_ANON_KEY,
        Accept: 'application/json',
      },
    });
    if (!fiscalResponse.ok) throw new Error(`Falha ao carregar XML autorizado (${fiscalResponse.status}).`);
    const [document] = await fiscalResponse.json();
    if (!document) return res.status(404).json({ error: 'Documento fiscal não encontrado.' });
    if (String(document.model_code || '') !== '55') return res.status(400).json({ error: 'O DANFE A4 é exclusivo da NF-e modelo 55.' });
    if (document.status !== 'autorizado') return res.status(409).json({ error: 'O DANFE só pode ser gerado após a autorização da NF-e.' });
    if (!String(document.xml_processado || '').includes('<nfeProc')) {
      return res.status(422).json({ error: 'O XML processado autorizado (nfeProc) não foi encontrado.' });
    }

    const pdfDocument = await gerarPDF(String(document.xml_processado), {
      textoRodape: 'PopSystem',
    });
    const pdf = await pdfToBuffer(pdfDocument);
    const number = String(document.numero || 'documento').replace(/[^0-9A-Za-z_-]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="DANFE-NFe-${number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdf);
  } catch (error: any) {
    console.error('Falha ao gerar DANFE oficial:', error);
    return res.status(500).json({ error: error?.message || 'Não foi possível gerar o DANFE.' });
  }
}
