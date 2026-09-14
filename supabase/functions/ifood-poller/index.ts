// deno-lint-ignore-file no-explicit-any
import {
  acknowledgeIfoodEvents,
  createServiceClient,
  fetchIfoodPollingEvents,
  ifoodCorsHeaders,
  okJson,
  persistIfoodEvent,
  processIfoodEvent,
  sanitizeIfoodSettings,
  upsertIfoodSettings,
} from '../_shared/ifood.ts'

const POLLING_INTERVAL_MS = 30_000
const IDLE_HEARTBEAT_INTERVAL_MS = 5 * 60_000

const eventTime = (event: any) => {
  const parsed = new Date(event?.createdAt || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: ifoodCorsHeaders })
  if (req.method !== 'POST') return okJson({ ok: false, error: 'method_not_allowed' }, 405)

  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - POLLING_INTERVAL_MS).toISOString()

  try {
    const { data: candidates, error } = await supabase
      .from('ifood_settings')
      .select('*')
      .eq('status', 'online')
      .or(`last_poll.is.null,last_poll.lt.${cutoff}`)
      .order('last_poll', { ascending: true, nullsFirst: true })
      .limit(100)

    if (error) throw error

    const summary = {
      candidates: Array.isArray(candidates) ? candidates.length : 0,
      polled: 0,
      fetched: 0,
      processed: 0,
      duplicates: 0,
      errors: 0,
    }

    for (const settings of candidates || []) {
      const sanitized = sanitizeIfoodSettings(settings)
      if (!sanitized?.merchant_enabled || !settings?.merchant_id) continue

      // Marca o início antes da chamada externa para reduzir polling concorrente.
      const claimedAt = new Date().toISOString()
      let claimQuery = supabase
        .from('ifood_settings')
        .update({ last_poll: claimedAt })
        .eq('id', settings.id)
      claimQuery = settings.last_poll
        ? claimQuery.eq('last_poll', settings.last_poll)
        : claimQuery.is('last_poll', null)

      const { data: claimed, error: claimError } = await claimQuery.select('id')
        .maybeSingle()

      if (claimError) {
        summary.errors += 1
        continue
      }
      if (!claimed) continue
      summary.polled += 1

      try {
        const pollingResponse = await fetchIfoodPollingEvents(supabase, settings)
        const events = (Array.isArray(pollingResponse?.data) ? pollingResponse.data : [])
          .slice()
          .sort((left: any, right: any) => eventTime(left) - eventTime(right))

        summary.fetched += events.length

        for (const event of events) {
          const { eventRow, duplicate } = await persistIfoodEvent(
            supabase,
            settings.user_id,
            event,
            { source: 'polling', httpStatus: pollingResponse?.status },
          )

          if (duplicate) summary.duplicates += 1

          try {
            await processIfoodEvent(supabase, settings, eventRow)
            summary.processed += 1
          } catch {
            summary.errors += 1
          }
        }

        if (events.length > 0) await acknowledgeIfoodEvents(supabase, settings, events)

        const previousSyncAt = new Date(settings.last_sync_at || 0).getTime()
        const idleHeartbeatDue = !Number.isFinite(previousSyncAt) ||
          Date.now() - previousSyncAt >= IDLE_HEARTBEAT_INTERVAL_MS
        const shouldPersistSync = events.length > 0 ||
          settings.last_sync_status !== 'ok' ||
          idleHeartbeatDue

        // O polling precisa continuar frequente para descobrir pedidos novos,
        // mas uma resposta vazia não precisa regravar toda a configuração a
        // cada 30 segundos. Mantemos um heartbeat espaçado para observabilidade.
        if (shouldPersistSync) {
          await upsertIfoodSettings(supabase, settings.user_id, {
            merchant_id: settings.merchant_id,
            last_sync_at: new Date().toISOString(),
            last_sync_status: 'ok',
            last_sync_message: events.length
              ? `${events.length} evento(s) recebido(s) pelo polling automático`
              : 'Polling automático ativo; nenhum evento novo',
            status: 'online',
          })
        }
      } catch (pollError: any) {
        summary.errors += 1
        await upsertIfoodSettings(supabase, settings.user_id, {
          merchant_id: settings.merchant_id,
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_message: String(pollError?.message || pollError),
          status: 'online',
        })
      }
    }

    return okJson({ ok: true, summary })
  } catch (error: any) {
    return okJson(
      { ok: false, error: 'ifood_poller_error', message: String(error?.message || error) },
      500,
    )
  }
})
