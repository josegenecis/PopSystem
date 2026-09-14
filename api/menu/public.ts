import { createClient } from '@supabase/supabase-js';
import { enrichCategoryWithMetadata } from '../../src/lib/category-metadata.js';
import { getSupabaseRuntimeEnv } from '../_lib/runtime-env.js';

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = getSupabaseRuntimeEnv();

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function buildLinkedGlobalVariation(link: any, globalVariation: any) {
  if (!link || !globalVariation) return null;

  const required =
    link.required !== undefined && link.required !== null ? Boolean(link.required) : Boolean(globalVariation.required);
  const minSelections =
    link.min_selections !== undefined && link.min_selections !== null
      ? Number(link.min_selections) || 0
      : Number(globalVariation.min_selections) || 0;
  const maxSelections =
    link.max_selections !== undefined && link.max_selections !== null
      ? Number(link.max_selections) || 1
      : Number(globalVariation.max_selections) || 1;

  return {
    ...globalVariation,
    required,
    min_selections: Math.max(0, minSelections),
    max_selections: Math.max(1, maxSelections),
    free_selections_limit: Number(link.free_selections_limit) || 0,
    allow_paid_excess: Boolean(link.allow_paid_excess),
    paid_max_selections:
      link.paid_max_selections !== undefined && link.paid_max_selections !== null
        ? Number(link.paid_max_selections) || Math.max(1, maxSelections)
        : null,
    display_order: link.display_order,
    pricing_mode: link.pricing_mode ?? 'default',
    price_multiplier: link.price_multiplier ?? 1,
    fixed_option_price: link.fixed_option_price ?? null,
    option_price_overrides: link.option_price_overrides ?? {},
  };
}

async function fetchProducts(userId: string) {
  const selectAttempts = [
    'id,name,description,price,original_price,discount_percentage,image_url,available,is_available,show_in_delivery,is_highlight,highlight_order,order_count,category_id,track_stock,stock_quantity,low_stock_threshold,display_order',
    'id,name,description,price,original_price,discount_percentage,image_url,available,show_in_delivery,is_highlight,highlight_order,order_count,category_id,track_stock,stock_quantity,low_stock_threshold,display_order',
    'id,name,description,price,original_price,discount_percentage,image_url,is_available,show_in_delivery,is_highlight,highlight_order,order_count,category_id,track_stock,stock_quantity,low_stock_threshold,display_order',
    'id,name,description,price,image_url,available,show_in_delivery,category_id,display_order'
  ];

  let lastError: any = null;
  for (const selectClause of selectAttempts) {
    const result = await supabase
      .from('products')
      .select(selectClause)
      .eq('user_id', userId)
      .eq('show_in_delivery', true)
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });

    if (!result.error) {
      return (Array.isArray(result.data) ? result.data : [])
        .filter((product: any) => {
          const available = product?.is_available !== undefined && product?.is_available !== null
            ? product.is_available
            : product?.available;
          return available !== false;
        })
        .map((product: any) => ({
          ...product,
          is_available: product?.is_available !== undefined && product?.is_available !== null
            ? product.is_available
            : product?.available !== false
        }));
    }

    lastError = result.error;
  }

  throw lastError;
}

