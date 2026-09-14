import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/integrations/supabase/client';

export type MetaStandardEvent =
  | 'PageView'
  | 'ViewContent'
  | 'Search'
  | 'AddToCart'
  | 'InitiateCheckout'
  | 'AddPaymentInfo'
  | 'Purchase'
  | 'Contact'
  | 'Lead';

export type MarketingContent = {
  id: string;
  quantity: number;
  item_price?: number;
};

type MarketingEventParams = Record<string, unknown>;

type QueuedMetaEvent = {
  scope: string;
  eventName: MetaStandardEvent;
  params: MarketingEventParams;
  eventId: string;
  createdAt: number;
};

type ActiveGoogleTag = {
  scope: string;
  measurementId: string;
};

type TrackingFunction = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: TrackingFunction;
    gtag?: TrackingFunction;
    dataLayer?: unknown[];
    __popsystemMetaPixel?: { scope: string; pixelId: string } | null;
    __popsystemGoogleTag?: ActiveGoogleTag | null;
    __popsystemMetaQueue?: QueuedMetaEvent[];
  }
}

const META_QUEUE_MAX_AGE_MS = 10 * 60 * 1000;
const META_QUEUE_MAX_ITEMS = 100;

const readCookie = (name: string) => {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  const entry = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : '';
};

const sendServerEvent = (event: QueuedMetaEvent) => {
  if (typeof window === 'undefined' || !event.scope) return;
  const endpoint = `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/meta-conversions`;
  void fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({
      restaurantId: event.scope,
      eventName: event.eventName,
      eventId: event.eventId,
      eventTime: event.createdAt,
      eventSourceUrl: window.location.href,
      params: event.params,
      userData: {
        fbp: readCookie('_fbp') || undefined,
        fbc: readCookie('_fbc') || undefined,
      },
    }),
    keepalive: true,
  }).catch(() => undefined);
};

const normalizeScope = (value?: string) => String(value || '').trim();

const createEventId = (eventName: MetaStandardEvent) => {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `popsystem-${eventName.toLowerCase()}-${random}`;
};

const normalizeMoney = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
};

const normalizeParams = (params: MarketingEventParams): MarketingEventParams => {
  const normalized: MarketingEventParams = { ...params };
  if ('value' in normalized) normalized.value = normalizeMoney(normalized.value);
  if (Array.isArray(normalized.contents)) {
    normalized.contents = normalized.contents
      .map((content) => {
        const item = content && typeof content === 'object'
          ? content as Partial<MarketingContent>
          : {};
        return {
          id: String(item.id || '').trim(),
          quantity: Math.max(1, Number(item.quantity) || 1),
          ...(item.item_price !== undefined ? { item_price: normalizeMoney(item.item_price) } : {}),
        };
      })
      .filter((content: MarketingContent) => Boolean(content.id));
  }
  return normalized;
};

const pushDataLayerEvent = (
  eventName: MetaStandardEvent,
  params: MarketingEventParams,
  eventId: string,
  scope: string,
) => {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: `popsystem_${eventName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}`,
    meta_event_name: eventName,
    event_id: eventId,
    restaurant_id: scope || undefined,
    ...params,
  });
};

const googleEventName: Record<MetaStandardEvent, string> = {
  PageView: 'page_view',
  ViewContent: 'view_item',
  Search: 'search',
  AddToCart: 'add_to_cart',
  InitiateCheckout: 'begin_checkout',
  AddPaymentInfo: 'add_payment_info',
  Purchase: 'purchase',
  Contact: 'generate_lead',
  Lead: 'generate_lead',
};

const toGoogleParams = (eventName: MetaStandardEvent, params: MarketingEventParams) => {
  const contents = Array.isArray(params.contents) ? params.contents : [];
  const googleParams: MarketingEventParams = {
    ...params,
    ...(contents.length > 0 ? {
      items: contents.map((content) => {
        const item = content && typeof content === 'object'
          ? content as Partial<MarketingContent>
          : {};
        return {
          item_id: String(item.id || ''),
          quantity: Math.max(1, Number(item.quantity) || 1),
          ...(item.item_price !== undefined ? { price: normalizeMoney(item.item_price) } : {}),
        };
      }),
    } : {}),
  };

  delete googleParams.contents;
  if (eventName === 'Purchase' && params.order_id) googleParams.transaction_id = String(params.order_id);
  if (eventName === 'Search' && params.search_string) googleParams.search_term = String(params.search_string);
  return googleParams;
};

