import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { markLoyaltyRewardUsedForOrder } from '../_shared/loyalty.ts'
import { notifyOrderCreated } from '../_shared/restaurant-whatsapp.ts'
import { getPopPayAccessToken, getPopPayConnection, refreshPopPayAccessToken } from '../_shared/poppay.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pix-secret, x-signature, x-request-id',
}

const isWaiterPixPayload = (payload: any) => {
  const source = String(payload?.source || payload?.variations?.source || '').trim().toUpperCase()
  return source === 'WAITER_WEB_PIX'
}

const recordWaiterPixPayment = async (supabase: any, checkout: any, payload: any) => {
  const sessionId = String(payload?.waiter_session_id || payload?.session_id || payload?.variations?.waiter?.session_id || '').trim()
  const accountId = String(payload?.waiter_account_id || payload?.account_id || payload?.variations?.waiter?.account_id || '').trim()
  const waiterId = String(payload?.waiter_id || payload?.variations?.waiter?.waiter_id || '').trim()
  const amount = Number(payload?.total || 0)

  if (!sessionId || !accountId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('waiter_pix_payload_invalid')
  }

  const { data: account, error: accountError } = await supabase
    .from('table_accounts')
    .select('id, session_id')
    .eq('id', accountId)
    .maybeSingle()

  if (accountError) throw accountError
  if (!account || String(account.session_id || '') !== sessionId) {
    throw new Error('waiter_pix_account_invalid')
  }

  const { error: paymentError } = await supabase
    .from('payments')
    .insert({
      session_id: sessionId,
      account_id: accountId,
      user_id: checkout.restaurant_user_id,
      waiter_id: waiterId || null,
      method: 'pix',
      amount,
    })

  if (paymentError) throw paymentError
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl =
      Deno.env.get('SUPABASE_URL') ??
      Deno.env.get('BORACUME_SUPABASE_URL') ??
      ''
    const serviceRole =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      Deno.env.get('BORACUME_SERVICE_ROLE_KEY') ??
      Deno.env.get('SERVICE_ROLE_KEY') ??
      ''
    const supabase = createClient(supabaseUrl, serviceRole)

    const url = new URL(req.url)
    const cidFromQuery = url.searchParams.get('cid') ?? ''
    const providedSecret =
      (req.headers.get('x-pix-secret') ?? '') ||
      (url.searchParams.get('secret') ?? '')

    let body: any = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const status = body?.status ?? body?.payment_status ?? body?.charge?.status ?? ''
    const orderId = body?.order_id ?? body?.metadata?.order_id ?? body?.orderId ?? ''
    const correlationID = body?.charge?.correlationID ?? body?.pix?.charge?.correlationID ?? ''

    const paymentIdFromQuery =
      url.searchParams.get('data.id') ||
      url.searchParams.get('id') ||
      ''

    const paymentIdFromBody =
      body?.data?.id ??
      body?.id ??
      ''

    const paymentId = String(paymentIdFromBody || paymentIdFromQuery || '')

    let checkoutPrefetched: any | null = null
    const prefetchCheckoutByCorrelation = async (cid: string) =>
      (await supabase
        .from('pix_checkouts')
        .select('id, restaurant_user_id, status, provider, order_payload, order_id, correlation_id, payment_connection, payment_kind, platform_fee_bps, platform_fee_cents')
        .eq('correlation_id', cid)
        .maybeSingle()).data

    const prefetchCheckoutByPaymentId = async (pid: string) =>
      (await supabase
        .from('pix_checkouts')
        .select('id, restaurant_user_id, status, provider, order_payload, order_id, correlation_id, payment_connection, payment_kind, platform_fee_bps, platform_fee_cents')
        .or(`transaction_id.eq.${pid},metadata->>payment_id.eq.${pid}`)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()).data

    // Webhook de provedor externo (Mercado Pago) pode chegar sem `secret/cid` em eventos de teste/validação.
    // Nunca retornamos 401 aqui, porque o MP marca como erro e continua tentando.
    if (!providedSecret) {
      if (!cidFromQuery && !paymentId) {
        return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const checkout = cidFromQuery
        ? await prefetchCheckoutByCorrelation(cidFromQuery)
        : await prefetchCheckoutByPaymentId(paymentId)
      if (!checkout) {
        return new Response(JSON.stringify({ ok: true, unknown: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      if (String(checkout.provider).toLowerCase() !== 'mercadopago') {
        return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      checkoutPrefetched = checkout
    } else if (cidFromQuery || paymentId) {
      const checkout = cidFromQuery
        ? await prefetchCheckoutByCorrelation(cidFromQuery)
        : await prefetchCheckoutByPaymentId(paymentId)
      if (checkout && String(checkout.provider).toLowerCase() === 'mercadopago') {
        checkoutPrefetched = checkout
      }
    }

    let userIdFromSecret: string | null = null
    let secretValidated = false

    if (providedSecret) {
      // Try multi-tenant secret from DB first
      try {
        const { data: pix, error: pixErr } = await supabase
          .from('pix_settings')
          .select('user_id, webhook_secret')
          .eq('webhook_secret', providedSecret)
          .maybeSingle()
        if (!pixErr && pix) {
          userIdFromSecret = pix.user_id as string
          secretValidated = true
        }
      } catch (_) {
        // Table may not exist yet; ignore and fallback to env secret
      }

      if (!secretValidated) {
        const expectedSecret = Deno.env.get('PIX_WEBHOOK_SECRET') ?? ''
        if (!expectedSecret || providedSecret !== expectedSecret) {
          if (checkoutPrefetched && String(checkoutPrefetched.provider).toLowerCase() === 'mercadopago') {
            secretValidated = true
          } else if (paymentId) {
            return new Response(JSON.stringify({ ok: true, unknown: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
          } else {
          return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
          }
        }
        secretValidated = true
      }
    }

    const effectiveCid = String(cidFromQuery || checkoutPrefetched?.correlation_id || '')
    console.log(`[PixWebhook] Received request. CID: ${effectiveCid}, Secret provided: ${!!providedSecret}`);

    if (!effectiveCid && paymentId) {
      return new Response(JSON.stringify({ ok: true, unknown: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ... (rest of the code)

    if (effectiveCid) {
      console.log(`[PixWebhook] Processing correlation ID: ${effectiveCid}`);
      const checkout = checkoutPrefetched
        ? checkoutPrefetched
        : (await supabase
            .from('pix_checkouts')
            .select('id, restaurant_user_id, status, provider, order_payload, order_id, payment_connection, payment_kind, platform_fee_bps, platform_fee_cents')
            .eq('correlation_id', effectiveCid)
            .maybeSingle()).data

      if (!checkout) {
        console.error(`[PixWebhook] Checkout not found for CID: ${effectiveCid}`);
        return new Response(JSON.stringify({ ok: true, unknown: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      console.log(`[PixWebhook] Checkout found. Status: ${checkout.status}, Provider: ${checkout.provider}`);

      if (String(checkout.provider).toLowerCase() === 'mercadopago') {
        console.log(`[PixWebhook] MP Payment ID: ${paymentId}`);
        
        if (!paymentId) {
           // Se for apenas teste de validação do MP
           if (body?.action === 'test.created') {
               console.log('[PixWebhook] MP Test Notification received.');
               return new Response(JSON.stringify({ ok: true }), { status: 200 });
           }
           console.log('[PixWebhook] No payment ID found in body');
           return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const usePopPay = String(checkout.payment_connection || '') === 'poppay'
        let accessToken = ''
        let refreshAccessToken: () => Promise<string>

        if (usePopPay) {
          const { connection } = await getPopPayConnection(supabase, checkout.restaurant_user_id)
          if (!connection) {
            console.error(`[PixWebhook] PopPay connection not found for user ${checkout.restaurant_user_id}`)
            return new Response(JSON.stringify({ error: 'config_missing' }), { status: 200 })
          }
          accessToken = await getPopPayAccessToken(supabase, connection)
          refreshAccessToken = () => refreshPopPayAccessToken(supabase, connection)
        } else {
          const { data: mp } = await supabase
            .from('pix_settings')
            .select('enabled, bank, client_id, mp_access_token, mp_refresh_token, mp_expires_at')
            .eq('user_id', checkout.restaurant_user_id)
            .maybeSingle()
          if (!mp || !(mp.mp_access_token || mp.client_id || (mp as any).mp_refresh_token)) {
            console.error(`[PixWebhook] MP settings not found for user ${checkout.restaurant_user_id}`)
            return new Response(JSON.stringify({ error: 'config_missing' }), { status: 200 })
          }
          const mpClientId = Deno.env.get('MP_PLATFORM_CLIENT_ID') || ''
          const mpClientSecret = Deno.env.get('MP_PLATFORM_CLIENT_SECRET') || ''
          refreshAccessToken = async () => {
            const refreshToken = String((mp as any)?.mp_refresh_token || '')
            if (!refreshToken || !mpClientId || !mpClientSecret) return ''
            const resp = await fetch('https://api.mercadopago.com/oauth/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: mpClientId, client_secret: mpClientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
            })
            const json: any = await resp.json().catch(() => ({}))
            if (!resp.ok) return ''
            const nextToken = String(json?.access_token || '')
            const nextRefresh = String(json?.refresh_token || '') || refreshToken
            const expiresIn = Number(json?.expires_in || 0)
            const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
            await supabase.from('pix_settings').update({
              mp_access_token: nextToken || null,
              mp_refresh_token: nextRefresh || null,
              mp_expires_at: expiresAt,
              client_id: nextToken || null,
              updated_at: new Date().toISOString(),
            }).eq('user_id', checkout.restaurant_user_id)
            ;(mp as any).mp_access_token = nextToken
            ;(mp as any).mp_refresh_token = nextRefresh
            ;(mp as any).mp_expires_at = expiresAt
            return nextToken
          }
          accessToken = String((mp as any)?.mp_access_token || (mp as any)?.client_id || '')
          const expiresAt = mp?.mp_expires_at ? new Date(String(mp.mp_expires_at)).getTime() : 0
          if (!accessToken || (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt - 60_000)) {
            accessToken = await refreshAccessToken()
          }
        }

        if (!accessToken) {
          return new Response(JSON.stringify({ error: 'config_missing' }), { status: 200 })
        }
        
        console.log(`[PixWebhook] Fetching payment status from MP API...`);
        const callPayment = async (token: string) =>
          fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId))}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })

        let paymentResp = await callPayment(accessToken)
        if (paymentResp.status === 401) {
          const refreshed = await refreshAccessToken()
          if (refreshed) {
            accessToken = refreshed
            paymentResp = await callPayment(accessToken)
          }
        }
        const paymentJson: any = await paymentResp.json().catch(() => ({}))

        const externalRef = String(paymentJson?.external_reference || '')
        if (effectiveCid && externalRef && externalRef !== String(effectiveCid)) {
          console.error('[PixWebhook] external_reference mismatch', { cid: effectiveCid, externalRef })
          return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        
        if (!paymentResp.ok) {
          console.error(`[PixWebhook] MP API Error:`, paymentJson);
          return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const mpStatus = String(paymentJson?.status || '').toLowerCase()
        const mpDetail = String(paymentJson?.status_detail || '').toLowerCase()
        console.log(`[PixWebhook] Payment Status: ${mpStatus}`);

        if (mpStatus === 'refunded' || mpStatus === 'charged_back') {
          const refundedCents = Math.max(0, Math.round(Number(paymentJson?.transaction_amount_refunded || paymentJson?.transaction_amount || 0) * 100))
          await supabase
            .from('pix_checkouts')
            .update({ status: 'REFUNDED', refund_status: 'approved', refunded_cents: refundedCents, updated_at: new Date().toISOString() })
            .eq('id', checkout.id)
          await supabase
            .from('poppay_refunds')
            .update({ status: 'approved', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(), provider_response: paymentJson })
            .eq('checkout_id', checkout.id)
            .in('status', ['requested', 'in_process'])
          return new Response(JSON.stringify({ ok: true, refunded: true, orderId: checkout.order_id || null }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        
        const isApproved = mpStatus === 'approved' && (Boolean(paymentJson?.date_approved) || mpDetail === 'accredited')
        if (!isApproved) {
          await supabase
            .from('pix_checkouts')
            .update({ status: String(mpStatus || 'PENDING').toUpperCase(), updated_at: new Date().toISOString() })
            .eq('id', checkout.id)
          return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const providerFeeCents = Math.max(0, Math.round(
          (Array.isArray(paymentJson?.fee_details) ? paymentJson.fee_details : [])
            .filter((fee: any) => String(fee?.type || '').toLowerCase() !== 'application_fee')
            .reduce((sum: number, fee: any) => sum + Number(fee?.amount || 0), 0) * 100
        ))
        const netReceivedRaw = Number(paymentJson?.transaction_details?.net_received_amount)
        const netReceivedCents = Number.isFinite(netReceivedRaw) ? Math.max(0, Math.round(netReceivedRaw * 100)) : null

        // CREATE ORDER
        const locked = (await supabase
          .from('pix_checkouts')
          .update({
            status: 'PROCESSING',
            provider_fee_cents: providerFeeCents,
            net_received_cents: netReceivedCents,
            updated_at: new Date().toISOString(),
          })
          .eq('id', checkout.id)
          .neq('status', 'PAID')
          .neq('status', 'PROCESSING')
          .select('id')
          .maybeSingle()).data

        if (!locked) {
          return new Response(JSON.stringify({ ok: true, idempotent: true, orderId: checkout.order_id || null }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        if (checkout.order_id) {
          const targetOrderId = String(checkout.order_id)
          const paidMethod = String(checkout.payment_kind || '') === 'credit_card' ? 'cartao_online' : 'pix_online'
          const { error: updErr } = await supabase
            .from('orders')
            .update({ status: 'paid', acceptance_status: 'pending_acceptance', payment_method: paidMethod } as any)
            .eq('id', targetOrderId)
          if (updErr) {
            await supabase
              .from('pix_checkouts')
              .update({ status: 'PENDING', updated_at: new Date().toISOString() })
              .eq('id', checkout.id)
            return new Response(JSON.stringify({ error: 'order_update_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
          }

          await supabase
            .from('pix_checkouts')
            .update({ status: 'PAID', order_id: targetOrderId, updated_at: new Date().toISOString() })
            .eq('id', checkout.id)

          return new Response(JSON.stringify({ ok: true, orderId: targetOrderId }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const payload = checkout.order_payload || {}
        if (isWaiterPixPayload(payload)) {
          try {
            await recordWaiterPixPayment(supabase, checkout, payload)
          } catch (error) {
            console.error('[PixWebhook] Waiter PIX payment error:', error)
            await supabase
              .from('pix_checkouts')
              .update({ status: 'PENDING', updated_at: new Date().toISOString() })
              .eq('id', checkout.id)
            return new Response(JSON.stringify({ error: 'waiter_payment_record_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
          }

          await supabase
            .from('pix_checkouts')
            .update({ status: 'PAID', updated_at: new Date().toISOString() })
            .eq('id', checkout.id)

          return new Response(JSON.stringify({ ok: true, waiterPayment: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        console.log(`[PixWebhook] Creating Order...`);
        const payloadSource = String(payload?.variations?.source || payload?.source || '')
        const isPdv = payloadSource.toUpperCase() === 'PDV'
        // ... (rest of order creation)
        const orderNumber = payload?.order_number || `MP-${effectiveCid.slice(0, 8)}`
        const paidMethod = String(checkout.payment_kind || '') === 'credit_card' ? 'cartao_online' : 'pix_online'
        const insertData: any = {
          user_id: checkout.restaurant_user_id,
          order_number: orderNumber,
          customer_name: payload?.customer_name || (isPdv ? 'Venda PDV' : 'Cliente'),
          customer_phone: payload?.customer_phone || null,
          customer_address: payload?.customer_address || null,
          customer_neighborhood: payload?.customer_neighborhood || null,
          delivery_zone_id: payload?.delivery_zone_id || null,
          table_id: payload?.table_id || null,
          items: payload?.items || [],
          total: payload?.total || 0,
          delivery_fee: payload?.delivery_fee || 0,
          payment_method: paidMethod,
          status: payload?.status || (isPdv ? 'preparing' : 'pending'),
          acceptance_status: payload?.acceptance_status || (isPdv ? 'accepted' : 'pending_acceptance'),
          change_amount: payload?.change_amount ?? null,
          order_type: payload?.order_type || 'delivery',
          delivery_instructions: payload?.delivery_instructions || null,
          scheduled_at: payload?.scheduled_at || null,
          waiter_id: payload?.waiter_id || null,
          cash_register_session_id: payload?.cash_register_session_id || null,
          variations: payload?.variations || null,
          // ...
        }

        const { data: created, error: createErr } = await supabase
          .from('orders')
          .insert(insertData)
          .select('id')
          .single()

        if (createErr) {
            console.error(`[PixWebhook] Order Creation Error:`, createErr);
            await supabase
              .from('pix_checkouts')
              .update({ status: 'PENDING', updated_at: new Date().toISOString() })
              .eq('id', checkout.id)
            return new Response(JSON.stringify({ error: 'order_create_failed' }), { status: 500 });
        }

        console.log(`[PixWebhook] Order Created: ${created.id}`);
        
        // ... update checkout ...
        await supabase
          .from('pix_checkouts')
          .update({ status: 'PAID', order_id: created.id, updated_at: new Date().toISOString() })
          .eq('id', checkout.id)

        try {
          await notifyOrderCreated(supabase, { ...insertData, id: created.id })
        } catch (error) {
          console.error('[PixWebhook] Falha ao notificar pedido criado via WhatsApp:', error)
        }

        return new Response(JSON.stringify({ ok: true, orderId: created.id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    const normalized = String(status).toUpperCase()
    const isPaid =
      normalized === 'PAID' ||
      normalized === 'APPROVED' ||
      normalized === 'PAID_OUT' ||
      normalized === 'CONCLUDED' ||
      normalized === 'COMPLETED'

    if (!isPaid) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (correlationID) {
      const { data: checkout, error: chkErr } = await supabase
        .from('pix_checkouts')
        .select('id, restaurant_user_id, status, order_payload, order_id')
        .eq('correlation_id', correlationID)
        .maybeSingle()
      if (chkErr || !checkout) {
        return new Response(JSON.stringify({ ok: true, unknown: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      if (checkout.status === 'PAID') {
        return new Response(JSON.stringify({ ok: true, idempotent: true, orderId: checkout.order_id || null }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const payload = checkout.order_payload || {}
      if (isWaiterPixPayload(payload)) {
        try {
          await recordWaiterPixPayment(supabase, checkout, payload)
        } catch (error) {
          console.error('[PixWebhook] Legacy waiter PIX payment error:', error)
          return new Response(JSON.stringify({ error: 'waiter_payment_record_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        await supabase
          .from('pix_checkouts')
          .update({ status: 'PAID', updated_at: new Date().toISOString() })
          .eq('id', checkout.id)

        return new Response(JSON.stringify({ ok: true, waiterPayment: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const orderNumber = payload?.order_number || `PIX-${correlationID.slice(0, 8)}`

      const insertData: any = {
        user_id: checkout.restaurant_user_id,
        order_number: orderNumber,
        customer_name: payload?.customer_name || null,
        customer_phone: payload?.customer_phone || null,
        customer_address: payload?.customer_address || null,
        customer_neighborhood: payload?.customer_neighborhood || null,
        delivery_zone_id: payload?.delivery_zone_id || null,
        items: payload?.items || [],
        total: payload?.total || 0,
        delivery_fee: payload?.delivery_fee || null,
        payment_method: payload?.payment_method || 'pix_online',
        discount: payload?.discount ?? 0,
        coupon_code: payload?.coupon_code ?? null,
        status: 'pending',
        acceptance_status: 'pending_acceptance',
        change_amount: payload?.change_amount ?? null,
        order_type: payload?.order_type || 'delivery',
        delivery_instructions: payload?.delivery_instructions || null,
        estimated_time: payload?.estimated_time || null,
        customer_latitude: payload?.customer_latitude || null,
        customer_longitude: payload?.customer_longitude || null,
        customer_location_accuracy: payload?.customer_location_accuracy || null,
        google_maps_link: payload?.google_maps_link || null,
        scheduled_at: payload?.scheduled_at || null,
        variations: payload?.variations || null
      }

      const { data: created, error: createErr } = await supabase
        .from('orders')
        .insert(insertData)
        .select('id')
        .single()

      if (createErr || !created?.id) {
        return new Response(JSON.stringify({ error: 'order_create_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      await supabase
        .from('pix_checkouts')
        .update({ status: 'PAID', order_id: created.id, updated_at: new Date().toISOString() })
        .eq('id', checkout.id)

      try {
        const loyaltyRewardId = String(payload?.loyalty_reward_id || '')
        if (loyaltyRewardId) {
          await markLoyaltyRewardUsedForOrder(supabase, {
            rewardId: loyaltyRewardId,
            orderId: created.id,
            userId: checkout.restaurant_user_id,
          })
        }
      } catch {}

      try {
        await notifyOrderCreated(supabase, { ...insertData, id: created.id })
      } catch (error) {
        console.error('[PixWebhook] Falha ao notificar pedido legado via WhatsApp:', error)
      }

      return new Response(JSON.stringify({ ok: true, orderId: created.id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'missing_order_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: order, error: getError } = await supabase
      .from('orders')
      .select('id, acceptance_status, user_id')
      .eq('id', orderId)
      .maybeSingle()

    if (getError) {
      return new Response(JSON.stringify({ error: 'order_lookup_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (!order) {
      return new Response(JSON.stringify({ error: 'order_not_found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (userIdFromSecret && order.user_id !== userIdFromSecret) {
      return new Response(JSON.stringify({ error: 'order_mismatch' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (order.acceptance_status === 'pending_acceptance' || order.acceptance_status === 'accepted') {
      return new Response(JSON.stringify({ ok: true, idempotent: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({ acceptance_status: 'pending_acceptance' })
      .eq('id', orderId)

    if (updateError) {
      return new Response(JSON.stringify({ error: 'update_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
