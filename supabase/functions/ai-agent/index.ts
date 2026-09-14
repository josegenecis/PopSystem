
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { geminiGenerateContent } from '../_shared/gemini.ts';

// @ts-ignore
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

console.log("Edge Function ai-agent V1 (Multi-Tool) iniciada!");

async function openAiChatWithTools(params: {
  apiKey: string;
  model: string;
  system: string;
  messages: any[];
  tools: any[];
}) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: params.system },
        ...params.messages
      ],
      tools: params.tools,
      tool_choice: params.tools?.length ? 'auto' : undefined
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Falha ao consultar OpenAI');
  }

  const message = payload?.choices?.[0]?.message || {};
  return {
    text: String(message?.content || '').trim(),
    functionCalls: Array.isArray(message?.tool_calls)
      ? message.tool_calls.map((call: any) => ({
          id: String(call?.id || crypto.randomUUID()),
          name: String(call?.function?.name || ''),
          args: (() => {
            try {
              return JSON.parse(String(call?.function?.arguments || '{}'));
            } catch {
              return {};
            }
          })()
        }))
      : [],
    assistantMessage: {
      role: 'assistant',
      content: message?.content || '',
      tool_calls: message?.tool_calls || []
    }
  };
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function ensurePublicBucket(supabase: any, bucketName: string) {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = Array.isArray(buckets) && buckets.some((bucket: any) => bucket?.name === bucketName || bucket?.id === bucketName);
    if (!exists) {
      await supabase.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"]
      });
    }
  } catch (error) {
    console.error("ensure_bucket_failed", bucketName, error);
  }
}

async function uploadGeneratedProductImage(supabase: any, productId: string, bytes: Uint8Array, contentType = "image/png") {
  await ensurePublicBucket(supabase, "product-images");
  const ext = contentType.includes("webp") ? "webp" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
  const filePath = `products/ai-${productId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("product-images")
    .upload(filePath, bytes, { contentType, upsert: true } as any);
  if (error) throw error;
  const { data } = supabase.storage.from("product-images").getPublicUrl(filePath);
  return data.publicUrl;
}

async function uploadAttachedProductImage(supabase: any, productId: string, imageBase64: string) {
  const raw = String(imageBase64 || '').trim();
  if (!raw) return null;

  const dataUrlMatch = raw.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  const contentType = String(dataUrlMatch?.[1] || 'image/jpeg').toLowerCase();
  const encoded = String(dataUrlMatch?.[2] || raw).replace(/\s/g, '');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
    throw new Error('A imagem anexada deve estar em PNG, JPEG ou WebP.');
  }

  const bytes = bytesFromBase64(encoded);
  if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) {
    throw new Error('A imagem anexada deve possuir no máximo 8 MB.');
  }

  await ensurePublicBucket(supabase, 'product-images');
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const filePath = `products/agent-${productId}-${Date.now()}.${extension}`;
  const { error } = await supabase.storage
    .from('product-images')
    .upload(filePath, bytes, { contentType, upsert: false } as any);
  if (error) throw error;
  const { data } = supabase.storage.from('product-images').getPublicUrl(filePath);
  return { publicUrl: data.publicUrl, filePath, contentType, size: bytes.byteLength };
}

async function generateProductImageWithOpenAI(params: {
  apiKey: string;
  supabase: any;
  product: any;
  restaurantName?: string;
  customPrompt?: string;
}) {
  const productName = String(params.product?.name || "produto do restaurante").trim();
  const description = String(params.product?.description || "").trim();
  const restaurantName = String(params.restaurantName || "restaurante brasileiro").trim();
  const prompt = [
    `Crie uma foto publicitaria realista e apetitosa para o produto "${productName}" do restaurante "${restaurantName}".`,
    description ? `Descricao do produto: ${description}.` : "",
    params.customPrompt ? `Orientacao extra: ${params.customPrompt}.` : "",
    "Estilo: fotografia profissional de comida, luz natural, fundo limpo, alta nitidez, produto em destaque, sem pessoas.",
    "Importante: nao coloque texto, preco, logo, marca d'agua, moldura ou letras na imagem."
  ].filter(Boolean).join(" ");

  const modelCandidates = [...new Set([Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-1", "gpt-image-1"])];
  let lastError: any = null;
  for (const model of modelCandidates) {
    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`
        },
        body: JSON.stringify({
          model,
          prompt,
          size: "1024x1024",
          quality: Deno.env.get("OPENAI_IMAGE_QUALITY") || "low",
          n: 1
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || "Falha ao gerar imagem com OpenAI.");
      const item = payload?.data?.[0] || {};
      if (item.b64_json) {
        const imageUrl = await uploadGeneratedProductImage(params.supabase, String(params.product.id), bytesFromBase64(String(item.b64_json)), "image/png");
        return { imageUrl, model, prompt };
      }
      if (item.url) {
        const imageResponse = await fetch(String(item.url));
        if (!imageResponse.ok) throw new Error("Imagem gerada, mas falhou ao baixar o arquivo.");
        const contentType = imageResponse.headers.get("content-type") || "image/png";
        const imageUrl = await uploadGeneratedProductImage(params.supabase, String(params.product.id), new Uint8Array(await imageResponse.arrayBuffer()), contentType);
        return { imageUrl, model, prompt };
      }
      throw new Error("OpenAI nao retornou imagem utilizavel.");
    } catch (error) {
      lastError = error;
      console.error("agent_product_image_model_failed", model, error);
    }
  }
  throw lastError || new Error("Falha ao gerar imagem.");
}

