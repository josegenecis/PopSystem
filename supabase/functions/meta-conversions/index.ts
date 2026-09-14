// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const allowedEvents = new Set([
  "PageView",
  "ViewContent",
  "Search",
  "AddToCart",
  "InitiateCheckout",
  "AddPaymentInfo",
  "Purchase",
  "Contact",
  "Lead",
]);

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function fromB64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function cryptoKey() {
  const secret = Deno.env.get("META_TOKEN_SECRET") || Deno.env.get("AUTOMATION_SECRET") || Deno.env.get("JWT_SECRET") || "";
  if (!secret || secret.length < 16) throw new Error("META_TOKEN_SECRET não configurado.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
}

async function decryptToken(value: string) {
  const [ivRaw, encryptedRaw] = String(value || "").split(".");
  if (!ivRaw || !encryptedRaw) throw new Error("Token Meta inválido.");
  const key = await cryptoKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivRaw) },
    key,
    fromB64(encryptedRaw),
  );
  return new TextDecoder().decode(decrypted);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeText(value: unknown, maxLength = 300) {
  return String(value || "").trim().slice(0, maxLength);
}

function safeMoney(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(Math.max(0, amount).toFixed(2)) : 0;
}

function safeQuantity(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(Math.max(0, amount).toFixed(3)) : 0;
}

function normalizeContents(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((content: any) => ({
    id: safeText(content?.id || content?.product_id || content?.productId, 120),
    quantity: safeQuantity(content?.quantity || 1) || 1,
    ...(content?.item_price !== undefined || content?.price !== undefined
      ? { item_price: safeMoney(content?.item_price ?? content?.price) }
      : {}),
  })).filter((content) => content.id);
}

function normalizeEventTime(value: unknown) {
  const now = Math.floor(Date.now() / 1000);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return now;
  const seconds = parsed > 10_000_000_000 ? Math.floor(parsed / 1000) : Math.floor(parsed);
  return seconds > now + 300 || seconds < now - 7 * 24 * 60 * 60 ? now : seconds;
}

function clientIp(req: Request) {
  return safeText(
    req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0],
    80,
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function canonicalPurchase(serviceClient: any, restaurantId: string, params: any) {
  const orderId = safeText(params?.order_id, 80);
  if (!isUuid(orderId)) return null;

  const { data: order, error } = await serviceClient
    .from("orders")
    .select("id,order_number,total,items,customer_phone,created_at")
    .eq("id", orderId)
    .eq("user_id", restaurantId)
    .maybeSingle();
  if (error || !order) return null;

  const contents = normalizeContents(order.items);
  return {
    customData: {
      order_id: String(order.id),
      content_type: "product",
      content_ids: contents.map((item) => item.id),
      contents,
      num_items: contents.reduce((sum, item) => sum + item.quantity, 0),
      value: safeMoney(order.total),
      currency: "BRL",
    },
    phone: safeText(order.customer_phone, 40),
    eventTime: normalizeEventTime(order.created_at ? new Date(order.created_at).getTime() : undefined),
  };
}

function genericCustomData(params: any) {
  const contents = normalizeContents(params?.contents);
  const contentIds = Array.isArray(params?.content_ids)
    ? params.content_ids.map((value: unknown) => safeText(value, 120)).filter(Boolean).slice(0, 100)
    : contents.map((item) => item.id);
  return {
    ...(params?.content_type ? { content_type: safeText(params.content_type, 40) } : {}),
    ...(params?.content_name ? { content_name: safeText(params.content_name, 200) } : {}),
    ...(params?.content_category ? { content_category: safeText(params.content_category, 120) } : {}),
    ...(contentIds.length ? { content_ids: contentIds } : {}),
    ...(contents.length ? { contents } : {}),
    ...(params?.search_string ? { search_string: safeText(params.search_string, 200) } : {}),
    ...(params?.value !== undefined ? { value: safeMoney(params.value), currency: safeText(params.currency || "BRL", 5) } : {}),
    ...(params?.num_items !== undefined ? { num_items: safeQuantity(params.num_items) } : {}),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ accepted: false, reason: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const restaurantId = safeText(body?.restaurantId, 80);
    const eventName = safeText(body?.eventName, 40);
    const eventId = safeText(body?.eventId, 160);
    if (!isUuid(restaurantId) || !allowedEvents.has(eventName) || !eventId) {
      return json({ accepted: false, reason: "invalid_event" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Backend não configurado.");
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: settings }, { data: connection }] = await Promise.all([
      serviceClient.from("marketing_settings").select("facebook_pixel_id").eq("user_id", restaurantId).maybeSingle(),
      serviceClient.from("meta_connections")
        .select("access_token_encrypted,status,token_expires_at")
        .eq("restaurant_id", restaurantId)
        .maybeSingle(),
    ]);

    const pixelId = safeText(settings?.facebook_pixel_id, 40).replace(/\D/g, "");
    const expired = connection?.token_expires_at && new Date(connection.token_expires_at).getTime() <= Date.now();
    if (!pixelId || connection?.status !== "connected" || !connection?.access_token_encrypted || expired) {
      return json({ accepted: false, reason: "not_configured" }, 202);
    }

    let customData = genericCustomData(body?.params || {});
    let eventTime = normalizeEventTime(body?.eventTime);
    let orderPhone = "";
    if (eventName === "Purchase") {
      const purchase = await canonicalPurchase(serviceClient, restaurantId, body?.params || {});
      if (!purchase) return json({ accepted: false, reason: "purchase_not_found" }, 202);
      customData = purchase.customData;
      eventTime = purchase.eventTime;
      orderPhone = purchase.phone;
    }

    const userData: Record<string, unknown> = {};
    const ip = clientIp(req);
    const userAgent = safeText(req.headers.get("user-agent"), 500);
    const fbp = safeText(body?.userData?.fbp, 200);
    const fbc = safeText(body?.userData?.fbc, 200);
    if (ip) userData.client_ip_address = ip;
    if (userAgent) userData.client_user_agent = userAgent;
    if (fbp) userData.fbp = fbp;
    if (fbc) userData.fbc = fbc;

    const email = safeText(body?.userData?.email, 200).toLowerCase();
    const phone = safeText(body?.userData?.phone || orderPhone, 40).replace(/\D/g, "");
    if (email) userData.em = [await sha256(email)];
    if (phone) userData.ph = [await sha256(phone)];

    const sourceUrl = safeText(body?.eventSourceUrl, 1000);
    const event = {
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,
      action_source: "website",
      ...(sourceUrl.startsWith("https://") || sourceUrl.startsWith("http://") ? { event_source_url: sourceUrl } : {}),
      user_data: userData,
      custom_data: customData,
    };
    const token = await decryptToken(connection.access_token_encrypted);
    const url = new URL(`${GRAPH_BASE}/${pixelId}/events`);
    url.searchParams.set("access_token", token);
    const payload: Record<string, unknown> = { data: [event] };
    const testEventCode = safeText(Deno.env.get("META_TEST_EVENT_CODE"), 80);
    if (testEventCode) payload.test_event_code = testEventCode;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("meta_conversions_rejected", {
        restaurantId,
        eventName,
        code: result?.error?.code,
        subcode: result?.error?.error_subcode,
        message: result?.error?.message,
      });
      return json({ accepted: false, reason: "meta_rejected" }, 202);
    }

    return json({ accepted: true, eventsReceived: Number(result?.events_received || 1) });
  } catch (error) {
    console.error("meta_conversions_failed", error);
    // Rastreamento nunca deve interromper cardápio, checkout ou criação do pedido.
    return json({ accepted: false, reason: "temporarily_unavailable" }, 202);
  }
});
