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

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function baseUrl() {
  return (Deno.env.get("PUBLIC_WEB_BASE_URL") || Deno.env.get("VITE_PUBLIC_WEB_BASE_URL") || "https://popsystem.com.br").replace(/\/+$/, "");
}

function redirectUri() {
  return `${baseUrl()}/marketing?tab=pop-ai&meta_callback=1`;
}

function normalizeAdAccountId(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("act_") ? raw : `act_${raw.replace(/^act_/, "")}`;
}

async function getUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const serviceClient = createClient(supabaseUrl, serviceKey || anonKey);
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user?.id) throw new Error("Sessão inválida.");
  return { user, serviceClient };
}

async function cryptoKey() {
  const secret = Deno.env.get("META_TOKEN_SECRET") || Deno.env.get("AUTOMATION_SECRET") || Deno.env.get("JWT_SECRET") || "";
  if (!secret || secret.length < 16) throw new Error("META_TOKEN_SECRET não configurado.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function b64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function fromB64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await cryptoKey();
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
  return `${b64(iv)}.${b64(encrypted)}`;
}

async function decryptToken(value: string) {
  const [ivRaw, encryptedRaw] = String(value || "").split(".");
  if (!ivRaw || !encryptedRaw) throw new Error("Token Meta inválido.");
  const key = await cryptoKey();
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivRaw) }, key, fromB64(encryptedRaw));
  return new TextDecoder().decode(decrypted);
}

async function graphGetAtVersion(version: string, path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\/+/, "")}`);
  url.searchParams.set("access_token", token);
  Object.entries(params).forEach(([key, value]) => value && url.searchParams.set(key, value));
  const res = await fetch(url);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error?.message || "Falha ao consultar Meta.");
  return payload;
}

async function graphGet(path: string, token: string, params: Record<string, string> = {}) {
  return graphGetAtVersion(GRAPH_VERSION, path, token, params);
}

async function graphPost(path: string, token: string, body: Record<string, any>) {
  const params = new URLSearchParams();
  params.set("access_token", token);
  Object.entries(body).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  });
  const res = await fetch(`${GRAPH_BASE}/${path.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const metaError = payload?.error || {};
    const details = [
      metaError?.error_user_title,
      metaError?.error_user_msg,
      metaError?.error_data ? JSON.stringify(metaError.error_data) : "",
    ].filter(Boolean).join(" - ");
    throw new Error(`${metaError?.message || "Falha ao enviar para Meta."}${details ? `: ${details}` : ""} (${path.replace(/^\/+/, "")}${metaError?.code ? `, code ${metaError.code}` : ""}${metaError?.error_subcode ? `, subcode ${metaError.error_subcode}` : ""})`);
  }
  return payload;
}

