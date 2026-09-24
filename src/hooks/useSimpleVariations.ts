import { useState } from 'react';
import { supabase } from '../integrations/supabase/client';
import { perfStart } from '@/utils/perf';
import { calculatePizzaFlavorPrice, isPizzaFlavorVariation, type PizzaCategoryConfig } from '@/lib/pizza-pricing';

type VariationOption = { name: string; price: number; base_price?: number; recommended?: boolean; active?: boolean };
type VariationPricingMode = 'default' | 'free' | 'half' | 'multiplier' | 'fixed';
type VariationOptionOverride = {
  price?: number;
  label?: string;
  hidden?: boolean;
  display_order?: number;
  recommended?: boolean;
};

export type Variation = {
  id: string;
  name: string;
  customer_label?: string;
  receipt_label?: string;
  display_order?: number;
  required: boolean;
  min_selections: number;
  max_selections: number;
  standard_max_selections: number;
  free_selections_limit: number;
  allow_paid_excess: boolean;
  paid_max_selections?: number;
  pricing_mode: VariationPricingMode;
  price_multiplier?: number;
  fixed_option_price?: number | null;
  option_price_overrides?: Record<string, VariationOptionOverride>;
  options: VariationOption[];
};

export type SelectedVariationDetail = {
  key: string;
  label: string;
  value: string;
  price: number;
};

type VariationPricingContext = {
  category?: PizzaCategoryConfig | null;
  pizzaFlavorCounts?: Record<string, number>;
};

export type VariationPresence = 'unknown' | 'none' | 'has';

