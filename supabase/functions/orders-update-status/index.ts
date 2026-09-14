// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  getUserIfoodSettings,
  requestIfoodOrderAction,
} from '../_shared/ifood.ts'
import { notifyOrderStatus } from '../_shared/restaurant-whatsapp.ts'
import { processLoyaltyForOrder } from '../_shared/loyalty.ts'
import { resolveStoreUserId } from '../_shared/multi-store.ts'

export const config = { runtime: 'edge', verify_jwt: false }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const getEnv = (...keys: string[]) => {
  for (const key of keys) {
    const value = Deno.env.get(key)
    if (value) return value
  }
  return ''
}

const ok = (payload: any) =>
  new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders })

const errInfo = (e: any) => {
  if (!e) return null
  return {
    message: e.message,
    code: e.code,
    details: e.details,
    hint: e.hint,
    status: e.status
  }
}

const parseItems = (raw: any): any[] => {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw)
      return Array.isArray(j) ? j : []
    } catch {
      return []
    }
  }
  return []
}

const applyStockForOrder = async (supabase: any, order: any) => {
  const items = parseItems(order?.items)
  if (!items.length) return { updated: 0, disabled: 0 }

  let updatedCount = 0
  let disabledCount = 0
  const grouped = new Map<string, number>()

  for (const item of items) {
    const productId = String(item?.product_id || item?.id || '')
    const qty = Math.max(0, parseInt(String(item?.quantity || '0'), 10) || 0)
    if (!productId || qty <= 0) continue
    grouped.set(productId, (grouped.get(productId) || 0) + qty)
  }

  for (const [productId, qty] of grouped.entries()) {
    const { data: existingMovement } = await supabase
      .from('inventory_movements')
      .select('id')
      .eq('user_id', order.user_id)
      .eq('order_id', order.id)
      .eq('product_id', productId)
      .eq('type', 'sale')
      .maybeSingle()

    if (existingMovement?.id) continue

    const { data: product, error: pErr } = await supabase
      .from('products')
      .select('id, user_id, track_stock, stock_quantity, show_in_delivery, available, is_available')
      .eq('id', productId)
      .eq('user_id', order.user_id)
      .maybeSingle()

    if (pErr || !product) continue
    if (!product.track_stock) continue

    const { error: movementErr } = await supabase
      .from('inventory_movements')
      .insert({
        user_id: order.user_id,
        product_id: productId,
        order_id: order.id,
        type: 'sale',
        quantity: -qty
      })

    if (movementErr) continue

    const currentQty = Math.max(0, parseInt(String(product.stock_quantity || 0), 10) || 0)
    const nextQty = Math.max(0, currentQty - qty)

    const updateData: any = { stock_quantity: nextQty }
    if (nextQty <= 0) {
      updateData.show_in_delivery = false
      updateData.available = false
      updateData.is_available = false
    }

    const { error: uErr } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', productId)
      .eq('user_id', order.user_id)

    if (!uErr) {
      updatedCount += 1
      if (nextQty <= 0) disabledCount += 1
    }
  }

  return { updated: updatedCount, disabled: disabledCount }
}