async function graphPostMultipart(path: string, token: string, form: FormData) {
  form.set("access_token", token);
  const res = await fetch(`${GRAPH_BASE}/${path.replace(/^\/+/, "")}`, {
    method: "POST",
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const metaError = payload?.error || {};
    throw new Error(`${metaError?.message || "Falha ao enviar arquivo para Meta."} (${path.replace(/^\/+/, "")}${metaError?.code ? `, code ${metaError.code}` : ""}${metaError?.error_subcode ? `, subcode ${metaError.error_subcode}` : ""})`);
  }
  return payload;
}

function normalizeMetaPublishError(error: any) {
  const message = String(error?.message || error || "").trim();
  if (/development mode|modo de desenvolvimento|1885183/i.test(message)) {
    return [
      "O app Meta conectado está em modo de desenvolvimento. Para criar criativos de anúncio para clientes reais, coloque o app em modo Live/Público no Meta Developers e garanta acesso avançado às permissões de anúncios.",
      "Depois disso, clique em Atualizar ativos e tente publicar novamente.",
      `Diagnóstico da Meta: ${message}`,
    ].join(" ");
  }
  return message || "Falha ao publicar campanha na Meta.";
}

async function ensurePublicBucket(serviceClient: any, bucket: string) {
  const { data: buckets } = await serviceClient.storage.listBuckets();
  const exists = Array.isArray(buckets) && buckets.some((item: any) => item.name === bucket || item.id === bucket);
  if (!exists) {
    await serviceClient.storage.createBucket(bucket, { public: true, fileSizeLimit: 10485760 });
  }
}

async function uploadMarketingImage(serviceClient: any, restaurantId: string, bytes: Uint8Array, contentType = "image/png") {
  await ensurePublicBucket(serviceClient, "product-images");
  const ext = contentType.includes("webp") ? "webp" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
  const path = `marketing-ai/${restaurantId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await serviceClient.storage.from("product-images").upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
  const { data } = serviceClient.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

function publicProductImageUrl(serviceClient: any, value?: string | null) {
  let raw = String(value || "").trim().replace(/^['"]+|['"]+$/g, "");
  if (!raw) return null;
  if (raw.startsWith("//")) raw = `https:${raw}`;
  if (raw.startsWith("http://")) raw = `https://${raw.slice("http://".length)}`;
  raw = raw.replace(/^https:\/\/https:\/\//, "https://");
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  const path = raw.replace(/^\/+/, "").replace(/^product-images\//, "");
  const { data } = serviceClient.storage.from("product-images").getPublicUrl(path);
  return data?.publicUrl || raw;
}

async function isUsablePublicImage(url?: string | null) {
  const raw = String(url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const head = await fetch(raw, { method: "HEAD" });
    const headType = head.headers.get("content-type") || "";
    if (head.ok && headType.toLowerCase().startsWith("image/")) return true;
    const get = await fetch(raw, { headers: { Range: "bytes=0-2047" } });
    const getType = get.headers.get("content-type") || "";
    return get.ok && getType.toLowerCase().startsWith("image/");
  } catch {
    return false;
  }
}

const creativeFormatConfig: Record<string, { label: string; size: string; width: number; height: number; aspect: string; placement: string[]; preset: string }> = {
  feed_1080x1080: {
    label: "Feed quadrado 1080x1080",
    size: "1024x1024",
    width: 1080,
    height: 1080,
    aspect: "quadrado 1:1",
    placement: ["facebook_feed", "instagram_feed"],
    preset: "feed_square",
  },
  story_1080x1920: {
    label: "Stories 1080x1920",
    size: "1024x1536",
    width: 1080,
    height: 1920,
    aspect: "vertical 9:16",
    placement: ["instagram_stories", "facebook_stories"],
    preset: "story_vertical",
  },
  reels_1080x1920: {
    label: "Reels 1080x1920",
    size: "1024x1536",
    width: 1080,
    height: 1920,
    aspect: "vertical 9:16",
    placement: ["instagram_reels"],
    preset: "reels_vertical",
  },
  banner_1200x628: {
    label: "Horizontal 1200x628",
    size: "1536x1024",
    width: 1200,
    height: 628,
    aspect: "horizontal",
    placement: ["facebook_feed"],
    preset: "facebook_horizontal",
  },
};

const creativeVariationConfig: Record<string, { label: string; style: string; composition: string }> = {
  A: {
    label: "Criativo A",
    style: "premium comercial, limpo, produto dominante, preço forte e CTA claro",
    composition: "produto em destaque lateral ou central, logo discreta no topo, preço grande e CTA no rodape",
  },
  B: {
    label: "Criativo B",
    style: "promoção forte para delivery, alto contraste, leitura imediata no celular",
    composition: "produto maior, oferta em destaque, preço com maximo impacto e CTA em botao visivel",
  },
  C: {
    label: "Criativo C",
    style: "visual social media brasileiro, apetitoso, moderno, com profundidade e cenário premium",
    composition: "produto protagonista sobre cenario realista, textos em blocos curtos e logo integrada sem poluir",
  },
};

function normalizeFormatKey(value: string) {
  return value === "facebook_1200x628" ? "banner_1200x628" : value;
}

function normalizeSelectedFormats(value: unknown) {
  const allowed = new Set(Object.keys(creativeFormatConfig));
  const list = Array.isArray(value) ? value.map((item) => normalizeFormatKey(String(item))).filter((item) => allowed.has(item)) : [];
  return list.length ? [...new Set(list)] : ["feed_1080x1080", "story_1080x1920", "reels_1080x1920"];
}

function normalizeSelectedPlacements(formats: string[], value: unknown) {
  const allowed = new Set(["facebook_feed", "instagram_feed", "instagram_stories", "instagram_reels", "facebook_stories"]);
  const selected = Array.isArray(value) ? value.map(String).filter((item) => allowed.has(item)) : [];
  const fromFormats = formats.flatMap((format) => creativeFormatConfig[format]?.placement || []);
  return [...new Set(selected.length ? selected : fromFormats)];
}

async function fetchImageBlob(url?: string | null) {
  const raw = String(url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  const res = await fetch(raw);
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") || "image/png";
  if (!contentType.toLowerCase().startsWith("image/")) return null;
  return new Blob([await res.arrayBuffer()], { type: contentType });
}

function imageFilename(name: string, blob: Blob) {
  const type = blob.type.toLowerCase();
  const ext = type.includes("webp") ? "webp" : type.includes("jpeg") || type.includes("jpg") ? "jpg" : "png";
  return `${name}.${ext}`;
}

function escXml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textLines(value: unknown, maxChars: number, maxLines: number) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : [""];
}

function templateKind(productName?: string | null, category?: string | null, objective?: string | null) {
  const text = `${productName || ""} ${category || ""} ${objective || ""}`.toLowerCase();
  if (text.includes("aça") || text.includes("acai")) return "açai";
  if (text.includes("pizza")) return "pizza";
  if (text.includes("hamb") || text.includes("burger") || text.includes("burguer")) return "hamburguer";
  if (text.includes("marmita")) return "marmita";
  if (text.includes("sorvete") || text.includes("gelato")) return "sorveteria";
  if (text.includes("combo")) return "combo";
  if (text.includes("desconto") || text.includes("promo")) return "promoção";
  return "restaurante";
}

function templatePalette(kind: string) {
  const palettes: Record<string, { bg1: string; bg2: string; accent: string; dark: string; light: string }> = {
    açai: { bg1: "#3b0764", bg2: "#f59e0b", accent: "#22c55e", dark: "#2e063f", light: "#fff7ed" },
    pizza: { bg1: "#7f1d1d", bg2: "#f97316", accent: "#fde047", dark: "#3a160b", light: "#fff7ed" },
    hamburguer: { bg1: "#111827", bg2: "#b45309", accent: "#facc15", dark: "#0f172a", light: "#fff7ed" },
    marmita: { bg1: "#064e3b", bg2: "#84cc16", accent: "#f97316", dark: "#052e16", light: "#f7fee7" },
    sorveteria: { bg1: "#0e7490", bg2: "#f472b6", accent: "#fde68a", dark: "#164e63", light: "#fdf2f8" },
    combo: { bg1: "#14532d", bg2: "#f97316", accent: "#bef264", dark: "#052e16", light: "#f7fee7" },
    promoção: { bg1: "#7c2d12", bg2: "#f97316", accent: "#fef08a", dark: "#431407", light: "#fff7ed" },
    restaurante: { bg1: "#003223", bg2: "#ff5a00", accent: "#8cc850", dark: "#062f23", light: "#f8f6ef" },
  };
  return palettes[kind] || palettes.restaurante;
}

function buildTemplateCreativeSvg(input: {
  format: string;
  restaurantName: string;
  productName: string;
  productImageUrl: string;
  logoUrl?: string | null;
  headline?: string | null;
  priceLabel?: string | null;
  cta?: string | null;
  category?: string | null;
  objective?: string | null;
}) {
  const config = creativeFormatConfig[input.format] || creativeFormatConfig.feed_1080x1080;
  const width = config.width;
  const height = config.height;
  const isVertical = height > width;
  const isHorizontal = width > height;
  const kind = templateKind(input.productName, input.category, input.objective);
  const palette = templatePalette(kind);
  const headlineLines = textLines(String(input.headline || `${input.productName} em oferta`).toUpperCase(), isVertical ? 13 : isHorizontal ? 18 : 16, 3);
  const productLines = textLines(String(input.productName || "Oferta especial").toUpperCase(), isVertical ? 14 : 18, 2);
  const price = String(input.priceLabel || "").trim();
  const cta = String(input.cta || "PEÇA AGORA").toUpperCase();
  const logoBlock = input.logoUrl
    ? `<circle cx="${isVertical ? 880 : 170}" cy="${isVertical ? 150 : 145}" r="${isVertical ? 92 : 82}" fill="#fff" opacity=".96"/>
       <image href="${escXml(input.logoUrl)}" x="${isVertical ? 800 : 94}" y="${isVertical ? 72 : 72}" width="${isVertical ? 160 : 152}" height="${isVertical ? 160 : 152}" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="${isVertical ? 86 : 72}" y="${isVertical ? 150 : 110}" fill="#fff" font-size="${isVertical ? 46 : 38}" font-family="Arial, Helvetica, sans-serif" font-weight="800">${escXml(input.restaurantName)}</text>`;

  if (isHorizontal) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.bg1}"/><stop offset="1" stop-color="${palette.bg2}"/></linearGradient>
        <clipPath id="photo"><rect x="650" y="54" width="500" height="520" rx="34"/></clipPath>
        <filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity=".32"/></filter>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <circle cx="1060" cy="50" r="210" fill="${palette.accent}" opacity=".20"/>
      <rect x="650" y="54" width="500" height="520" rx="34" fill="#fff" opacity=".95" filter="url(#shadow)"/>
      <image href="${escXml(input.productImageUrl)}" x="650" y="54" width="500" height="520" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo)"/>
      ${logoBlock}
      ${headlineLines.map((line, i) => `<text x="72" y="${214 + i * 76}" fill="#fff" font-size="70" font-family="Arial, Helvetica, sans-serif" font-weight="900">${escXml(line)}</text>`).join("")}
      ${productLines.map((line, i) => `<text x="72" y="${430 + i * 56}" fill="${palette.light}" font-size="50" font-family="Arial, Helvetica, sans-serif" font-weight="800">${escXml(line)}</text>`).join("")}
      ${price ? `<rect x="72" y="510" width="260" height="82" rx="34" fill="${palette.accent}" filter="url(#shadow)"/><text x="102" y="567" fill="${palette.dark}" font-size="52" font-family="Arial, Helvetica, sans-serif" font-weight="900">${escXml(price)}</text>` : ""}
      <rect x="${price ? 352 : 72}" y="510" width="330" height="82" rx="34" fill="#fff" opacity=".94"/>
      <text x="${price ? 388 : 108}" y="563" fill="${palette.dark}" font-size="34" font-family="Arial, Helvetica, sans-serif" font-weight="900">${escXml(cta)}</text>
    </svg>`;
  }

  const photoX = isVertical ? 94 : 86;
  const photoY = isVertical ? 620 : 330;
  const photoW = isVertical ? 892 : 908;
  const photoH = isVertical ? 760 : 650;
  const priceY = isVertical ? 1620 : 940;
  const headlineY = isVertical ? 280 : 210;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.bg1}"/><stop offset=".58" stop-color="${palette.dark}"/><stop offset="1" stop-color="${palette.bg2}"/></linearGradient>
      <clipPath id="photo"><rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" rx="${isVertical ? 58 : 44}"/></clipPath>
      <filter id="shadow"><feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#000" flood-opacity=".34"/></filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <circle cx="${isVertical ? 100 : 920}" cy="${isVertical ? 1740 : 130}" r="${isVertical ? 330 : 230}" fill="${palette.accent}" opacity=".18"/>
    <circle cx="${isVertical ? 960 : 90}" cy="${isVertical ? 240 : 940}" r="${isVertical ? 240 : 180}" fill="#fff" opacity=".10"/>
    ${logoBlock}
    ${headlineLines.map((line, i) => `<text x="${isVertical ? 82 : 82}" y="${headlineY + i * (isVertical ? 92 : 82)}" fill="#fff" font-size="${isVertical ? 86 : 76}" font-family="Arial, Helvetica, sans-serif" font-weight="900">${escXml(line)}</text>`).join("")}
    ${productLines.map((line, i) => `<text x="${isVertical ? 82 : 86}" y="${isVertical ? 520 + i * 64 : 285 + i * 52}" fill="${palette.accent}" font-size="${isVertical ? 58 : 46}" font-family="Arial, Helvetica, sans-serif" font-weight="900">${escXml(line)}</text>`).join("")}
    <rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" rx="${isVertical ? 58 : 44}" fill="#fff" opacity=".96" filter="url(#shadow)"/>
    <image href="${escXml(input.productImageUrl)}" x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo)"/>
    ${price ? `<rect x="${isVertical ? 82 : 86}" y="${priceY}" width="${isVertical ? 410 : 320}" height="${isVertical ? 140 : 92}" rx="${isVertical ? 52 : 34}" fill="${palette.accent}" filter="url(#shadow)"/><text x="${isVertical ? 126 : 116}" y="${priceY + (isVertical ? 94 : 63)}" fill="${palette.dark}" font-size="${isVertical ? 80 : 56}" font-family="Arial, Helvetica, sans-serif" font-weight="900">${escXml(price)}</text>` : ""}
    <rect x="${price ? (isVertical ? 520 : 420) : (isVertical ? 82 : 86)}" y="${priceY}" width="${isVertical ? 440 : 410}" height="${isVertical ? 140 : 92}" rx="${isVertical ? 52 : 34}" fill="#fff" opacity=".96" filter="url(#shadow)"/>
    <text x="${price ? (isVertical ? 570 : 458) : (isVertical ? 132 : 126)}" y="${priceY + (isVertical ? 88 : 59)}" fill="${palette.dark}" font-size="${isVertical ? 45 : 36}" font-family="Arial, Helvetica, sans-serif" font-weight="900">${escXml(cta)}</text>
  </svg>`;
}

async function renderTemplateCreativeImage(params: {
  serviceClient: any;
  restaurantId: string;
  format: string;
  restaurantName: string;
  productName: string;
  productImageUrl: string;
  logoUrl?: string | null;
  headline?: string | null;
  priceLabel?: string | null;
  cta?: string | null;
  category?: string | null;
  objective?: string | null;
}) {
  const config = creativeFormatConfig[params.format] || creativeFormatConfig.feed_1080x1080;
  const svg = buildTemplateCreativeSvg(params);
  const renderUrl = `${baseUrl()}/api/marketing/render-creative`;
  const response = await fetch(renderUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-boracume-key": Deno.env.get("BORACUME_INTERNAL_KEY") || Deno.env.get("RENDER_CREATIVE_SECRET") || "",
    },
    body: JSON.stringify({ svg, width: config.width, height: config.height }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `Falha ao renderizar criativo por template (${response.status}).`);
  }
  return uploadMarketingImage(params.serviceClient, params.restaurantId, new Uint8Array(await response.arrayBuffer()), "image/png");
}

