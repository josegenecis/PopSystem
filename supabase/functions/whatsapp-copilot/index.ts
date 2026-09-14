import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { generateText, gateway, Output } from 'npm:ai@6.0.282';
import { createOpenAI } from 'npm:@ai-sdk/openai@3.0.112';
import { z } from 'npm:zod@3.25.76';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const CopilotOutput = z.object({
  summary: z.string().max(800),
  suggestedReply: z.string().max(1200),
  intent: z.enum(['SEND_MENU', 'SEARCH_PRODUCT', 'CREATE_ORDER', 'CHECK_ORDER', 'CHECK_DELIVERY', 'CHECK_OPENING_HOURS', 'PAYMENT', 'HUMAN_SUPPORT', 'COMPLAINT', 'OTHER']),
  confidence: z.number().min(0).max(1),
  possibleOrder: z.array(z.string().max(200)).max(20),
  alert: z.string().max(400),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
    );
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { conversationId } = await req.json().catch(() => ({}));
    if (!conversationId) return json({ error: 'conversationId obrigatório' }, 400);
    const { data: conversation } = await authClient
      .from('whatsapp_conversations')
      .select('id,customer_name,customer_phone')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!conversation) return json({ error: 'Conversa não encontrada' }, 404);

    const { data: messages, error } = await authClient
      .from('whatsapp_messages')
      .select('sender,content,message_type,transcription,sent_at')
      .eq('conversation_id', conversation.id)
      .neq('message_type', 'order_draft')
      .order('sent_at', { ascending: false })
      .limit(40);
    if (error) throw error;

    const transcript = (messages || []).slice().reverse().map((message) => {
      const speaker = message.sender === 'customer' ? 'Cliente' : message.sender === 'agent' ? 'Operador' : 'Chatbot';
      return `${speaker}: ${message.transcription || message.content || `[${message.message_type}]`}`;
    }).join('\n').slice(-12000);

    const gatewayKey = Deno.env.get('AI_GATEWAY_API_KEY');
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!gatewayKey && !openAiKey) return json({ error: 'Copiloto não configurado' }, 503);
    const model = gatewayKey
      ? gateway(Deno.env.get('WHATSAPP_COPILOT_MODEL') || 'openai/gpt-6-astra')
      : createOpenAI({ apiKey: openAiKey })(Deno.env.get('WHATSAPP_COPILOT_OPENAI_MODEL') || 'gpt-5.4-mini');

    const { output } = await generateText({
      model,
      output: Output.object({ schema: CopilotOutput }),
      system: `Você é o copiloto privado de um operador de restaurante. Nunca fale com o cliente e nunca execute ações. Analise apenas o histórico fornecido. Não invente preço, produto, prazo, pagamento ou status. Se a informação não estiver no histórico, diga que precisa consultar. A resposta sugerida deve ser curta, humana e em português do Brasil. Um comprovante enviado nunca significa pagamento confirmado.`,
      prompt: `Cliente: ${conversation.customer_name || 'Cliente'}\n\nHistórico:\n${transcript || 'Sem mensagens.'}`,
    });

    return json({ ok: true, copilot: output });
  } catch (error) {
    console.error('[whatsapp-copilot]', error);
    return json({ error: error instanceof Error ? error.message : 'Falha no copiloto' }, 500);
  }
});