const sendGoogleEvent = (
  scope: string,
  eventName: MetaStandardEvent,
  params: MarketingEventParams,
  eventId: string,
) => {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  const activeTag = window.__popsystemGoogleTag;
  if (!activeTag || activeTag.scope !== scope || !activeTag.measurementId.startsWith('G-')) return;

  window.gtag('event', googleEventName[eventName], {
    ...toGoogleParams(eventName, params),
    event_id: eventId,
    send_to: activeTag.measurementId,
  });
};

const sendMetaEvent = (event: QueuedMetaEvent) => {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return false;
  const activePixel = window.__popsystemMetaPixel;
  if (!activePixel || activePixel.scope !== event.scope || !activePixel.pixelId) return false;

  window.fbq('trackSingle', activePixel.pixelId, event.eventName, event.params, {
    eventID: event.eventId,
  });
  return true;
};

const enqueueMetaEvent = (event: QueuedMetaEvent) => {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const current = (window.__popsystemMetaQueue || []).filter(
    (queued) => now - queued.createdAt <= META_QUEUE_MAX_AGE_MS,
  );
  current.push(event);
  window.__popsystemMetaQueue = current.slice(-META_QUEUE_MAX_ITEMS);
};

export const setActiveMetaPixel = (scope: string, pixelId: string | null) => {
  if (typeof window === 'undefined') return;
  const normalizedScope = normalizeScope(scope);
  const normalizedPixelId = String(pixelId || '').trim();
  window.__popsystemMetaPixel = normalizedScope && normalizedPixelId
    ? { scope: normalizedScope, pixelId: normalizedPixelId }
    : null;
};

export const setActiveGoogleTag = (scope: string, measurementId: string | null) => {
  if (typeof window === 'undefined') return;
  const normalizedScope = normalizeScope(scope);
  const normalizedMeasurementId = String(measurementId || '').trim().toUpperCase();
  window.__popsystemGoogleTag = normalizedScope && normalizedMeasurementId.startsWith('G-')
    ? { scope: normalizedScope, measurementId: normalizedMeasurementId }
    : null;
};

export const flushMetaEventQueue = (scope: string) => {
  if (typeof window === 'undefined') return;
  const normalizedScope = normalizeScope(scope);
  const now = Date.now();
  const remaining: QueuedMetaEvent[] = [];

  for (const event of window.__popsystemMetaQueue || []) {
    if (now - event.createdAt > META_QUEUE_MAX_AGE_MS) continue;
    if (event.scope === normalizedScope && sendMetaEvent(event)) continue;
    remaining.push(event);
  }

  window.__popsystemMetaQueue = remaining.slice(-META_QUEUE_MAX_ITEMS);
};

export const trackMarketingEvent = (
  eventName: MetaStandardEvent,
  params: MarketingEventParams = {},
  options: { scope?: string; eventId?: string } = {},
) => {
  if (typeof window === 'undefined') return '';
  const scope = normalizeScope(options.scope);
  const eventId = String(options.eventId || createEventId(eventName));
  const normalizedParams = normalizeParams(params);

  pushDataLayerEvent(eventName, normalizedParams, eventId, scope);
  if (scope) sendGoogleEvent(scope, eventName, normalizedParams, eventId);

  if (scope) {
    const event: QueuedMetaEvent = {
      scope,
      eventName,
      params: normalizedParams,
      eventId,
      createdAt: Date.now(),
    };
    sendServerEvent(event);
    if (!sendMetaEvent(event)) enqueueMetaEvent(event);
  }

  return eventId;
};

export const createMarketingContent = (
  id: unknown,
  quantity: unknown,
  itemPrice?: unknown,
): MarketingContent => ({
  id: String(id || '').trim(),
  quantity: Math.max(1, Number(quantity) || 1),
  ...(itemPrice !== undefined ? { item_price: normalizeMoney(itemPrice) } : {}),
});
