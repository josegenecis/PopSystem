import { persistRestaurantInboundMessage, processRestaurantBotMessage } from '../whatsapp-bot.ts';
import {
  getConversationHistory,
  getOrCreatePopAiCustomer,
  getOrCreatePopAiSettings,
  logPopAiAction,
  savePopAiMessage,
  syncLegacyConversationAiState,
  updatePopAiConversationStatus,
  upsertPopAiConversation
} from './aiConversationService.ts';
import { buildPopAiSystemPrompt, classifyAiStatusFromResult } from './aiToolService.ts';
import { getRestaurantKnowledge } from './restaurantKnowledgeService.ts';
import { sendEvolutionTyping } from './evolutionService.ts';
import type { PopAiEngineResult, PopAiIncomingMessage } from './types.ts';

function normalizeIntentText(text: string) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function minutesSince(dateString?: string | null) {
  if (!dateString) return Number.POSITIVE_INFINITY;
  const time = new Date(dateString).getTime();
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / 60000;
}

function manualPauseMinutes() {
  const raw = Number(Deno.env.get('WHATSAPP_MANUAL_PAUSE_MINUTES') || '60');
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

function shouldAutoResumeManualPause() {
  return String(Deno.env.get('WHATSAPP_AUTO_RESUME_MANUAL_PAUSE') || 'true').trim().toLowerCase() !== 'false';
}

function isActionableCustomerIntent(text: string) {
  const value = normalizeIntentText(text);
  return /^(oi+|ola+|opa+|bom dia|boa tarde|boa noite)\b/.test(value) ||
    /(link|cardapio|catalogo|menu|me envia|me manda|manda o link|envia o link|me passa o link)/i.test(value) ||
    /(acompanhar|rastrear|status do pedido|meu pedido|onde.*pedido|pedido.*andamento|pedido.*status)/i.test(value) ||
    /(promo|promocao|desconto|oferta|combo)/i.test(value) ||
    /(quero|queria|gostaria|vou querer|fazer pedido|pedir|pedido|finalizar pedido)/i.test(value);
}

function isExplicitCustomerReactivationIntent(text: string) {
  const value = normalizeIntentText(text);
  return /(voltar|retomar|reativar|chamar).*(bot|robo|robô|ia|atendimento automatico)|atendimento automatico.*(voltar|retomar|reativar)/i.test(value);
}

function getHandoffTimeoutMinutes(settings: any) {
  const configured = Number(settings?.human_handoff_timeout_minutes || settings?.metadata?.human_handoff_timeout_minutes);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return manualPauseMinutes();
}

function getConversationResumeAt(conversation: any, timeoutMinutes: number) {
  const metadata = conversation?.metadata || {};
  const explicitResumeAt =
    conversation?.ai_resume_at ||
    metadata.aiResumeAt ||
    metadata.pauseExpiresAt ||
    metadata.resumeAt;
  if (explicitResumeAt && !Number.isNaN(new Date(explicitResumeAt).getTime())) {
    return String(explicitResumeAt);
  }

  const lastHumanAt =
    conversation?.last_human_message_at ||
    metadata.lastHumanMessageAt ||
    metadata.pausedAt;
  if (!lastHumanAt) return null;
  const baseTime = new Date(lastHumanAt).getTime();
  if (Number.isNaN(baseTime)) return null;
  return new Date(baseTime + timeoutMinutes * 60000).toISOString();
}

async function markPopAiResumed(supabase: any, conversation: any, metadata: Record<string, unknown>) {
  const payload = {
    status: 'ai_active',
    owner: 'AI',
    current_state: 'IDLE',
    ai_resume_at: null,
    metadata,
    last_message_at: new Date().toISOString()
  };

  const result = await supabase
    .from('ai_conversations')
    .update(payload)
    .eq('id', conversation.id);

  if (result.error && /owner|current_state|ai_resume_at|schema cache|column/i.test(String(result.error.message || ''))) {
    await updatePopAiConversationStatus(supabase, conversation.id, 'ai_active', metadata);
  }
}

export async function processPopAiMessage(params: PopAiIncomingMessage): Promise<PopAiEngineResult> {
  const startedAt = Date.now();
  const supabase = params.supabase;
  const restaurantId = String(params.restaurantId || '').trim();
  const phone = String(params.customerPhone || '').replace(/\D/g, '');
  const text = String(params.text || '').trim();

  if (!restaurantId || !phone || !text) {
    return { ok: false, skipped: true, reason: 'missing_input' };
  }

  // Some provider webhooks use the atomic inbox fast path and hand us the
  // already-persisted row. In that case, do not claim the provider event a
  // second time or it would be incorrectly classified as a duplicate.
  let inboundClaimed = Boolean(params.persistedInbound?.conversationId);
  if (!inboundClaimed) try {
    const { data: claimed, error: claimError } = await supabase.rpc('claim_whatsapp_inbound_message', {
      p_restaurant_id: restaurantId,
      p_customer_phone: phone,
      p_content: text,
      p_provider_message_id: params.providerMessageId || null,
      p_instance_name: params.instanceName || null,
      p_window_seconds: 30
    });

    if (claimError) {
      // Fail open during rolling deploys so a delayed database migration does
      // not interrupt customer service. The legacy deduplication remains active.
      console.warn('[PopAI] inbound claim unavailable:', claimError.message || claimError);
    } else if (claimed !== true) {
      return { ok: true, skipped: true, reason: 'duplicate_inbound_message' };
    } else {
      inboundClaimed = true;
    }
  } catch (claimError) {
    console.warn('[PopAI] inbound claim failed:', claimError);
  }

  let processingParams = params;
  if (inboundClaimed && !params.persistedInbound) {
    try {
      const persistedInbound = await persistRestaurantInboundMessage({
        supabase,
        restaurantId,
      customerPhone: phone,
      text,
      media: params.media,
      providerMessageId: params.providerMessageId,
      messageType: params.messageType,
      quotedProviderMessageId: params.quotedProviderMessageId,
      });
      if (persistedInbound) processingParams = { ...params, persistedInbound };
    } catch (persistError) {
      // Keep the legacy path as a rolling-deploy fallback. It will persist the
      // message inside processRestaurantBotMessage instead.
      console.warn('[PopAI] fast inbox persistence failed:', persistError);
    }
  }

  let aiConversation: any = null;
  try {
    const [settings, customer] = await Promise.all([
      getOrCreatePopAiSettings(supabase, restaurantId),
      getOrCreatePopAiCustomer(supabase, restaurantId, phone)
    ]);

    aiConversation = await upsertPopAiConversation(supabase, restaurantId, customer?.id || null, phone, settings.enabled);

    const [knowledge, history] = await Promise.all([
      getRestaurantKnowledge(supabase, restaurantId),
      getConversationHistory(supabase, aiConversation.id, Number(settings.max_history_messages || 30))
    ]);

    const owner = String(aiConversation?.owner || '').toUpperCase();
    if (owner === 'HUMAN' || aiConversation.status === 'human_active' || aiConversation.status === 'human_required') {
      const timeoutMinutes = getHandoffTimeoutMinutes(settings);
      const resumeAt = getConversationResumeAt(aiConversation, timeoutMinutes);
      const resumeAtMs = resumeAt ? new Date(resumeAt).getTime() : Number.NaN;
      const autoResumeEnabled = settings?.auto_resume_human_handoff !== false && shouldAutoResumeManualPause() !== false;
      const actionableCustomerIntent = isActionableCustomerIntent(text);
      const explicitReactivationIntent = isExplicitCustomerReactivationIntent(text);
      const shouldResume =
        autoResumeEnabled &&
        (
          explicitReactivationIntent ||
          (actionableCustomerIntent && Number.isFinite(resumeAtMs) && resumeAtMs <= Date.now()) ||
          (actionableCustomerIntent && !resumeAt && minutesSince(aiConversation?.metadata?.pausedAt || aiConversation?.last_message_at) >= timeoutMinutes)
        );

      if (shouldResume) {
        await markPopAiResumed(supabase, aiConversation, {
          ...(aiConversation?.metadata || {}),
          reason: explicitReactivationIntent ? 'auto_resume_by_explicit_customer_request' : 'auto_resume_after_human_pause',
          previousStatus: aiConversation.status,
          previousOwner: owner || null,
          manualPauseMinutes: timeoutMinutes,
          resumedAt: new Date().toISOString()
        });
        aiConversation = { ...aiConversation, status: 'ai_active', owner: 'AI' };
      } else {
        await savePopAiMessage(supabase, aiConversation, 'user', text, {
          skipped: true,
          reason: 'human_conversation_active',
          resumeAt,
          timeoutMinutes,
          actionableCustomerIntent,
          explicitReactivationIntent
        });
        await logPopAiAction(supabase, restaurantId, aiConversation.id, 'incoming_ignored_human_active', {
          instanceName: params.instanceName,
          phone,
          textPreview: text.slice(0, 180),
          status: aiConversation.status,
          owner,
          resumeAt,
          timeoutMinutes,
          actionableCustomerIntent,
          explicitReactivationIntent
        });
        return { ok: true, skipped: true, reason: 'bot_paused', aiConversationId: aiConversation.id, status: 'human_active' };
      }
    }

    const systemPrompt = buildPopAiSystemPrompt(settings, knowledge);
    await savePopAiMessage(supabase, aiConversation, 'system', systemPrompt, {
      kind: 'current_restaurant_knowledge',
      productCount: knowledge.productCount,
      historyMessages: history.length
    });
    await savePopAiMessage(supabase, aiConversation, 'user', text, {
      media: params.media ? {
        type: params.media.type,
        mimeType: params.media.mimeType || null,
        hasInlineBytes: Boolean(params.media.hasInlineBytes),
        hasUrl: Boolean(params.media.url)
      } : null
    });

    await logPopAiAction(supabase, restaurantId, aiConversation.id, 'incoming_whatsapp_message', {
      instanceName: params.instanceName,
      phone,
      textPreview: text.slice(0, 180),
      mediaType: params.media?.type || null
    }, {
      aiEnabled: settings.enabled,
      whatsappAiEnabled: knowledge.whatsappAiEnabled
    });

    if (settings.enabled === false || knowledge.whatsappAiEnabled === false || knowledge.whatsappEnabled === false) {
      await updatePopAiConversationStatus(supabase, aiConversation.id, 'human_active', {
        reason: 'ai_disabled',
        updatedAt: new Date().toISOString()
      });
      return { ok: true, skipped: true, reason: 'ai_disabled', aiConversationId: aiConversation.id, status: 'human_active' };
    }

    await sendEvolutionTyping(params.instanceName, phone, 1200).catch(() => null);

    const result = await processRestaurantBotMessage(processingParams);
    const status = classifyAiStatusFromResult(result as PopAiEngineResult);

    if (result?.replyText) {
      await savePopAiMessage(supabase, aiConversation, 'assistant', result.replyText, {
        legacyConversationId: result.conversationId || null,
        status,
        source: 'pop_ai_mvp'
      });
    }

    await updatePopAiConversationStatus(supabase, aiConversation.id, status, {
      lastReason: result?.reason || null,
      legacyConversationId: result?.conversationId || null,
      processingMs: Date.now() - startedAt,
      updatedAt: new Date().toISOString()
    });
    await syncLegacyConversationAiState(supabase, result?.conversationId, aiConversation.id, status);

    await logPopAiAction(supabase, restaurantId, aiConversation.id, result?.ok ? 'ai_response_created' : 'ai_response_failed', {
      textPreview: text.slice(0, 180),
      historyMessages: history.length
    }, {
      ok: result?.ok,
      skipped: result?.skipped || false,
      reason: result?.reason || null,
      status,
      replyPreview: String(result?.replyText || '').slice(0, 220),
      processingMs: Date.now() - startedAt
    }, result?.ok ? null : result?.error);

    return { ...(result as PopAiEngineResult), status, aiConversationId: aiConversation.id };
  } catch (error) {
    const errorText = String((error as any)?.message || error || '');
    if (
      errorText.includes('ai_settings') ||
      errorText.includes('ai_conversations') ||
      errorText.includes('ai_messages') ||
      errorText.includes('ai_logs') ||
      errorText.includes('schema cache')
    ) {
      const fallback = await processRestaurantBotMessage(processingParams);
      return {
        ...(fallback as PopAiEngineResult),
        status: 'ai_active',
        reason: fallback?.reason || 'pop_ai_schema_fallback'
      };
    }

    await logPopAiAction(supabase, restaurantId, aiConversation?.id || null, 'pop_ai_exception', {
      phone,
      textPreview: text.slice(0, 180)
    }, null, error).catch(() => null);
    return { ok: false, error: String((error as any)?.message || error || 'pop_ai_failed'), aiConversationId: aiConversation?.id };
  }
}