async function fetchMenuPayload(userId: string) {
  const [profileResult, categoriesResult, deliveryZonesResult, deliverySettingsResult, products] = await Promise.all([
    supabase
      .from('profiles')
      .select('id,restaurant_name,description,logo_url,banner_url,phone,address,opening_hours,theme_config')
      .eq('id', userId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('product_categories')
      .select('id,name,description,display_order,totem_image_url')
      .eq('user_id', userId)
      .eq('active', true)
      .order('display_order', { ascending: true }),
    supabase
      .from('delivery_zones')
      .select('id,name,delivery_fee,minimum_order,delivery_time,active')
      .eq('user_id', userId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('delivery_settings')
      .select('delivery_areas')
      .eq('user_id', userId)
      .maybeSingle(),
    fetchProducts(userId),
  ]);

  if (profileResult.error && profileResult.error.code !== 'PGRST116') throw profileResult.error;
  if (categoriesResult.error) throw categoriesResult.error;
  if (deliveryZonesResult.error) throw deliveryZonesResult.error;
  if (deliverySettingsResult.error) throw deliverySettingsResult.error;

  const activeCategoryIds = new Set((categoriesResult.data || []).map((category: any) => String(category.id)));
  const visibleProducts = products.filter((product: any) => {
    const categoryId = String(product?.category_id || '').trim();
    return !categoryId || activeCategoryIds.has(categoryId);
  });
  const productIds = visibleProducts.map((product: any) => String(product.id || '').trim()).filter(Boolean);

  let variationPayloadByProduct: Record<string, any[]> = {};
  let variationPresenceByProduct: Record<string, 'has' | 'none'> = {};

  if (productIds.length > 0) {
    const [specificResult, linkResult] = await Promise.all([
      supabase
        .from('product_variations')
        .select('product_id,id,name,required,max_selections,free_selections_limit,allow_paid_excess,paid_max_selections,active,options,customer_label,receipt_label,display_order,created_at')
        .in('product_id', productIds as any),
      supabase
        .from('product_global_variation_links')
        .select('product_id,global_variation_id,required,min_selections,max_selections,free_selections_limit,allow_paid_excess,paid_max_selections,display_order,pricing_mode,price_multiplier,fixed_option_price,option_price_overrides')
        .in('product_id', productIds as any)
        .order('display_order', { ascending: true }),
    ]);

    if (specificResult.error) throw specificResult.error;
    if (linkResult.error) throw linkResult.error;

    const specificByProduct = new Map<string, any[]>();
    for (const row of Array.isArray(specificResult.data) ? specificResult.data : []) {
      const productId = String((row as any)?.product_id || '').trim();
      if (!productId) continue;
      const current = specificByProduct.get(productId) || [];
      current.push(row);
      specificByProduct.set(productId, current);
    }

    const linksByProduct = new Map<string, any[]>();
    const globalIds = Array.from(
      new Set(
        (Array.isArray(linkResult.data) ? linkResult.data : [])
          .map((row: any) => String(row?.global_variation_id || '').trim())
          .filter(Boolean)
      )
    );

    for (const row of Array.isArray(linkResult.data) ? linkResult.data : []) {
      const productId = String((row as any)?.product_id || '').trim();
      if (!productId) continue;
      const current = linksByProduct.get(productId) || [];
      current.push(row);
      linksByProduct.set(productId, current);
    }

    let globalsById = new Map<string, any>();
    if (globalIds.length > 0) {
      const globalResult = await supabase
        .from('global_variations')
        .select('id,name,required,max_selections,active,options,customer_label,receipt_label')
        .in('id', globalIds as any);

      if (globalResult.error) throw globalResult.error;
      globalsById = new Map(
        (Array.isArray(globalResult.data) ? globalResult.data : []).map((row: any) => [String(row.id), row])
      );
    }

    for (const productId of productIds) {
      const specificRows = (specificByProduct.get(productId) || []).filter((item: any) => item?.active !== false);
      const globalRows = (linksByProduct.get(productId) || [])
        .map((link: any) => buildLinkedGlobalVariation(link, globalsById.get(String(link.global_variation_id))))
        .filter((item: any) => item && item.active !== false);

      const payload = [...specificRows, ...globalRows];
      variationPayloadByProduct[productId] = payload;
      variationPresenceByProduct[productId] = payload.length > 0 ? 'has' : 'none';
    }
  }

  return {
    ok: true,
    profile: profileResult.data || null,
    categories: (categoriesResult.data || []).map((category: any) => enrichCategoryWithMetadata(category)),
    products: visibleProducts,
    deliveryZones: deliveryZonesResult.data || [],
    deliverySettings: deliverySettingsResult.data?.delivery_areas || null,
    variationPayloadByProduct,
    variationPresenceByProduct,
  };
}

export default async function handler(req: any, res: any) {
  try {
    const userId = String(req?.query?.userId || req?.query?.id || '').trim();
    if (!userId) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'missing_userId' }));
      return;
    }

    const payload = await fetchMenuPayload(userId);

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('pragma', 'no-cache');
    res.setHeader('expires', '0');
    res.setHeader('surrogate-control', 'no-store');
    res.end(JSON.stringify(payload));
  } catch (error: any) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: String(error?.message || error || 'internal error') }));
  }
}
