// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  calculatePlatformFeeCents,
  envEnabled,
  getPopPayAccessToken,
  getPopPayConnection,
  refreshPopPayAccessToken,
} from '../_shared/poppay.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
}

console.log("Edge Function pix-start-checkout init")

const getEnv = (...keys: string[]) => {
  for (const key of keys) {
    const value = Deno.env.get(key)
    if (value) return value
  }
  return ''
}

const getRequestOrigin = (req: Request) => {
  const origin = req.headers.get('origin')
  if (origin) return origin
  const referer = req.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).origin
    } catch {
      return ''
    }
  }
  return ''
}

const randomSecret = () => {
  try {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const weekdayToDayKey: Record<string, string> = {
  sun: 'sunday',
  sunday: 'sunday',
  mon: 'monday',
  monday: 'monday',
  tue: 'tuesday',
  tuesday: 'tuesday',
  wed: 'wednesday',
  wednesday: 'wednesday',
  thu: 'thursday',
  thursday: 'thursday',
  fri: 'friday',
  friday: 'friday',
  sat: 'saturday',
  saturday: 'saturday',
}
const storeTimeZone = getEnv('STORE_TIME_ZONE', 'BORACUME_STORE_TIME_ZONE') || 'America/Sao_Paulo'

const isEnabledFutureSchedule = (scheduledValue: unknown, themeConfig: any) => {
  const config = themeConfig?.orderScheduling
  if (!config?.enabled) return false
  const scheduledAt = new Date(String(scheduledValue || '')).getTime()
  const maximumAdvanceDays = Math.min(30, Math.max(1, Number(config.maximumAdvanceDays) || 7))
  return Number.isFinite(scheduledAt) && scheduledAt > Date.now() && scheduledAt <= Date.now() + maximumAdvanceDays * 86_400_000
}

const parseOpeningHours = (value: unknown) => {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' ? value : {}
}

const parseMinutes = (value?: string) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

const getClockInTimeZone = (now = new Date(), timeZone = storeTimeZone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)

    const values = parts.reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value
      return acc
    }, {})

    const dayKey = weekdayToDayKey[String(values.weekday || '').toLowerCase()] || dayKeys[now.getDay()]
    const dayIndex = dayKeys.indexOf(dayKey)
    const hours = Number(values.hour || now.getHours())
    const minutes = Number(values.minute || now.getMinutes())

    return {
      dayKey,
      dayIndex: dayIndex >= 0 ? dayIndex : now.getDay(),
      currentMinutes: hours * 60 + minutes,
    }
  } catch {
    return {
      dayKey: dayKeys[now.getDay()],
      dayIndex: now.getDay(),
      currentMinutes: now.getHours() * 60 + now.getMinutes(),
    }
  }
}

const isOpenFromTodaySchedule = (schedule: any, currentMinutes: number) => {
  if (!schedule || schedule.closed) return false

  const openMinutes = parseMinutes(schedule.open)
  const closeMinutes = parseMinutes(schedule.close)
  if (openMinutes === null || closeMinutes === null) return true

  if (closeMinutes <= openMinutes) {
    return currentMinutes >= openMinutes
  }

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes
}

const isOpenFromYesterdaySchedule = (schedule: any, currentMinutes: number) => {
  if (!schedule || schedule.closed) return false

  const openMinutes = parseMinutes(schedule.open)
  const closeMinutes = parseMinutes(schedule.close)
  if (openMinutes === null || closeMinutes === null) return false

  return closeMinutes <= openMinutes && currentMinutes < closeMinutes
}