// @ts-ignore
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('authorization') || '';
    const botTokenHeader = req.headers.get('x-bot-token') || '';
    // @ts-ignore
    const BOT_WEBHOOK_SECRET = Deno.env.get('BOT_WEBHOOK_SECRET') || '';
    const isBotRequest = !authHeader && Boolean(BOT_WEBHOOK_SECRET) && botTokenHeader === BOT_WEBHOOK_SECRET;
    if (!authHeader) {
      if (!BOT_WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      if (botTokenHeader !== BOT_WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const body = await req.json();
    const {
      command,
      userId,
      conversationHistory = [],
      supportMode = false,
      imageBase64,
      cancelJobId,
      operatorId,
    } = body;

    if (!command && !imageBase64 && !cancelJobId) {
        throw new Error('Comando ou imagem são obrigatórios.');
    }
    if (!userId) {
        throw new Error('UserId é obrigatório.');
    }

    // @ts-ignore
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY');
    // @ts-ignore
    const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-1.5-flash';
    // @ts-ignore
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    // @ts-ignore
    const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini';
    // @ts-ignore
    const PEXELS_API_KEY = Deno.env.get('PEXELS_API_KEY');
    // @ts-ignore
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    // @ts-ignore
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!OPENAI_API_KEY && !GEMINI_API_KEY) {
        throw new Error('Nenhuma chave de IA configurada. Defina OPENAI_API_KEY ou GEMINI_API_KEY.');
    }
    if (!SUPABASE_URL) {
        throw new Error('SUPABASE_URL indisponível no ambiente da Edge Function.');
    }
    if (!SERVICE_ROLE_KEY) {
        throw new Error('Secret SERVICE_ROLE_KEY não configurado.');
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (!isBotRequest) {
        const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
        const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
        if (authError || !authData?.user) {
            return new Response(JSON.stringify({ success: false, error: 'Sessão inválida ou expirada.' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
        if (authData.user.id !== userId) {
            return new Response(JSON.stringify({ success: false, error: 'Acesso negado para este restaurante.' }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }

    const normalizedCommand = String(command || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const unrelatedContentRequest = /\b(roteiro\s+(?:de|para)|poema|redacao|conto|historia\s+ficcional|curriculo|letra\s+de\s+musica|trabalho\s+escolar|resumo\s+de\s+livro|traduz(?:a|ir))\b/.test(normalizedCommand);

    if (unrelatedContentRequest) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Posso ajudar somente com recursos, configurações, dados e operações do PopSystem. Para criar conteúdos gerais, como roteiros de vídeo, use uma ferramenta própria para esse tipo de tarefa.',
          tool_results: [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    let operatorIsAdmin = true;
    let operatorPermissions: Record<string, boolean> = {};
    if (operatorId) {
        const { data: operator, error: operatorError } = await supabase
            .from('waiters')
            .select('id, role, permissions, active')
            .eq('id', operatorId)
            .eq('user_id', userId)
            .eq('active', true)
            .maybeSingle();
        if (operatorError) throw operatorError;
        if (!operator) {
            return new Response(JSON.stringify({ success: false, error: 'Operador inválido ou sem acesso.' }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
        operatorPermissions = operator.permissions || {};
        operatorIsAdmin = operator.role === 'admin' || operatorPermissions.admin === true;
    }

    if (cancelJobId) {
        const { data: existingJob, error: readError } = await supabase
            .from('agent_activity_logs')
            .select('id, metadata')
            .eq('user_id', userId)
            .eq('id', cancelJobId)
            .eq('action_type', 'ai_image_job')
            .maybeSingle();
        if (readError) throw readError;
        if (!existingJob) {
            return new Response(JSON.stringify({
                success: false,
                message: 'Não encontrei este job para cancelar.'
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 });
        }

        const metadata = existingJob.metadata || {};
        const currentStatus = String(metadata.status || '');
        const terminalStatuses = ['done', 'failed', 'partial', 'paused_timeout', 'cancelled'];
        if (terminalStatuses.includes(currentStatus)) {
            return new Response(JSON.stringify({
                success: true,
                message: 'Esse job já estava finalizado.',
                metadata: {
                    background_job: {
                        id: existingJob.id,
                        type: 'missing_product_images',
                        status: currentStatus
                    }
                }
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
        }

        await supabase
            .from('agent_activity_logs')
            .update({
                description: 'Cancelamento solicitado pelo usuário',
                metadata: {
                    ...metadata,
                    status: 'cancel_requested',
                    cancel_requested_at: new Date().toISOString(),
                    last_update_at: new Date().toISOString()
                }
            } as any)
            .eq('user_id', userId)
            .eq('id', existingJob.id);

        return new Response(JSON.stringify({
            success: true,
            message: 'Solicitei a parada do job. Ele será interrompido com segurança no próximo item.',
            metadata: {
                background_job: {
                    id: existingJob.id,
                    type: 'missing_product_images',
                    status: 'cancel_requested'
                }
            }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    const shouldRunMissingProductImagesInBackground = (() => {
        if (supportMode || imageBase64) return false;
        const text = String(command || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        return (
            /produtos?.{0,40}sem imagem/.test(text) &&
            /(gerar|gere|criar|crie|fazer|preencher|colocar|adicionar).{0,50}imagens?/.test(text)
        ) || (
            /imagens?.{0,50}produtos?.{0,50}sem imagem/.test(text)
        );
    })();

    const runMissingProductImagesJob = async (jobId: string) => {
        const readJobMetadata = async () => {
            const { data } = await supabase
                .from('agent_activity_logs')
                .select('metadata')
                .eq('user_id', userId)
                .eq('id', jobId)
                .maybeSingle();
            return data?.metadata || {};
        };

        const isCancelRequested = async () => {
            const metadata = await readJobMetadata();
            return String(metadata?.status || '') === 'cancel_requested';
        };

        const updateJob = async (metadata: Record<string, any>, description?: string) => {
            try {
                await supabase
                    .from('agent_activity_logs')
                    .update({
                        description: description || 'Geração IA de imagens para produtos sem imagem',
                        metadata: {
                            ...metadata,
                            last_update_at: new Date().toISOString()
                        }
                    } as any)
                    .eq('user_id', userId)
                    .eq('id', jobId);
            } catch (error) {
                console.error('agent_job_update_failed', error);
            }
        };

        const getRestaurantName = async () => {
            try {
                const { data } = await supabase
                    .from('profiles')
                    .select('restaurant_name')
                    .eq('id', userId)
                    .maybeSingle();
                return String(data?.restaurant_name || 'restaurante brasileiro');
            } catch {
                return 'restaurante brasileiro';
            }
        };

        const startedAt = Date.now();
        const maxProducts = Math.min(Math.max(Number(body?.limit || 150) || 150, 1), 150);
        const timeBudgetMs = 270_000;
        const restaurantName = await getRestaurantName();
        const failures: any[] = [];
        const updatedIds: string[] = [];
        const attemptedIds = new Set<string>();
        let processed = 0;
        let updated = 0;

        if (await isCancelRequested()) {
            await updateJob({
                status: 'cancelled',
                provider: 'openai',
                processed,
                updated,
                failures: 0,
                cancelled_at: new Date().toISOString()
            }, 'Geração cancelada antes de iniciar');
            return;
        }

        await updateJob({
            status: 'running',
            provider: 'openai',
            processed,
            updated,
            failures: 0,
            remaining_without_image: null,
            started_at: new Date(startedAt).toISOString()
        }, 'Gerando imagens em segundo plano');

        try {
            while (processed < maxProducts && Date.now() - startedAt <= timeBudgetMs) {
                if (await isCancelRequested()) {
                    await updateJob({
                        status: 'cancelled',
                        provider: 'openai',
                        processed,
                        updated,
                        failures: failures.length,
                        updated_ids: updatedIds,
                        cancelled_at: new Date().toISOString()
                    }, `Geração cancelada: ${updated} produto(s) atualizado(s)`);
                    return;
                }

                const { data: products, error } = await supabase
                    .from('products')
                    .select('id, name, description, image_url')
                    .eq('user_id', userId)
                    .or('image_url.is.null,image_url.eq.')
                    .order('created_at', { ascending: true })
                    .limit(Math.min(200, maxProducts + attemptedIds.size));
                if (error) throw error;

                const list = (products || []).filter((product: any) => !attemptedIds.has(String(product.id)));
                if (list.length === 0) break;

                for (const product of list) {
                    if (processed >= maxProducts || Date.now() - startedAt > timeBudgetMs) break;
                    if (await isCancelRequested()) {
                        await updateJob({
                            status: 'cancelled',
                            provider: 'openai',
                            processed,
                            updated,
                            failures: failures.length,
                            updated_ids: updatedIds,
                            cancelled_at: new Date().toISOString()
                        }, `Geração cancelada: ${updated} produto(s) atualizado(s)`);
                        return;
                    }

                    attemptedIds.add(String(product.id));
                    processed++;
                    try {
                        const generated = await generateProductImageWithOpenAI({
                            apiKey: OPENAI_API_KEY!,
                            supabase,
                            product,
                            restaurantName
                        });
                        const { error: updErr } = await supabase
                            .from('products')
                            .update({ image_url: generated.imageUrl, updated_at: new Date().toISOString() } as any)
                            .eq('user_id', userId)
                            .eq('id', product.id);
                        if (updErr) throw updErr;
                        updated++;
                        updatedIds.push(String(product.id));
                    } catch (error: any) {
                        failures.push({ id: product.id, name: product.name, error: String(error?.message || error) });
                    }

                    if (processed === 1 || processed % 3 === 0) {
                        await updateJob({
                            status: 'running',
                            provider: 'openai',
                            processed,
                            updated,
                            failures: failures.length,
                            updated_ids: updatedIds,
                            last_error: failures.at(-1)?.error || null
                        }, `Gerando imagens em segundo plano: ${updated} atualizada(s)`);
                    }
                }
            }

            const { count: remainingCount } = await supabase
                .from('products')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId)
                .or('image_url.is.null,image_url.eq.');

            const exhaustedTime = Date.now() - startedAt > timeBudgetMs;
            const done = typeof remainingCount === 'number' && remainingCount === 0;
            await updateJob({
                status: done ? 'done' : exhaustedTime ? 'paused_timeout' : 'partial',
                provider: 'openai',
                processed,
                updated,
                failures: failures.length,
                failure_samples: failures.slice(0, 10),
                remaining_without_image: typeof remainingCount === 'number' ? remainingCount : null,
                updated_ids: updatedIds,
                exhausted_time_budget: exhaustedTime,
                finished_at: new Date().toISOString()
            }, done
                ? `Imagens concluídas: ${updated} produto(s) atualizado(s)`
                : `Imagens parcialmente concluídas: ${updated} atualizada(s), ${remainingCount ?? '?'} pendente(s)`);
        } catch (error: any) {
            await updateJob({
                status: 'failed',
                provider: 'openai',
                processed,
                updated,
                failures: failures.length,
                failure_samples: failures.slice(0, 10),
                error: String(error?.message || error),
                updated_ids: updatedIds,
                finished_at: new Date().toISOString()
            }, `Falha ao gerar imagens: ${String(error?.message || error)}`);
        }
    };

    if (shouldRunMissingProductImagesInBackground) {
        if (!OPENAI_API_KEY) {
            throw new Error('Secret OPENAI_API_KEY não configurado. A geração de imagens por IA precisa da chave OpenAI no Supabase.');
        }

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recentJobs } = await supabase
            .from('agent_activity_logs')
            .select('id, metadata, created_at')
            .eq('user_id', userId)
            .eq('action_type', 'ai_image_job')
            .gte('created_at', oneDayAgo)
            .order('created_at', { ascending: false })
            .limit(10);
        const activeJob = (recentJobs || []).find((job: any) => ['queued', 'running', 'cancel_requested'].includes(String(job?.metadata?.status || '')));
        if (activeJob) {
            return new Response(JSON.stringify({
                success: true,
                message: `Já existe uma geração de imagens em andamento.\n\nJob: ${activeJob.id}\n\nVou acompanhar esse mesmo job em vez de executar tudo de novo.`,
                metadata: {
                    background_job: {
                        id: activeJob.id,
                        type: 'missing_product_images',
                        status: activeJob?.metadata?.status || 'running',
                        reused: true
                    }
                }
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
        }

        const jobId = crypto.randomUUID();
        await supabase.from('agent_activity_logs').insert({
            id: jobId,
            user_id: userId,
            action_type: 'ai_image_job',
            description: 'Geração IA de imagens para produtos sem imagem iniciada',
            metadata: {
                status: 'queued',
                provider: 'openai',
                processed: 0,
                updated: 0,
                failures: 0,
                remaining_without_image: null,
                command,
                started_at: new Date().toISOString()
            }
        } as any);

        const runtime = (globalThis as any).EdgeRuntime;
        if (runtime?.waitUntil) {
            runtime.waitUntil(runMissingProductImagesJob(jobId));
        } else {
            runMissingProductImagesJob(jobId).catch((error) => console.error('agent_background_job_failed', error));
        }

        return new Response(JSON.stringify({
            success: true,
            message: `Iniciei a geração das imagens em segundo plano.\n\nJob: ${jobId}\n\nPode sair desta página ou minimizar o navegador. Vou continuar pelo servidor e esta tela acompanha o progresso quando você voltar.`,
            metadata: {
                background_job: {
                    id: jobId,
                    type: 'missing_product_images'
                }
            }
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    const parseMoney = (v: any): number => {
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
            let s = v.trim();
            s = s.replace(/[^0-9.,-]/g, '');
            const lastComma = s.lastIndexOf(',');
            const lastDot = s.lastIndexOf('.');
            const decPos = Math.max(lastComma, lastDot);
            if (decPos >= 0) {
                const intPart = s.slice(0, decPos).replace(/[^0-9-]/g, '');
                const frac = s.slice(decPos + 1).replace(/[^0-9]/g, '');
                s = `${intPart}.${frac}`;
            } else {
                s = s.replace(/[^0-9-]/g, '');
            }
            const n = Number(s);
            return Number.isFinite(n) ? n : NaN;
        }
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
    };

    const normalizeText = (value: any): string =>
        String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();

    const resolveOrCreateProductCategory = async (requestedName: any) => {
        const categoryName = String(requestedName || '').trim() || 'Outros';
        const normalizedRequested = normalizeText(categoryName);
        const singularRequested = normalizedRequested.replace(/s$/, '');
        const { data: categories, error } = await supabase
            .from('product_categories')
            .select('id, name, display_order')
            .eq('user_id', userId)
            .order('display_order', { ascending: true })
            .limit(500);
        if (error) throw error;

        const existing = (categories || []).find((category: any) => normalizeText(category.name) === normalizedRequested)
            || (categories || []).find((category: any) => normalizeText(category.name).replace(/s$/, '') === singularRequested)
            || (categories || []).find((category: any) => {
                const normalized = normalizeText(category.name);
                return normalized.length >= 4 && (
                    normalizedRequested.includes(normalized) || normalized.includes(normalizedRequested)
                );
            });

        if (existing) {
            return { id: existing.id, name: existing.name, created: false };
        }

        const nextOrder = (categories || []).reduce(
            (highest: number, category: any) => Math.max(highest, Number(category?.display_order || 0)),
            -1,
        ) + 1;
        const { data: created, error: createError } = await supabase
            .from('product_categories')
            .insert({ user_id: userId, name: categoryName, display_order: nextOrder })
            .select('id, name')
            .single();
        if (createError) throw createError;
        return { id: created.id, name: created.name, created: true };
    };

    const attachRequestImageToProduct = async (product: any) => {
        if (!imageBase64 || !product?.id) return { product, attachment: null };
        let uploaded: any = null;
        try {
            uploaded = await uploadAttachedProductImage(supabase, String(product.id), String(imageBase64));
            const { data: updated, error } = await supabase
                .from('products')
                .update({ image_url: uploaded?.publicUrl || null, updated_at: new Date().toISOString() } as any)
                .eq('user_id', userId)
                .eq('id', product.id)
                .select()
                .single();
            if (error) throw error;
            return { product: updated, attachment: uploaded };
        } catch (error) {
            if (uploaded?.filePath) {
                await supabase.storage.from('product-images').remove([uploaded.filePath]).catch(() => undefined);
            }
            await supabase.from('products').delete().eq('user_id', userId).eq('id', product.id);
            throw error;
        }
    };

    const parseOptions = (raw: any): Array<{ name: string; price: number; active?: boolean }> => {
        let parsed = raw;
        if (typeof parsed === 'string') {
            try {
                parsed = JSON.parse(parsed);
            } catch {
                parsed = [];
            }
        }
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((option: any) => ({
                name: String(option?.name || '').trim(),
                price: Number.isFinite(parseMoney(option?.price)) ? parseMoney(option?.price) : 0,
                active: option?.active === undefined ? true : Boolean(option?.active)
            }))
            .filter((option: any) => option.name);
    };

    const isPlaceholderOption = (name: any): boolean => {
        const normalized = normalizeText(name);
        return (
            !normalized ||
            normalized === 'placeholder' ||
            normalized === 'opcao' ||
            normalized === 'opcao de teste' ||
            normalized === 'teste' ||
            normalized.includes('placeholder') ||
            normalized.includes('teste')
        );
    };

    const countRealOptions = (raw: any): number =>
        parseOptions(raw).filter((option) => !isPlaceholderOption(option.name)).length;

    const findBestGlobalVariationMatch = async (groupName: string) => {
        const trimmedName = String(groupName || '').trim();
        if (!trimmedName) return { match: null, candidates: [] as any[] };

        const searchTerms = Array.from(
            new Set(
                [
                    trimmedName,
                    trimmedName.replace(/\s+/g, ' ').trim(),
                    trimmedName.replace(/\bcomplementos?\b/gi, '').trim()
                ].filter(Boolean)
            )
        );

        const rows: any[] = [];
        for (const term of searchTerms) {
            const { data, error } = await supabase
                .from('global_variations')
                .select('id, name, description, customer_label, receipt_label, required, max_selections, active, options, updated_at')
                .eq('user_id', userId)
                .ilike('name', `%${term}%`)
                .order('updated_at', { ascending: false })
                .limit(20);
            if (error) throw error;
            for (const row of data || []) {
                if (!rows.some((existing) => existing.id === row.id)) rows.push(row);
            }
        }

        const normalizedTarget = normalizeText(trimmedName);
        const scored = rows.map((row) => {
            const normalizedName = normalizeText(row.name);
            const exact = normalizedName === normalizedTarget;
            const startsWith = normalizedName.startsWith(normalizedTarget);
            const realOptionCount = countRealOptions(row.options);
            const totalOptionCount = parseOptions(row.options).length;
            const hasPlaceholderOnly = totalOptionCount > 0 && realOptionCount === 0;
            return {
                ...row,
                exact,
                startsWith,
                realOptionCount,
                totalOptionCount,
                hasPlaceholderOnly
            };
        });

        scored.sort((a, b) => {
            if (Number(b.exact) !== Number(a.exact)) return Number(b.exact) - Number(a.exact);
            if (Number(b.startsWith) !== Number(a.startsWith)) return Number(b.startsWith) - Number(a.startsWith);
            if (b.realOptionCount !== a.realOptionCount) return b.realOptionCount - a.realOptionCount;
            if (b.totalOptionCount !== a.totalOptionCount) return b.totalOptionCount - a.totalOptionCount;
            return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
        });

        const match = scored.find((row) => row.realOptionCount > 0) || scored[0] || null;
        return { match, candidates: scored };
    };

    // =================================================================================
    // 1. Definição das TOOLS (Ferramentas que o Agente pode usar)
    // =================================================================================
    const tools = [
        {
            type: "function",
            function: {
                name: "list_product_categories",
                description: "Lista as categorias reais do cardápio. Use antes de cadastrar um produto para escolher a categoria existente mais relacionada. Se nenhuma combinar, a ferramenta de criação cadastrará a nova categoria informada.",
                parameters: {
                    type: "object",
                    properties: {}
                }
            }
        },
        {
            type: "function",
            function: {
                name: "create_product",
                description: "Cria um novo produto de venda no cardápio. Se houver uma imagem anexada à solicitação, ela será armazenada e vinculada automaticamente ao produto. Reutiliza a categoria relacionada ou cria uma nova quando necessário.",
                parameters: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Nome do produto (ex: X-Tudo)" },
                        price: { type: "number", description: "Preço do produto (ex: 25.00)" },
                        category: { type: "string", description: "Categoria do produto (ex: Lanches, Bebidas)" },
                        description: { type: "string", description: "Descrição opcional do produto" }
                    },
                    required: ["name", "price", "category"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "create_product_full",
                description: "Cria um produto completo com variações de preço (product_variants) e complementos/adicionais (product_variations). Se houver uma imagem anexada, salva e vincula automaticamente. Use quando o usuário pedir tamanhos/variações de preço ou complementos/adicionais.",
                parameters: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Nome do produto (ex: Pizza Calabresa)" },
                        category: { type: "string", description: "Categoria do produto (ex: Pizzas, Bebidas)" },
                        description: { type: "string", description: "Descrição opcional do produto" },
                        price: { type: "number", description: "Preço base do produto (usado se não houver variações de preço)" },
                        price_variants: {
                            type: "array",
                            description: "Variações de preço do produto (ex: tamanhos).",
                            items: {
                                type: "object",
                                properties: {
                                    name: { type: "string", description: "Nome da variação (ex: Pequena, Média, Grande)" },
                                    price: { type: "number", description: "Preço da variação" },
                                    promotional_price: { type: "number", description: "Preço promocional (opcional)" }
                                },
                                required: ["name", "price"]
                            }
                        },
                        variation_groups: {
                            type: "array",
                            description: "Grupos de complementos/adicionais do produto.",
                            items: {
                                type: "object",
                                properties: {
                                    name: { type: "string", description: "Nome do grupo (ex: Adicionais, Bordas, Sabores)" },
                                    description: { type: "string", description: "Descrição do grupo (opcional)" },
                                    required: { type: "boolean", description: "Se é obrigatório escolher" },
                                    max_selections: { type: "integer", description: "Número máximo de opções selecionáveis" },
                                    options: {
                                        type: "array",
                                        description: "Lista de opções com nome e preço adicional",
                                        items: {
                                            type: "object",
                                            properties: {
                                                name: { type: "string" },
                                                price: { type: "number" }
                                            },
                                            required: ["name", "price"]
                                        }
                                    }
                                },
                                required: ["name", "options"]
                            }
                        }
                    },
                    required: ["name", "category"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "create_products",
                description: "Cria vários produtos no cardápio de uma vez. Use quando o usuário pedir para criar 3 ou mais produtos.",
                parameters: {
                    type: "object",
                    properties: {
                        products: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    name: { type: "string", description: "Nome do produto" },
                                    price: { type: "number", description: "Preço do produto" },
                                    category: { type: "string", description: "Categoria do produto" },
                                    description: { type: "string", description: "Descrição opcional do produto" }
                                },
                                required: ["name", "price", "category"]
                            },
                            description: "Lista de produtos a criar"
                        }
                    },
                    required: ["products"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "update_product_price",
                description: "Atualiza o preço de um produto existente.",
                parameters: {
                    type: "object",
                    properties: {
                        product_name: { type: "string", description: "Nome do produto a ser atualizado (busca aproximada)" },
                        new_price: { type: "number", description: "Novo preço do produto" }
                    },
                    required: ["product_name", "new_price"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "create_price_schedule",
                description: "Cria uma tabela de preço, promoção ou happy hour sem sobrescrever o preço-base. Pode aplicar a um produto, uma categoria ou ao catálogo inteiro, limitar por canal, datas, dias e horários. Só ativa imediatamente quando activate_now for true.",
                parameters: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Nome da tabela ou campanha" },
                        kind: { type: "string", enum: ["promotion", "happy_hour", "channel", "custom"] },
                        target_type: { type: "string", enum: ["product", "category", "all"] },
                        target_name: { type: "string", description: "Nome exato ou aproximado do produto/categoria; omita quando target_type=all" },
                        channel: { type: "string", enum: ["all", "pdv", "delivery", "totem", "whatsapp", "dine_in", "pickup"] },
                        adjustment_type: { type: "string", enum: ["fixed_price", "percentage_discount", "percentage_markup", "amount_discount"] },
                        adjustment_value: { type: "number" },
                        starts_at: { type: "string", description: "Data/hora inicial ISO, opcional" },
                        ends_at: { type: "string", description: "Data/hora final ISO, opcional" },
                        start_time: { type: "string", description: "Horário diário HH:MM, opcional" },
                        end_time: { type: "string", description: "Horário diário HH:MM, opcional" },
                        days_of_week: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "0 domingo até 6 sábado" },
                        priority: { type: "integer", minimum: 0, maximum: 10000 },
                        activate_now: { type: "boolean", description: "Ative somente se o usuário pedir explicitamente para aplicar/ativar" }
                    },
                    required: ["name", "kind", "target_type", "adjustment_type", "adjustment_value"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "update_product",
                description: "Edita um produto existente do cardápio com segurança. Use para alterar nome, preço, descrição, categoria, disponibilidade, destaque ou exibição no PDV/delivery. Não cria produto novo.",
                parameters: {
                    type: "object",
                    properties: {
                        product_name: { type: "string", description: "Nome atual do produto a localizar (busca aproximada)" },
                        new_name: { type: "string", description: "Novo nome do produto, se solicitado" },
                        price: { type: "number", description: "Novo preço do produto, se solicitado" },
                        description: { type: "string", description: "Nova descrição do produto, se solicitada" },
                        category: { type: "string", description: "Nova categoria do produto, se solicitada" },
                        available: { type: "boolean", description: "Disponível no cardápio. false para pausar/desativar, true para ativar" },
                        show_in_pdv: { type: "boolean", description: "Exibir no PDV" },
                        show_in_delivery: { type: "boolean", description: "Exibir no cardápio digital/delivery" },
                        is_highlight: { type: "boolean", description: "Marcar/remover destaque" }
                    },
                    required: ["product_name"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "disable_product",
                description: "Desativa/Remove um produto do cardápio (disponibilidade = false).",
                parameters: {
                    type: "object",
                    properties: {
                        product_name: { type: "string", description: "Nome do produto a ser desativado" }
                    },
                    required: ["product_name"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "create_variation_group",
                description: "Cria um grupo de variações/adicionais para produtos.",
                parameters: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Nome do grupo (ex: Adicionais, Tamanho)" },
                        options: { 
                            type: "array", 
                            items: {
                                type: "object",
                                properties: {
                                    name: { type: "string" },
                                    price: { type: "number" }
                                }
                            },
                            description: "Lista de opções com nome e preço adicional"
                        },
                        required: { type: "boolean", description: "Se é obrigatório escolher uma opção" },
                        max_selections: { type: "integer", description: "Número máximo de opções selecionáveis" }
                    },
                    required: ["name", "options"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "list_variation_group",
                description: "Localiza um grupo de complementos/adicionais existente e lista as opções reais dele. Use antes de editar preços quando o usuário citar um grupo como SABORES G.",
                parameters: {
                    type: "object",
                    properties: {
                        group_name: { type: "string", description: "Nome do grupo de complementos (ex: SABORES G)" }
                    },
                    required: ["group_name"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "adjust_variation_group_prices",
                description: "Reajusta em lote os preços das opções de um grupo de complementos existente. Pode dobrar, aplicar porcentagem ou somar um valor fixo.",
                parameters: {
                    type: "object",
                    properties: {
                        group_name: { type: "string", description: "Nome do grupo de complementos (ex: SABORES G)" },
                        multiplier: { type: "number", description: "Multiplicador dos preços. Ex: 2 dobra, 1.1 aumenta 10%" },
                        percentage_increase: { type: "number", description: "Porcentagem de aumento. Ex: 100 dobra, 10 aumenta 10%" },
                        absolute_increase: { type: "number", description: "Valor fixo para somar em cada opção. Ex: 2.50" },
                        include_zero_prices: { type: "boolean", description: "Se true, também reajusta opções que hoje valem zero. Padrão false." }
                    },
                    required: ["group_name"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "generate_product_image",
                description: "Gera e define uma imagem de produto (AI) baseado no nome/descrição. Use quando o usuário pedir imagem para um produto.",
                parameters: {
                    type: "object",
                    properties: {
                        product_name: { type: "string", description: "Nome do produto (busca aproximada)" },
                        product_id: { type: "string", description: "ID do produto (opcional, preferível se conhecido)" }
                    }
                }
            }
        },
        {
            type: "function",
            function: {
                name: "set_product_image_from_pexels",
                description: "Busca uma imagem no Pexels e define no produto. Use quando o usuário pedir para usar imagens gratuitas do Pexels.",
                parameters: {
                    type: "object",
                    properties: {
                        product_name: { type: "string", description: "Nome do produto (busca aproximada)" },
                        product_id: { type: "string", description: "ID do produto (opcional, preferível se conhecido)" },
                        query: { type: "string", description: "Termo de busca opcional (se omitido, usa nome/descrição do produto)" }
                    }
                }
            }
        },
        {
            type: "function",
            function: {
                name: "set_missing_product_images_from_pexels",
                description: "Busca imagens no Pexels e aplica em produtos sem imagem. Mais barato que gerar por IA.",
                parameters: {
                    type: "object",
                    properties: {
                        limit: { type: "integer", description: "Máximo de produtos para processar agora (padrão 100, máx 150)." },
                        process_all: { type: "boolean", description: "Se true ou omitido, tenta processar todos os produtos sem imagem dentro do limite." },
                        job_id: { type: "string", description: "ID do job para continuar uma execução anterior (opcional)." }
                    }
                }
            }
        },
        {
            type: "function",
            function: {
                name: "generate_missing_product_images",
                description: "Gera imagens para produtos sem imagem (image_url vazio). Use quando o usuário pedir para preencher imagens faltantes.",
                parameters: {
                    type: "object",
                    properties: {
                        limit: { type: "integer", description: "Quantidade máxima de produtos a processar agora (padrão 100, máx 150)." },
                        process_all: { type: "boolean", description: "Se true ou omitido, tenta processar todos os produtos sem imagem dentro do limite." },
                        job_id: { type: "string", description: "ID do job para continuar uma execução anterior (opcional)." }
                    }
                }
            }
        },
        {
            type: "function",
            function: {
                name: "add_delivery_zone",
                description: "Adiciona uma zona de entrega (bairro) com taxa.",
                parameters: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Nome do bairro ou região" },
                        fee: { type: "number", description: "Taxa de entrega em R$" },
                        min_order: { type: "number", description: "Pedido mínimo em R$" },
                        delivery_time: { type: "string", description: "Tempo estimado (ex: 30-40 min)" }
                    },
                    required: ["name", "fee"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "add_courier",
                description: "Cadastra um novo entregador/motoboy.",
                parameters: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Nome do entregador" },
                        phone: { type: "string", description: "Telefone do entregador" },
                        vehicle: { type: "string", description: "Veículo (ex: Moto Honda 123)" }
                    },
                    required: ["name", "phone"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "list_products",
                description: "Lista produtos reais do cardápio para consulta. Use category quando o usuário pedir produtos de uma categoria, como 'Extras', 'Bebidas' ou 'Pizzas'. Use search somente para buscar por nome/texto de produto.",
                parameters: {
                    type: "object",
                    properties: {
                        search: { type: "string", description: "Termo de busca por nome/texto do produto. Não use para categoria." },
                        category: { type: "string", description: "Nome da categoria que deve ser listada exatamente ou de forma aproximada." },
                        include_unavailable: { type: "boolean", description: "Se true, inclui produtos indisponíveis/inativos." },
                        limit: { type: "number", description: "Quantidade máxima de produtos para retornar. Padrão 100." }
                    }
                }
            }
        },
        {
            type: "function",
            function: {
                name: "create_expense",
                description: "Registra uma despesa.",
                parameters: {
                    type: "object",
                    properties: {
                        description: { type: "string", description: "Descrição da despesa" },
                        amount: { type: "number", description: "Valor da despesa" },
                        category: { type: "string", description: "Categoria (ex: Aluguel, Água, Energia, Insumos)" },
                        expense_date: { type: "string", description: "Data no formato YYYY-MM-DD" },
                        receipt_url: { type: "string", description: "URL do comprovante (opcional)" }
                    },
                    required: ["description", "amount"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "list_expenses",
                description: "Lista despesas registradas.",
                parameters: {
                    type: "object",
                    properties: {
                        search: { type: "string", description: "Busca por descrição/categoria (opcional)" },
                        limit: { type: "integer", description: "Limite de resultados (padrão 20)" }
                    }
                }
            }
        },
        {
            type: "function",
            function: {
                name: "get_team_summary",
                description: "Consulta dados reais da Central da Equipe: funcionários, quem está trabalhando, ponto incompleto, fechamento, faltas, horas extras, comissões, adiantamentos e saldo previsto. Nunca estime valores ausentes.",
                parameters: {
                    type: "object",
                    properties: {
                        competence: { type: "string", description: "Competência YYYY-MM. Se omitida, usa o mês atual." },
                        employee_name: { type: "string", description: "Nome do colaborador, quando a pergunta for individual." }
                    }
                }
            }
        },
        {
            type: "function",
            function: {
                name: "reverse_expense",
                description: "Estorna uma despesa pelo id (mantém histórico).",
                parameters: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "ID da despesa" },
                        reason: { type: "string", description: "Motivo obrigatório do estorno" },
                        admin_pin: { type: "string", description: "Senha/PIN do administrador que autoriza o estorno" }
                    },
                    required: ["id", "reason", "admin_pin"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "delete_expense",
                description: "Remove uma despesa pelo id.",
                parameters: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "ID da despesa" }
                    },
                    required: ["id"]
                }
            }
        }
    ];

    const productMutationTools = new Set([
        'create_product',
        'create_product_full',
        'create_products',
        'update_product_price',
        'create_price_schedule',
        'update_product',
        'disable_product',
        'create_variation_group',
        'adjust_variation_group_prices',
        'generate_product_image',
        'set_product_image_from_pexels',
        'set_missing_product_images_from_pexels',
        'generate_missing_product_images',
    ]);
    const deliveryMutationTools = new Set(['add_delivery_zone', 'add_courier']);
    const financialMutationTools = new Set(['create_expense', 'reverse_expense', 'delete_expense']);

    const canManageProducts = operatorIsAdmin || operatorPermissions.menu_manage === true;
    const canManageDelivery =
      operatorIsAdmin ||
      operatorPermissions.delivery_manage === true ||
      operatorPermissions.settings_manage === true;
    const canManageFinancial = operatorIsAdmin || operatorPermissions.financial_view === true;
    const canViewFinancial = canManageFinancial;

    const scopedTools = tools.filter((tool: any) => {
        const name = String(tool?.function?.name || '');
        if (productMutationTools.has(name)) return canManageProducts;
        if (deliveryMutationTools.has(name)) return canManageDelivery;
        if (financialMutationTools.has(name)) return canManageFinancial;
        if (name === 'list_expenses') return canViewFinancial;
        if (name === 'get_team_summary') return operatorIsAdmin || operatorPermissions.payroll_view === true || operatorPermissions.payroll_manage === true || operatorPermissions.timeclock_manage === true;
        return true;
    });

    // =================================================================================
    // 2. Chamada à OpenAI (Function Calling)
    // =================================================================================
    const requestedCountMatch = String(command || '').match(/(?:criar|crie|gere)\s+(\d{1,3})\s+(?:produtos?|itens?)/i);
    const requestedCount = requestedCountMatch ? Number(requestedCountMatch[1]) : 0;

    const systemPrompt = supportMode
      ? `Você é um atendente virtual humano e prestativo do sistema PopSystem PDV.
Seu objetivo é resolver completamente as solicitações do cliente dentro do sistema, com autonomia, como se fosse um atendente humano.

Regras:
- Escopo obrigatório: responda e execute somente solicitações relacionadas ao uso, configuração, suporte, dados ou operação do PopSystem.
- Recuse tarefas gerais que não sejam serviços do PopSystem, incluindo roteiros de vídeo, textos criativos, trabalhos escolares, traduções e assuntos pessoais. Nesses casos, explique brevemente que o Pop Agente é exclusivo do sistema.
- Fale de forma natural e acolhedora, sem mencionar ferramentas internas, logs, ou nomes de tabelas.
- Aja como um operador especialista do PopSystem: entenda a intenção, consulte dados reais, execute a ação certa e responda com o que foi feito.
- Antes de responder, sempre que preciso, busque dados reais ou execute ações no sistema usando as ferramentas disponíveis.
- Não peça confirmação para passos triviais; execute e confirme o resultado.
- Se faltar um dado indispensável (ex.: qual produto, qual período, qual categoria), faça 1 pergunta objetiva.
- Não reexecute uma ação que já aparece no histórico como concluída. Se o usuário repetir o mesmo pedido, explique o estado atual e ofereça o próximo passo.
- Ao cadastrar produto, consulte list_product_categories, escolha a categoria existente semanticamente mais relacionada e só informe uma nova categoria quando nenhuma existente for adequada.
- Se houver uma foto anexada e o pedido for cadastrar/criar um produto, extraia dela nome, marca, descrição e outros dados visíveis úteis. Use create_product ou create_product_full: a própria ferramenta salvará a foto original no produto. Não gere outra imagem e não trate a foto como simples análise.
- Se o pedido envolver cadastro completo de produto com tamanhos/variações e/ou complementos, use create_product_full.
- Se o pedido envolver mudança em produto já existente (preço, nome, categoria, descrição, disponibilidade, PDV/delivery ou destaque), use update_product. Nunca crie um novo produto quando o usuário pediu para alterar um produto existente.
- Para promoções, happy hour, preço por canal ou preço agendado, use create_price_schedule. Preserve o preço-base e só ative imediatamente quando o usuário pedir explicitamente para aplicar agora.
- Se o usuário pedir "vá nos produtos/categoria X e liste todos", use list_products com category: "X". Não transforme categoria em busca por nome.
- Para alterações de cardápio, preserve todos os campos que o usuário não pediu para mudar. Se houver mais de um produto possível, pare e peça uma confirmação objetiva com as opções encontradas.
- Se o usuário pedir para listar ou alterar preços de grupos de complementos já existentes, use list_variation_group e adjust_variation_group_prices.
- Se o usuário pedir uma imagem nova sem anexar uma foto, use generate_product_image ou generate_missing_product_images. Quando houver foto anexada no cadastro, preserve e salve a foto original pela ferramenta de criação.
- Se o usuário disser "pode fazer", "sim", "isso", "continue", "pode aplicar" ou algo parecido, entenda como autorização para executar a última solicitação acionável do histórico. Não pergunte "o que você quer que eu faça?" se existir uma ação pendente no histórico.
- Quando o pedido for acionável, execute. Evite apenas sugerir passos.
- Mantenha respostas curtas e diretas.
- Só execute alterações disponibilizadas pelas ferramentas desta sessão; elas já refletem as permissões do operador.
- O ID do usuário (restaurante) é: ${userId}`
      : `Você é um assistente administrativo inteligente para um sistema de PDV de restaurante.
Seu objetivo é ser tão útil quanto um bom copiloto operacional: entender pedidos em linguagem natural, consultar dados reais do PopSystem, executar ações com segurança e explicar o resultado de forma curta.

Regras:
- Escopo obrigatório: responda e execute somente solicitações relacionadas ao uso, configuração, suporte, dados ou operação do PopSystem.
- Recuse tarefas gerais que não sejam serviços do PopSystem, incluindo roteiros de vídeo, textos criativos, trabalhos escolares, traduções e assuntos pessoais. Nesses casos, explique brevemente que o Pop Agente é exclusivo do sistema.
- Antes de responder sobre produtos, categorias, estoque, financeiro, pedidos ou marketing, consulte/execute pelas ferramentas disponíveis sempre que isso for necessário para usar dados reais.
- Se o usuário pedir para criar algo, chame a função apropriada.
- Tenha autonomia: planeje e execute múltiplas ações necessárias usando as tools disponíveis, sem pedir confirmação.
- Não reexecute uma ação que já aparece no histórico como concluída. Se o usuário repetir o mesmo pedido, diga que já foi feito ou que existe um processo em andamento e mostre o próximo passo.
- Se existir uma tarefa longa em andamento, não abra outra igual. Informe o status e oriente o usuário a aguardar ou cancelar.
- Se o usuário disser "pode fazer", "sim", "isso", "continue", "pode aplicar" ou algo parecido, entenda como autorização para executar a última solicitação acionável do histórico. Não pergunte "o que você quer que eu faça?" se existir uma ação pendente no histórico.
- Se o usuário pedir para criar 3 ou mais produtos, use create_products com uma lista completa (crie exatamente a quantidade solicitada, até 50).
- Ao cadastrar produto, consulte list_product_categories, escolha a categoria existente semanticamente mais relacionada e só informe uma nova categoria quando nenhuma existente for adequada.
- Se houver uma foto anexada e o pedido for cadastrar/criar um produto, extraia dela nome, marca, descrição e outros dados visíveis úteis. Use create_product ou create_product_full: a própria ferramenta salvará a foto original no produto. Não gere outra imagem e não trate a foto como simples análise.
- Se o usuário pedir para criar produto com tamanhos/variações de preço e/ou complementos/adicionais, use create_product_full.
- Se o usuário pedir para alterar produto existente (ex.: mudar preço, nome, categoria, descrição, disponibilidade, destacar, aparecer ou ocultar do delivery/PDV), use update_product e não crie duplicado.
- Para promoções, happy hour, preço por canal ou preço agendado, use create_price_schedule. Não altere products.price: ele é o preço-base. Só use activate_now=true quando o usuário pedir explicitamente para ativar/aplicar agora.
- Se o usuário pedir para listar produtos de uma categoria, use list_products com category. Ex.: "vai nos produtos Extras e lista todos" significa category="Extras", não search="Extras".
- Ao editar cardápio, seja conservador: localize o produto correto, preserve os campos não mencionados e peça confirmação se o nome estiver ambíguo.
- Se o usuário pedir para listar ou reajustar preços de um grupo de complementos/adicionais já existente, use list_variation_group e adjust_variation_group_prices.
- Se o usuário enviar uma imagem de comprovante/recibo, extraia as informações e lance a despesa usando create_expense. Categorize automaticamente da melhor forma.
- Se o usuário pedir para criar imagem de produto sem anexar uma foto, ou para gerar imagens faltantes, use generate_product_image / generate_missing_product_images. Quando houver foto anexada no cadastro, preserve e salve a foto original pela ferramenta de criação.
- Se o usuário pedir imagens para produtos sem imagem, execute generate_missing_product_images com process_all=true e limit=100. Não peça para o usuário mandar "continue" quando ainda houver produtos pendentes; a ferramenta deve tentar o lote completo na mesma solicitação.
- Se o usuário pedir informações, use a função de listar para buscar dados reais antes de responder.
- Se faltar algum dado indispensável, faça 1 pergunta objetiva para destravar a execução.
- Seja direto e confirme a ação realizada.
- Só execute alterações disponibilizadas pelas ferramentas desta sessão; elas já refletem as permissões do operador.
- O ID do usuário (restaurante) é: ${userId}${requestedCount >= 3 ? `\n- O usuário solicitou ${requestedCount} produtos. Gere exatamente ${requestedCount} produtos.` : ''}`;

    const functionDeclarations = (scopedTools || [])
      .map((t: any) => t?.function)
      .filter(Boolean)
      .map((fn: any) => ({
        name: String(fn.name || ''),
        description: String(fn.description || ''),
        parameters: fn.parameters || { type: 'object', properties: {} }
      }))
      .filter((fn: any) => fn.name);
    const openAiTools = functionDeclarations.map((fn: any) => ({ type: 'function', function: fn }));
    const aiProvider = OPENAI_API_KEY ? 'openai' : 'gemini';

    const historyContents = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .map((m: any) => {
        const role = String(m?.role || '').toLowerCase();
        const text = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content || '');
        if (role === 'assistant' || role === 'model') return { role: 'model', parts: [{ text }] };
        if (role === 'user') return { role: 'user', parts: [{ text }] };
        return null;
      })
      .filter(Boolean) as any[];

    let currentContents: any[] = [
      ...historyContents
    ];
    let openAiMessages: any[] = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .map((m: any) => {
        const role = String(m?.role || '').toLowerCase();
        const text = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content || '');
        if (!text) return null;
        if (role === 'assistant' || role === 'model') return { role: 'assistant', content: text };
        if (role === 'user') return { role: 'user', content: text };
        return null;
      })
      .filter(Boolean);

    const userParts: any[] = [];
    if (command) {
        userParts.push({ text: String(command) });
    } else if (imageBase64) {
        userParts.push({ text: "Analise esta imagem." });
    }

    if (imageBase64) {
        // Remove data:image/jpeg;base64, prefix if present
        let cleanBase64 = imageBase64;
        let mimeType = 'image/jpeg';
        
        if (imageBase64.includes(';base64,')) {
            const parts = imageBase64.split(';base64,');
            mimeType = parts[0].split(':')[1] || 'image/jpeg';
            cleanBase64 = parts[1];
        }
        
        userParts.push({
            inlineData: {
                mimeType: mimeType,
                data: cleanBase64
            }
        });
    }

    currentContents.push({ role: 'user', parts: userParts });
    openAiMessages.push(
      imageBase64
        ? {
            role: 'user',
            content: [
              { type: 'text', text: String(command || 'Analise esta imagem.') },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64.includes(';base64,') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
                }
              }
            ]
          }
        : { role: 'user', content: String(command || '') }
    );

    const allToolResults: any[] = [];
    let finalMessageText: string | null = null;

    for (let step = 0; step < 6; step++) {
        const ai = aiProvider === 'openai'
          ? await openAiChatWithTools({
              apiKey: OPENAI_API_KEY!,
              model: OPENAI_MODEL,
              system: systemPrompt,
              messages: openAiMessages,
              tools: openAiTools
            })
          : await geminiGenerateContent({
              apiKey: GEMINI_API_KEY!,
              model: GEMINI_MODEL,
              system: systemPrompt,
              user: '',
              tools: functionDeclarations,
              functionCallingMode: 'AUTO',
              temperature: 0.2,
              contents: currentContents
            });

        if (aiProvider === 'openai') {
          if ((ai as any).assistantMessage) {
            openAiMessages = [...openAiMessages, (ai as any).assistantMessage];
          }
        } else {
          const candidateContent = (ai as any).raw?.candidates?.[0]?.content;
          if (candidateContent?.parts) {
            currentContents = [...currentContents, { role: 'model', parts: candidateContent.parts }];
          }
        }

        if (!(ai as any).functionCalls || (ai as any).functionCalls.length === 0) {
            finalMessageText = (ai as any).text || '';
            break;
        }

        const toolResults: any[] = [];

        for (const call of (ai as any).functionCalls) {
            const toolCallId = String((call as any)?.id || crypto.randomUUID());
            const fnName = String((call as any)?.name || '');
            const args: any = (call as any)?.args || {};
            let result: any = null;

            console.log(`[Agent] Executing tool: ${fnName}`, args);

            try {
                if (fnName === "list_product_categories") {
                    const { data: categories, error } = await supabase
                        .from('product_categories')
                        .select('id, name, description, display_order')
                        .eq('user_id', userId)
                        .order('display_order', { ascending: true })
                        .limit(500);
                    if (error) throw error;
                    result = { success: true, count: categories?.length || 0, categories: categories || [] };
                }

                // --- CREATE PRODUCT ---
                else if (fnName === "create_product") {
                    const productName = String(args.name || '').trim();
                    const price = parseMoney(args.price);
                    if (!productName || !Number.isFinite(price) || price < 0) {
                        result = { success: false, error: 'Nome e preço válido são obrigatórios para cadastrar o produto.' };
                    } else {
                        const { data: possibleDuplicates, error: duplicateError } = await supabase
                            .from('products')
                            .select('id, name, price, category, image_url, available')
                            .eq('user_id', userId)
                            .ilike('name', productName)
                            .limit(5);
                        if (duplicateError) throw duplicateError;
                        const duplicate = (possibleDuplicates || []).find((product: any) => normalizeText(product.name) === normalizeText(productName));
                        if (duplicate) {
                            result = {
                                success: false,
                                error: `Já existe um produto chamado "${duplicate.name}". Edite o existente para evitar duplicidade.`,
                                existing_product: duplicate
                            };
                        } else {
                            const category = await resolveOrCreateProductCategory(args.category);
                            const { data: createdProduct, error } = await supabase
                                .from('products')
                                .insert({
                                    user_id: userId,
                                    name: productName,
                                    price,
                                    description: String(args.description || '').trim(),
                                    category: category.name,
                                    category_id: category.id,
                                    available: true,
                                    show_in_pdv: true,
                                    show_in_delivery: true
                                })
                                .select()
                                .single();
                            if (error) throw error;

                            const attached = await attachRequestImageToProduct(createdProduct);
                            result = {
                                success: true,
                                product: attached.product,
                                category_created: category.created,
                                image_attached: Boolean(attached.attachment),
                                image_url: attached.attachment?.publicUrl || attached.product?.image_url || null
                            };
                        }
                    }
                }

                else if (fnName === "create_product_full") {
                    const catName = String(args.category || '').trim() || 'Sem categoria';
                    const prodName = String(args.name || '').trim();
                    const description = String(args.description || '');
                    const variants = Array.isArray(args.price_variants) ? args.price_variants : [];
                    const groups = Array.isArray(args.variation_groups) ? args.variation_groups : [];

                    if (!prodName || !catName) {
                        result = { success: false, error: 'Nome e categoria são obrigatórios.' };
                    } else {
                        const category = await resolveOrCreateProductCategory(catName);

                        const parsedVariantPrices = variants
                            .map((v: any) => ({
                                name: String(v?.name || '').trim(),
                                price: parseMoney(v?.price),
                                promotional_price: v?.promotional_price === undefined ? null : parseMoney(v?.promotional_price)
                            }))
                            .filter((v: any) => v.name && Number.isFinite(v.price) && v.price >= 0);

                        const basePrice =
                            parsedVariantPrices.length > 0
                                ? Math.min(...parsedVariantPrices.map((v: any) => v.price))
                                : (Number.isFinite(parseMoney(args.price)) ? parseMoney(args.price) : 0);

                        const { data: prod, error } = await supabase
                            .from('products')
                            .insert({
                                user_id: userId,
                                name: prodName,
                                price: basePrice,
                                description,
                                category: category.name,
                                category_id: category.id,
                                available: true,
                                show_in_pdv: true,
                                show_in_delivery: true
                            })
                            .select('id, name, price, category, image_url')
                            .single();
                        if (error) throw error;
                        const attached = await attachRequestImageToProduct(prod);

                        let createdVariants = 0;
                        if (parsedVariantPrices.length > 0) {
                            const payload = parsedVariantPrices.map((v: any, idx: number) => ({
                                product_id: prod.id,
                                name: v.name,
                                price: v.price,
                                promotional_price: Number.isFinite(v.promotional_price) ? v.promotional_price : null,
                                display_order: idx
                            }));
                            const { error: vErr } = await supabase.from('product_variants').insert(payload);
                            if (vErr) throw vErr;
                            createdVariants = payload.length;
                        }

                        let createdGroups = 0;
                        for (const g of groups) {
                            const gName = String(g?.name || '').trim();
                            const gOptionsRaw = Array.isArray(g?.options) ? g.options : [];
                            const gOptions = gOptionsRaw
                                .map((o: any) => ({ name: String(o?.name || '').trim(), price: parseMoney(o?.price) }))
                                .filter((o: any) => o.name && Number.isFinite(o.price) && o.price >= 0);
                            if (!gName || gOptions.length === 0) continue;
                            const payload = {
                                user_id: userId,
                                product_id: prod.id,
                                name: gName,
                                description: g?.description ? String(g.description) : null,
                                required: g?.required === undefined ? false : Boolean(g.required),
                                max_selections: Number.isFinite(Number(g?.max_selections)) ? Number(g.max_selections) : 1,
                                options: gOptions,
                                price: 0
                            };
                            const { error: gErr } = await supabase.from('product_variations').insert(payload);
                            if (gErr) throw gErr;
                            createdGroups++;
                        }

                        result = {
                            success: true,
                            product: attached.product,
                            category_created: category.created,
                            image_attached: Boolean(attached.attachment),
                            image_url: attached.attachment?.publicUrl || attached.product?.image_url || null,
                            created_price_variants: createdVariants,
                            created_variation_groups: createdGroups
                        };
                    }
                }

                // --- CREATE PRODUCTS (BATCH) ---
                else if (fnName === "create_products") {
                    const products = Array.isArray(args.products) ? args.products : [];
                    const max = 50;
                    const toCreate = products.slice(0, max);
                    const categoryCache = new Map<string, string>();
                    const createdNames: string[] = [];

                    for (const p of toCreate) {
                        const catName = String(p.category || '').trim() || 'Sem categoria';
                        let categoryId = categoryCache.get(catName) || null;

                        if (!categoryId) {
                            const { data: existingCat } = await supabase
                                .from('product_categories')
                                .select('id, name')
                                .eq('user_id', userId)
                                .ilike('name', `%${catName}%`)
                                .maybeSingle();

                            if (existingCat) {
                                categoryId = existingCat.id;
                            } else {
                                const { data: newCat } = await supabase
                                    .from('product_categories')
                                    .insert({ user_id: userId, name: catName })
                                    .select('id')
                                    .single();
                                if (newCat) categoryId = newCat.id;
                            }

                            if (categoryId) categoryCache.set(catName, categoryId);
                        }

                        const name = String(p.name || '').trim();
                        const price = parseMoney((p as any).price);
                        if (!name || !Number.isFinite(price)) continue;

                        const { error } = await supabase
                            .from('products')
                            .insert({
                                user_id: userId,
                                name,
                                price,
                                description: String(p.description || ''),
                                category: catName,
                                category_id: categoryId,
                                available: true,
                                show_in_pdv: true,
                                show_in_delivery: true
                            });
                        if (error) throw error;
                        createdNames.push(name);
                    }

                    result = { success: true, created_count: createdNames.length, created_names: createdNames };
                }

                // --- UPDATE PRICE ---
                else if (fnName === "update_product_price") {
                    // Find product first
                    const { data: products } = await supabase
                        .from('products')
                        .select('id, name')
                        .eq('user_id', userId)
                        .ilike('name', `%${args.product_name}%`)
                        .limit(1);
                    
                    if (!products || products.length === 0) {
                        result = { success: false, error: "Produto não encontrado." };
                    } else {
                        const next = parseMoney(args.new_price);
                        if (!Number.isFinite(next) || next < 0) {
                            result = { success: false, error: "Preço inválido." };
                        } else {
                        const { error } = await supabase
                            .from('products')
                            .update({ price: next })
                            .eq('id', products[0].id);
                        
                        if (error) throw error;
                        result = { success: true, updated: products[0].name, new_price: next };
                        }
                    }
                }

                else if (fnName === "create_price_schedule") {
                    const scheduleName = String(args.name || '').trim();
                    const targetType = String(args.target_type || 'product');
                    const targetName = String(args.target_name || '').trim();
                    const adjustmentValue = parseMoney(args.adjustment_value);
                    if (!scheduleName || !['product', 'category', 'all'].includes(targetType) || !Number.isFinite(adjustmentValue) || adjustmentValue < 0 || (args.adjustment_type === 'percentage_discount' && adjustmentValue > 100)) {
                        result = { success: false, error: 'Informe nome, alvo e regra de preço válidos.' };
                    } else {
                        let targets: Array<{ product_id: string | null; category_id: string | null }> = [];
                        if (targetType === 'all') {
                            targets = [{ product_id: null, category_id: null }];
                        } else if (targetType === 'product') {
                            const { data: foundProducts, error: productsError } = await supabase
                                .from('products').select('id,name').eq('user_id', userId).ilike('name', `%${targetName}%`).limit(8);
                            if (productsError) throw productsError;
                            const exact = (foundProducts || []).filter((item: any) => normalizeText(item.name) === normalizeText(targetName));
                            const candidates = exact.length ? exact : (foundProducts || []);
                            if (candidates.length !== 1) {
                                result = { success: false, needs_confirmation: true, error: candidates.length ? 'Encontrei mais de um produto parecido.' : 'Produto não encontrado.', options: candidates };
                            } else targets = [{ product_id: candidates[0].id, category_id: null }];
                        } else {
                            const { data: foundCategories, error: categoriesError } = await supabase
                                .from('product_categories').select('id,name').eq('user_id', userId).ilike('name', `%${targetName}%`).limit(8);
                            if (categoriesError) throw categoriesError;
                            const exact = (foundCategories || []).filter((item: any) => normalizeText(item.name) === normalizeText(targetName));
                            const candidates = exact.length ? exact : (foundCategories || []);
                            if (candidates.length !== 1) {
                                result = { success: false, needs_confirmation: true, error: candidates.length ? 'Encontrei mais de uma categoria parecida.' : 'Categoria não encontrada.', options: candidates };
                            } else targets = [{ product_id: null, category_id: candidates[0].id }];
                        }

                        if (!result && targets.length === 0) {
                            result = { success: false, error: 'Nenhum produto foi encontrado para aplicar a tabela.' };
                        }
                        if (!result) {
                            const { data: table, error: tableError } = await supabase.from('price_tables').insert({
                                user_id: userId,
                                name: scheduleName,
                                kind: args.kind || 'custom',
                                channel: args.channel || 'all',
                                priority: Number.isFinite(Number(args.priority)) ? Number(args.priority) : 100,
                                active: Boolean(args.activate_now),
                                starts_at: args.starts_at || null,
                                ends_at: args.ends_at || null,
                                start_time: args.start_time || null,
                                end_time: args.end_time || null,
                                days_of_week: Array.isArray(args.days_of_week) && args.days_of_week.length ? args.days_of_week : null,
                                created_by: userId
                            }).select('*').single();
                            if (tableError) throw tableError;
                            const { error: itemsError } = await supabase.from('price_table_items').insert(targets.map((target) => ({
                                user_id: userId,
                                price_table_id: table.id,
                                ...target,
                                adjustment_type: args.adjustment_type,
                                adjustment_value: adjustmentValue
                            })));
                            if (itemsError) {
                                await supabase.from('price_tables').delete().eq('id', table.id).eq('user_id', userId);
                                throw itemsError;
                            }
                            await supabase.from('price_change_audit').insert({
                                user_id: userId, actor_id: userId, entity_type: 'price_table', entity_id: table.id,
                                action: table.active ? 'created_and_activated_by_agent' : 'created_by_agent', after_data: table
                            });
                            result = { success: true, table, rules_created: targets.length, active: table.active, base_prices_preserved: true };
                        }
                    }
                }

                else if (fnName === "update_product") {
                    const productName = String(args.product_name || '').trim();
                    if (!productName) {
                        result = { success: false, error: 'Informe o nome do produto que deve ser alterado.' };
                    } else {
                        const { data: products, error: findError } = await supabase
                            .from('products')
                            .select('id, name, price, category, category_id, available, show_in_pdv, show_in_delivery, is_highlight')
                            .eq('user_id', userId)
                            .ilike('name', `%${productName}%`)
                            .limit(8);
                        if (findError) throw findError;

                        const list = products || [];
                        const normalizedTarget = normalizeText(productName);
                        const exactMatches = list.filter((product: any) => normalizeText(product.name) === normalizedTarget);
                        const candidates = exactMatches.length > 0 ? exactMatches : list;

                        if (candidates.length === 0) {
                            result = { success: false, error: `Produto "${productName}" não encontrado.` };
                        } else if (candidates.length > 1 && exactMatches.length !== 1) {
                            result = {
                                success: false,
                                needs_confirmation: true,
                                error: `Encontrei mais de um produto parecido com "${productName}".`,
                                options: candidates.slice(0, 5).map((product: any) => ({
                                    id: product.id,
                                    name: product.name,
                                    price: product.price,
                                    category: product.category
                                }))
                            };
                        } else {
                            const product = candidates[0];
                            const updatePayload: Record<string, any> = {};

                            if (typeof args.new_name === 'string' && args.new_name.trim()) {
                                updatePayload.name = args.new_name.trim();
                            }
                            if (args.price !== undefined && args.price !== null && String(args.price).trim() !== '') {
                                const nextPrice = parseMoney(args.price);
                                if (!Number.isFinite(nextPrice) || nextPrice < 0) {
                                    result = { success: false, error: 'Preço inválido.' };
                                } else {
                                    updatePayload.price = nextPrice;
                                }
                            }
                            if (typeof args.description === 'string') {
                                updatePayload.description = args.description.trim();
                            }
                            if (args.available !== undefined) updatePayload.available = Boolean(args.available);
                            if (args.show_in_pdv !== undefined) updatePayload.show_in_pdv = Boolean(args.show_in_pdv);
                            if (args.show_in_delivery !== undefined) updatePayload.show_in_delivery = Boolean(args.show_in_delivery);
                            if (args.is_highlight !== undefined) updatePayload.is_highlight = Boolean(args.is_highlight);

                            if (!result && typeof args.category === 'string' && args.category.trim()) {
                                const catName = args.category.trim();
                                let categoryId: string | null = null;
                                const { data: existingCat, error: catFindError } = await supabase
                                    .from('product_categories')
                                    .select('id, name')
                                    .eq('user_id', userId)
                                    .ilike('name', `%${catName}%`)
                                    .maybeSingle();
                                if (catFindError) throw catFindError;
                                if (existingCat) {
                                    categoryId = existingCat.id;
                                } else {
                                    const { data: newCat, error: catCreateError } = await supabase
                                        .from('product_categories')
                                        .insert({ user_id: userId, name: catName })
                                        .select('id')
                                        .single();
                                    if (catCreateError) throw catCreateError;
                                    categoryId = newCat?.id || null;
                                }
                                updatePayload.category = catName;
                                updatePayload.category_id = categoryId;
                            }

                            if (!result) {
                                if (Object.keys(updatePayload).length === 0) {
                                    result = { success: false, error: 'Nenhuma alteração válida foi informada.' };
                                } else {
                                    const { data: updated, error } = await supabase
                                        .from('products')
                                        .update(updatePayload)
                                        .eq('user_id', userId)
                                        .eq('id', product.id)
                                        .select('id, name, price, category, available, show_in_pdv, show_in_delivery, is_highlight')
                                        .single();
                                    if (error) throw error;
                                    result = {
                                        success: true,
                                        updated_product: updated,
                                        changed_fields: Object.keys(updatePayload),
                                        previous_product: product
                                    };
                                }
                            }
                        }
                    }
                }

                // --- DISABLE PRODUCT ---
                else if (fnName === "disable_product") {
                    const { data: products } = await supabase
                        .from('products')
                        .select('id, name')
                        .eq('user_id', userId)
                        .ilike('name', `%${args.product_name}%`)
                        .limit(1);
                    
                    if (!products || products.length === 0) {
                        result = { success: false, error: "Produto não encontrado." };
                    } else {
                        const { error } = await supabase
                            .from('products')
                            .update({ available: false })
                            .eq('id', products[0].id);
                        
                        if (error) throw error;
                        result = { success: true, disabled: products[0].name };
                    }
                }

                // --- CREATE VARIATION GROUP ---
                else if (fnName === "create_variation_group") {
                    // 1. Create global variation
                    const { data: globalVar, error: varError } = await supabase
                        .from('global_variations')
                        .insert({
                            user_id: userId,
                            name: args.name,
                            description: args.description ? String(args.description) : null,
                            required: args.required === undefined ? false : Boolean(args.required),
                            max_selections: Number.isFinite(Number(args.max_selections)) ? Number(args.max_selections) : 1,
                            options: args.options // JSONB
                        })
                        .select()
                        .single();

                    if (varError) throw varError;
                    result = { success: true, variation: globalVar };
                }

                else if (fnName === "list_variation_group") {
                    const groupName = String(args.group_name || '').trim();
                    if (!groupName) {
                        result = { success: false, error: 'Informe o nome do grupo.' };
                    } else {
                        const { match, candidates } = await findBestGlobalVariationMatch(groupName);
                        if (!match) {
                            result = { success: false, error: `Nenhum grupo encontrado para "${groupName}".` };
                        } else {
                            const options = parseOptions(match.options);
                            const realOptions = options.filter((option) => !isPlaceholderOption(option.name));
                            result = {
                                success: true,
                                group: {
                                    id: match.id,
                                    name: match.name,
                                    description: match.description || null,
                                    customer_label: match.customer_label || null,
                                    receipt_label: match.receipt_label || null,
                                    required: Boolean(match.required),
                                    max_selections: Number(match.max_selections || 1),
                                    active: match.active !== false,
                                    options: realOptions.length > 0 ? realOptions : options
                                },
                                candidates: candidates.slice(0, 5).map((candidate) => ({
                                    id: candidate.id,
                                    name: candidate.name,
                                    real_options: candidate.realOptionCount,
                                    total_options: candidate.totalOptionCount
                                })),
                                warning: match.hasPlaceholderOnly
                                    ? `O grupo "${match.name}" encontrado parece estar só com opções de teste/placeholder.`
                                    : null
                            };
                        }
                    }
                }

                else if (fnName === "adjust_variation_group_prices") {
                    const groupName = String(args.group_name || '').trim();
                    if (!groupName) {
                        result = { success: false, error: 'Informe o nome do grupo.' };
                    } else {
                        const multiplier = Number(args.multiplier);
                        const percentageIncrease = Number(args.percentage_increase);
                        const absoluteIncrease = parseMoney(args.absolute_increase);
                        const includeZeroPrices = Boolean(args.include_zero_prices);

                        const hasMultiplier = Number.isFinite(multiplier) && multiplier > 0;
                        const hasPercentage = Number.isFinite(percentageIncrease);
                        const hasAbsolute = Number.isFinite(absoluteIncrease);

                        if (!hasMultiplier && !hasPercentage && !hasAbsolute) {
                            result = {
                                success: false,
                                error: 'Informe multiplier, percentage_increase ou absolute_increase para reajustar os preços.'
                            };
                        } else {
                            const { match, candidates } = await findBestGlobalVariationMatch(groupName);
                            if (!match) {
                                result = { success: false, error: `Nenhum grupo encontrado para "${groupName}".` };
                            } else {
                                const options = parseOptions(match.options);
                                const realOptions = options.filter((option) => !isPlaceholderOption(option.name));
                                const sourceOptions = realOptions.length > 0 ? realOptions : options;

                                if (sourceOptions.length === 0) {
                                    result = {
                                        success: false,
                                        error: `O grupo "${match.name}" não possui opções válidas para reajuste.`
                                    };
                                } else {
                                    const updatedOptions = sourceOptions.map((option) => {
                                        const current = Number.isFinite(parseMoney(option.price)) ? parseMoney(option.price) : 0;
                                        if (!includeZeroPrices && current <= 0) {
                                            return { ...option, price: Number(current.toFixed(2)) };
                                        }

                                        let next = current;
                                        if (hasMultiplier) {
                                            next = current * multiplier;
                                        } else if (hasPercentage) {
                                            next = current * (1 + (percentageIncrease / 100));
                                        } else if (hasAbsolute) {
                                            next = current + absoluteIncrease;
                                        }

                                        return {
                                            ...option,
                                            price: Math.max(0, Number(next.toFixed(2)))
                                        };
                                    });

                                    const { error } = await supabase
                                        .from('global_variations')
                                        .update({
                                            options: JSON.stringify(updatedOptions),
                                            updated_at: new Date().toISOString()
                                        } as any)
                                        .eq('id', match.id);

                                    if (error) throw error;

                                    result = {
                                        success: true,
                                        group: match.name,
                                        updated_count: updatedOptions.length,
                                        candidates: candidates.slice(0, 5).map((candidate) => ({
                                            id: candidate.id,
                                            name: candidate.name,
                                            real_options: candidate.realOptionCount,
                                            total_options: candidate.totalOptionCount
                                        })),
                                        preview: updatedOptions.slice(0, 10).map((option) => ({
                                            name: option.name,
                                            price: option.price
                                        })),
                                        skipped_zero_prices: !includeZeroPrices
                                    };
                                }
                            }
                        }
                    }
                }

                else if (fnName === "generate_product_image" || fnName === "generate_missing_product_images") {
                    if (!OPENAI_API_KEY) {
                        result = {
                            success: false,
                            error: 'Secret OPENAI_API_KEY não configurado. A geração de imagens por IA precisa da chave OpenAI no Supabase.'
                        };
                    } else {
                        const getRestaurantName = async () => {
                            try {
                                const { data } = await supabase
                                    .from('profiles')
                                    .select('restaurant_name')
                                    .eq('id', userId)
                                    .maybeSingle();
                                return String(data?.restaurant_name || 'restaurante brasileiro');
                            } catch {
                                return 'restaurante brasileiro';
                            }
                        };

                        const findProduct = async () => {
                            const pid = String(args.product_id || '').trim();
                            const pname = String(args.product_name || '').trim();
                            if (pid) {
                                const { data, error } = await supabase
                                    .from('products')
                                    .select('id, name, description, image_url')
                                    .eq('user_id', userId)
                                    .eq('id', pid)
                                    .maybeSingle();
                                if (error) throw error;
                                return data;
                            }
                            if (pname) {
                                const { data, error } = await supabase
                                    .from('products')
                                    .select('id, name, description, image_url')
                                    .eq('user_id', userId)
                                    .ilike('name', `%${pname}%`)
                                    .order('created_at', { ascending: true })
                                    .limit(3);
                                if (error) throw error;
                                if ((data || []).length > 1) {
                                    const exact = (data || []).find((p: any) => String(p.name || '').toLowerCase() === pname.toLowerCase());
                                    if (exact) return exact;
                                }
                                return (data || [])[0] || null;
                            }
                            return null;
                        };

                        if (fnName === "generate_product_image") {
                            const product = await findProduct();
                            if (!product) {
                                result = { success: false, error: 'Produto não encontrado. Informe o nome exato ou selecione o produto antes de pedir a imagem.' };
                            } else {
                                const restaurantName = await getRestaurantName();
                                const generated = await generateProductImageWithOpenAI({
                                    apiKey: OPENAI_API_KEY,
                                    supabase,
                                    product,
                                    restaurantName,
                                    customPrompt: args.prompt || args.description
                                });
                                const { error: updErr } = await supabase
                                    .from('products')
                                    .update({ image_url: generated.imageUrl, updated_at: new Date().toISOString() } as any)
                                    .eq('user_id', userId)
                                    .eq('id', product.id);
                                if (updErr) throw updErr;
                                try {
                                    await supabase.from('agent_activity_logs').insert({
                                        user_id: userId,
                                        action_type: 'product_image_generate',
                                        description: `Imagem IA gerada para ${product.name}`,
                                        metadata: { product_id: product.id, image_url: generated.imageUrl, model: generated.model }
                                    } as any);
                                } catch {}
                                result = {
                                    success: true,
                                    product_id: product.id,
                                    product_name: product.name,
                                    image_url: generated.imageUrl,
                                    source: { provider: 'openai', model: generated.model }
                                };
                            }
                        } else {
                            const requested = Number(args.limit || 100) || 100;
                            const maxPerExecution = 150;
                            const limit = Math.min(Math.max(requested, 1), maxPerExecution);
                            const processAll = args.process_all !== false;
                            const jobId = String(args.job_id || '').trim() || crypto.randomUUID();
                            const startedAt = Date.now();
                            const timeBudgetMs = 240_000;
                            const restaurantName = await getRestaurantName();
                            const failures: any[] = [];
                            const updatedIds: string[] = [];
                            const attemptedIds = new Set<string>();
                            let processed = 0;
                            let updated = 0;

                            try {
                                const { data: existingJob } = await supabase
                                    .from('agent_activity_logs')
                                    .select('id')
                                    .eq('user_id', userId)
                                    .eq('id', jobId)
                                    .maybeSingle();
                                if (!existingJob) {
                                    await supabase.from('agent_activity_logs').insert({
                                        id: jobId,
                                        user_id: userId,
                                        action_type: 'ai_image_job',
                                        description: 'Geração IA de imagens para produtos sem imagem',
                                        metadata: { status: 'running', updated: 0, failures: 0, started_at: new Date().toISOString() }
                                    } as any);
                                }
                            } catch {}

                            while (processed < limit) {
                                const { data: products, error } = await supabase
                                    .from('products')
                                    .select('id, name, description, image_url')
                                    .eq('user_id', userId)
                                    .or('image_url.is.null,image_url.eq.')
                                    .order('created_at', { ascending: true })
                                    .limit(Math.min(200, limit + attemptedIds.size));
                                if (error) throw error;
                                const list = (products || []).filter((product: any) => !attemptedIds.has(String(product.id)));
                                if (list.length === 0) break;

                                for (const product of list) {
                                    if (processed >= limit) break;
                                    if (Date.now() - startedAt > timeBudgetMs) break;
                                    attemptedIds.add(String(product.id));
                                    processed++;
                                    try {
                                        const generated = await generateProductImageWithOpenAI({
                                            apiKey: OPENAI_API_KEY,
                                            supabase,
                                            product,
                                            restaurantName
                                        });
                                        const { error: updErr } = await supabase
                                            .from('products')
                                            .update({ image_url: generated.imageUrl, updated_at: new Date().toISOString() } as any)
                                            .eq('user_id', userId)
                                            .eq('id', product.id);
                                        if (updErr) throw updErr;
                                        updated++;
                                        updatedIds.push(String(product.id));
                                    } catch (error: any) {
                                        failures.push({ id: product.id, name: product.name, error: String(error?.message || error) });
                                    }
                                }

                                if (!processAll) break;
                                if (Date.now() - startedAt > timeBudgetMs) break;
                            }

                            const { count: remainingCount } = await supabase
                                .from('products')
                                .select('id', { count: 'exact', head: true })
                                .eq('user_id', userId)
                                .or('image_url.is.null,image_url.eq.');

                            try {
                                await supabase
                                    .from('agent_activity_logs')
                                    .update({
                                        metadata: {
                                            status: typeof remainingCount === 'number' && remainingCount === 0 ? 'done' : 'running',
                                            provider: 'openai',
                                            updated,
                                            processed,
                                            failures: failures.length,
                                            remaining_without_image: typeof remainingCount === 'number' ? remainingCount : null,
                                            updated_ids: updatedIds,
                                            last_update_at: new Date().toISOString()
                                        }
                                    } as any)
                                    .eq('user_id', userId)
                                    .eq('id', jobId);
                            } catch {}

                            result = {
                                success: true,
                                job_id: jobId,
                                processed,
                                updated,
                                failures,
                                remaining_without_image: typeof remainingCount === 'number' ? remainingCount : null,
                                updated_ids: updatedIds,
                                exhausted_time_budget: Date.now() - startedAt > timeBudgetMs,
                                note: typeof remainingCount === 'number' && remainingCount > 0
                                    ? `Tentei processar o lote completo desta solicitação. Ainda restam ${remainingCount} produto(s) sem imagem, normalmente por falha da API, timeout ou limite de segurança.`
                                    : 'Todas as imagens pendentes foram processadas.'
                            };
                        }
                    }
                }

                else if (fnName === "set_product_image_from_pexels" || fnName === "set_missing_product_images_from_pexels") {
                    if (!PEXELS_API_KEY) {
                        result = { success: false, error: 'Secret PEXELS_API_KEY não configurado.' };
                    } else {
                        const searchPexels = async (query: string) => {
                            const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=square`;
                            const resp = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
                            const data = await resp.json();
                            const photo = data?.photos?.[0];
                            const src = photo?.src?.large || photo?.src?.medium || photo?.src?.original;
                            if (!src) throw new Error('Nenhuma imagem encontrada no Pexels.');
                            return { src: String(src), photo };
                        };

                        const uploadFromUrl = async (productId: string, imageUrl: string) => {
                            const resp = await fetch(imageUrl);
                            if (!resp.ok) throw new Error('Falha ao baixar imagem do Pexels.');
                            const ct = resp.headers.get('content-type') || 'image/jpeg';
                            const bytes = new Uint8Array(await resp.arrayBuffer());
                            const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
                            const fileName = `pexels-${productId}-${Date.now()}.${ext}`;
                            const filePath = `products/${fileName}`;
                            const { error: upErr } = await supabase.storage
                                .from('product-images')
                                .upload(filePath, bytes, { contentType: ct, upsert: true } as any);
                            if (upErr) throw upErr;
                            const { data: pub } = supabase.storage.from('product-images').getPublicUrl(filePath);
                            return pub.publicUrl;
                        };

                        const pickQuery = (name: string, desc: string, manual?: string) => {
                            const q = String(manual || '').trim();
                            if (q) return q;
                            const base = `${name}${desc ? ` ${desc}` : ''}`.trim();
                            return `${base} food`;
                        };

                        if (fnName === "set_product_image_from_pexels") {
                            const pid = String(args.product_id || '').trim();
                            const pname = String(args.product_name || '').trim();
                            let product: any = null;
                            if (pid) {
                                const { data, error } = await supabase
                                    .from('products')
                                    .select('id, name, description, image_url')
                                    .eq('user_id', userId)
                                    .eq('id', pid)
                                    .maybeSingle();
                                if (error) throw error;
                                product = data;
                            } else if (pname) {
                                const { data, error } = await supabase
                                    .from('products')
                                    .select('id, name, description, image_url')
                                    .eq('user_id', userId)
                                    .ilike('name', `%${pname}%`)
                                    .limit(1);
                                if (error) throw error;
                                product = (data || [])[0] || null;
                            }
                            if (!product) {
                                result = { success: false, error: 'Produto não encontrado.' };
                            } else {
                                const q = pickQuery(String(product.name), String(product.description || ''), args.query);
                                const { src, photo } = await searchPexels(q);
                                const publicUrl = await uploadFromUrl(String(product.id), src);
                                const { error: updErr } = await supabase
                                    .from('products')
                                    .update({ image_url: publicUrl })
                                    .eq('user_id', userId)
                                    .eq('id', product.id);
                                if (updErr) throw updErr;
                                result = {
                                    success: true,
                                    product_id: product.id,
                                    image_url: publicUrl,
                                    source: { provider: 'pexels', id: photo?.id, url: photo?.url, photographer: photo?.photographer }
                                };
                            }
                        } else {
                            const requested = Number(args.limit || 100) || 100;
                            const maxPerExecution = 150;
                            const limit = Math.min(Math.max(requested, 1), maxPerExecution);
                            const processAll = args.process_all !== false;
                            const jobId = String(args.job_id || '').trim() || crypto.randomUUID();
                            const startedAt = Date.now();
                            const timeBudgetMs = 220_000;

                            const failures: any[] = [];
                            const updatedIds: string[] = [];
                            const attemptedIds = new Set<string>();
                            let processed = 0;
                            let updated = 0;

                            try {
                                const { data: existingJob } = await supabase
                                    .from('agent_activity_logs')
                                    .select('id')
                                    .eq('user_id', userId)
                                    .eq('id', jobId)
                                    .maybeSingle();
                                if (!existingJob) {
                                    await supabase.from('agent_activity_logs').insert({
                                        id: jobId,
                                        user_id: userId,
                                        action_type: 'pexels_image_job',
                                        description: 'Busca de imagens no Pexels para produtos sem imagem',
                                        metadata: { status: 'running', updated: 0, failures: 0, started_at: new Date().toISOString() }
                                    } as any);
                                }
                            } catch {}

                            while (processed < limit) {
                                const { data: products, error } = await supabase
                                    .from('products')
                                    .select('id, name, description, image_url')
                                    .eq('user_id', userId)
                                    .or('image_url.is.null,image_url.eq.')
                                    .order('created_at', { ascending: true })
                                    .limit(Math.min(200, limit + attemptedIds.size));
                                if (error) throw error;
                                const list = (products || []).filter((product: any) => !attemptedIds.has(String(product.id)));
                                if (list.length === 0) break;

                                for (const p of list) {
                                    if (processed >= limit) break;
                                    if (Date.now() - startedAt > timeBudgetMs) break;
                                    attemptedIds.add(String(p.id));
                                    processed++;
                                    try {
                                        const q = pickQuery(String(p.name), String(p.description || ''), '');
                                        const { src, photo } = await searchPexels(q);
                                        const publicUrl = await uploadFromUrl(String(p.id), src);
                                        const { error: updErr } = await supabase
                                            .from('products')
                                            .update({ image_url: publicUrl })
                                            .eq('user_id', userId)
                                            .eq('id', p.id);
                                        if (updErr) throw updErr;
                                        updated++;
                                        updatedIds.push(String(p.id));
                                    } catch (e: any) {
                                        failures.push({ id: p.id, name: p.name, error: String(e?.message || e) });
                                    }
                                }

                                if (!processAll) break;
                                if (Date.now() - startedAt > timeBudgetMs) break;
                            }

                            const { count: remainingCount } = await supabase
                                .from('products')
                                .select('id', { count: 'exact', head: true })
                                .eq('user_id', userId)
                                .or('image_url.is.null,image_url.eq.');

                            try {
                                await supabase
                                    .from('agent_activity_logs')
                                    .update({
                                        metadata: {
                                            status: typeof remainingCount === 'number' && remainingCount === 0 ? 'done' : 'running',
                                            updated,
                                            processed,
                                            failures: failures.length,
                                            remaining_without_image: typeof remainingCount === 'number' ? remainingCount : null,
                                            updated_ids: updatedIds,
                                            last_update_at: new Date().toISOString()
                                        }
                                    } as any)
                                    .eq('user_id', userId)
                                    .eq('id', jobId);
                            } catch {}

                            result = {
                                success: true,
                                job_id: jobId,
                                processed,
                                updated,
                                failures,
                                remaining_without_image: typeof remainingCount === 'number' ? remainingCount : null,
                                updated_ids: updatedIds,
                                exhausted_time_budget: Date.now() - startedAt > timeBudgetMs,
                                note: typeof remainingCount === 'number' && remainingCount > 0
                                    ? `Tentei processar o lote completo desta solicitação. Ainda restam ${remainingCount} produto(s) sem imagem, normalmente por falha da busca, timeout ou limite de segurança.`
                                    : 'Todas as imagens pendentes foram processadas.'
                            };
                        }
                    }
                }

                // --- ADD DELIVERY ZONE ---
                else if (fnName === "add_delivery_zone") {
                    const { data: zone, error } = await supabase
                        .from('delivery_zones')
                        .insert({
                            user_id: userId,
                            name: args.name,
                            delivery_fee: args.fee,
                            minimum_order: args.min_order || 0,
                            delivery_time: args.delivery_time || '30-45 min',
                            active: true
                        })
                        .select()
                        .single();
                    
                    if (error) throw error;
                    result = { success: true, zone: zone };
                }

                // --- ADD COURIER ---
                else if (fnName === "add_courier") {
                    const { data: courier, error } = await supabase
                        .from('couriers')
                        .insert({
                            user_id: userId,
                            name: args.name,
                            phone: args.phone,
                            vehicle_info: args.vehicle,
                            active: true
                        })
                        .select()
                        .single();
                    
                    if (error) throw error;
                    result = { success: true, courier: courier };
                }

                // --- LIST PRODUCTS ---
                else if (fnName === "list_products") {
                    const rawCategory = String(args.category || '').trim();
                    const rawSearch = String(args.search || '').trim();
                    const includeUnavailable = args.include_unavailable === true;
                    const limit = Math.min(250, Math.max(1, Number(args.limit || 100)));
                    const requestedCategory = rawCategory || rawSearch;
                    let matchedCategory: any = null;

                    if (requestedCategory) {
                        const { data: categories, error: categoryError } = await supabase
                            .from('product_categories')
                            .select('id, name')
                            .eq('user_id', userId)
                            .limit(300);
                        if (categoryError) throw categoryError;

                        const normalizedRequestedCategory = normalizeText(requestedCategory);
                        matchedCategory = (categories || []).find((category: any) =>
                            normalizeText(category?.name) === normalizedRequestedCategory
                        ) || null;

                        if (!matchedCategory && rawCategory) {
                            matchedCategory = (categories || []).find((category: any) =>
                                normalizeText(category?.name).includes(normalizedRequestedCategory) ||
                                normalizedRequestedCategory.includes(normalizeText(category?.name))
                            ) || null;
                        }
                    }

                    let query = supabase
                        .from('products')
                        .select('id, name, price, category, category_id, available, show_in_pdv, show_in_delivery')
                        .eq('user_id', userId)
                        .order('name', { ascending: true })
                        .limit(limit);

                    if (!includeUnavailable) {
                        query = query.eq('available', true);
                    }
                    
                    if (matchedCategory?.id) {
                        query = query.or(`category_id.eq.${matchedCategory.id},category.ilike.%${matchedCategory.name}%`);
                    } else if (rawCategory) {
                        query = query.ilike('category', `%${rawCategory}%`);
                    } else if (rawSearch) {
                        query = query.or(`name.ilike.%${rawSearch}%,category.ilike.%${rawSearch}%`);
                    }
                    
                    const { data: products, error } = await query;
                    if (error) throw error;
                    result = {
                        success: true,
                        mode: matchedCategory ? 'category' : rawCategory ? 'category_fuzzy' : rawSearch ? 'search' : 'all',
                        requested_category: rawCategory || null,
                        matched_category: matchedCategory?.name || null,
                        count: products?.length || 0,
                        products: products
                    };
                }

                else if (fnName === "create_expense") {
                    const today = new Date().toISOString().slice(0, 10);
                    const payload = {
                        user_id: userId,
                        description: String(args.description || '').trim(),
                        amount: Number(args.amount),
                        category: String(args.category || 'Outros'),
                        expense_date: String(args.expense_date || today),
                        receipt_url: args.receipt_url ? String(args.receipt_url) : null
                    };
                    if (!payload.description || !Number.isFinite(payload.amount) || payload.amount <= 0) {
                        result = { success: false, error: 'Descrição e valor (maior que zero) são obrigatórios.' };
                    } else {
                        const { data: expense, error } = await supabase
                            .from('expenses')
                            .insert(payload)
                            .select('id, description, amount, category, expense_date, receipt_url')
                            .single();
                        if (error) throw error;
                        result = { success: true, expense };
                    }
                }

                else if (fnName === "list_expenses") {
                    const limit = Math.min(Math.max(Number(args.limit || 20) || 20, 1), 100);
                    let query = supabase
                        .from('expenses')
                        .select('id, description, amount, category, expense_date, receipt_url')
                        .eq('user_id', userId)
                        .eq('is_active', true)
                        .order('expense_date', { ascending: false })
                        .limit(limit);

                    if (args.search) {
                        const term = String(args.search);
                        query = query.or(`description.ilike.%${term}%,category.ilike.%${term}%`);
                    }
                    const { data: expenses, error } = await query;
                    if (error) throw error;
                    result = { success: true, expenses };
                }

                else if (fnName === "get_team_summary") {
                    const competence = /^\d{4}-\d{2}$/.test(String(args.competence || ''))
                        ? String(args.competence)
                        : new Date().toISOString().slice(0, 7);
                    const startDate = `${competence}-01`;
                    const endDate = new Date(Number(competence.slice(0, 4)), Number(competence.slice(5, 7)), 0).toISOString().slice(0, 10);
                    let employeeQuery = supabase.from('employees').select('id,full_name,display_name,cpf,job_title,department,employment_status').eq('restaurant_id', userId);
                    if (args.employee_name) employeeQuery = employeeQuery.ilike('full_name', `%${String(args.employee_name).trim()}%`);
                    const [{ data: employees, error: employeeError }, { data: closings, error: closingError }, { data: commissions, error: commissionError }, { data: advances, error: advanceError }, { data: todayEvents, error: eventError }] = await Promise.all([
                        employeeQuery.order('full_name').limit(100),
                        supabase.from('employee_payroll_closings').select('id,status,total_earnings,total_deductions,total_net,competence_date').eq('restaurant_id', userId).gte('competence_date', startDate).lte('competence_date', endDate).order('created_at', { ascending: false }).limit(1),
                        supabase.from('employee_commissions').select('employee_id,amount,status,description').eq('restaurant_id', userId).gte('competence_date', startDate).lte('competence_date', endDate).neq('status', 'cancelled'),
                        supabase.from('employee_advances').select('employee_id,amount,status,advance_date').eq('restaurant_id', userId).gte('advance_date', startDate).lte('advance_date', endDate).neq('status', 'reversed'),
                        supabase.from('employee_time_clock_events').select('employee_id,event_type,occurred_at,status').eq('user_id', userId).gte('occurred_at', `${new Date().toISOString().slice(0,10)}T00:00:00`).neq('status', 'rejected').order('occurred_at'),
                    ]);
                    if (employeeError || closingError || commissionError || advanceError || eventError) throw employeeError || closingError || commissionError || advanceError || eventError;
                    const closing = closings?.[0] || null;
                    const { data: payrollItems, error: itemsError } = closing
                        ? await supabase.from('employee_payroll_items').select('employee_id,base_salary,worked_minutes,overtime_minutes,late_minutes,absence_days,commissions,bonuses,advances,total_earnings,total_deductions,net_amount,status').eq('closing_id', closing.id)
                        : { data: [], error: null };
                    if (itemsError) throw itemsError;
                    const lastEventByEmployee = new Map<string, any>();
                    for (const event of todayEvents || []) if (event.employee_id) lastEventByEmployee.set(event.employee_id, event);
                    result = {
                        success: true,
                        competence,
                        source_notice: closing ? 'Valores provenientes do fechamento salvo.' : 'Não existe fechamento salvo; não invente valores de pagamento.',
                        closing,
                        employees: (employees || []).map((employee: any) => ({
                            ...employee,
                            working_now: ['clock_in','break_end'].includes(lastEventByEmployee.get(employee.id)?.event_type),
                            point_incomplete: Boolean(lastEventByEmployee.get(employee.id)) && lastEventByEmployee.get(employee.id)?.event_type !== 'clock_out',
                            payroll: (payrollItems || []).find((item: any) => item.employee_id === employee.id) || null,
                            commissions: (commissions || []).filter((item: any) => item.employee_id === employee.id).reduce((sum: number,item: any) => sum + Number(item.amount || 0), 0),
                            advances: (advances || []).filter((item: any) => item.employee_id === employee.id).reduce((sum: number,item: any) => sum + Number(item.amount || 0), 0),
                        })),
                    };
                }

                else if (fnName === "delete_expense") {
                    result = {
                        success: false,
                        error: 'Despesas não podem ser apagadas. Use o estorno para preservar o histórico financeiro.'
                    };
                }

                else if (fnName === "reverse_expense") {
                    const id = String(args.id || '').trim();
                    const reason = String(args.reason || '').trim();
                    const adminPin = String(args.admin_pin || '').trim();
                    if (!id || !reason || !adminPin) {
                        result = { success: false, error: 'ID, motivo e senha/PIN do administrador são obrigatórios.' };
                    } else {
                        const { data: authorizedWaiters, error: waiterError } = await supabase
                            .from('waiters')
                            .select('id, name, role, permissions')
                            .eq('user_id', userId)
                            .eq('active', true)
                            .eq('pin', adminPin)
                            .limit(10);
                        if (waiterError) throw waiterError;
                        const administrator = (authorizedWaiters || []).find((waiter: any) =>
                            String(waiter?.role || '').toLowerCase() === 'admin' ||
                            waiter?.permissions?.admin === true
                        );
                        if (!administrator?.id) {
                            result = { success: false, error: 'Senha/PIN inválido ou operador sem permissão de administrador.' };
                        } else {
                            const { error } = await supabase
                                .from('expenses')
                                .update({
                                    is_active: false,
                                    reversed_at: new Date().toISOString(),
                                    reversal_reason: reason,
                                    reversed_by: userId,
                                    reversed_by_waiter_id: administrator.id,
                                    reversed_by_name: administrator.name
                                })
                                .eq('user_id', userId)
                                .eq('is_active', true)
                                .eq('id', id);
                            if (error) throw error;
                            result = { success: true, reversed_id: id };
                        }
                    }
                }

            } catch (err: any) {
                console.error(`Error executing ${fnName}:`, err);
                result = { success: false, error: err.message };
            }

            toolResults.push({
                tool_call_id: toolCallId,
                role: "tool",
                name: fnName,
                content: JSON.stringify(result)
            });

            if (aiProvider === 'openai') {
              openAiMessages = [
                ...openAiMessages,
                {
                  role: 'tool',
                  tool_call_id: toolCallId,
                  content: JSON.stringify(result)
                }
              ];
            } else {
              currentContents = [
                ...currentContents,
                { role: 'user', parts: [{ functionResponse: { name: fnName, response: result } }] }
              ];
            }
        }
        allToolResults.push(...toolResults);
    }

    return new Response(
        JSON.stringify({
            success: true,
            message: finalMessageText || '',
            tool_results: allToolResults
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error('[AI Agent] Erro:', error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || 'Erro no agente.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
})
