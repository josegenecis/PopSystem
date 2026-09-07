import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { perfStart } from '@/utils/perf';
import { hydrateSimpleVariationsCache, primeSimpleVariationPresence } from '@/hooks/useSimpleVariations';
import { enrichCategoryWithMetadata } from '@/lib/category-metadata';
import { applyEffectivePrices, type PricingChannel } from '@/services/pricingEngine';

interface Product {
  id: string;
  name: string;
  display_order?: number;
  description: string;
  price: number;
  original_price?: number;
  discount_percentage?: number;
  image_url?: string;
  is_available: boolean;
  show_in_delivery: boolean;
  is_highlight: boolean;
  highlight_order?: number;
  order_count: number;
  category_id: string;
  track_stock?: boolean;
  stock_quantity?: number;
  low_stock_threshold?: number;
  base_price?: number;
  effective_price?: number;
  price_table_id?: string | null;
  price_rule_id?: string | null;
  price_table_name?: string | null;
  price_source?: 'base' | 'price_table';
}

interface Category {
  id: string;
  name: string;
  description?: string;
  display_order: number;
  totem_image_url?: string;
  is_pizza?: boolean;
  pizza_half_price_mode?: 'highest' | 'split_halves';
}

interface RestaurantProfile {
  id: string;
  restaurant_name: string;
  description?: string;
  logo_url?: string;
  banner_url?: string;
  phone?: string;
  address?: string;
  opening_hours?: string;
  theme_config?: any;
}

interface DeliveryZone {
  id: string;
  name: string;
  delivery_fee: number;
  minimum_order: number;
  delivery_time: string;
  active: boolean;
}

type MenuPayload = {
  products: Product[];
  categories: Category[];
  profile: RestaurantProfile | null;
  deliveryZones: DeliveryZone[];
  deliverySettings: any;
};

interface MenuData {
  products: Product[];
  categories: Category[];
  highlights: Product[];
  profile: RestaurantProfile | null;
  deliveryZones: DeliveryZone[];
  deliverySettings: any;
  isLoading: boolean;
  error: string | null;
}

interface UseMenuDataOptions {
  userId: string;
  enableCache?: boolean;
  cacheTTL?: number;
  pricingChannel?: PricingChannel;
}

const CACHE_PREFIX = 'boracume_menu_data_v6';

