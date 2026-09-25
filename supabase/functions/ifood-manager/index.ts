// deno-lint-ignore-file no-explicit-any
import {
  buildIfoodWebhookUrl,
  createServiceClient,
  fetchIfoodPollingEvents,
  getAuthUserId,
  getIfoodCancellationReasons,
  getIfoodMerchantDetails,
  getIfoodMerchantOpeningHours,
  getIfoodMerchantStatus,
  getUserIfoodSettings,
  ifoodCorsHeaders,
  listIfoodMerchants,
  listIfoodMerchantInterruptions,
  createIfoodMerchantInterruption,
  deleteIfoodMerchantInterruption,
  okJson,
  persistIfoodEvent,
  processIfoodEvent,
  requestIfoodAccessToken,
  respondIfoodDispute,
  sanitizeIfoodSettings,
  upsertIfoodSettings,
  updateIfoodMerchantOpeningHours,
  acknowledgeIfoodEvents,
} from '../_shared/ifood.ts'
import { resolveStoreUserId } from '../_shared/multi-store.ts'

const parseMerchantSummary = (merchant: any) => ({
  id: String(merchant?.id || ''),
  name: String(merchant?.name || merchant?.corporateName || ''),
  corporateName: String(merchant?.corporateName || ''),
})

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: ifoodCorsHeaders })
  }

  try {
    const authenticatedUserId = await getAuthUserId(req)
    if (!authenticatedUserId) {
      return okJson({ ok: false, error: 'unauthorized' }, 401)
    }

    const supabase = createServiceClient()
    const body = await req.json().catch(() => ({}))
    const userId = await resolveStoreUserId(supabase, authenticatedUserId, body?._storeId)
    const action = String(body?.action || 'overview')
    const settings = await getUserIfoodSettings(supabase, userId)
    const currentSettings = sanitizeIfoodSettings(settings) || null

    if (action === 'overview') {
      let merchants: any[] = []
      let merchantStatus: any = null

      if (settings?.client_id && settings?.client_secret) {
        try {
          const merchantsResponse = await listIfoodMerchants(supabase, settings)
          merchants = Array.isArray(merchantsResponse?.data)
            ? merchantsResponse.data.map(parseMerchantSummary)
            : []

          if (settings?.merchant_id) {
            const statusResponse = await getIfoodMerchantStatus(supabase, settings, settings.merchant_id)
            merchantStatus = statusResponse?.data || null
          }
        } catch (error: any) {
          await upsertIfoodSettings(supabase, userId, {
            last_sync_at: new Date().toISOString(),
            last_sync_status: 'error',
            last_sync_message: String(error?.message || error),
          })
        }
      }

      return okJson({
        ok: true,
        settings: sanitizeIfoodSettings({
          ...(settings || {}),
          webhook_url: buildIfoodWebhookUrl(),
        }),
        merchants,
        merchantStatus,
      })
    }

    if (action === 'save_credentials') {
      const clientId = String(body?.clientId || settings?.client_id || '').trim()
      const clientSecret = String(body?.clientSecret || settings?.client_secret || '').trim()
      const merchantId = String(body?.merchantId || settings?.merchant_id || '').trim()
      const merchantEnabled = Boolean(body?.merchantEnabled ?? currentSettings?.merchant_enabled ?? false)

      if (!clientId || !clientSecret) {
        return okJson({ ok: false, error: 'missing_credentials' }, 400)
      }

      const tokenResponse = await requestIfoodAccessToken(clientId, clientSecret)
      const merchantsResponse = await listIfoodMerchants(supabase, {
        ...(settings || {}),
        user_id: userId,
        client_id: clientId,
        client_secret: clientSecret,
        access_token: tokenResponse?.accessToken || '',
        access_token_expires_at: new Date(
          Date.now() + Math.max(60, Number(tokenResponse?.expiresIn || 21600)) * 1000,
        ).toISOString(),
      })

      const merchants = Array.isArray(merchantsResponse?.data)
        ? merchantsResponse.data.map(parseMerchantSummary)
        : []

      const selectedMerchantId = merchantId || merchants[0]?.id || ''
      let merchantDetails: any = null
      let merchantStatus: any = null

      if (selectedMerchantId) {
        const detailsResponse = await getIfoodMerchantDetails(supabase, {
          ...(settings || {}),
          user_id: userId,
          client_id: clientId,
          client_secret: clientSecret,
          access_token: tokenResponse?.accessToken || '',
          access_token_expires_at: new Date(
            Date.now() + Math.max(60, Number(tokenResponse?.expiresIn || 21600)) * 1000,
          ).toISOString(),
        }, selectedMerchantId)
        merchantDetails = detailsResponse?.data || null

        const statusResponse = await getIfoodMerchantStatus(supabase, {
          ...(settings || {}),
          user_id: userId,
          client_id: clientId,
          client_secret: clientSecret,
          access_token: tokenResponse?.accessToken || '',
          access_token_expires_at: new Date(
            Date.now() + Math.max(60, Number(tokenResponse?.expiresIn || 21600)) * 1000,
          ).toISOString(),
        }, selectedMerchantId)
        merchantStatus = statusResponse?.data || null
      }

      const saved = await upsertIfoodSettings(supabase, userId, {
        client_id: clientId,
        client_secret: clientSecret,
        client_secret_updated_at: new Date().toISOString(),
        merchant_id: selectedMerchantId || null,
        merchant_name: String(merchantDetails?.name || merchantDetails?.corporateName || ''),
        merchant_timezone: String(merchantDetails?.timezone || ''),
        merchant_state: String(merchantStatus?.state || ''),
        merchant_enabled: merchantEnabled,
        status: merchantEnabled ? 'online' : 'offline',
        access_token: tokenResponse?.accessToken || '',
        token_type: tokenResponse?.tokenType || 'Bearer',
        access_token_expires_at: new Date(
          Date.now() + Math.max(60, Number(tokenResponse?.expiresIn || 21600)) * 1000,
        ).toISOString(),
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'connected',
        last_sync_message: 'Credenciais validadas com sucesso',
        webhook_url: buildIfoodWebhookUrl(),
      })

      return okJson({
        ok: true,
        settings: sanitizeIfoodSettings(saved),
        merchants,
        merchantStatus,
      })
    }

    if (!settings) {
      return okJson({ ok: false, error: 'ifood_not_configured' }, 400)
    }

    if (action === 'select_merchant') {
      const merchantId = String(body?.merchantId || '').trim()
      if (!merchantId) {
        return okJson({ ok: false, error: 'missing_merchant_id' }, 400)
      }

      const detailsResponse = await getIfoodMerchantDetails(supabase, settings, merchantId)
      const statusResponse = await getIfoodMerchantStatus(supabase, settings, merchantId)
      const saved = await upsertIfoodSettings(supabase, userId, {
        merchant_id: merchantId,
        merchant_name: String(detailsResponse?.data?.name || detailsResponse?.data?.corporateName || ''),
        merchant_timezone: String(detailsResponse?.data?.timezone || ''),
        merchant_state: String(statusResponse?.data?.state || ''),
        status: currentSettings?.merchant_enabled ? 'online' : 'offline',
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'merchant_selected',
        last_sync_message: 'Merchant selecionado com sucesso',
      })

      return okJson({
        ok: true,
        settings: sanitizeIfoodSettings(saved),
        merchantStatus: statusResponse?.data || null,
      })
    }

    if (action === 'toggle_enabled') {
      const enabled = Boolean(body?.enabled)
      if (enabled && (!settings?.client_id || !settings?.client_secret || !settings?.merchant_id)) {
        return okJson({ ok: false, error: 'ifood_not_ready' }, 400)
      }
      const saved = await upsertIfoodSettings(supabase, userId, {
        merchant_enabled: enabled,
        status: enabled ? 'online' : 'offline',
        last_sync_at: new Date().toISOString(),
        last_sync_status: enabled ? 'enabled' : 'disabled',
        last_sync_message: enabled
          ? 'Integração iFood ativada'
          : 'Integração iFood desativada',
      })

      return okJson({ ok: true, settings: sanitizeIfoodSettings(saved) })
    }

    if (action === 'sync_events') {
      const pollingResponse = await fetchIfoodPollingEvents(supabase, settings)
      const events = (Array.isArray(pollingResponse?.data) ? pollingResponse.data : [])
        .slice()
        .sort((left: any, right: any) => {
          const leftTime = new Date(left?.createdAt || 0).getTime()
          const rightTime = new Date(right?.createdAt || 0).getTime()
          return leftTime - rightTime
        })

      let inserted = 0
      let duplicates = 0
      let processed = 0

      if (events.length > 0) {
        for (const event of events) {
          const { eventRow, duplicate } = await persistIfoodEvent(supabase, userId, event, {
            source: 'polling',
            httpStatus: pollingResponse?.status,
          })
          if (duplicate) duplicates += 1
          else inserted += 1

          try {
            // O upsert do pedido é idempotente, então eventos reenviados também
            // podem recuperar um processamento que falhou anteriormente.
            await processIfoodEvent(supabase, settings, eventRow)
            processed += 1
          } catch {
            // evento fica persistido com erro para reprocessamento manual
          }
        }

        await acknowledgeIfoodEvents(supabase, settings, events)
      }

      const saved = await upsertIfoodSettings(supabase, userId, {
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'ok',
        last_sync_message: events.length
          ? `${processed} evento(s) processado(s), ${duplicates} duplicado(s)`
          : 'Nenhum evento novo encontrado',
        status: currentSettings?.merchant_enabled ? 'online' : 'offline',
      })

      return okJson({
        ok: true,
        summary: {
          fetched: events.length,
          inserted,
          duplicates,
          processed,
        },
        settings: sanitizeIfoodSettings(saved),
      })
    }

    if (action === 'cancellation_reasons') {
      const orderId = String(body?.orderId || '').trim()
      if (!orderId) {
        return okJson({ ok: false, error: 'missing_order_id' }, 400)
      }

      const response = await getIfoodCancellationReasons(supabase, settings, orderId)
      const rawReasons = Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.data?.reasons)
          ? response.data.reasons
          : []
      return okJson({
        ok: true,
        reasons: rawReasons.map((reason: any) => ({
          ...reason,
          cancelCodeId: String(reason?.cancelCodeId || reason?.code || reason?.id || ''),
          code: String(reason?.code || reason?.cancelCodeId || reason?.id || ''),
          description: String(reason?.description || reason?.name || ''),
        })).filter((reason: any) => reason.cancelCodeId),
      })
    }

    if (action === 'respond_dispute') {
      const disputeId = String(body?.disputeId || '').trim()
      const disputeResponse = String(body?.response || '').trim() as 'accept' | 'reject' | 'alternative'
      if (!disputeId || !['accept', 'reject', 'alternative'].includes(disputeResponse)) {
        return okJson({ ok: false, error: 'invalid_dispute_response' }, 400)
      }

      const responseBody = body?.responseBody && typeof body.responseBody === 'object'
        ? body.responseBody
        : undefined
      const response = await respondIfoodDispute(
        supabase,
        settings,
        disputeId,
        disputeResponse,
        responseBody,
      )

      return okJson({
        ok: true,
        status: response?.status || 202,
        settlement: response?.data || null,
      })
    }

    if (action === 'merchant_status') {
      if (!settings?.merchant_id) {
        return okJson({ ok: false, error: 'missing_merchant_id' }, 400)
      }
      const response = await getIfoodMerchantStatus(supabase, settings, settings.merchant_id)
      return okJson({ ok: true, merchantStatus: response?.data || null })
    }

    if (action === 'merchant_details') {
      const merchantId = String(body?.merchantId || settings?.merchant_id || '').trim()
      if (!merchantId) return okJson({ ok: false, error: 'missing_merchant_id' }, 400)

      const [detailsResponse, statusResponse] = await Promise.all([
        getIfoodMerchantDetails(supabase, settings, merchantId),
        getIfoodMerchantStatus(supabase, settings, merchantId),
      ])
      return okJson({
        ok: true,
        merchant: detailsResponse?.data || null,
        merchantStatus: statusResponse?.data || null,
      })
    }

    if (action === 'list_interruptions') {
      const merchantId = String(body?.merchantId || settings?.merchant_id || '').trim()
      if (!merchantId) return okJson({ ok: false, error: 'missing_merchant_id' }, 400)
      const response = await listIfoodMerchantInterruptions(supabase, settings, merchantId)
      return okJson({ ok: true, interruptions: Array.isArray(response?.data) ? response.data : [] })
    }

    if (action === 'create_interruption') {
      const merchantId = String(body?.merchantId || settings?.merchant_id || '').trim()
      const description = String(body?.description || '').trim()
      const start = String(body?.start || '').trim()
      const end = String(body?.end || '').trim()
      if (!merchantId) return okJson({ ok: false, error: 'missing_merchant_id' }, 400)
      if (!description || description.length > 255 || !start || !end) {
        return okJson({ ok: false, error: 'invalid_interruption' }, 400)
      }
      const startAt = new Date(start)
      const endAt = new Date(end)
      const durationMs = endAt.getTime() - startAt.getTime()
      if (!Number.isFinite(durationMs) || durationMs < 60_000 || durationMs > 7 * 24 * 60 * 60 * 1000) {
        return okJson({ ok: false, error: 'invalid_interruption_period' }, 400)
      }
      const response = await createIfoodMerchantInterruption(supabase, settings, merchantId, {
        description,
        start: startAt.toISOString(),
        end: endAt.toISOString(),
      })
      return okJson({ ok: true, interruption: response?.data || null }, 201)
    }

    if (action === 'delete_interruption') {
      const merchantId = String(body?.merchantId || settings?.merchant_id || '').trim()
      const interruptionId = String(body?.interruptionId || '').trim()
      if (!merchantId || !interruptionId) {
        return okJson({ ok: false, error: 'missing_interruption' }, 400)
      }
      await deleteIfoodMerchantInterruption(supabase, settings, merchantId, interruptionId)
      return okJson({ ok: true })
    }

    if (action === 'get_opening_hours') {
      const merchantId = String(body?.merchantId || settings?.merchant_id || '').trim()
      if (!merchantId) return okJson({ ok: false, error: 'missing_merchant_id' }, 400)
      const response = await getIfoodMerchantOpeningHours(supabase, settings, merchantId)
      return okJson({ ok: true, openingHours: response?.data || [] })
    }

    if (action === 'update_opening_hours') {
      const merchantId = String(body?.merchantId || settings?.merchant_id || '').trim()
      const rawShifts = Array.isArray(body?.shifts) ? body.shifts : []
      if (!merchantId) return okJson({ ok: false, error: 'missing_merchant_id' }, 400)

      const allowedDays = new Set(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])
      const shifts = rawShifts.map((shift: any) => ({
        dayOfWeek: String(shift?.dayOfWeek || '').toUpperCase(),
        start: String(shift?.start || ''),
        duration: Number(shift?.duration || 0),
      }))
      const invalidShift = shifts.some((shift: any) =>
        !allowedDays.has(shift.dayOfWeek)
        || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(shift.start)
        || !Number.isInteger(shift.duration)
        || shift.duration < 1
        || shift.duration > 24 * 60,
      )
      if (invalidShift) return okJson({ ok: false, error: 'invalid_opening_hours' }, 400)

      const response = await updateIfoodMerchantOpeningHours(supabase, settings, merchantId, shifts)
      return okJson({ ok: true, openingHours: response?.data || [] })
    }

    return okJson({ ok: false, error: 'unsupported_action' }, 400)
  } catch (error: any) {
    return okJson(
      {
        ok: false,
        error: 'ifood_manager_error',
        message: String(error?.message || error),
      },
      500,
    )
  }
})