const TTL_MS = 10 * 60 * 1000;
const LS_PREFIX = 'boracume_variations_v5:';
const LS_PRESENCE_PREFIX = 'boracume_variations_presence_v3:';
const cache = new Map<string, { ts: number; data: Variation[] }>();
const inflight = new Map<string, Promise<Variation[]>>();
const presenceCache = new Map<string, { ts: number; status: Exclude<VariationPresence, 'unknown'> }>();
const PRODUCT_VARIATION_SELECT = 'product_id,id,name,required,max_selections,free_selections_limit,allow_paid_excess,paid_max_selections,active,options,customer_label,receipt_label,display_order,created_at';
const GLOBAL_LINK_SELECT = 'product_id,global_variation_id,required,min_selections,max_selections,free_selections_limit,allow_paid_excess,paid_max_selections,display_order,pricing_mode,price_multiplier,fixed_option_price,option_price_overrides';
const GLOBAL_VARIATION_SELECT = 'id,name,required,max_selections,active,options,customer_label,receipt_label';

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries: number) {
  let lastErr: any = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(Math.min(1500, 200 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function parseOptions(raw: any): any[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      const names = String(raw).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      return names.map((name) => ({ name, price: 0 }));
    }
  }
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return Object.entries(raw).map(([name, price]) => ({ name, price: Number(price) || 0 }));
  return [];
}

function normalizeVariation(item: any): Variation | null {
  if (!item || !item.id) return null;
  const name = String(item.name || '').trim();
  if (!name) return null;
  const customerLabel = String(item.customer_label || '').trim();
  const receiptLabel = String(item.receipt_label || '').trim();
  const displayOrderRaw = item.display_order !== undefined && item.display_order !== null ? Number(item.display_order) : undefined;
  const displayOrder = displayOrderRaw !== undefined && Number.isFinite(displayOrderRaw) ? Math.max(0, Math.floor(displayOrderRaw)) : undefined;
  const maxSelections = item.max_selections !== undefined && item.max_selections !== null ? Math.max(1, Number(item.max_selections) || 1) : 1;
  const minSelectionsRaw = item.min_selections !== undefined && item.min_selections !== null ? Math.max(0, Number(item.min_selections) || 0) : 0;
  const allowPaidExcess = Boolean(item.allow_paid_excess);
  const paidMaxSelections = allowPaidExcess ? Math.max(maxSelections, Number(item.paid_max_selections) || maxSelections) : undefined;
  const effectiveMaxSelections = paidMaxSelections ?? maxSelections;
  const freeSelectionsLimit = Math.min(effectiveMaxSelections, Math.max(0, Number(item.free_selections_limit) || 0));
  const isActive = item.active !== false;
  const pricingMode = ['free', 'half', 'multiplier', 'fixed'].includes(String(item.pricing_mode || '').trim())
    ? String(item.pricing_mode || '').trim() as VariationPricingMode
    : 'default';
  const priceMultiplier = pricingMode === 'half'
    ? 0.5
    : pricingMode === 'multiplier'
      ? Math.max(0, Number(item.price_multiplier) || 1)
      : 1;
  const fixedOptionPrice = pricingMode === 'fixed'
    ? Math.max(0, Number(item.fixed_option_price) || 0)
    : null;
  const optionPriceOverrides = typeof item.option_price_overrides === 'object' && item.option_price_overrides
    ? Object.fromEntries(
        Object.entries(item.option_price_overrides).map(([name, value]) => {
          if (typeof value === 'number') return [String(name), { price: Math.max(0, Number(value) || 0) }];
          if (!value || typeof value !== 'object') return [String(name), {}];
          return [String(name), {
            ...(value.price !== undefined && value.price !== null ? { price: Math.max(0, Number(value.price) || 0) } : {}),
            ...(value.label ? { label: String(value.label).trim() } : {}),
            ...(value.hidden ? { hidden: true } : {}),
            ...(value.recommended ? { recommended: true } : {}),
            ...(value.display_order !== undefined && value.display_order !== null ? { display_order: Math.max(0, Math.floor(Number(value.display_order) || 0)) } : {})
          }];
        })
      )
    : {};
  const processedOptions = parseOptions(item.options);
  const validOptions: VariationOption[] = [];
  for (const opt of processedOptions as any[]) {
    if (!opt?.name) continue;
    const optionName = String(opt.name).trim();
    if (!optionName) continue;
    if (opt.active === false) continue;
    const optionBasePrice = opt.price !== undefined && opt.price !== null ? Number(opt.price) : 0;
    const safeBasePrice = Number.isFinite(optionBasePrice) ? Math.max(0, optionBasePrice) : 0;
    let adjustedPrice = safeBasePrice;
    const overrideConfig = optionPriceOverrides[optionName] || {};
    if (overrideConfig.hidden) continue;
    if (overrideConfig.price !== undefined) {
      adjustedPrice = overrideConfig.price;
    } else {
      if (pricingMode === 'free') adjustedPrice = 0;
      if (pricingMode === 'half') adjustedPrice = safeBasePrice * 0.5;
      if (pricingMode === 'multiplier') adjustedPrice = safeBasePrice * priceMultiplier;
      if (pricingMode === 'fixed') adjustedPrice = fixedOptionPrice ?? 0;
    }
    validOptions.push({
      name: String(overrideConfig.label || optionName).trim() || optionName,
      price: Number.isFinite(adjustedPrice) ? Math.max(0, adjustedPrice) : 0,
      base_price: safeBasePrice,
      ...(overrideConfig.recommended ? { recommended: true } : {}),
      ...(overrideConfig.display_order !== undefined ? { display_order: overrideConfig.display_order } : {})
    } as any);
  }
  const orderedOptions = validOptions
    .sort((a: any, b: any) => {
      const orderA = a?.display_order !== undefined ? Number(a.display_order) : Number.POSITIVE_INFINITY;
      const orderB = b?.display_order !== undefined ? Number(b.display_order) : Number.POSITIVE_INFINITY;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    })
    .map(({ display_order, ...option }: any) => option);
  if (orderedOptions.length === 0 || !isActive) return null;
  const required = Boolean(item.required ?? item.is_required ?? false);
  const minSelections = required ? Math.max(1, minSelectionsRaw) : minSelectionsRaw;
  return {
    id: String(item.id),
    name,
    customer_label: customerLabel || undefined,
    receipt_label: receiptLabel || undefined,
    display_order: displayOrder,
    required,
    min_selections: Math.min(minSelections, effectiveMaxSelections),
    max_selections: effectiveMaxSelections,
    standard_max_selections: maxSelections,
    free_selections_limit: freeSelectionsLimit,
    allow_paid_excess: allowPaidExcess,
    paid_max_selections: paidMaxSelections,
    pricing_mode: pricingMode,
    price_multiplier: priceMultiplier,
    fixed_option_price: fixedOptionPrice,
    option_price_overrides: optionPriceOverrides,
    options: orderedOptions
  };
}

function lsKey(productId: string) {
  return `${LS_PREFIX}${String(productId || '').trim()}`;
}

function lsPresenceKey(productId: string) {
  return `${LS_PRESENCE_PREFIX}${String(productId || '').trim()}`;
}

function loadFromLocalStorage(productId: string): { ts: number; data: Variation[] } | null {
  try {
    const raw = localStorage.getItem(lsKey(productId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed.ts !== 'number' || !Array.isArray(parsed.data)) return null;
    const ts = Number(parsed.ts);
    if (!Number.isFinite(ts)) return null;
    const data = (parsed.data || []).map((v: any) => normalizeVariation(v)).filter(Boolean) as Variation[];
    return { ts, data };
  } catch {
    return null;
  }
}

function loadPresenceFromLocalStorage(productId: string): { ts: number; status: Exclude<VariationPresence, 'unknown'> } | null {
  try {
    const raw = localStorage.getItem(lsPresenceKey(productId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    const status = parsed.status === 'has' || parsed.status === 'none' ? parsed.status : null;
    if (!status) return null;
    return { ts: Number(parsed.ts), status };
  } catch {
    return null;
  }
}

function saveToLocalStorage(productId: string, data: Variation[]) {
  try {
    const key = lsKey(productId);
    const payload = JSON.stringify({ ts: Date.now(), data });
    localStorage.setItem(key, payload);
  } catch {}
}

function savePresenceToLocalStorage(productId: string, status: Exclude<VariationPresence, 'unknown'>) {
  try {
    localStorage.setItem(lsPresenceKey(productId), JSON.stringify({ ts: Date.now(), status }));
  } catch {}
}

function clearVariationCache(productId: string) {
  const key = String(productId || '').trim();
  if (!key) return;
  cache.delete(key);
  try {
    localStorage.removeItem(lsKey(key));
  } catch {}
}

function clearVariationPresenceCache(productId: string) {
  const key = String(productId || '').trim();
  if (!key) return;
  presenceCache.delete(key);
  try {
    localStorage.removeItem(lsPresenceKey(key));
  } catch {}
}

export function invalidateSimpleVariationCaches(productId: string) {
  const key = String(productId || '').trim();
  if (!key) return;
  inflight.delete(key);
  clearVariationCache(key);
  clearVariationPresenceCache(key);
}

function setVariationPresence(productId: string, status: Exclude<VariationPresence, 'unknown'>) {
  const key = String(productId || '').trim();
  if (!key) return;
  const next = { ts: Date.now(), status };
  presenceCache.set(key, next);
  savePresenceToLocalStorage(key, status);
}

function sortVariations(variations: Variation[]) {
  return variations.sort((a, b) => {
    const ao = a.display_order !== undefined ? a.display_order : 10_000;
    const bo = b.display_order !== undefined ? b.display_order : 10_000;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

function storeVariationResult(productId: string, data: Variation[]) {
  const key = String(productId || '').trim();
  if (!key) return;
  const currentPresence = getSimpleVariationPresence(key);
  if (data.length === 0 && currentPresence !== 'none') {
    if (currentPresence === 'has') {
      setVariationPresence(key, 'has');
    }
    return;
  }
  cache.set(key, { ts: Date.now(), data });
  saveToLocalStorage(key, data);
  setVariationPresence(key, data.length > 0 ? 'has' : 'none');
}

export function hydrateSimpleVariationsCache(
  variationPayloadByProduct?: Record<string, any[] | null | undefined> | null,
  variationPresenceByProduct?: Record<string, Exclude<VariationPresence, 'unknown'> | null | undefined> | null
) {
  const ids = new Set<string>([
    ...Object.keys(variationPayloadByProduct || {}),
    ...Object.keys(variationPresenceByProduct || {})
  ]);

  for (const id of ids) {
    const rawPayload = variationPayloadByProduct?.[id];
    if (Array.isArray(rawPayload)) {
      const normalized = sortVariations(
        rawPayload
          .map((item: any) => normalizeVariation(item))
          .filter(Boolean) as Variation[]
      );
      storeVariationResult(id, normalized);
      continue;
    }

    const status = variationPresenceByProduct?.[id];
    if (status === 'has' || status === 'none') {
      setVariationPresence(id, status);
      if (status === 'none' && !hasFreshVariationCache(id)) {
        cache.set(id, { ts: Date.now(), data: [] });
        saveToLocalStorage(id, []);
      }
    }
  }
}

function buildLinkedGlobalVariation(link: any, globalVariation: any) {
  if (!link || !globalVariation) return null;
  const required = link.required !== undefined && link.required !== null ? Boolean(link.required) : Boolean(globalVariation.required);
  const minSelections = link.min_selections !== undefined && link.min_selections !== null
    ? Number(link.min_selections) || 0
    : Number(globalVariation.min_selections) || 0;
  const maxSelections = link.max_selections !== undefined && link.max_selections !== null
    ? Number(link.max_selections) || 1
    : Number(globalVariation.max_selections) || 1;

  return {
    ...globalVariation,
    required,
    min_selections: Math.max(0, minSelections),
    max_selections: Math.max(1, maxSelections),
    free_selections_limit: Number(link.free_selections_limit) || 0,
    allow_paid_excess: Boolean(link.allow_paid_excess),
    paid_max_selections: link.paid_max_selections !== undefined && link.paid_max_selections !== null
      ? Number(link.paid_max_selections) || Math.max(1, maxSelections)
      : null,
    display_order: link.display_order,
    pricing_mode: link.pricing_mode ?? 'default',
    price_multiplier: link.price_multiplier ?? 1,
    fixed_option_price: link.fixed_option_price ?? null,
    option_price_overrides: link.option_price_overrides ?? {}
  };
}

function hasFreshVariationCache(productId: string) {
  const key = String(productId || '').trim();
  if (!key) return false;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return true;
  const local = loadFromLocalStorage(key);
  if (local && Date.now() - local.ts < TTL_MS) {
    cache.set(key, local);
    return true;
  }
  return false;
}

export function getCachedSimpleVariations(productId: string): Variation[] {
  const key = String(productId || '').trim();
  if (!key) return [];
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;
  const local = loadFromLocalStorage(key);
  if (local && Date.now() - local.ts < TTL_MS) {
    cache.set(key, local);
    return local.data;
  }
  return [];
}

export function hasCachedSimpleVariationsResult(productId: string) {
  return hasFreshVariationCache(productId);
}

export function hasDefinitiveSimpleVariationsResult(productId: string) {
  const status = getSimpleVariationPresence(productId);
  if (status === 'none') return true;
  return getCachedSimpleVariations(productId).length > 0;
}

export function isSimpleVariationReady(productId: string) {
  return hasDefinitiveSimpleVariationsResult(productId);
}

export function getSimpleVariationPresence(productId: string): VariationPresence {
  const key = String(productId || '').trim();
  if (!key) return 'unknown';
  const cached = presenceCache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.status;
  const local = loadPresenceFromLocalStorage(key);
  if (local && Date.now() - local.ts < TTL_MS) {
    presenceCache.set(key, local);
    return local.status;
  }
  return 'unknown';
}

async function fetchVariationsUncached(productId: string): Promise<Variation[]> {
  const span = perfStart('menu.variations.fetch', { productId });
  try {
    const presenceBeforeFetch = getSimpleVariationPresence(productId);
    const [{ data: productVariations, error: productError }, { data: globalLinks, error: globalError }] = await Promise.all([
      withRetry(() => supabase.from('product_variations').select(PRODUCT_VARIATION_SELECT).eq('product_id', productId) as any, 2),
      withRetry(() => supabase.from('product_global_variation_links').select(GLOBAL_LINK_SELECT).eq('product_id', productId).order('display_order', { ascending: true }) as any, 2)
    ]);

    if (productError) throw productError;
    if (globalError) throw globalError;

    const specificRows = Array.isArray(productVariations) ? productVariations : [];
    const linkRows = Array.isArray(globalLinks) ? globalLinks : [];
    const linkIds = linkRows.map((l: any) => l.global_variation_id).filter(Boolean);
    let globalVariations: any[] = [];
    if (linkIds.length > 0) {
      const { data: globalVars, error: globalVarError } = await withRetry(() => supabase.from('global_variations').select(GLOBAL_VARIATION_SELECT).in('id', linkIds as any) as any, 2);
      if (globalVarError) throw globalVarError;
      const base = Array.isArray(globalVars) ? globalVars : [];
      const baseById = new Map(base.map((gv: any) => [String(gv.id), gv]));
      globalVariations = linkRows
        .map((link: any) => buildLinkedGlobalVariation(link, baseById.get(String(link.global_variation_id))))
        .filter(Boolean) as any[];
    }

    const normalized = [...specificRows, ...globalVariations]
      .map((item: any) => normalizeVariation(item))
      .filter(Boolean) as Variation[];

    const sorted = sortVariations(normalized);

    if (sorted.length > 0) {
      setVariationPresence(productId, 'has');
    } else if (presenceBeforeFetch === 'has') {
      clearVariationCache(productId);
      setVariationPresence(productId, 'has');
    } else {
      setVariationPresence(productId, 'none');
    }
    return sorted;
  } catch {
    return [];
  } finally {
    span.end();
  }
}

async function fetchVariationsBulkUncached(productIds: string[]) {
  const ids = Array.from(new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  const results = new Map<string, Variation[]>();
  if (ids.length === 0) return results;

  const span = perfStart('menu.variations.bulk.fetch', { count: ids.length });
  try {
    const [{ data: productRows, error: productError }, { data: linkRows, error: linkError }] = await Promise.all([
      withRetry(() => supabase.from('product_variations').select(PRODUCT_VARIATION_SELECT).in('product_id', ids as any) as any, 2),
      withRetry(() => supabase.from('product_global_variation_links').select(GLOBAL_LINK_SELECT).in('product_id', ids as any).order('display_order', { ascending: true }) as any, 2)
    ]);

    if (productError) throw productError;
    if (linkError) throw linkError;

    const specificByProduct = new Map<string, any[]>();
    for (const row of Array.isArray(productRows) ? productRows : []) {
      const productId = String((row as any)?.product_id || '').trim();
      if (!productId) continue;
      const current = specificByProduct.get(productId) || [];
      current.push(row);
      specificByProduct.set(productId, current);
    }

    const linksByProduct = new Map<string, any[]>();
    const globalIds = new Set<string>();
    for (const row of Array.isArray(linkRows) ? linkRows : []) {
      const productId = String((row as any)?.product_id || '').trim();
      const globalId = String((row as any)?.global_variation_id || '').trim();
      if (productId) {
        const current = linksByProduct.get(productId) || [];
        current.push(row);
        linksByProduct.set(productId, current);
      }
      if (globalId) globalIds.add(globalId);
    }

    let globalById = new Map<string, any>();
    if (globalIds.size > 0) {
      const { data: globalRows, error: globalError } = await withRetry(() => supabase.from('global_variations').select(GLOBAL_VARIATION_SELECT).in('id', Array.from(globalIds) as any) as any, 2);
      if (globalError) throw globalError;
      globalById = new Map((Array.isArray(globalRows) ? globalRows : []).map((row: any) => [String(row.id), row]));
    }

    for (const id of ids) {
      const specificRows = specificByProduct.get(id) || [];
      const linkedGlobals = (linksByProduct.get(id) || [])
        .map((link: any) => buildLinkedGlobalVariation(link, globalById.get(String(link.global_variation_id))))
        .filter(Boolean);

      const normalized = sortVariations(
        [...specificRows, ...linkedGlobals]
          .map((item: any) => normalizeVariation(item))
          .filter(Boolean) as Variation[]
      );

      if (normalized.length > 0) {
        setVariationPresence(id, 'has');
        storeVariationResult(id, normalized);
      } else if (getSimpleVariationPresence(id) === 'has') {
        clearVariationCache(id);
        setVariationPresence(id, 'has');
      } else {
        setVariationPresence(id, 'none');
        storeVariationResult(id, normalized);
      }
      results.set(id, normalized);
    }

    return results;
  } finally {
    span.end();
  }
}

export async function primeSimpleVariationPresence(productIds: string[], chunkSize = 80) {
  const ids = Array.from(new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (ids.length === 0) return [] as string[];

  const statuses = new Map<string, Exclude<VariationPresence, 'unknown'>>();
  const unknownIds: string[] = [];

  for (const id of ids) {
    const status = getSimpleVariationPresence(id);
    if (status === 'unknown') unknownIds.push(id);
    else statuses.set(id, status);
  }

  const chunks: string[][] = [];
  for (let index = 0; index < unknownIds.length; index += chunkSize) {
    chunks.push(unknownIds.slice(index, index + chunkSize));
  }

  for (const chunk of chunks) {
    try {
      const [{ data: productRows, error: productError }, { data: globalRows, error: globalError }] = await Promise.all([
        withRetry(() => supabase.from('product_variations').select('product_id').in('product_id', chunk as any) as any, 2),
        withRetry(() => supabase.from('product_global_variation_links').select('product_id').in('product_id', chunk as any) as any, 2)
      ]);

      if (productError) throw productError;
      if (globalError) throw globalError;

      const hasSet = new Set<string>();
      for (const row of Array.isArray(productRows) ? productRows : []) {
        const id = String((row as any)?.product_id || '').trim();
        if (id) hasSet.add(id);
      }
      for (const row of Array.isArray(globalRows) ? globalRows : []) {
        const id = String((row as any)?.product_id || '').trim();
        if (id) hasSet.add(id);
      }

      for (const id of chunk) {
        const status: Exclude<VariationPresence, 'unknown'> = hasSet.has(id) ? 'has' : 'none';
        setVariationPresence(id, status);
        statuses.set(id, status);
        if (status === 'none' && !hasFreshVariationCache(id)) {
          cache.set(id, { ts: Date.now(), data: [] });
          saveToLocalStorage(id, []);
        }
      }
    } catch {}
  }

  return ids.filter((id) => statuses.get(id) === 'has');
}

export function prefetchSimpleVariations(productId: string) {
  const key = String(productId || '').trim();
  if (!key) return Promise.resolve([] as Variation[]);
  if (getSimpleVariationPresence(key) === 'none') return Promise.resolve([] as Variation[]);
  const immediate = getCachedSimpleVariations(key);
  if (immediate.length > 0 || hasDefinitiveSimpleVariationsResult(key)) return Promise.resolve(immediate);
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchVariationsUncached(key)
    .then((data) => {
      storeVariationResult(key, data);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

export async function prefetchSimpleVariationsBulk(productIds: string[], concurrency = 6) {
  const uniqueIds = Array.from(new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const pendingIds = uniqueIds.filter((id) => {
    if (getSimpleVariationPresence(id) === 'none') return false;
    return !hasDefinitiveSimpleVariationsResult(id);
  });
  if (pendingIds.length === 0) return;

  try {
    await fetchVariationsBulkUncached(pendingIds);
    return;
  } catch {}

  let cursor = 0;
  const worker = async () => {
    while (cursor < pendingIds.length) {
      const current = pendingIds[cursor++];
      try {
        await prefetchSimpleVariations(current);
      } catch {}
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, pendingIds.length)) }, () => worker());
  await Promise.all(workers);
}

export function useSimpleVariations() {
  const [isLoading, setIsLoading] = useState(false);

  const fetchVariations = async (productId: string): Promise<Variation[]> => {
    const key = String(productId || '').trim();
    if (!key) return [];
    if (getSimpleVariationPresence(key) === 'none') return [];

    const immediate = getCachedSimpleVariations(key);
    if (immediate.length > 0 || hasDefinitiveSimpleVariationsResult(key)) return immediate;

    const running = inflight.get(key);
    if (running) return running;

    setIsLoading(true);
    const p = fetchVariationsUncached(key)
      .then((data) => {
        storeVariationResult(key, data);
        return data;
      })
      .finally(() => {
        inflight.delete(key);
        setIsLoading(false);
      });

    inflight.set(key, p);
    return p;
  };

  const calculateVariationPrice = (
    selectedVariations: Record<string, string[]>,
    variations: Variation[],
    context?: VariationPricingContext
  ) => {
    let total = 0;
    for (const variation of variations) {
      const selected = selectedVariations[variation.id] || [];
      if (selected.length === 0) continue;
      if (isPizzaFlavorVariation(variation, context?.category)) {
        total += calculatePizzaFlavorPrice(selected, variation, context?.category);
        continue;
      }
      let freeRemaining = Math.max(0, Number(variation.free_selections_limit || 0));
      for (const optionName of selected) {
        const option = variation.options.find((opt) => opt.name === optionName);
        if (!option) continue;
        if (freeRemaining > 0) {
          freeRemaining -= 1;
          continue;
        }
        total += option.price;
      }
    }
    return total;
  };

  const getSelectedVariationDetails = (
    selectedVariations: Record<string, string[]>,
    variations: Variation[],
    context?: VariationPricingContext
  ): SelectedVariationDetail[] => {
    const details: SelectedVariationDetail[] = [];

    for (const variation of variations) {
      const selected = selectedVariations[variation.id] || [];
      if (selected.length === 0) continue;
      if (isPizzaFlavorVariation(variation, context?.category)) {
        const totalPrice = calculatePizzaFlavorPrice(selected, variation, context?.category);
        const label = String(variation.receipt_label || variation.name || '').trim();
        selected.forEach((optionName, index) => {
          details.push({
            key: `${variation.id}-${index}`,
            label,
            value: optionName,
            price: index === 0 ? totalPrice : 0
          });
        });
        continue;
      }
      let freeRemaining = Math.max(0, Number(variation.free_selections_limit || 0));
      const label = String(variation.receipt_label || variation.name || '').trim();

      selected.forEach((optionName, index) => {
        const option = variation.options.find((opt) => opt.name === optionName);
        if (!option) return;

        const price = freeRemaining > 0 ? 0 : Number(option.price || 0);
        if (freeRemaining > 0) freeRemaining -= 1;

        details.push({
          key: `${variation.id}:${index}:${option.name}`,
          label: label || 'Complemento',
          value: option.name,
          price: price > 0 ? price : 0,
        });
      });
    }

    return details;
  };

  const getSelectedVariationsText = (selectedVariations: Record<string, string[]>) => {
    const texts: string[] = [];
    for (const options of Object.values(selectedVariations)) {
      texts.push(...options);
    }
    return Array.from(new Set(texts));
  };

  const getSelectedVariationsTextWithReceiptLabels = (selectedVariations: Record<string, string[]>, variations: Variation[]) => {
    const texts: string[] = [];
    for (const variation of variations) {
      const selected = selectedVariations[variation.id] || [];
      if (selected.length === 0) continue;
      const label = String(variation.receipt_label || variation.name || '').trim();
      if (!label) continue;
      texts.push(`${label}: ${selected.join(', ')}`);
    }
    return texts;
  };

  return {
    isLoading,
    fetchVariations,
    calculateVariationPrice,
    getSelectedVariationDetails,
    getSelectedVariationsText,
    getSelectedVariationsTextWithReceiptLabels,
  };
}