function compareProductsByDisplayOrder(a: Product, b: Product) {
  const aOrder = a.display_order !== undefined && a.display_order !== null
    ? Number(a.display_order)
    : Number.MAX_SAFE_INTEGER;
  const bOrder = b.display_order !== undefined && b.display_order !== null
    ? Number(b.display_order)
    : Number.MAX_SAFE_INTEGER;

  if (aOrder !== bOrder) return aOrder - bOrder;
  return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function readCache(userId: string, pricingChannel: PricingChannel, cacheTTLMinutes: number) {
  try {
    const key = `${CACHE_PREFIX}_${userId}_${pricingChannel}`;
    const cached = safeParse<{ ts: number; data: MenuPayload }>(localStorage.getItem(key));
    if (!cached) return null;
    const ttlMs = Math.max(1, cacheTTLMinutes) * 60 * 1000;
    if (Date.now() - cached.ts > ttlMs) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function writeCache(userId: string, pricingChannel: PricingChannel, data: MenuPayload) {
  try {
    const key = `${CACHE_PREFIX}_${userId}_${pricingChannel}`;
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

async function fetchMenuDataFromApi(userId: string): Promise<MenuPayload | null> {
  const span = perfStart('menu.data.api', { userId });
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`/api/menu/public?userId=${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`menu_api_${res.status}`);

    const json = await res.json();
    if (!json?.ok) throw new Error(String(json?.error || 'menu_api_invalid'));

    hydrateSimpleVariationsCache(json?.variationPayloadByProduct, json?.variationPresenceByProduct);

    return {
      products: Array.isArray(json?.products) ? json.products : [],
      categories: Array.isArray(json?.categories) ? json.categories : [],
      profile: json?.profile || null,
      deliveryZones: Array.isArray(json?.deliveryZones) ? json.deliveryZones : [],
      deliverySettings: json?.deliverySettings || null
    };
  } finally {
    window.clearTimeout(timeoutId);
    span.end();
  }
}

async function fetchMenuDataDirect(userId: string): Promise<MenuPayload> {
  const span = perfStart('menu.data.fetch', { userId });
  try {
    const [{ data: profileArr, error: profileError }, { data: categoriesData, error: categoriesError }, { data: deliveryZonesData, error: deliveryZonesError }, { data: deliverySettingsData }] =
      await Promise.all([
        supabase
          .from('profiles')
          .select('id, restaurant_name, description, logo_url, banner_url, phone, address, opening_hours, theme_config')
          .eq('id', userId)
          .limit(1) as any,
        supabase
          .from('product_categories')
          .select('id, name, description, display_order, totem_image_url')
          .eq('user_id', userId)
          .eq('active', true)
          .order('display_order', { ascending: true }) as any,
        supabase
          .from('delivery_zones')
          .select('id, name, delivery_fee, minimum_order, delivery_time, active')
          .eq('user_id', userId)
          .eq('active', true)
          .order('name', { ascending: true }) as any,
        supabase
          .from('delivery_settings')
          .select('delivery_areas')
          .eq('user_id', userId)
          .maybeSingle() as any
      ]);

    const productSelectAttempts = [
      'id, name, description, price, original_price, discount_percentage, image_url, available, is_available, show_in_delivery, is_highlight, highlight_order, order_count, category_id, track_stock, stock_quantity, low_stock_threshold, display_order',
      'id, name, description, price, original_price, discount_percentage, image_url, available, show_in_delivery, is_highlight, highlight_order, order_count, category_id, track_stock, stock_quantity, low_stock_threshold, display_order',
      'id, name, description, price, original_price, discount_percentage, image_url, is_available, show_in_delivery, is_highlight, highlight_order, order_count, category_id, track_stock, stock_quantity, low_stock_threshold, display_order',
      'id, name, description, price, image_url, available, show_in_delivery, category_id, display_order'
    ];
    let productsData: any[] | null = null;
    let productsError: any = null;

    for (const selectClause of productSelectAttempts) {
      const res = await (supabase.from('products') as any)
        .select(selectClause)
        .eq('user_id', userId)
        .eq('show_in_delivery', true)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });
      productsData = res.data as any;
      productsError = res.error as any;
      if (!productsError) break;
    }

    if (profileError && (profileError as any)?.code !== 'PGRST116') {
      throw profileError;
    }
    if (categoriesError) throw categoriesError;
    if (productsError) throw productsError;
    if (deliveryZonesError) throw deliveryZonesError;

    const profileData = Array.isArray(profileArr) && profileArr.length > 0 ? (profileArr[0] as any) : null;
    const profile = profileData
      ? (profileData as RestaurantProfile)
      : ({
          id: userId,
          restaurant_name: 'Cardápio',
          description: '',
          logo_url: '',
          phone: '',
          address: '',
          opening_hours: ''
        } as RestaurantProfile);

    const activeCategoryIds = new Set(((categoriesData || []) as any[]).map((category) => String(category.id)));
    const visibleProducts = ((productsData || []) as any[])
      .filter((product) => {
        const available = product?.is_available !== undefined && product?.is_available !== null
          ? product.is_available
          : product?.available;
        const categoryId = String(product?.category_id || '').trim();
        return available !== false && (!categoryId || activeCategoryIds.has(categoryId));
      })
      .map((product) => ({
        ...product,
        is_available: product?.is_available !== undefined && product?.is_available !== null
          ? product.is_available
          : product?.available !== false
      }));

    return {
      products: visibleProducts as any,
      categories: ((categoriesData || []) as any[]).map((category) => enrichCategoryWithMetadata(category)) as any,
      profile,
      deliveryZones: (deliveryZonesData || []) as any,
      deliverySettings: deliverySettingsData?.delivery_areas || null
    };
  } finally {
    span.end();
  }
}

async function fetchMenuData(userId: string, pricingChannel: PricingChannel): Promise<MenuPayload> {
  try {
    const fromApi = await fetchMenuDataFromApi(userId);
    if (fromApi) return { ...fromApi, products: await applyEffectivePrices(fromApi.products, userId, pricingChannel) };
  } catch {}

  const direct = await fetchMenuDataDirect(userId);
  return { ...direct, products: await applyEffectivePrices(direct.products, userId, pricingChannel) };
}

export const useMenuData = ({ userId, enableCache = false, cacheTTL = 1, pricingChannel = 'delivery' }: UseMenuDataOptions): MenuData => {
  const queryClient = useQueryClient();
  const recoverAttemptRef = useRef(false);

  const initialData = enableCache && userId ? readCache(userId, pricingChannel, cacheTTL) : null;

  const query = useQuery({
    queryKey: ['menuData', userId, pricingChannel],
    enabled: Boolean(userId),
    queryFn: () => fetchMenuData(userId, pricingChannel),
    staleTime: 5 * 60 * 1000,
    gcTime: Math.max(60 * 60 * 1000, cacheTTL * 60 * 1000),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: (attempt) => Math.min(2000, 250 * Math.pow(2, attempt)),
    initialData: initialData || undefined
  });
  const refetch = query.refetch;

  useEffect(() => {
    if (!userId || !enableCache) return;
    if (!query.data) return;
    const nextCount = Array.isArray(query.data.products) ? query.data.products.length : 0;
    const prevCount = Array.isArray(initialData?.products) ? initialData!.products.length : 0;
    if (nextCount === 0 && prevCount > 0) return;
    writeCache(userId, pricingChannel, query.data);
  }, [userId, pricingChannel, enableCache, query.data, initialData]);

  useEffect(() => {
    if (!userId) return;
    if (recoverAttemptRef.current) return;
    if (!query.isSuccess) return;
    const nextCount = Array.isArray(query.data?.products) ? query.data!.products.length : 0;
    const prevCount = Array.isArray(initialData?.products) ? initialData!.products.length : 0;
    if (!(nextCount === 0 && prevCount > 0)) return;

    recoverAttemptRef.current = true;
      queryClient.setQueryData(['menuData', userId, pricingChannel], initialData);
    void supabase.auth.refreshSession().finally(() => {
      void refetch();
    });
  }, [userId, pricingChannel, query.isSuccess, query.data, queryClient, initialData, refetch]);

  useEffect(() => {
    if (!userId) return;
    if (!query.isSuccess) return;
    const products: any[] = query.data?.products || [];
    if (!Array.isArray(products) || products.length === 0) return;
    const ids = products.map((p: any) => String(p?.id || '').trim()).filter(Boolean);
    void primeSimpleVariationPresence(ids);
  }, [userId, query.isSuccess, query.data]);

  useEffect(() => {
    if (!userId) return;

    const patch = (updater: (prev: MenuPayload) => MenuPayload) => {
      queryClient.setQueryData(['menuData', userId, pricingChannel], (prev: MenuPayload | undefined) => {
        const base: MenuPayload = prev || { products: [], categories: [], profile: null, deliveryZones: [], deliverySettings: null };
        return updater(base);
      });
    };

    const channel = supabase
      .channel(`menu-data:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `user_id=eq.${userId}` }, (payload: any) => {
        patch((prev) => {
          const next = [...(prev.products || [])];
          const eventType = String(payload.eventType || '').toUpperCase();
          const newRow = payload.new || null;
          const oldRow = payload.old || null;
          const id = String((newRow && newRow.id) || (oldRow && oldRow.id) || '');
          if (!id) return prev;

          if (eventType === 'DELETE') {
            return { ...prev, products: next.filter((p: any) => String(p.id) !== id) };
          }

          const available = newRow?.is_available !== undefined && newRow?.is_available !== null
            ? newRow.is_available
            : newRow?.available;
          const activeCategoryIds = new Set((prev.categories || []).map((category: any) => String(category.id)));
          const categoryId = String(newRow?.category_id || '').trim();
          const include = available !== false && Boolean(newRow?.show_in_delivery) && (!categoryId || activeCategoryIds.has(categoryId));
          const idx = next.findIndex((p: any) => String(p.id) === id);
          if (!include) {
            if (idx >= 0) next.splice(idx, 1);
            return { ...prev, products: next };
          }

          if (idx >= 0) next[idx] = { ...next[idx], ...newRow };
          else next.unshift(newRow);

          next.sort(compareProductsByDisplayOrder);
          return { ...prev, products: next as any };
        });
        void queryClient.invalidateQueries({ queryKey: ['menuData', userId, pricingChannel] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_categories', filter: `user_id=eq.${userId}` }, (payload: any) => {
        patch((prev) => {
          const next = [...(prev.categories || [])];
          const eventType = String(payload.eventType || '').toUpperCase();
          const newRow = payload.new || null;
          const oldRow = payload.old || null;
          const id = String((newRow && newRow.id) || (oldRow && oldRow.id) || '');
          if (!id) return prev;

          if (eventType === 'DELETE') {
            return { ...prev, categories: next.filter((c: any) => String(c.id) !== id) };
          }

          const include = Boolean(newRow?.active);
          const idx = next.findIndex((c: any) => String(c.id) === id);
          if (!include) {
            const products = (prev.products || []).filter((product: any) => String(product?.category_id || '') !== id);
            if (idx >= 0) next.splice(idx, 1);
            return { ...prev, categories: next as any, products };
          }

          if (idx >= 0) next[idx] = { ...next[idx], ...newRow };
          else next.push(newRow);

          next.sort((a: any, b: any) => Number(a.display_order || 0) - Number(b.display_order || 0));
          return { ...prev, categories: next as any };
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, (payload: any) => {
        patch((prev) => ({ ...prev, profile: payload.new || prev.profile }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_settings', filter: `user_id=eq.${userId}` }, (payload: any) => {
        patch((prev) => ({ ...prev, deliverySettings: payload.new?.delivery_areas || null }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_zones', filter: `user_id=eq.${userId}` }, (payload: any) => {
        patch((prev) => {
          const next = [...(prev.deliveryZones || [])];
          const eventType = String(payload.eventType || '').toUpperCase();
          const newRow = payload.new || null;
          const oldRow = payload.old || null;
          const id = String((newRow && newRow.id) || (oldRow && oldRow.id) || '');
          if (!id) return prev;

          if (eventType === 'DELETE') {
            return { ...prev, deliveryZones: next.filter((z: any) => String(z.id) !== id) };
          }

          const include = Boolean(newRow?.active);
          const idx = next.findIndex((z: any) => String(z.id) === id);
          if (!include) {
            if (idx >= 0) next.splice(idx, 1);
            return { ...prev, deliveryZones: next as any };
          }

          if (idx >= 0) next[idx] = { ...next[idx], ...newRow };
          else next.push(newRow);

          next.sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
          return { ...prev, deliveryZones: next as any };
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'price_tables', filter: `user_id=eq.${userId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['menuData', userId, pricingChannel] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'price_table_items', filter: `user_id=eq.${userId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['menuData', userId, pricingChannel] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, pricingChannel, queryClient]);

  const payload = query.data || { products: [], categories: [], profile: null, deliveryZones: [], deliverySettings: null };

  const highlights = useMemo(() => {
    return (payload.products || [])
      .filter((p: any) => p.is_highlight)
      .sort((a: any, b: any) => {
        const ao = a.highlight_order !== undefined && a.highlight_order !== null ? Number(a.highlight_order) : 10_000;
        const bo = b.highlight_order !== undefined && b.highlight_order !== null ? Number(b.highlight_order) : 10_000;
        if (ao !== bo) return ao - bo;
        return Number(b.order_count || 0) - Number(a.order_count || 0);
      })
      .slice(0, 6);
  }, [payload.products]);

  const error = query.error ? String((query.error as any)?.message || 'Erro ao carregar cardápio.') : null;
  const isLoading = Boolean(userId) && query.isLoading && !initialData;

  return {
    products: payload.products || [],
    categories: payload.categories || [],
    highlights,
    profile: payload.profile,
    deliveryZones: payload.deliveryZones || [],
    deliverySettings: payload.deliverySettings || null,
    isLoading,
    error
  };
};