const restoreStockForCancelledOrder = async (supabase: any, order: any) => {
  const { data: saleMovements, error } = await supabase
    .from('inventory_movements')
    .select('product_id, quantity')
    .eq('user_id', order.user_id)
    .eq('order_id', order.id)
    .eq('type', 'sale')

  if (error || !Array.isArray(saleMovements) || saleMovements.length === 0) {
    return { restored: 0, skipped: true }
  }

  const { data: returnMovements } = await supabase
    .from('inventory_movements')
    .select('product_id, quantity')
    .eq('user_id', order.user_id)
    .eq('order_id', order.id)
    .eq('type', 'return')

  const returnedByProduct = new Map<string, number>()
  for (const movement of returnMovements || []) {
    const productId = String(movement?.product_id || '')
    const qty = Math.max(0, Number(movement?.quantity || 0))
    if (!productId || qty <= 0) continue
    returnedByProduct.set(productId, (returnedByProduct.get(productId) || 0) + qty)
  }

  const soldByProduct = new Map<string, number>()
  for (const movement of saleMovements) {
    const productId = String(movement?.product_id || '')
    const qty = Math.abs(Number(movement?.quantity || 0))
    if (!productId || qty <= 0) continue
    soldByProduct.set(productId, (soldByProduct.get(productId) || 0) + qty)
  }

  let restored = 0
  for (const [productId, soldQty] of soldByProduct.entries()) {
    const pendingQty = Math.max(0, soldQty - (returnedByProduct.get(productId) || 0))
    if (pendingQty <= 0) continue

    const { data: product } = await supabase
      .from('products')
      .select('id, stock_quantity, track_stock')
      .eq('id', productId)
      .eq('user_id', order.user_id)
      .maybeSingle()

    if (!product?.track_stock) continue

    const nextQty = Math.max(0, Number(product.stock_quantity || 0)) + pendingQty
    const { error: updateError } = await supabase
      .from('products')
      .update({
        stock_quantity: nextQty,
        available: true,
        is_available: true,
        show_in_delivery: true
      })
      .eq('id', productId)
      .eq('user_id', order.user_id)

    if (updateError) continue

    await supabase
      .from('inventory_movements')
      .insert({
        user_id: order.user_id,
        product_id: productId,
        order_id: order.id,
        type: 'return',
        quantity: pendingQty
      })

    restored += 1
  }

  return { restored, skipped: false }
}

const createAutomaticDeliveryOffer = async (supabase: any, order: any, newStatus: string) => {
  if (newStatus !== 'preparing' || String(order?.order_type || '') !== 'delivery') {
    return { ok: true, skipped: true, reason: 'not_accepted_delivery' }
  }

  const { data: assigned } = await supabase
    .from('delivery_assignments')
    .select('id')
    .eq('order_id', order.id)
    .maybeSingle()
  if (assigned?.id) return { ok: true, skipped: true, reason: 'already_assigned' }

  const { count: enabledDrivers } = await supabase
    .from('delivery_personnel')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', order.user_id)
    .eq('app_enabled', true)
  if (!enabledDrivers) return { ok: true, skipped: true, reason: 'no_app_drivers' }

  const now = new Date().toISOString()
  await supabase
    .from('delivery_offers')
    .update({ status: 'expired', updated_at: now })
    .eq('order_id', order.id)
    .eq('status', 'open')
    .lte('expires_at', now)

  const { data: existingOffer } = await supabase
    .from('delivery_offers')
    .select('id')
    .eq('order_id', order.id)
    .eq('status', 'open')
    .maybeSingle()
  if (existingOffer?.id) return { ok: true, skipped: true, reason: 'already_offered', offerId: existingOffer.id }

  const { data: settings } = await supabase
    .from('delivery_settlement_settings')
    .select('payout_mode,fixed_payout')
    .eq('user_id', order.user_id)
    .maybeSingle()
  const payoutAmount = String(settings?.payout_mode || 'delivery_fee') === 'fixed'
    ? Math.max(0, Number(settings?.fixed_payout) || 0)
    : Math.max(0, Number(order?.delivery_fee) || 0)

  const { data: offer, error } = await supabase
    .from('delivery_offers')
    .insert({
      restaurant_id: order.user_id,
      order_id: order.id,
      target_driver_id: null,
      payout_amount: payoutAmount,
      status: 'open',
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if (String(error?.code || '') === '23505') return { ok: true, skipped: true, reason: 'already_offered' }
    return { ok: false, error: String(error?.message || error) }
  }

  return { ok: true, created: true, offerId: offer?.id || null, payoutAmount }
}

const runPostStatusTasks = async (supabase: any, updated: any, previousOrder: any, newStatus: string) => {
  const stockTask = (async () => {
    if (['preparing', 'ready', 'in_delivery', 'delivered', 'completed'].includes(newStatus)) {
      try {
        return await applyStockForOrder(supabase, updated)
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) }
      }
    }
    if (newStatus === 'cancelled' && String(previousOrder.status || '') !== 'cancelled') {
      try {
        return await restoreStockForCancelledOrder(supabase, updated)
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) }
      }
    }
    return { ok: true, skipped: true, reason: 'status_without_stock_change' }
  })()

  const whatsappTask = notifyOrderStatus(supabase, updated, newStatus)
    .catch((e: any) => ({ ok: false, error: String(e?.message || e) }))

  const deliveryOfferTask = createAutomaticDeliveryOffer(supabase, updated, newStatus)
    .catch((e: any) => ({ ok: false, error: String(e?.message || e) }))

  const loyaltyTask = (newStatus === 'delivered' || newStatus === 'completed')
    ? processLoyaltyForOrder(supabase, updated)
        .catch((e: any) => ({ ok: false, error: String(e?.message || e) }))
    : Promise.resolve({ ok: true, skipped: true, reason: 'status_without_loyalty_change' })

  const [stock, whatsapp, deliveryOffer, loyalty] = await Promise.all([
    stockTask,
    whatsappTask,
    deliveryOfferTask,
    loyaltyTask,
  ])

  return { stock, whatsapp, deliveryOffer, loyalty }
}

