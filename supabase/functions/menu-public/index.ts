// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const config = { runtime: 'edge' }

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!
const supabase = createClient(url, serviceKey)

export default async function handler(req: Request): Promise<Response> {
  // Add CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const { searchParams } = new URL(req.url)
  let userId = searchParams.get('userId')

  // Try to get userId from body if not in query params
  if (!userId && req.method === 'POST') {
    try {
      const body = await req.json()
      userId = body.userId
    } catch {}
  }

  if (!userId) return new Response(JSON.stringify({ ok: false, error: 'missing_userId' }), { status: 400, headers })

  try {
    const [profileResult, categoriesResult, productsResult, deliveryZonesResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, restaurant_name, description, logo_url, phone, address, opening_hours')
        .eq('id', userId)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('product_categories')
        .select('id, name, description, display_order')
        .eq('user_id', userId)
        .eq('active', true)
        .order('display_order', { ascending: true }),
      supabase
        .from('products')
        .select('*')
        .eq('user_id', userId)
        .eq('show_in_delivery', true)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true }),
      supabase
        .from('delivery_zones')
        .select('id, name, delivery_fee, minimum_order, delivery_time, active')
        .eq('user_id', userId)
        .eq('active', true)
        .order('name', { ascending: true })
    ])

    const activeCategoryIds = new Set((categoriesResult.data || []).map((category: any) => String(category.id)))
    const visibleProducts = (productsResult.data || []).filter((product: any) => {
      const available = product?.is_available !== undefined && product?.is_available !== null
        ? product.is_available
        : product?.available
      const categoryId = String(product?.category_id || '').trim()
      return available !== false && (!categoryId || activeCategoryIds.has(categoryId))
    })

    const responseData = {
      ok: true,
      profile: profileResult.data || null,
      categories: categoriesResult.data || [],
      products: visibleProducts,
      deliveryZones: deliveryZonesResult.data || []
    };

    return new Response(JSON.stringify(responseData), { headers })
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers })
  }
}