async function uploadMetaAdImage(adAccountId: string, token: string, imageUrl?: string | null) {
  const blob = await fetchImageBlob(imageUrl);
  if (!blob) return null;
  const form = new FormData();
  form.append("filename", blob, imageFilename("popmarketing-ai", blob));
  const payload = await graphPostMultipart(`${adAccountId}/adimages`, token, form);
  const images = payload?.images || {};
  const first = Object.values(images)[0] as any;
  return first?.hash || null;
}

function normalizeMetaObjective(value?: string | null) {
  const raw = String(value || "").trim().toUpperCase();
  const aliases: Record<string, string> = {
    LINK_CLICKS: "OUTCOME_TRAFFIC",
    TRAFFIC: "OUTCOME_TRAFFIC",
    CONVERSIONS: "OUTCOME_SALES",
    SALES: "OUTCOME_SALES",
    LEADS: "OUTCOME_LEADS",
    ENGAGEMENT: "OUTCOME_ENGAGEMENT",
    REACH: "OUTCOME_AWARENESS",
    AWARENESS: "OUTCOME_AWARENESS",
  };
  const normalized = aliases[raw] || raw || "OUTCOME_TRAFFIC";
  const allowed = new Set([
    "OUTCOME_LEADS",
    "OUTCOME_SALES",
    "OUTCOME_ENGAGEMENT",
    "OUTCOME_AWARENESS",
    "OUTCOME_TRAFFIC",
    "OUTCOME_APP_PROMOTION",
  ]);
  return allowed.has(normalized) ? normalized : "OUTCOME_TRAFFIC";
}

async function createPausedMetaCampaign(adAccountId: string, token: string, name: string, objective?: string | null) {
  const payload = {
    name,
    buying_type: "AUCTION",
    objective: normalizeMetaObjective(objective),
    status: "PAUSED",
    special_ad_categories: ["NONE"],
    is_adset_budget_sharing_enabled: false,
  };

  return await graphPost(`${adAccountId}/campaigns`, token, payload);
}

const placementMap: Record<string, { publisher: "facebook" | "instagram"; position: string }> = {
  facebook_feed: { publisher: "facebook", position: "feed" },
  facebook_stories: { publisher: "facebook", position: "story" },
  instagram_feed: { publisher: "instagram", position: "stream" },
  instagram_stories: { publisher: "instagram", position: "story" },
  instagram_reels: { publisher: "instagram", position: "reels" },
};

function buildMetaPlacements(value: unknown) {
  const requested = Array.isArray(value) ? value.map(String) : [];
  const resolved = requested.map((item) => placementMap[item]).filter(Boolean);
  if (!resolved.length) return {};
  const publisherPlatforms = [...new Set(resolved.map((item) => item.publisher))];
  const facebookPositions = [...new Set(resolved.filter((item) => item.publisher === "facebook").map((item) => item.position))];
  const instagramPositions = [...new Set(resolved.filter((item) => item.publisher === "instagram").map((item) => item.position))];
  return {
    publisher_platforms: publisherPlatforms,
    ...(facebookPositions.length ? { facebook_positions: facebookPositions } : {}),
    ...(instagramPositions.length ? { instagram_positions: instagramPositions } : {}),
  };
}