const callIfoodForStatus = async (supabase: any, order: any, newStatus: string, payload: any) => {
  const variations = order?.variations && typeof order.variations === 'object'
    ? order.variations
    : {}
  const ifoodData = variations?.ifood || {}
  const ifoodOrderId = String(variations?.externalOrderId || ifoodData?.id || '').trim()

  if (String(variations?.provider || '') !== 'ifood' || !ifoodOrderId) {
    return { ok: true, skipped: true }
  }

  const settings = await getUserIfoodSettings(supabase, String(order.user_id || ''))
  if (!settings?.client_id || !settings?.client_secret) {
    throw new Error('Credenciais do iFood não configuradas para esta loja')
  }

  const deliveredBy = String(ifoodData?.deliveredBy || '').toUpperCase()

  if (newStatus === 'preparing') {
    return await requestIfoodOrderAction(supabase, settings, ifoodOrderId, 'confirm')
  }

  if (newStatus === 'ready') {
    if (String(order?.order_type || '') !== 'delivery' || deliveredBy === 'IFOOD') {
      return await requestIfoodOrderAction(supabase, settings, ifoodOrderId, 'readyToPickup')
    }
    return { ok: true, skipped: true }
  }

  if (newStatus === 'in_delivery') {
    if (deliveredBy !== 'MERCHANT') {
      return { ok: true, skipped: true, reason: 'ifood_delivery' }
    }
    return await requestIfoodOrderAction(
      supabase,
      settings,
      ifoodOrderId,
      'dispatch',
      { deliveredBy: 'MERCHANT' },
    )
  }

  if (newStatus === 'cancelled') {
    const cancellationCode = String(payload?.ifoodCancellationCode || '').trim()
    if (!cancellationCode) {
      throw new Error('ifood_cancel_reason_required')
    }

    return await requestIfoodOrderAction(
      supabase,
      settings,
      ifoodOrderId,
      'requestCancellation',
      { reason: cancellationCode },
    )
  }

  return { ok: true, skipped: true }
}

const getAuthUserId = async (req: Request): Promise<string> => {
  const supabaseUrl = getEnv('SUPABASE_URL', 'BORACUME_SUPABASE_URL')
  const anonKey = getEnv('SUPABASE_ANON_KEY', 'BORACUME_SUPABASE_ANON_KEY')
  const authHeader = req.headers.get('authorization') || ''

  if (!supabaseUrl || !anonKey || !authHeader) return ''

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data, error } = await authClient.auth.getUser()
  if (error) return ''
  return data?.user?.id || ''
}