const isStoreOpenNow = (openingHours: unknown, now = new Date(), timeZone = storeTimeZone) => {
  const schedule = parseOpeningHours(openingHours) as Record<string, any>
  const { dayKey: currentDay, dayIndex, currentMinutes } = getClockInTimeZone(now, timeZone)
  const todaySchedule = schedule[currentDay]
  const yesterdaySchedule = schedule[dayKeys[(dayIndex + 6) % 7]]

  return (
    isOpenFromTodaySchedule(todaySchedule, currentMinutes) ||
    isOpenFromYesterdaySchedule(yesterdaySchedule, currentMinutes)
  )
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const ok = (payload: any) =>
    new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders })

  try {
    const supabaseUrl = getEnv('SUPABASE_URL', 'BORACUME_SUPABASE_URL')
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', 'BORACUME_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceKey) {
      console.error("Missing environment variables")
      return ok({ ok: false, error: 'missing_env', message: "Missing environment variables SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    let body
    try {
      body = await req.json()
    } catch (e: any) {
      console.error("Error parsing JSON body:", e)
      return ok({ ok: false, error: 'invalid_json_body', details: e?.message })
    }

    const restaurantUserId = String(body?.restaurantUserId || '')
    const orderPayload = body?.orderPayload
    const total = Number(orderPayload?.total || 0)
    const preferredMethod = String(body?.preferredMethod || orderPayload?.payment_method || '')
    const useCheckoutPro = Boolean(body?.useCheckoutPro)
    const existingOrderId = String(body?.orderId || orderPayload?.order_id || '').trim() || null

    console.log(`Processing request for user: ${restaurantUserId}, total: ${total}, method: ${preferredMethod}, pro: ${useCheckoutPro}`)

    if (!restaurantUserId || !orderPayload || !Number.isFinite(total) || total <= 0) {
      return ok({ ok: false, error: 'invalid_payload' })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('opening_hours, theme_config')
      .eq('id', restaurantUserId)
      .maybeSingle()

    if (profileError) {
      console.error("Database error fetching profile:", profileError)
      return ok({ ok: false, error: 'profile_fetch_error', details: profileError })
    }

    const isValidFutureSchedule = isEnabledFutureSchedule(orderPayload?.scheduled_at, profile?.theme_config)
    if (!isStoreOpenNow(profile?.opening_hours) && !isValidFutureSchedule) {
      return ok({ ok: false, error: 'store_closed', message: 'A loja está fechada no momento.' })
    }

    const { data: pix, error: pixErr } = await supabase
      .from('pix_settings')
      .select('enabled, bank, pix_key, merchant_name, merchant_city, client_id, endpoint_base, webhook_secret, mp_access_token, mp_refresh_token, mp_expires_at')
      .eq('user_id', restaurantUserId)
      .maybeSingle()

    if (pixErr) {
      console.error("Database error fetching settings:", pixErr)
      return ok({ ok: false, error: 'db_error', details: pixErr })
    }
    
    if (!pix) {
      console.error("No pix settings found for user")
      return ok({ ok: false, error: 'pix_not_configured' })
    }

    if (!pix.enabled) return ok({ ok: false, error: 'pix_disabled' })

    const correlationID = crypto.randomUUID()
    const value = Math.round(total * 100)
    const customerName = String(orderPayload?.customer_name || 'Cliente')
    const customerPhone = String(orderPayload?.customer_phone || '')
    
    // Fallback seguro para origin se header não existir
    const origin = getRequestOrigin(req) || 'http://localhost:5173'

    const providerKey = String(pix.bank || 'mercadopago')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    const provider = (!providerKey || providerKey === 'mp' || providerKey.includes('mercadopago')) ? 'mercadopago' : providerKey
    let webhookSecret = getEnv('PIX_WEBHOOK_SECRET') || String(pix.webhook_secret || '')
    if (!webhookSecret) {
      webhookSecret = randomSecret()
      await supabase
        .from('pix_settings')
        .update({ webhook_secret: webhookSecret, updated_at: new Date().toISOString() })
        .eq('user_id', restaurantUserId)
    }
    const webhookBase = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/pix-webhook`
    const notificationUrl = `${webhookBase}?secret=${encodeURIComponent(webhookSecret)}&cid=${encodeURIComponent(correlationID)}`

    // Tenta inserir, mas não falha fatalmente se der erro (log apenas)
    const { error: insertErr } = await supabase.from('pix_checkouts').insert({
      restaurant_user_id: restaurantUserId,
      correlation_id: correlationID,
      amount_cents: value,
      status: 'CREATED',
      provider: provider || 'mercadopago',
      order_payload: orderPayload,
      order_id: existingOrderId,
      updated_at: new Date().toISOString()
    })

    if (insertErr) {
      console.error("Error creating pix_checkout record:", insertErr)
      // Não retorna erro fatal, tenta prosseguir com MP, mas idealmente deveria parar.
      // Vamos parar para garantir consistência
      return ok({ ok: false, error: 'db_insert_error', details: insertErr })
    }

    if (provider === 'mercadopago') {
      const mpClientId = getEnv('MP_PLATFORM_CLIENT_ID')
      const mpClientSecret = getEnv('MP_PLATFORM_CLIENT_SECRET')

      const refreshAccessToken = async () => {
        const refreshToken = String((pix as any)?.mp_refresh_token || '')
        if (!refreshToken || !mpClientId || !mpClientSecret) return ''
        const resp = await fetch('https://api.mercadopago.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: mpClientId,
            client_secret: mpClientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          })
        })
        const json: any = await resp.json().catch(() => ({}))
        if (!resp.ok) return ''
        const nextToken = String(json?.access_token || '')
        const nextRefresh = String(json?.refresh_token || '') || refreshToken
        const expiresIn = json?.expires_in ? Number(json.expires_in) : 0
        const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
        await supabase
          .from('pix_settings')
          .update({
            mp_access_token: nextToken || null,
            mp_refresh_token: nextRefresh || null,
            mp_expires_at: expiresAt,
            client_id: nextToken || null,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', restaurantUserId)
        ;(pix as any).mp_access_token = nextToken
        ;(pix as any).client_id = nextToken
        ;(pix as any).mp_refresh_token = nextRefresh
        ;(pix as any).mp_expires_at = expiresAt
        return nextToken
      }

      const getAccessToken = async () => {
        const token = String((pix as any)?.mp_access_token || (pix as any)?.client_id || '')
        const expiresAtRaw = String((pix as any)?.mp_expires_at || '')
        if (expiresAtRaw) {
          const t = new Date(expiresAtRaw).getTime()
          if (Number.isFinite(t) && Date.now() > t - 60_000) {
            const refreshed = await refreshAccessToken()
            if (refreshed) return refreshed
          }
        }
        return token
      }

      let paymentConnection = 'legacy'
      let platformFeeBps = 0
      let platformFeeCents = 0
      let popPayConnection: any = null
      let accessToken = await getAccessToken()
      let refreshSelectedAccessToken = refreshAccessToken

      // O PopPay e selecionado automaticamente no servidor quando a conta esta
      // conectada. Qualquer falha preserva o checkout legado da loja.
      if (envEnabled('POPPAY_SPLIT_ENABLED')) {
        const popPayResult = await getPopPayConnection(supabase, restaurantUserId)
        const candidate = popPayResult.connection
        if (
          candidate &&
          candidate.status === 'connected' &&
          candidate.enabled === true
        ) {
          const popPayToken = await getPopPayAccessToken(supabase, candidate)
          if (popPayToken) {
            popPayConnection = candidate
            paymentConnection = 'poppay'
            platformFeeBps = Number(candidate.fee_bps || 100)
            platformFeeCents = calculatePlatformFeeCents(value, platformFeeBps)
            accessToken = popPayToken
            refreshSelectedAccessToken = () => refreshPopPayAccessToken(supabase, popPayConnection)
          }
        }
      }

      if (!accessToken) return ok({ ok: false, error: 'missing_provider_credentials' })

      await supabase
        .from('pix_checkouts')
        .update({
          payment_connection: paymentConnection,
          platform_fee_bps: platformFeeBps,
          platform_fee_cents: platformFeeCents,
          updated_at: new Date().toISOString(),
        })
        .eq('correlation_id', correlationID)

      console.log("Calling Mercado Pago API...")
      
      if (preferredMethod === 'pix' && !useCheckoutPro) {
        const payerEmail = `${correlationID}@example.com`
        const callPayment = async (token: string, feeCents: number, idempotencyKey = correlationID) =>
          fetch('https://api.mercadopago.com/v1/payments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            transaction_amount: Number((value / 100).toFixed(2)),
            ...(feeCents > 0 ? { application_fee: Number((feeCents / 100).toFixed(2)) } : {}),
            description: `Pedido ${orderPayload?.order_number || correlationID}`,
            payment_method_id: 'pix',
            external_reference: correlationID,
            notification_url: notificationUrl,
            metadata: {
              popsystem_correlation_id: correlationID,
              payment_connection: paymentConnection,
              platform_fee_cents: feeCents,
            },
            payer: {
              email: payerEmail,
              first_name: customerName.split(' ')[0] || 'Cliente',
              last_name: customerName.split(' ').slice(1).join(' ') || 'PopSystem',
              phone: customerPhone ? { area_code: "11", number: customerPhone.replace(/\D/g, '') } : undefined
            }
          })
        })

        let mpResp = await callPayment(accessToken, platformFeeCents)
        if (mpResp.status === 401) {
          const refreshed = await refreshSelectedAccessToken()
          if (refreshed) {
            accessToken = refreshed
            mpResp = await callPayment(accessToken, platformFeeCents)
          }
        }

        let mpJson: any = await mpResp.json().catch(() => ({}))
        let splitFallbackReason = ''
        const providerErrorText = JSON.stringify(mpJson || {}).toLowerCase()
        const splitNotAllowed = platformFeeCents > 0 && (
          providerErrorText.includes('application_fee') ||
          providerErrorText.includes('2059')
        )

        if (!mpResp.ok && splitNotAllowed) {
          splitFallbackReason = String(mpJson?.message || 'application_fee_not_allowed')
          console.warn('[PopPay] Split recusado; repetindo PIX sem comissao:', splitFallbackReason)
          if (popPayConnection?.id) {
            await supabase
              .from('poppay_connections')
              .update({ last_error: `split_unavailable: ${splitFallbackReason}`.slice(0, 500), updated_at: new Date().toISOString() })
              .eq('id', popPayConnection.id)
          }
          platformFeeBps = 0
          platformFeeCents = 0
          await supabase
            .from('pix_checkouts')
            .update({ platform_fee_bps: 0, platform_fee_cents: 0, updated_at: new Date().toISOString() })
            .eq('correlation_id', correlationID)
          mpResp = await callPayment(accessToken, 0, `${correlationID}-no-fee`)
          mpJson = await mpResp.json().catch(() => ({}))
        }
        console.log("MP Response status:", mpResp.status)

        if (!mpResp.ok) {
          console.error("MP Error:", mpJson)
          const finalProviderErrorText = JSON.stringify(mpJson || {}).toLowerCase()
          const collectorPixKeyMissing = finalProviderErrorText.includes('collector user without key enabled for qr')
          await supabase
            .from('pix_checkouts')
            .update({
              status: 'FAILED',
              metadata: { provider: 'mercadopago', error: mpJson },
              updated_at: new Date().toISOString()
            })
            .eq('correlation_id', correlationID)
          if (collectorPixKeyMissing) {
            return ok({
              ok: false,
              error: 'collector_pix_key_missing',
              message: 'A conta Mercado Pago do restaurante ainda nao possui uma chave PIX ativa. Cadastre e valide uma chave PIX no aplicativo Mercado Pago e tente novamente.',
              correlationID,
            })
          }
          return ok({ ok: false, error: 'provider_error', details: mpJson, correlationID })
        }

        const mpStatus = String(mpJson?.status || '').toLowerCase()
        const mpDetail = String(mpJson?.status_detail || '').toLowerCase()
        const isActuallyPaid = mpStatus === 'approved' && (Boolean(mpJson?.date_approved) || mpDetail === 'accredited')
        const safeStatus = isActuallyPaid ? 'PAID' : (mpStatus ? mpStatus.toUpperCase() : 'CREATED')

        await supabase
          .from('pix_checkouts')
          .update({
            status: safeStatus,
            transaction_id: String(mpJson?.id || ''),
            metadata: {
              provider: 'mercadopago',
              payment_id: mpJson?.id ?? null,
              mp_status: mpJson?.status ?? null,
              mp_status_detail: mpJson?.status_detail ?? null,
              date_approved: mpJson?.date_approved ?? null,
              ticket_url: mpJson?.point_of_interaction?.transaction_data?.ticket_url ?? null,
              payment_connection: paymentConnection,
              platform_fee_bps: platformFeeBps,
              platform_fee_cents: platformFeeCents,
              split_fallback_reason: splitFallbackReason || null,
            },
            updated_at: new Date().toISOString()
          })
          .eq('correlation_id', correlationID)

        const brCode = mpJson?.point_of_interaction?.transaction_data?.qr_code || ''
        const qrBase64 = mpJson?.point_of_interaction?.transaction_data?.qr_code_base64 || ''
        const ticketUrl = mpJson?.point_of_interaction?.transaction_data?.ticket_url || ''
        const qrCodeImage = qrBase64 ? `data:image/png;base64,${qrBase64}` : ''

        return ok({ ok: true, correlationID, brCode, qrCodeImage, paymentLinkUrl: ticketUrl, provider: 'mercadopago', paymentId: mpJson?.id ?? null })
      }

      const payerEmail = `${correlationID}@example.com`
      const preferenceBody = {
        items: [
          {
            title: `Pedido ${orderPayload?.order_number || correlationID}`,
            quantity: 1,
            currency_id: 'BRL',
            unit_price: Number((value / 100).toFixed(2)),
          },
        ],
        external_reference: correlationID,
        notification_url: notificationUrl,
        payer: {
          email: payerEmail,
          name: customerName,
          phone: customerPhone ? { area_code: "11", number: customerPhone.replace(/\D/g, '') } : undefined,
        },
        back_urls: {
          success: `${origin.replace(/\/+$/, '')}/mp/return?cid=${encodeURIComponent(correlationID)}`,
          pending: `${origin.replace(/\/+$/, '')}/mp/return?cid=${encodeURIComponent(correlationID)}`,
          failure: `${origin.replace(/\/+$/, '')}/mp/return?cid=${encodeURIComponent(correlationID)}`,
        },
        auto_return: 'approved',
        ...(platformFeeCents > 0 ? { marketplace_fee: Number((platformFeeCents / 100).toFixed(2)) } : {}),
        metadata: {
          correlationID,
          restaurantUserId,
          payment_method: preferredMethod || null,
          payment_connection: paymentConnection,
          platform_fee_cents: platformFeeCents,
        },
      }

      const callPreference = async (token: string) =>
        fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(preferenceBody),
      })

      let prefResp = await callPreference(accessToken)
      if (prefResp.status === 401) {
        const refreshed = await refreshSelectedAccessToken()
        if (refreshed) {
          accessToken = refreshed
          prefResp = await callPreference(accessToken)
        }
      }

      const prefJson: any = await prefResp.json().catch(() => ({}))
      if (!prefResp.ok) {
        await supabase
          .from('pix_checkouts')
          .update({
            status: 'FAILED',
            metadata: { provider: 'mercadopago', error: prefJson },
            updated_at: new Date().toISOString()
          })
          .eq('correlation_id', correlationID)
        return ok({ ok: false, error: 'provider_error', details: prefJson, correlationID })
      }

      await supabase
        .from('pix_checkouts')
        .update({
          status: 'PENDING',
          transaction_id: String(prefJson?.id || ''),
          metadata: {
            provider: 'mercadopago',
            preference_id: prefJson?.id ?? null,
            init_point: prefJson?.init_point ?? null,
            payment_connection: paymentConnection,
            platform_fee_bps: platformFeeBps,
            platform_fee_cents: platformFeeCents,
          },
          updated_at: new Date().toISOString()
        })
        .eq('correlation_id', correlationID)

      return ok({ ok: true, correlationID, initPoint: prefJson?.init_point || '', provider: 'mercadopago' })
    }

    return ok({ ok: false, error: 'unsupported_provider' })

  } catch (e: any) {
    console.error("Fatal error in edge function:", e)
    return new Response(JSON.stringify({ ok: false, error: 'internal_error', message: e?.message }), { status: 200, headers: corsHeaders })
  }
})