function toMetaDateTime(value?: string | null) {
  if (!value) return undefined;
  const date = new Date(`${value}T12:00:00-03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function geocodeRestaurantAddress(address?: string | null, city?: string | null) {
  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  const query = [address, city, "Brasil"].filter(Boolean).join(", ");
  if (!apiKey || !query.trim()) return null;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", query);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("region", "br");
    const res = await fetch(url);
    const payload = await res.json().catch(() => ({}));
    const location = payload?.results?.[0]?.geometry?.location;
    if (!res.ok || payload?.status !== "OK" || !location) return null;
    return {
      lat: Number(location.lat),
      lng: Number(location.lng),
      formatted_address: String(payload?.results?.[0]?.formatted_address || query),
    };
  } catch (error) {
    console.error("marketing_geocode_failed", error);
    return null;
  }
}

async function discoverAssets(token: string) {
  const businesses = await graphGet("me/businesses", token, { fields: "id,name,verification_status" }).catch(() => ({ data: [] }));
  const directAdAccounts = await graphGet("me/adaccounts", token, { fields: "id,name,account_status,currency,timezone_name,business" }).catch(() => ({ data: [] }));
  const pages = await graphGet("me/accounts", token, { fields: "id,name,access_token,instagram_business_account{id,username,name},connected_instagram_account{id,username,name}" }).catch(() => ({ data: [] }));
  const permissions = await graphGet("me/permissions", token).catch(() => ({ data: [] }));
  const firstBusiness = businesses?.data?.[0] || null;
  const adAccountsById = new Map<string, any>();
  (directAdAccounts?.data || []).forEach((item: any) => {
    if (item?.id) adAccountsById.set(item.id, item);
  });
  for (const business of businesses?.data || []) {
    const [owned, client] = await Promise.all([
      graphGet(`${business.id}/owned_ad_accounts`, token, { fields: "id,name,account_status,currency,timezone_name,business" }).catch(() => ({ data: [] })),
      graphGet(`${business.id}/client_ad_accounts`, token, { fields: "id,name,account_status,currency,timezone_name,business" }).catch(() => ({ data: [] })),
    ]);
    [...(owned?.data || []), ...(client?.data || [])].forEach((item: any) => {
      if (item?.id) adAccountsById.set(item.id, item);
    });
  }
  const adAccounts = [...adAccountsById.values()];
  const pixelsById = new Map<string, any>();
  await Promise.all(adAccounts.map(async (adAccount: any) => {
    if (!adAccount?.id) return;
    const result = await graphGet(`${normalizeAdAccountId(adAccount.id)}/adspixels`, token, {
      fields: "id,name,last_fired_time",
    }).catch(() => ({ data: [] }));
    (result?.data || []).forEach((pixel: any) => {
      if (pixel?.id) pixelsById.set(pixel.id, { ...pixel, ad_account_id: adAccount.id });
    });
  }));
  const pixels = [...pixelsById.values()];
  let whatsappAccounts: any[] = [];
  let phoneNumbers: any[] = [];
  const warnings: string[] = [];
  if (firstBusiness?.id) {
    const ownedWaba = await graphGet(`${firstBusiness.id}/owned_whatsapp_business_accounts`, token, { fields: "id,name,currency,timezone_id" }).catch((error) => {
      warnings.push(`WhatsApp Business próprio não pôde ser consultado: ${String(error?.message || error)}`);
      return { data: [] };
    });
    const clientWaba = await graphGet(`${firstBusiness.id}/client_whatsapp_business_accounts`, token, { fields: "id,name,currency,timezone_id" }).catch((error) => {
      warnings.push(`WhatsApp Business atribuído não pôde ser consultado: ${String(error?.message || error)}`);
      return { data: [] };
    });
    const byId = new Map<string, any>();
    [...(ownedWaba?.data || []), ...(clientWaba?.data || [])].forEach((item: any) => {
      if (item?.id) byId.set(item.id, item);
    });
    whatsappAccounts = [...byId.values()];
  }
  const firstAd = adAccounts[0] || null;
  const firstPage = pages?.data?.[0] || null;
  const firstInstagram = firstPage?.instagram_business_account || firstPage?.connected_instagram_account || null;
  const firstWaba = whatsappAccounts?.[0] || null;
  if (firstWaba?.id) {
    const phones = await graphGet(`${firstWaba.id}/phone_numbers`, token, { fields: "id,display_phone_number,verified_name,quality_rating" }).catch((error) => {
      warnings.push(`Números WABA não puderam ser consultados: ${String(error?.message || error)}`);
      return { data: [] };
    });
    phoneNumbers = phones?.data || [];
  }
  return {
    businesses: businesses?.data || [],
    adAccounts,
    pixels,
    pages: pages?.data || [],
    whatsappAccounts,
    phoneNumbers,
    permissions: permissions?.data || [],
    warnings,
    capabilities: {
      canReadInstagram: Boolean(firstInstagram?.id),
      canReadWhatsAppBusiness: whatsappAccounts.length > 0,
      canReadWabaPhone: phoneNumbers.length > 0,
    },
    selected: {
      business_id: firstBusiness?.id || null,
      ad_account_id: firstAd?.id || null,
      pixel_id: pixels[0]?.id || null,
      page_id: firstPage?.id || null,
      instagram_account_id: firstInstagram?.id || null,
      whatsapp_business_account_id: firstWaba?.id || null,
      phone_number_id: phoneNumbers?.[0]?.id || null,
      currency: firstAd?.currency || null,
      timezone: firstAd?.timezone_name || null,
    },
  };
}

async function persistDetectedPixel(serviceClient: any, restaurantId: string, assets: any) {
  const pixels = Array.isArray(assets?.pixels) ? assets.pixels : [];
  if (pixels.length !== 1 || !pixels[0]?.id) return;

  const { data: current } = await serviceClient
    .from("marketing_settings")
    .select("facebook_pixel_id")
    .eq("user_id", restaurantId)
    .maybeSingle();
  if (current?.facebook_pixel_id) return;

  const { error } = await serviceClient.from("marketing_settings").upsert({
    user_id: restaurantId,
    facebook_pixel_id: String(pixels[0].id),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) console.error("marketing_pixel_auto_link_failed", error);
}

function moneyToCents(value: unknown) {
  const n = Number(value || 0);
  return Math.max(100, Math.round(n * 100));
}

async function generateCopyWithAi(input: any, knowledge: any) {
  const product = knowledge.product?.name || input.productFocus || "produto em destaque";
  const price = knowledge.product?.price ? `R$ ${Number(knowledge.product.price).toFixed(2).replace(".", ",")}` : "preço especial";
  const fallback = [
    { style: "promocional", primary_text: `Hoje tem ${product} por ${price}. Peça agora e receba rapidinho.`, headline: `${product} em oferta`, description: "Promoção por tempo limitado.", cta: "ORDER_NOW" },
    { style: "urgente", primary_text: `Bateu vontade? Garanta seu ${product} enquanto está disponível.`, headline: `Peça ${product} agora`, description: "Clique e fale pelo WhatsApp.", cta: "WHATSAPP_MESSAGE" },
    { style: "emocional", primary_text: `Seu momento gostoso do dia fica melhor com ${product}.`, headline: "Sabor que combina com hoje", description: "Faça seu pedido em poucos cliques.", cta: "ORDER_NOW" },
    { style: "direta", primary_text: `${product} por ${price}. Clique e faça seu pedido.`, headline: `${product} - ${price}`, description: "Entrega conforme área do restaurante.", cta: "ORDER_NOW" },
    { style: "premium", primary_text: `Escolha ${product} preparado com cuidado pelo ${knowledge.restaurant?.restaurant_name || "restaurante"}.`, headline: "Experiência especial", description: "Peça pelo cardápio digital.", cta: "LEARN_MORE" },
  ];

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return fallback;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
        temperature: 0.65,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Você é um especialista brasileiro em tráfego pago para restaurantes. Gere apenas JSON válido com a chave copies, contendo 5 variações: promocional, urgente, emocional, direta e premium. Não prometa resultado garantido." },
          { role: "user", content: JSON.stringify({ input, restaurant: knowledge.restaurant, product: knowledge.product, menuLink: knowledge.menuLink }) },
        ],
      }),
    });
    const payload = await res.json();
    const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "{}");
    return Array.isArray(parsed?.copies) && parsed.copies.length ? parsed.copies.slice(0, 5) : fallback;
  } catch {
    return fallback;
  }
}

async function buildKnowledge(serviceClient: any, restaurantId: string, input: any) {
  const { data: restaurant } = await serviceClient.from("profiles").select("restaurant_name,address,phone,opening_hours,logo_url,banner_url,description").eq("id", restaurantId).maybeSingle();
  if (restaurant) {
    restaurant.logo_url = publicProductImageUrl(serviceClient, restaurant.logo_url);
    restaurant.banner_url = publicProductImageUrl(serviceClient, restaurant.banner_url);
  }
  let product: any = null;
  if (input.productId) {
    const { data } = await serviceClient.from("products").select("id,name,description,price,category,image_url,available").eq("user_id", restaurantId).eq("id", input.productId).maybeSingle();
    product = data;
  }
  if (!product && input.productFocus) {
    const focus = String(input.productFocus).trim();
    const { data } = await serviceClient
      .from("products")
      .select("id,name,description,price,category,image_url,available")
      .eq("user_id", restaurantId)
      .eq("available", true)
      .or(`name.ilike.%${focus.replace(/[,%()]/g, " ")}%,category.ilike.%${focus.replace(/[,%()]/g, " ")}%`)
      .not("image_url", "is", null)
      .limit(1);
    product = data?.[0] || null;
  }
  if (product) {
    const rawImageUrl = product.image_url;
    const normalizedImageUrl = publicProductImageUrl(serviceClient, rawImageUrl);
    product.original_image_url = rawImageUrl || null;
    // Some restaurant image CDNs reject HEAD/range probes from Edge runtimes even
    // though the public image loads normally in the browser and renderer. Keep a
    // normalized HTTPS URL here and let the renderer perform the definitive read.
    product.image_url = /^https?:\/\//i.test(String(normalizedImageUrl || "")) ? normalizedImageUrl : null;
    product.image_status = product.image_url ? "ready_for_render" : "missing";
  }
  const { data: products } = await serviceClient.from("products").select("id,name,price,category,available").eq("user_id", restaurantId).eq("available", true).order("name").limit(80);
  return {
    restaurant,
    product,
    products: products || [],
    menuLink: `${baseUrl()}/share/menu/${restaurantId}`,
  };
}

async function planCampaign(serviceClient: any, restaurantId: string, input: any) {
  const knowledge = await buildKnowledge(serviceClient, restaurantId, input);
  const copies = await generateCopyWithAi(input, knowledge);
  const destination = String(input.destination || "whatsapp");
  const productFocus = knowledge.product?.name || input.productFocus || input.categoryFocus || "Produto em destaque";
  const dailyBudget = Math.max(5, Number(input.dailyBudget || 20));
  const selectedFormats = normalizeSelectedFormats(input.selectedFormats);
  const selectedPlacements = normalizeSelectedPlacements(selectedFormats, input.selectedPlacements);
  const variations = ["A"];
  const productImageUrl = String(knowledge.product?.image_url || "").trim();
  if (!productImageUrl) {
    throw new Error("Cadastre uma foto real pública do produto antes de gerar a campanha. O PopMarketing AI agora usa templates com fotos reais e não gera imagens por IA.");
  }
  const restaurantLocation = await geocodeRestaurantAddress(knowledge.restaurant?.address, input.targetCity);
  const strategy = {
    objective: input.objective || "vender_mais",
    destination,
    restaurant: {
      name: knowledge.restaurant?.restaurant_name || "PopSystem",
      logo_url: knowledge.restaurant?.logo_url || null,
      banner_url: knowledge.restaurant?.banner_url || null,
    },
    audience: {
      city: input.targetCity || "",
      radius_km: Number(input.targetRadiusKm || 5),
      origin: restaurantLocation,
      age_min: 18,
      age_max: 55,
      interests: ["delivery", "restaurantes", "comida", productFocus],
    },
    placements: selectedPlacements,
    formats: selectedFormats,
    budget: { daily: dailyBudget, recommended_daily: Math.max(dailyBudget, 20) },
    safety: [
      "Campanha será criada pausada para revisão.",
      "Sem promessa de resultado garantido.",
      "Preço e disponibilidade validados pelo cardápio.",
    ],
    product: knowledge.product,
    media: {
      product_image_url: knowledge.product?.image_url || null,
      product_image_status: knowledge.product?.image_status || "not_selected",
      generated_image_url: null,
      generated_image_prompt: null,
      final_image_source: "template_real_photo",
      creative_mode: "template_real_photo",
      creative_flags: {
        usesRealProductPhoto: true,
        usesAiImageGeneration: false,
        renderer: "html_svg_template_png",
      },
      warning: null,
    },
    menu_link: knowledge.menuLink,
  };
  const creativeJobs = selectedFormats.flatMap((format) => variations.map((variation) => ({ format, variation })));
  const creatives = await Promise.all(creativeJobs.map(async ({ format, variation }, index) => {
    const copy = copies[index % Math.max(copies.length, 1)] || copies[0] || {};
    const headline = copy?.headline || `${productFocus} no ${knowledge.restaurant?.restaurant_name || "PopSystem"}`;
    const primaryText = copy?.primary_text || `Peça ${productFocus} agora.`;
    const description = copy?.description || "Campanha criada com IA para revisão.";
    const price = knowledge.product?.price ? `R$ ${Number(knowledge.product.price).toFixed(2).replace(".", ",")}` : "";
    const placement = (creativeFormatConfig[format]?.placement || []).filter((item) => selectedPlacements.includes(item)).join(", ");
    const finalImageUrl = await renderTemplateCreativeImage({
      serviceClient,
      restaurantId,
      format,
      restaurantName: knowledge.restaurant?.restaurant_name || "PopSystem",
      productName: productFocus,
      productImageUrl,
      priceLabel: price,
      headline,
      cta: destination === "whatsapp" ? "Chame no WhatsApp" : "Peça agora",
      logoUrl: knowledge.restaurant?.logo_url || null,
      objective: input.objective || "vender_mais",
      category: knowledge.product?.category || null,
    });
    if (!finalImageUrl) throw new Error(`O template não retornou imagem final para o formato ${creativeFormatConfig[format]?.label || format}.`);
    return {
      format,
      type: "template_static",
      image_url: finalImageUrl,
      logo_url: knowledge.restaurant?.logo_url || null,
      generated_image_prompt: `Template ${templateKind(productFocus, knowledge.product?.category, input.objective)} renderizado em PNG com foto real do produto. Posicionamentos: ${placement || "auto"}.`,
      source_product_image_url: productImageUrl,
      variation,
      mode: "template_real_photo",
      warning: null,
      image_error: null,
      headline,
      primary_text: primaryText,
      description,
      cta: destination === "whatsapp" ? "WHATSAPP_MESSAGE" : "ORDER_NOW",
    };
  }));
  if (creatives.length !== creativeJobs.length || creatives.some((creative) => !creative.image_url)) {
    throw new Error("Não foi possível renderizar todos os criativos por template. Confira se a foto do produto e a logo estão públicas.");
  }
  return { knowledge, strategy, copies, creatives };
}

function creativeToRow(campaignId: string, creative: any) {
  return {
    campaign_id: campaignId,
    format: creative.format,
    type: creative.type || "ai_ad_creative",
    image_url: creative.image_url || null,
    video_url: creative.video_url || null,
    logo_url: creative.logo_url || null,
    generated_image_prompt: creative.generated_image_prompt || null,
    source_product_image_url: creative.source_product_image_url || null,
    variation: creative.variation || null,
    mode: creative.mode || null,
    warning: creative.warning || null,
    image_error: creative.image_error || null,
    headline: creative.headline || null,
    primary_text: creative.primary_text || null,
    description: creative.description || null,
    cta: creative.cta || "ORDER_NOW",
    status: creative.status || "draft",
  };
}

function compactCreativeRow(row: any) {
  return {
    campaign_id: row.campaign_id,
    format: row.format,
    type: row.type || "ai_ad_creative",
    image_url: row.image_url || null,
    video_url: row.video_url || null,
    logo_url: row.logo_url || null,
    generated_image_prompt: row.generated_image_prompt || null,
    headline: row.headline || null,
    primary_text: row.primary_text || null,
    description: row.description || null,
    cta: row.cta || "ORDER_NOW",
    status: row.status || "draft",
  };
}

function baseCreativeRow(row: any) {
  return {
    campaign_id: row.campaign_id,
    format: row.format,
    type: row.type || "ai_ad_creative",
    image_url: row.image_url || null,
    video_url: row.video_url || null,
    headline: row.headline || null,
    primary_text: row.primary_text || null,
    description: row.description || null,
    cta: row.cta || "ORDER_NOW",
    status: row.status || "draft",
  };
}

async function insertMarketingCreatives(serviceClient: any, campaignId: string, creatives: any[]) {
  const rows = creatives.map((creative) => creativeToRow(campaignId, creative));
  let result = await serviceClient.from("marketing_creatives").insert(rows);
  if (result.error && /source_product_image_url|variation|mode|warning|image_error|schema cache/i.test(String(result.error.message || ""))) {
    result = await serviceClient.from("marketing_creatives").insert(rows.map(compactCreativeRow));
  }
  if (result.error && /logo_url|generated_image_prompt|schema cache/i.test(String(result.error.message || ""))) {
    result = await serviceClient.from("marketing_creatives").insert(rows.map(baseCreativeRow));
  }
  return result;
}

async function loadOrRepairCreativeRows(serviceClient: any, campaign: any) {
  const { data: existingRows, error } = await serviceClient
    .from("marketing_creatives")
    .select("*")
    .eq("campaign_id", campaign.id);
  if (error) throw error;
  const rowsWithImage = (existingRows || []).filter((item: any) => item?.image_url);
  if (rowsWithImage.length > 0) return existingRows || [];

  const snapshotCreatives = Array.isArray(campaign.review_snapshot?.creatives)
    ? campaign.review_snapshot.creatives.filter((item: any) => item?.image_url)
    : [];
  if (snapshotCreatives.length === 0) return existingRows || [];

  const result = await insertMarketingCreatives(serviceClient, campaign.id, snapshotCreatives);
  if (result.error) throw result.error;

  const { data: repairedRows, error: repairedError } = await serviceClient
    .from("marketing_creatives")
    .select("*")
    .eq("campaign_id", campaign.id);
  if (repairedError) throw repairedError;
  return repairedRows || [];
}

async function updateMarketingCreative(serviceClient: any, creativeId: string, creative: any) {
  const fullRow = creativeToRow("", creative);
  delete (fullRow as any).campaign_id;

  let result = await serviceClient
    .from("marketing_creatives")
    .update(fullRow)
    .eq("id", creativeId)
    .select("*")
    .single();

  if (result.error && /source_product_image_url|variation|mode|warning|image_error|schema cache/i.test(String(result.error.message || ""))) {
    const row = compactCreativeRow({ ...fullRow, campaign_id: "" });
    delete (row as any).campaign_id;
    result = await serviceClient
      .from("marketing_creatives")
      .update(row)
      .eq("id", creativeId)
      .select("*")
      .single();
  }

  if (result.error && /logo_url|generated_image_prompt|schema cache/i.test(String(result.error.message || ""))) {
    const row = baseCreativeRow({ ...fullRow, campaign_id: "" });
    delete (row as any).campaign_id;
    result = await serviceClient
      .from("marketing_creatives")
      .update(row)
      .eq("id", creativeId)
      .select("*")
      .single();
  }

  return result;
}

function replaceSnapshotCreative(snapshot: any, creative: any) {
  const current = snapshot && typeof snapshot === "object" ? snapshot : {};
  const list = Array.isArray(current.creatives) ? current.creatives : [];
  let replaced = false;
  const creatives = list.map((item: any) => {
    const matches = (creative.id && item.id === creative.id)
      || (item.format === creative.format && String(item.variation || "") === String(creative.variation || ""));
    if (!matches) return item;
    replaced = true;
    return { ...item, ...creative };
  });
  if (!replaced) creatives.push(creative);
  return { ...current, creatives };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { user, serviceClient } = await getUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    if (action === "start_oauth") {
      const appId = Deno.env.get("META_APP_ID");
      if (!appId) return json({ error: "META_APP_ID não configurado." }, 400);
      const loginConfigId = Deno.env.get("META_LOGIN_CONFIG_ID");
      const state = crypto.randomUUID();
      const scopes = [
        "ads_management",
        "ads_read",
        "business_management",
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_ads",
      ].join(",");
      const url = new URL("https://www.facebook.com/dialog/oauth");
      url.searchParams.set("client_id", appId);
      url.searchParams.set("redirect_uri", redirectUri());
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", scopes);
      url.searchParams.set("auth_type", "rerequest");
      url.searchParams.set("return_scopes", "true");
      if (loginConfigId) url.searchParams.set("config_id", loginConfigId);
      return json({ url: url.toString(), state, redirect_uri: redirectUri() });
    }

    if (action === "complete_oauth") {
      const appId = Deno.env.get("META_APP_ID");
      const appSecret = Deno.env.get("META_APP_SECRET");
      const code = String(body.code || "");
      if (!appId || !appSecret) return json({ error: "META_APP_ID/META_APP_SECRET não configurados." }, 400);
      if (!code) return json({ error: "Código Meta não informado." }, 400);
      const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
      tokenUrl.searchParams.set("client_id", appId);
      tokenUrl.searchParams.set("client_secret", appSecret);
      tokenUrl.searchParams.set("redirect_uri", redirectUri());
      tokenUrl.searchParams.set("code", code);
      const tokenRes = await fetch(tokenUrl);
      const tokenPayload = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenPayload?.error?.message || "Falha ao conectar Meta.");
      const token = String(tokenPayload.access_token || "");
      const assets = await discoverAssets(token);
      const encrypted = await encryptToken(token);
      const selected = assets.selected;
      const { data: existingConnection } = await serviceClient
        .from("meta_connections")
        .select("*")
        .eq("restaurant_id", user.id)
        .maybeSingle();
      const resolvedSelected = {
        business_id: selected.business_id || existingConnection?.business_id || null,
        ad_account_id: selected.ad_account_id || existingConnection?.ad_account_id || null,
        pixel_id: selected.pixel_id || existingConnection?.assets_json?.selected?.pixel_id || null,
        page_id: selected.page_id || existingConnection?.page_id || null,
        instagram_account_id: selected.instagram_account_id || existingConnection?.instagram_account_id || null,
        whatsapp_business_account_id: selected.whatsapp_business_account_id || existingConnection?.whatsapp_business_account_id || null,
        phone_number_id: selected.phone_number_id || existingConnection?.phone_number_id || null,
        currency: selected.currency || existingConnection?.currency || null,
        timezone: selected.timezone || existingConnection?.timezone || null,
      };
      const persistedAssets = {
        ...(existingConnection?.assets_json || {}),
        ...assets,
        selected: resolvedSelected,
      };
      const expiresAt = tokenPayload.expires_in ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString() : null;
      const { data, error } = await serviceClient.from("meta_connections").upsert({
        restaurant_id: user.id,
        business_id: resolvedSelected.business_id,
        ad_account_id: resolvedSelected.ad_account_id,
        page_id: resolvedSelected.page_id,
        instagram_account_id: resolvedSelected.instagram_account_id,
        whatsapp_business_account_id: resolvedSelected.whatsapp_business_account_id,
        phone_number_id: resolvedSelected.phone_number_id,
        access_token_encrypted: encrypted,
        token_expires_at: expiresAt,
        status: "connected",
        permissions: assets.permissions || [],
        assets_json: persistedAssets,
        currency: resolvedSelected.currency,
        timezone: resolvedSelected.timezone,
        last_sync_at: new Date().toISOString(),
      }, { onConflict: "restaurant_id" }).select("*").single();
      if (error) throw error;
      await persistDetectedPixel(serviceClient, user.id, assets);
      return json({ connection: { ...data, access_token_encrypted: undefined } });
    }

    if (action === "sync_assets") {
      const { data: conn, error } = await serviceClient.from("meta_connections").select("*").eq("restaurant_id", user.id).maybeSingle();
      if (error) throw error;
      if (!conn?.access_token_encrypted) return json({ error: "Conta Meta não conectada." }, 400);
      const token = await decryptToken(conn.access_token_encrypted);
      const assets = await discoverAssets(token);
      const selected = assets.selected;
      const { data } = await serviceClient.from("meta_connections").update({
        business_id: selected.business_id || conn.business_id,
        ad_account_id: selected.ad_account_id || conn.ad_account_id,
        page_id: selected.page_id || conn.page_id,
        instagram_account_id: selected.instagram_account_id || conn.instagram_account_id,
        whatsapp_business_account_id: selected.whatsapp_business_account_id || conn.whatsapp_business_account_id,
        phone_number_id: selected.phone_number_id || conn.phone_number_id,
        permissions: assets.permissions || conn.permissions || [],
        assets_json: assets,
        currency: selected.currency || conn.currency,
        timezone: selected.timezone || conn.timezone,
        status: "connected",
        last_sync_at: new Date().toISOString(),
      }).eq("id", conn.id).select("*").single();
      await persistDetectedPixel(serviceClient, user.id, assets);
      return json({ connection: { ...data, access_token_encrypted: undefined } });
    }

    if (action === "get_account_finance") {
      const { data: conn, error } = await serviceClient
        .from("meta_connections")
        .select("id,access_token_encrypted,ad_account_id,currency")
        .eq("restaurant_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!conn?.access_token_encrypted || !conn?.ad_account_id) {
        return json({ error: "Conta de anúncios Meta não conectada." }, 400);
      }

      const token = await decryptToken(conn.access_token_encrypted);
      const accountId = normalizeAdAccountId(conn.ad_account_id);
      const account = await graphGet(accountId, token, {
        fields: "id,name,account_status,currency,timezone_name,balance,amount_spent,spend_cap",
      });
      const balanceMinor = Number(account?.balance || 0);
      const amountSpentMinor = Number(account?.amount_spent || 0);
      const spendCapMinor = account?.spend_cap == null ? null : Number(account.spend_cap);
      // Keep the finance card aligned with the first implementation: display
      // Meta's AdAccount.balance field exactly as returned by the API.
      const availableFundsMinor = Number.isFinite(balanceMinor) ? balanceMinor : null;
      return json({
        finance: {
          adAccountId: account?.id || accountId,
          name: account?.name || null,
          accountStatus: Number(account?.account_status || 0),
          currency: account?.currency || conn.currency || "BRL",
          timezone: account?.timezone_name || null,
          balanceMinor,
          amountSpentMinor,
          spendCapMinor,
          directPrepayBalanceMinor: null,
          storedBalanceMinor: null,
          availableFundsMinor,
          availableFundsSource: availableFundsMinor == null ? "unavailable" : "account_balance",
          isPrepayAccount: null,
          fetchedAt: new Date().toISOString(),
        },
      });
    }

    if (action === "plan_campaign") {
      const plan = await planCampaign(serviceClient, user.id, body);
      const { data: connection } = await serviceClient.from("meta_connections").select("id,ad_account_id,page_id,instagram_account_id,whatsapp_business_account_id,phone_number_id,status").eq("restaurant_id", user.id).maybeSingle();
      const campaignPayload = {
        restaurant_id: user.id,
        connection_id: connection?.id || null,
        name: body.name || `PopMarketing AI - ${plan.strategy.product?.name || body.productFocus || "Campanha"}`,
        objective: "OUTCOME_TRAFFIC",
        destination: body.destination || "whatsapp",
        daily_budget: Number(body.dailyBudget || 20),
        status: "review",
        start_date: body.startDate || null,
        end_date: body.endDate || null,
        target_city: body.targetCity || null,
        target_radius_km: Number(body.targetRadiusKm || 5),
        product_focus: plan.strategy.product?.name || body.productFocus || null,
        product_id: plan.strategy.product?.id || body.productId || null,
        menu_link: plan.knowledge.menuLink,
        ai_strategy: { ...plan.strategy, copies: plan.copies },
        review_snapshot: { connection, creatives: plan.creatives, knowledge: plan.knowledge },
      };
      const { data: campaign, error } = await serviceClient.from("marketing_campaigns").insert(campaignPayload).select("*").single();
      if (error) throw error;
      const adsetPayload = {
        campaign_id: campaign.id,
        audience_json: plan.strategy.audience,
        placement_json: { placements: plan.strategy.placements },
        budget: Number(body.dailyBudget || 20),
        status: "draft",
      };
      const { error: adsetError } = await serviceClient.from("marketing_adsets").insert(adsetPayload);
      if (adsetError) {
        await serviceClient.from("marketing_campaigns").update({ status: "error", last_error: adsetError.message }).eq("id", campaign.id);
        throw adsetError;
      }
      const { error: creativeError } = await insertMarketingCreatives(serviceClient, campaign.id, plan.creatives);
      if (creativeError) {
        await serviceClient.from("marketing_campaigns").update({ status: "error", last_error: creativeError.message }).eq("id", campaign.id);
        throw creativeError;
      }
      await serviceClient.from("marketing_ai_logs").insert({ restaurant_id: user.id, campaign_id: campaign.id, action: "plan_campaign", input: body, output: { strategy: plan.strategy } });
      return json({ campaignId: campaign.id, plan: { campaign, creatives: plan.creatives, copies: plan.copies, strategy: plan.strategy } });
    }

    if (action === "rerender_creative") {
      const campaignId = String(body.campaignId || "");
      const creativeId = String(body.creativeId || "");
      const format = normalizeFormatKey(String(body.format || "feed_1080x1080"));
      const variation = String(body.variation || "A");
      const copyIndex = Math.max(0, Number(body.copyIndex || 0));
      const sourceImageUrl = publicProductImageUrl(serviceClient, String(body.sourceImageUrl || ""));

      if (!campaignId) return json({ error: "Campanha não informada." }, 400);
      if (!creativeFormatConfig[format]) return json({ error: "Formato de criativo inválido." }, 400);
      if (!await isUsablePublicImage(sourceImageUrl)) return json({ error: "A imagem enviada não está pública ou não pôde ser lida." }, 400);

      const { data: campaign } = await serviceClient
        .from("marketing_campaigns")
        .select("*")
        .eq("restaurant_id", user.id)
        .eq("id", campaignId)
        .single();
      if (!campaign?.id) return json({ error: "Campanha não encontrada." }, 404);

      const creativeRows = await loadOrRepairCreativeRows(serviceClient, campaign);
      const existing = (creativeRows || []).find((item: any) => creativeId && item.id === creativeId)
        || (creativeRows || []).find((item: any) => item.format === format && String(item.variation || "A") === variation)
        || null;

      const copies = Array.isArray(campaign.ai_strategy?.copies) ? campaign.ai_strategy.copies : [];
      const copy = copies[copyIndex] || copies[0] || {};
      const product = campaign.ai_strategy?.product || {};
      const restaurant = campaign.ai_strategy?.restaurant || {};
      const productName = product?.name || campaign.product_focus || "Oferta especial";
      const headline = copy?.headline || existing?.headline || `${productName} em oferta`;
      const primaryText = copy?.primary_text || existing?.primary_text || `Peça ${productName} agora.`;
      const description = copy?.description || existing?.description || "Campanha criada com IA para revisão.";
      const price = product?.price ? `R$ ${Number(product.price).toFixed(2).replace(".", ",")}` : "";
      const finalImageUrl = await renderTemplateCreativeImage({
        serviceClient,
        restaurantId: user.id,
        format,
        restaurantName: restaurant?.name || "PopSystem",
        productName,
        productImageUrl: sourceImageUrl,
        priceLabel: price,
        headline,
        cta: campaign.destination === "whatsapp" ? "Chame no WhatsApp" : "Peça agora",
        logoUrl: restaurant?.logo_url || null,
        objective: campaign.objective || "vender_mais",
        category: product?.category || null,
      });

      const updatedCreative = {
        ...(existing || {}),
        id: existing?.id || undefined,
        format,
        type: "template_static",
        image_url: finalImageUrl,
        logo_url: restaurant?.logo_url || existing?.logo_url || null,
        generated_image_prompt: `Template ${templateKind(productName, product?.category, campaign.objective)} refeito com foto escolhida manualmente para ${format}.`,
        source_product_image_url: sourceImageUrl,
        variation,
        mode: "template_real_photo",
        warning: null,
        image_error: null,
        headline,
        primary_text: primaryText,
        description,
        cta: campaign.destination === "whatsapp" ? "WHATSAPP_MESSAGE" : "ORDER_NOW",
        status: "draft",
      };

      let savedCreative = updatedCreative;
      if (existing?.id) {
        const result = await updateMarketingCreative(serviceClient, existing.id, updatedCreative);
        if (result.error) throw result.error;
        savedCreative = { ...updatedCreative, ...(result.data || {}) };
      } else {
        const result = await insertMarketingCreatives(serviceClient, campaign.id, [updatedCreative]);
        if (result.error) throw result.error;
        const { data } = await serviceClient
          .from("marketing_creatives")
          .select("*")
          .eq("campaign_id", campaign.id)
          .eq("format", format)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        savedCreative = { ...updatedCreative, ...(data || {}) };
      }

      await serviceClient
        .from("marketing_campaigns")
        .update({
          status: campaign.status === "error" ? "review" : campaign.status,
          last_error: null,
          review_snapshot: replaceSnapshotCreative(campaign.review_snapshot, savedCreative),
        })
        .eq("id", campaign.id);

      return json({ creative: savedCreative });
    }

    if (action === "publish_paused") {
      const campaignId = String(body.campaignId || "");
      const creativeId = String(body.creativeId || "");
      const copyIndex = Math.max(0, Number(body.copyIndex || 0));
      const { data: campaign } = await serviceClient.from("marketing_campaigns").select("*, meta_connections(*)").eq("restaurant_id", user.id).eq("id", campaignId).single();
      if (!campaign?.id) return json({ error: "Campanha não encontrada." }, 404);
      const conn = campaign.meta_connections;
      if (!conn?.access_token_encrypted || !conn?.ad_account_id || !conn?.page_id) return json({ error: "Conecte uma conta Meta com conta de anúncio e página antes de publicar." }, 400);
      const token = await decryptToken(conn.access_token_encrypted);
      const adAccountId = normalizeAdAccountId(conn.ad_account_id);
      await serviceClient.from("marketing_campaigns").update({ status: "publishing", last_error: null }).eq("id", campaign.id);

      try {
        const radiusKm = Math.max(1, Number(campaign.target_radius_km || campaign.ai_strategy?.audience?.radius_km || 5));
        const origin = campaign.ai_strategy?.audience?.origin;
        if (!origin?.lat || !origin?.lng) {
          throw new Error("Localização do restaurante não encontrada. Corrija o endereço antes de publicar; a campanha não será ampliada automaticamente para todo o Brasil.");
        }
        const geoLocations = {
          custom_locations: [{ latitude: Number(origin.lat), longitude: Number(origin.lng), radius: radiusKm, distance_unit: "kilometer" }],
        };
        const copies = Array.isArray(campaign.ai_strategy?.copies) ? campaign.ai_strategy.copies : [];
        const selectedCopy = copies[copyIndex] || copies[0] || {};
        const creativeRows = await loadOrRepairCreativeRows(serviceClient, campaign);
        const creativeRow = (creativeRows || []).find((item: any) => creativeId && item.id === creativeId && item.image_url)
          || (creativeRows || []).find((item: any) => item.format === "feed_1080x1080" && item.variation === "A" && item.image_url)
          || (creativeRows || []).find((item: any) => item.format === "feed_1080x1080" && item.image_url)
          || (creativeRows || []).find((item: any) => item.image_url);
        if (!creativeRow?.image_url) {
          throw new Error("Gere um criativo final com imagem antes de publicar.");
        }
        const imageHash = await uploadMetaAdImage(adAccountId, token, creativeRow.image_url);
        if (!imageHash) {
          throw new Error("A Meta não retornou o hash da imagem. Gere o criativo novamente e tente publicar.");
        }
        const link = campaign.menu_link || `${baseUrl()}/share/menu/${user.id}`;
        const linkData: Record<string, any> = {
          link,
          message: selectedCopy?.primary_text || creativeRow?.primary_text || "Clique e faça seu pedido.",
          name: selectedCopy?.headline || creativeRow?.headline || campaign.name,
          description: selectedCopy?.description || creativeRow?.description || "Campanha PopMarketing AI",
          call_to_action: { type: "LEARN_MORE", value: { link } },
          image_hash: imageHash,
        };
        const metaCreative = await graphPost(`${adAccountId}/adcreatives`, token, {
          name: `${campaign.name} - Criativo IA`,
          object_story_spec: {
            page_id: conn.page_id,
            link_data: linkData,
          },
        });
        const metaCampaign = await createPausedMetaCampaign(adAccountId, token, campaign.name, campaign.objective);
        const selectedPlacements = campaign.ai_strategy?.placements || campaign.review_snapshot?.placements || [];
        const metaAdset = await graphPost(`${adAccountId}/adsets`, token, {
          name: `${campaign.name} - Público IA`,
          campaign_id: metaCampaign.id,
          daily_budget: moneyToCents(campaign.daily_budget),
          billing_event: "IMPRESSIONS",
          optimization_goal: "LINK_CLICKS",
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          destination_type: "WEBSITE",
          targeting: {
            geo_locations: geoLocations,
            age_min: 18,
            age_max: 55,
            ...buildMetaPlacements(selectedPlacements),
            targeting_automation: { advantage_audience: 0 },
          },
          ...(toMetaDateTime(campaign.start_date) ? { start_time: toMetaDateTime(campaign.start_date) } : {}),
          ...(toMetaDateTime(campaign.end_date) ? { end_time: toMetaDateTime(campaign.end_date) } : {}),
          status: "PAUSED",
        });
        const metaAd = await graphPost(`${adAccountId}/ads`, token, {
          name: `${campaign.name} - Anúncio IA`,
          adset_id: metaAdset.id,
          creative: { creative_id: metaCreative.id },
          status: "PAUSED",
        });
        const { data: localAdset } = await serviceClient
          .from("marketing_adsets")
          .select("id")
          .eq("campaign_id", campaign.id)
          .limit(1)
          .maybeSingle();
        await serviceClient.from("marketing_campaigns").update({ meta_campaign_id: metaCampaign.id, status: "paused", last_error: null }).eq("id", campaign.id);
        await serviceClient.from("marketing_adsets").update({ meta_adset_id: metaAdset.id, status: "paused" }).eq("campaign_id", campaign.id);
        if (creativeRow?.id) await serviceClient.from("marketing_creatives").update({ meta_creative_id: metaCreative.id, status: "paused" }).eq("id", creativeRow.id);
        await serviceClient.from("marketing_ads").insert({ campaign_id: campaign.id, adset_id: localAdset?.id || null, creative_id: creativeRow?.id || null, meta_ad_id: metaAd.id, status: "paused", performance_json: {} });
        return json({ ok: true, meta: { campaign: metaCampaign, adset: metaAdset, creative: metaCreative, ad: metaAd } });
      } catch (publishError: any) {
        const errorMessage = normalizeMetaPublishError(publishError);
        await serviceClient.from("marketing_campaigns").update({ status: "error", last_error: errorMessage }).eq("id", campaign.id);
        await serviceClient.from("marketing_ai_logs").insert({ restaurant_id: user.id, campaign_id: campaign.id, action: "publish_paused", input: body, output: {}, error: errorMessage });
        return json({ error: errorMessage }, 400);
      }
    }

    if (action === "update_campaign") {
      const campaignId = String(body.campaignId || "");
      const { data: campaign } = await serviceClient.from("marketing_campaigns").select("*, meta_connections(*)").eq("restaurant_id", user.id).eq("id", campaignId).single();
      if (!campaign?.id) return json({ error: "Campanha não encontrada." }, 404);

      const dailyBudget = Math.max(5, Number(body.dailyBudget || campaign.daily_budget || 5));
      const endDate = body.endDate === null ? null : String(body.endDate || campaign.end_date || "") || null;
      const localUpdate = await serviceClient.from("marketing_campaigns").update({ daily_budget: dailyBudget, end_date: endDate }).eq("id", campaign.id).select("*").single();
      if (localUpdate.error) throw localUpdate.error;

      if (campaign.meta_campaign_id && campaign.meta_connections?.access_token_encrypted) {
        const token = await decryptToken(campaign.meta_connections.access_token_encrypted);
        const { data: adset } = await serviceClient.from("marketing_adsets").select("meta_adset_id").eq("campaign_id", campaign.id).maybeSingle();
        if (adset?.meta_adset_id) {
          await graphPost(adset.meta_adset_id, token, {
            daily_budget: moneyToCents(dailyBudget),
            ...(toMetaDateTime(endDate) ? { end_time: toMetaDateTime(endDate) } : {}),
          });
        }
      }
      return json({ campaign: localUpdate.data });
    }

    if (action === "set_campaign_status") {
      const campaignId = String(body.campaignId || "");
      const requestedStatus = String(body.status || "").toUpperCase();
      if (!new Set(["ACTIVE", "PAUSED"]).has(requestedStatus)) return json({ error: "Status de campanha inválido." }, 400);
      const { data: campaign } = await serviceClient.from("marketing_campaigns").select("*, meta_connections(*)").eq("restaurant_id", user.id).eq("id", campaignId).single();
      if (!campaign?.meta_campaign_id || !campaign.meta_connections?.access_token_encrypted) return json({ error: "A campanha ainda não foi publicada na Meta." }, 400);
      const token = await decryptToken(campaign.meta_connections.access_token_encrypted);
      await graphPost(campaign.meta_campaign_id, token, { status: requestedStatus });
      const localStatus = requestedStatus === "ACTIVE" ? "active" : "paused";
      await Promise.all([
        serviceClient.from("marketing_campaigns").update({ status: localStatus, last_error: null }).eq("id", campaign.id),
        serviceClient.from("marketing_adsets").update({ status: localStatus }).eq("campaign_id", campaign.id),
        serviceClient.from("marketing_ads").update({ status: localStatus }).eq("campaign_id", campaign.id),
      ]);
      return json({ ok: true, status: localStatus });
    }

    if (action === "metrics") {
      const campaignId = String(body.campaignId || "");
      const { data: campaign } = await serviceClient.from("marketing_campaigns").select("*, meta_connections(*)").eq("restaurant_id", user.id).eq("id", campaignId).single();
      if (!campaign?.meta_campaign_id) return json({ metrics: [] });
      if (!campaign.meta_connections?.access_token_encrypted) return json({ error: "A conexão com a Meta expirou. Reconecte a conta para consultar as métricas." }, 400);
      const token = await decryptToken(campaign.meta_connections.access_token_encrypted);
      const insights = await graphGet(`${campaign.meta_campaign_id}/insights`, token, { fields: "date_start,impressions,reach,clicks,ctr,cpc,cpm,spend", time_increment: "1" });
      const rows = (insights?.data || []).map((item: any) => ({
        campaign_id: campaign.id,
        date: item.date_start,
        impressions: Number(item.impressions || 0),
        reach: Number(item.reach || 0),
        clicks: Number(item.clicks || 0),
        ctr: Number(item.ctr || 0),
        cpc: Number(item.cpc || 0),
        cpm: Number(item.cpm || 0),
        spend: Number(item.spend || 0),
      }));
      if (rows.length) await serviceClient.from("marketing_metrics").upsert(rows, { onConflict: "campaign_id,date" });
      return json({ metrics: rows });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (error: any) {
    console.error("[meta-marketing]", error);
    return json({ error: error?.message || "Erro inesperado no PopMarketing AI." }, 200);
  }
});
