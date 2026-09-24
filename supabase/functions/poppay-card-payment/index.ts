// deno-lint-ignore-file no-explicit-any no-import-prefix
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  calculatePlatformFeeCents,
  getEnv,
  getPopPayAccessToken,
  getPopPayConnection,
  refreshPopPayAccessToken,
} from '../_shared/poppay.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const ok = (payload: any, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: corsHeaders })

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase().slice(0, 180)
const normalizeDigits = (value: unknown) => String(value || '').replace(/\D/g, '').slice(0, 20)
const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const weekdayMap: Record<string, string> = {
  Sun: 'sunday', Mon: 'monday', Tue: 'tuesday', Wed: 'wednesday',
  Thu: 'thursday', Fri: 'friday', Sat: 'saturday',
}

const parseMinutes = (value: unknown) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

const parseHours = (value: unknown): Record<string, any> => {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, any>
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const isStoreOpenNow = (openingHours: unknown) => {
  const schedule = parseHours(openingHours)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: getEnv('STORE_TIME_ZONE', 'BORACUME_STORE_TIME_ZONE') || 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const dayKey = weekdayMap[values.weekday] || dayKeys[new Date().getDay()]
  const dayIndex = dayKeys.indexOf(dayKey)
  const nowMinutes = Number(values.hour || 0) * 60 + Number(values.minute || 0)
  const today = schedule[dayKey]
  const yesterday = schedule[dayKeys[(dayIndex + 6) % 7]]

  const activeToday = (() => {
    if (!today || today.closed) return false
    const open = parseMinutes(today.open)
    const close = parseMinutes(today.close)
    if (open === null || close === null) return true
    return close <= open ? nowMinutes >= open : nowMinutes >= open && nowMinutes < close
  })()
  const activeYesterday = (() => {
    if (!yesterday || yesterday.closed) return false
    const open = parseMinutes(yesterday.open)
    const close = parseMinutes(yesterday.close)
    return open !== null && close !== null && close <= open && nowMinutes < close
  })()
  return activeToday || activeYesterday
}

const isEnabledFutureSchedule = (scheduledValue: unknown, themeConfig: any) => {
  const config = themeConfig?.orderScheduling
  if (!config?.enabled) return false
  const scheduledAt = new Date(String(scheduledValue || '')).getTime()
  const maximumAdvanceDays = Math.min(30, Math.max(1, Number(config.maximumAdvanceDays) || 7))
  return Number.isFinite(scheduledAt) && scheduledAt > Date.now() && scheduledAt <= Date.now() + maximumAdvanceDays * 86_400_000
}

const validAttemptId = (value: unknown) => {
  const id = String(value || '').trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : ''
}

const getExistingCheckout = async (supabase: any, correlationID: string) =>
  (await supabase
    .from('pix_checkouts')
    .select('correlation_id,status,order_id,transaction_id,metadata')
    .eq('correlation_id', correlationID)
    .maybeSingle()).data

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = getEnv('SUPABASE_URL', 'BORACUME_SUPABASE_URL')
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', 'BORACUME_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceKey) return ok({ ok: false, error: 'missing_env' }, 503)

    const body = await req.json().catch(() => ({}))
    const restaurantUserId = String(body?.restaurantUserId || '').trim()
    const orderPayload = body?.orderPayload
    const token = String(body?.cardToken || '').trim()
    const paymentMethodId = String(body?.paymentMethodId || '').trim().toLowerCase()
    const issuerId = String(body?.issuerId || '').trim()
    const payerEmail = normalizeEmail(body?.payer?.email)
    const identificationType = String(body?.payer?.identification?.type || '').trim().toUpperCase().slice(0, 12)
    const identificationNumber = normalizeDigits(body?.payer?.identification?.number)
    const attemptId = validAttemptId(body?.attemptId)
    const correlationID = attemptId ? `card-${attemptId}` : ''
    const total = Number(orderPayload?.total || 0)
    const amountCents = Math.round(total * 100)

    if (
      !restaurantUserId ||
      !orderPayload ||
      !token ||
      !paymentMethodId ||
      !payerEmail ||
      !attemptId ||
      !Number.isFinite(total) ||
      amountCents <= 0
    ) {
      return ok({ ok: false, error: 'invalid_payload', message: 'Confira os dados do cartão e tente novamente.' }, 400)
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const existing = await getExistingCheckout(supabase, correlationID)
    if (existing) {
      return ok({
        ok: true,
        idempotent: true,
        correlationID,
        status: existing.status,
        orderId: existing.order_id || null,
        paymentId: existing.transaction_id || null,
      })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('opening_hours, theme_config')
      .eq('id', restaurantUserId)
      .maybeSingle()
    const isValidFutureSchedule = isEnabledFutureSchedule(orderPayload?.scheduled_at, profile?.theme_config)
    if (!isStoreOpenNow(profile?.opening_hours) && !isValidFutureSchedule) {
      return ok({ ok: false, error: 'store_closed', message: 'A loja está fechada no momento.' }, 409)
    }

    const { connection } = await getPopPayConnection(supabase, restaurantUserId)
    if (
      !connection ||
      connection.status !== 'connected' ||
      connection.enabled !== true ||
      connection.credit_online_enabled !== true ||
      !connection.public_key
    ) {
      return ok({
        ok: false,
        error: 'credit_online_disabled',
        message: 'O crédito online não está habilitado para este restaurante.',
      }, 409)
    }

    let accessToken = await getPopPayAccessToken(supabase, connection)
    if (!accessToken) return ok({ ok: false, error: 'missing_provider_credentials' }, 503)

    const fetchMethod = async (access: string) =>
      fetch('https://api.mercadopago.com/v1/payment_methods', {
        headers: { Authorization: `Bearer ${access}` },
      })
    let methodResponse = await fetchMethod(accessToken)
    if (methodResponse.status === 401) {
      const refreshed = await refreshPopPayAccessToken(supabase, connection)
      if (refreshed) {
        accessToken = refreshed
        methodResponse = await fetchMethod(accessToken)
      }
    }
    const methodsJson: any = await methodResponse.json().catch(() => ([]))
    const selectedMethod = Array.isArray(methodsJson)
      ? methodsJson.find((method: any) => String(method?.id || '').toLowerCase() === paymentMethodId)
      : null
    if (!methodResponse.ok || String(selectedMethod?.payment_type_id || '') !== 'credit_card') {
      return ok({
        ok: false,
        error: 'credit_card_required',
        message: 'Use um cartão de crédito. Débito online não está habilitado.',
      }, 400)
    }

    const { data: pixSettings } = await supabase
      .from('pix_settings')
      .select('webhook_secret')
      .eq('user_id', restaurantUserId)
      .maybeSingle()
    let webhookSecret = String(pixSettings?.webhook_secret || getEnv('PIX_WEBHOOK_SECRET') || '')
    if (!webhookSecret) {
      webhookSecret = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
      await supabase
        .from('pix_settings')
        .update({ webhook_secret: webhookSecret, updated_at: new Date().toISOString() })
        .eq('user_id', restaurantUserId)
    }

    const webhookBase = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/pix-webhook`
    const notificationUrl = `${webhookBase}?secret=${encodeURIComponent(webhookSecret)}&cid=${encodeURIComponent(correlationID)}`
    const feeBps = Math.max(0, Math.min(1000, Math.round(Number(connection.credit_fee_bps ?? 50))))
    const platformFeeCents = calculatePlatformFeeCents(amountCents, feeBps)

    const { error: insertError } = await supabase.from('pix_checkouts').insert({
      restaurant_user_id: restaurantUserId,
      correlation_id: correlationID,
      amount_cents: amountCents,
      status: 'CREATED',
      provider: 'mercadopago',
      order_payload: { ...orderPayload, payment_method: 'cartao_online' },
      payment_connection: 'poppay',
      payment_kind: 'credit_card',
      platform_fee_bps: feeBps,
      platform_fee_cents: platformFeeCents,
      updated_at: new Date().toISOString(),
    })
    if (insertError) {
      if (String(insertError.code || '') === '23505') {
        const concurrent = await getExistingCheckout(supabase, correlationID)
        return ok({
          ok: true,
          idempotent: true,
          correlationID,
          status: concurrent?.status || 'CREATED',
          orderId: concurrent?.order_id || null,
          paymentId: concurrent?.transaction_id || null,
        })
      }
      throw insertError
    }

    const firstName = String(orderPayload?.customer_name || 'Cliente').trim().split(/\s+/)[0] || 'Cliente'
    const lastName = String(orderPayload?.customer_name || '').trim().split(/\s+/).slice(1).join(' ') || 'PopSystem'
    const payer: Record<string, any> = {
      email: payerEmail,
      first_name: firstName,
      last_name: lastName,
    }
    if (identificationType && identificationNumber) {
      payer.identification = { type: identificationType, number: identificationNumber }
    }
    const phone = normalizeDigits(orderPayload?.customer_phone)
    if (phone.length >= 10) {
      payer.phone = { area_code: phone.slice(0, 2), number: phone.slice(2) }
    }

    const paymentBody = {
      transaction_amount: Number((amountCents / 100).toFixed(2)),
      token,
      description: `Pedido ${String(orderPayload?.order_number || correlationID).slice(0, 80)}`,
      installments: 1,
      payment_method_id: paymentMethodId,
      ...(issuerId ? { issuer_id: issuerId } : {}),
      ...(platformFeeCents > 0 ? { application_fee: Number((platformFeeCents / 100).toFixed(2)) } : {}),
      payer,
      external_reference: correlationID,
      notification_url: notificationUrl,
      metadata: {
        popsystem_correlation_id: correlationID,
        payment_connection: 'poppay',
        payment_kind: 'credit_card',
        platform_fee_cents: platformFeeCents,
        installments: 1,
      },
    }

    const createPayment = async (access: string) =>
      fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access}`,
          'X-Idempotency-Key': correlationID,
        },
        body: JSON.stringify(paymentBody),
      })

    let paymentResponse = await createPayment(accessToken)
    if (paymentResponse.status === 401) {
      const refreshed = await refreshPopPayAccessToken(supabase, connection)
      if (refreshed) {
        accessToken = refreshed
        paymentResponse = await createPayment(accessToken)
      }
    }
    const payment: any = await paymentResponse.json().catch(() => ({}))

    if (!paymentResponse.ok) {
      await supabase.from('pix_checkouts').update({
        status: 'FAILED',
        metadata: { provider: 'mercadopago', error: payment },
        updated_at: new Date().toISOString(),
      }).eq('correlation_id', correlationID)
      return ok({
        ok: false,
        error: 'provider_error',
        message: String(payment?.message || payment?.cause?.[0]?.description || 'Pagamento não aprovado.'),
        details: payment,
        correlationID,
      }, 422)
    }

    const mpStatus = String(payment?.status || '').toLowerCase()
    const checkoutStatus = mpStatus === 'approved'
      ? 'APPROVED'
      : mpStatus === 'rejected'
        ? 'REJECTED'
        : String(mpStatus || 'PENDING').toUpperCase()
    const providerFeeCents = Math.max(0, Math.round(
      (Array.isArray(payment?.fee_details) ? payment.fee_details : [])
        .filter((fee: any) => String(fee?.type || '').toLowerCase() !== 'application_fee')
        .reduce((sum: number, fee: any) => sum + Number(fee?.amount || 0), 0) * 100
    ))
    const netReceived = Number(payment?.transaction_details?.net_received_amount)

    await supabase.from('pix_checkouts').update({
      status: checkoutStatus,
      transaction_id: String(payment?.id || ''),
      provider_fee_cents: providerFeeCents,
      net_received_cents: Number.isFinite(netReceived) ? Math.max(0, Math.round(netReceived * 100)) : null,
      metadata: {
        provider: 'mercadopago',
        payment_id: payment?.id ?? null,
        mp_status: payment?.status ?? null,
        mp_status_detail: payment?.status_detail ?? null,
        payment_method_id: paymentMethodId,
        payment_type_id: payment?.payment_type_id ?? null,
        installments: 1,
        platform_fee_bps: feeBps,
        platform_fee_cents: platformFeeCents,
      },
      updated_at: new Date().toISOString(),
    }).eq('correlation_id', correlationID)

    if (mpStatus === 'rejected') {
      return ok({
        ok: false,
        error: 'payment_rejected',
        message: 'O cartão não foi aprovado. Confira os dados ou use outro cartão.',
        statusDetail: payment?.status_detail || null,
        correlationID,
      }, 422)
    }

    if (mpStatus === 'approved' && payment?.id) {
      try {
        await fetch(notificationUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'payment', data: { id: payment.id } }),
        })
      } catch {
        // O webhook oficial do Mercado Pago repetirá a notificação.
      }
    }

    const finalCheckout = await getExistingCheckout(supabase, correlationID)
    return ok({
      ok: true,
      correlationID,
      paymentId: payment?.id || null,
      status: finalCheckout?.status || checkoutStatus,
      orderId: finalCheckout?.order_id || null,
      statusDetail: payment?.status_detail || null,
      installments: 1,
    })
  } catch (error: any) {
    console.error('[poppay-card-payment]', error)
    return ok({ ok: false, error: 'internal_error', message: String(error?.message || error) }, 500)
  }
})