const createServiceClient = async (supabaseUrl: string) => {
  const keys = [
    getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    getEnv('BORACUME_SERVICE_ROLE_KEY'),
    getEnv('SERVICE_ROLE_KEY'),
  ].filter(Boolean)

  if (!keys.length) return { client: null, error: 'missing_env' }

  for (const key of keys) {
    const client = createClient(supabaseUrl, String(key), { auth: { persistSession: false } })
    const { error } = await client.from('orders').select('id').limit(1)
    if (!error) return { client, error: null }
    const msg = String(error?.message || '').toLowerCase()
    if (msg.includes('invalid api key') || msg.includes('jwt') || error?.status === 401 || error?.status === 403) {
      continue
    }
    return { client, error }
  }

  return { client: null, error: 'invalid_service_key' }
}

const authorizeFinancialCancellation = async (
  supabase: any,
  order: any,
  userId: string,
  payload: any,
) => {
  const reason = String(payload?.reason || '').trim()
  const adminPin = String(payload?.adminPin || '').trim()
  if (!reason) return { ok: false, error: 'cancellation_reason_required' }
  if (!adminPin) return { ok: false, error: 'admin_pin_required' }

  const { data: openSession, error: sessionError } = await supabase
    .from('cash_register_sessions')
    .select('id, opened_at, status')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessionError) {
    return { ok: false, error: 'db_error', details: errInfo(sessionError) }
  }
  if (!openSession?.id) return { ok: false, error: 'open_cash_required' }

  const linkedSessionId = String(order?.cash_register_session_id || '')
  const belongsToOpenSession = linkedSessionId
    ? linkedSessionId === String(openSession.id)
    : new Date(order?.created_at || 0).getTime() >= new Date(openSession.opened_at).getTime()

  if (!belongsToOpenSession) {
    return { ok: false, error: 'historical_sale_cancellation_blocked' }
  }

  const { data: matchingWaiters, error: waiterError } = await supabase
    .from('waiters')
    .select('id, name, role, permissions, active')
    .eq('user_id', userId)
    .eq('active', true)
    .eq('pin', adminPin)
    .limit(10)

  if (waiterError) {
    return { ok: false, error: 'db_error', details: errInfo(waiterError) }
  }

  const administrator = (matchingWaiters || []).find((waiter: any) => (
    String(waiter?.role || '').toLowerCase() === 'admin' ||
    waiter?.permissions?.admin === true
  ))
  if (!administrator?.id) return { ok: false, error: 'invalid_admin_pin' }

  return {
    ok: true,
    reason,
    sessionId: String(openSession.id),
    administrator,
    refundRequested: payload?.refundRequested === true,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = getEnv('SUPABASE_URL', 'BORACUME_SUPABASE_URL')
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', 'BORACUME_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceKey) return ok({ ok: false, error: 'missing_env' })

    const authenticatedUserId = await getAuthUserId(req)
    if (!authenticatedUserId) return ok({ ok: false, error: 'unauthorized' })

    const body = await req.json().catch(() => ({}))
    const requestStartedAt = Date.now()
    const orderId = String(body?.orderId || '')
    const newStatus = String(body?.newStatus || '')
    const operationId = String(body?.operationId || crypto.randomUUID())

    const validStatuses = ['pending', 'preparing', 'ready', 'in_delivery', 'delivered', 'completed', 'cancelled']
    if (!orderId || !validStatuses.includes(newStatus)) {
      return ok({ ok: false, error: 'invalid_payload' })
    }

    const svc = await createServiceClient(supabaseUrl)
    if (svc.error) return ok({ ok: false, error: 'missing_env', details: svc.error })
    const supabase = svc.client
    let userId = authenticatedUserId
    try {
      userId = await resolveStoreUserId(supabase, authenticatedUserId, body?._storeId)
    } catch {
      return ok({ ok: false, error: 'forbidden' })
    }

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle()

    if (orderErr) return ok({ ok: false, error: 'db_error', details: errInfo(orderErr) })
    if (!order) return ok({ ok: false, error: 'not_found' })

    if (String(order.user_id) !== userId) {
      return ok({ ok: false, error: 'forbidden' })
    }

    let financialAuthorization: any = null
    if (newStatus === 'cancelled' && body?.financialCancellation) {
      financialAuthorization = await authorizeFinancialCancellation(
        supabase,
        order,
        userId,
        body.financialCancellation,
      )
      if (!financialAuthorization?.ok) return ok(financialAuthorization)
    }

    const alreadyApplied =
      String(order.status || '') === newStatus &&
      (newStatus !== 'preparing' || String(order.acceptance_status || '') === 'accepted') &&
      (newStatus !== 'cancelled' || String(order.acceptance_status || '') === 'rejected')

    // Aceites repetidos (duplo clique, retry ou resposta perdida) não podem
    // repetir confirmação no iFood, WhatsApp, impressão lógica ou estoque.
    if (alreadyApplied) {
      return ok({
        ok: true,
        order,
        idempotent: true,
        operationId,
        stock: { skipped: true, reason: 'status_already_applied' },
        whatsapp: { skipped: true, reason: 'status_already_applied' },
        deliveryOffer: { skipped: true, reason: 'status_already_applied' },
        loyalty: { skipped: true, reason: 'status_already_applied' },
      })
    }

    try {
      await callIfoodForStatus(supabase, order, newStatus, body)
    } catch (e: any) {
      return ok({ ok: false, error: 'ifood_action_failed', details: { message: String(e?.message || e) } })
    }

    const updateData =
      newStatus === 'preparing'
        ? { status: newStatus, acceptance_status: 'accepted' }
        : newStatus === 'cancelled'
          ? { status: newStatus, acceptance_status: 'rejected' }
          : { status: newStatus }

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select('*')
      .single()

    if (updateErr) return ok({ ok: false, error: 'db_error', details: errInfo(updateErr) })

    if (financialAuthorization?.ok) {
      const { error: auditError } = await supabase
        .from('finance_sale_cancellations')
        .insert({
          user_id: userId,
          order_id: order.id,
          cash_register_session_id: financialAuthorization.sessionId,
          original_status: String(order.status || ''),
          order_snapshot: order,
          amount: Number(order.total || 0),
          payment_method: String(order.payment_method || ''),
          reason: financialAuthorization.reason,
          authorized_waiter_id: financialAuthorization.administrator.id,
          authorized_waiter_name: financialAuthorization.administrator.name,
          created_by: authenticatedUserId,
          refund_requested: financialAuthorization.refundRequested,
          refund_status: financialAuthorization.refundRequested ? 'pending' : 'not_requested',
          operation_id: operationId,
        })

      if (auditError && String(auditError?.code || '') !== '23505') {
        await supabase
          .from('orders')
          .update({
            status: order.status,
            acceptance_status: order.acceptance_status,
          })
          .eq('id', orderId)
        return ok({ ok: false, error: 'cancellation_audit_failed', details: errInfo(auditError) })
      }
    }

    const postStatusTask = runPostStatusTasks(supabase, updated, order, newStatus)
    const edgeRuntime = (globalThis as any).EdgeRuntime
    let postStatusResult: any = null

    if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
      edgeRuntime.waitUntil(
        postStatusTask
          .then((result) => {
            console.log('[orders-update-status] post-processing completed', {
              orderId,
              newStatus,
              operationId,
              result,
            })
          })
          .catch((error) => {
            console.error('[orders-update-status] post-processing failed', {
              orderId,
              newStatus,
              operationId,
              error: String(error?.message || error),
            })
          }),
      )
    } else {
      postStatusResult = await postStatusTask
    }

    const queuedResult = { ok: true, queued: true }

    console.log('[orders-update-status] status persisted', {
      orderId,
      newStatus,
      operationId,
      elapsedMs: Date.now() - requestStartedAt,
      postProcessingQueued: !postStatusResult,
    })

    return ok({
      ok: true,
      order: updated,
      stock: postStatusResult?.stock || queuedResult,
      whatsapp: postStatusResult?.whatsapp || queuedResult,
      deliveryOffer: postStatusResult?.deliveryOffer || queuedResult,
      loyalty: postStatusResult?.loyalty || queuedResult,
      postProcessingQueued: !postStatusResult,
      idempotent: false,
      operationId,
    })
  } catch (e: any) {
    return ok({ ok: false, error: 'internal_error', message: String(e?.message || e) })
  }
})
