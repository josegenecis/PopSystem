// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: corsHeaders })

const getEnv = (...keys: string[]) => {
  for (const key of keys) {
    const value = Deno.env.get(key)
    if (value) return value
  }
  return ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const orderId = String(body?.orderId || '').trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      return json({ ok: false, error: 'invalid_order_id' }, 400)
    }

    const url = getEnv('SUPABASE_URL', 'BORACUME_SUPABASE_URL')
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', 'BORACUME_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY')
    if (!url || !serviceKey) return json({ ok: false, error: 'missing_env' }, 500)

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { data: order, error } = await supabase
      .from('orders')
      .select('id,order_number,customer_name,customer_phone,order_type,status,acceptance_status,total,payment_method,created_at,estimated_time,user_id')
      .eq('id', orderId)
      .maybeSingle()

    if (error) {
      console.error('[public-order-tracking] query failed', { orderId, code: error.code, message: error.message })
      return json({ ok: false, error: 'query_failed' }, 500)
    }
    if (!order) return json({ ok: false, error: 'not_found' }, 404)
    return json({ ok: true, order })
  } catch (error: any) {
    console.error('[public-order-tracking] unexpected failure', { message: String(error?.message || error) })
    return json({ ok: false, error: 'internal_error' }, 500)
  }
})
