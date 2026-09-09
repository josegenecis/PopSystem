import { supabase } from '@/integrations/supabase/client';

export type PricingChannel = 'all' | 'pdv' | 'delivery' | 'waiter' | 'totem' | 'whatsapp' | 'dine_in' | 'pickup';

export type EffectivePriceMetadata = {
  base_price: number;
  effective_price: number;
  price_table_id: string | null;
  price_rule_id: string | null;
  price_table_name: string | null;
  price_source: 'base' | 'price_table';
  applied_discount_percentage: number | null;
};

export type PriceAwareProduct = {
  id: string;
  price: number;
  original_price?: number | null;
  discount_percentage?: number | null;
  [key: string]: unknown;
};

const baseMetadata = (product: PriceAwareProduct): EffectivePriceMetadata => ({
  base_price: Number(product.price || 0),
  effective_price: Number(product.price || 0),
  price_table_id: null,
  price_rule_id: null,
  price_table_name: null,
  price_source: 'base',
  applied_discount_percentage: null,
});

/**
 * Applies the winning price rule while keeping products.price as the permanent
 * fallback. Pricing failures must never stop a sale or hide a product.
 */
export async function applyEffectivePrices<T extends PriceAwareProduct>(
  products: T[],
  userId: string,
  channel: PricingChannel,
): Promise<Array<T & EffectivePriceMetadata>> {
  const fallback = products.map((product) => ({ ...product, ...baseMetadata(product) }));
  if (!userId || products.length === 0) return fallback;

  try {
    const { data, error } = await (supabase as any).rpc('resolve_product_prices', {
      p_user_id: userId,
      p_channel: channel,
      p_product_ids: products.map((product) => product.id),
      p_at: new Date().toISOString(),
    });
    if (error || !Array.isArray(data)) return fallback;

    const resolved = new Map<string, any>(data.map((row: any) => [String(row.product_id), row]));
    return products.map((product) => {
      const row = resolved.get(product.id);
      if (!row) return { ...product, ...baseMetadata(product) };
      const basePrice = Number(row.base_price ?? product.price ?? 0);
      const effectivePrice = Number(row.effective_price ?? basePrice);
      const hasRule = Boolean(row.price_rule_id);
      return {
        ...product,
        price: effectivePrice,
        original_price: hasRule && effectivePrice < basePrice ? basePrice : product.original_price,
        discount_percentage: hasRule && effectivePrice < basePrice
          ? Math.max(0, Number(row.discount_percentage ?? ((basePrice - effectivePrice) / Math.max(basePrice, 0.01)) * 100))
          : product.discount_percentage,
        base_price: basePrice,
        effective_price: effectivePrice,
        price_table_id: row.price_table_id || null,
        price_rule_id: row.price_rule_id || null,
        price_table_name: row.price_table_name || null,
        price_source: hasRule ? 'price_table' : 'base',
        applied_discount_percentage: row.discount_percentage == null ? null : Number(row.discount_percentage),
      };
    });
  } catch {
    return fallback;
  }
}
