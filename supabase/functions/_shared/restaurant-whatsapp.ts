import { sendWhatsAppByConfiguredProvider } from './whatsapp-provider.ts';

const EVOLUTION_URL = "https://api.boracume.com";

type AutoResponses = {
  welcome?: string;
  menu_link?: string;
  order_received?: string;
  preparing?: string;
  ready?: string;
  out_for_delivery?: string;
  delivered?: string;
  cancelled?: string;
};

type RestaurantContext = {
  enabled: boolean;
  restaurantName: string;
  autoResponses: Required<AutoResponses>;
};

const defaultResponses: Required<AutoResponses> = {
  welcome: "Olá! 👋 Bem-vindo ao {restaurant_name}.\n\nClique aqui e faça seu pedido: {menu_link}",
  menu_link: "Clique aqui e faça seu pedido: {menu_link}",
  order_received: "🎉 Recebemos seu pedido #{order_number}! Acompanhe aqui: {track_link}",
  preparing: "👨‍🍳 Seu pedido #{order_number} está sendo preparado. Acompanhe aqui: {track_link}",
  ready: "✅ Seu pedido #{order_number} está pronto! Acompanhe aqui: {track_link}",
  out_for_delivery: "🚗 Seu pedido #{order_number} saiu para entrega. Acompanhe aqui: {track_link}",
  delivered: "📦 Seu pedido #{order_number} foi entregue. Obrigado pela preferência!",
  cancelled: "❌ Seu pedido #{order_number} foi cancelado. Se precisar, fale com a gente."
};

function baseUrl() {
  return (Deno.env.get("PUBLIC_WEB_BASE_URL") || Deno.env.get("VITE_PUBLIC_WEB_BASE_URL") || "https://popsystem.com.br").replace(/\/+$/, "");
}

function parseAutoResponses(value: unknown): AutoResponses {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AutoResponses;
}

export function normalizePhone(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export function extractPhoneFromRemoteJid(value: string | null | undefined) {
  const remote = String(value || "").split("@")[0].split(":")[0];
  return normalizePhone(remote);
}

export function buildPhoneCandidates(value: string | null | undefined) {
  const normalized = normalizePhone(value);
  const withoutCountry = normalized.startsWith("55") ? normalized.slice(2) : normalized;
  const localVariants = [withoutCountry];
  if (withoutCountry.length === 11 && withoutCountry[2] === "9") {
    localVariants.push(`${withoutCountry.slice(0, 2)}${withoutCountry.slice(3)}`);
  } else if (withoutCountry.length === 10) {
    localVariants.push(`${withoutCountry.slice(0, 2)}9${withoutCountry.slice(2)}`);
  }
  const candidates = localVariants.flatMap((item) => [item, `55${item}`]).filter(Boolean);

  return Array.from(new Set(candidates));
}

export function fillTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => variables[key] ?? "");
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    let safe = value.trim().replace(/[^0-9.,-]/g, "");
    const lastComma = safe.lastIndexOf(",");
    const lastDot = safe.lastIndexOf(".");
    const decimalPos = Math.max(lastComma, lastDot);

    if (decimalPos >= 0) {
      const integerPart = safe.slice(0, decimalPos).replace(/[^0-9-]/g, "");
      const fractionPart = safe.slice(decimalPos + 1).replace(/[^0-9]/g, "");
      safe = `${integerPart}.${fractionPart}`;
    } else {
      safe = safe.replace(/[^0-9-]/g, "");
    }

    const parsed = Number(safe);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(toNumber(value));
}

function formatPaymentMethodLabel(value: unknown, order?: any) {
  const raw = normalizeText(value).toLowerCase();
  const labels: Record<string, string> = {
    pix: "PIX",
    pix_online: "PIX online",
    pix_entrega: "PIX na entrega",
    dinheiro: "Dinheiro",
    cartao: "Cartao",
    cartao_credito: "Cartao de Credito",
    cartao_debito: "Cartao de Debito",
    credito: "Cartao de Credito",
    debito: "Cartao de Debito",
  };

  if (raw === "pix" && normalizeText(order?.acceptance_status).toLowerCase() === "awaiting_pix_payment") {
    return "PIX online";
  }

  if (labels[raw]) return labels[raw];
  if (!raw) return "Nao informado";

  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseOrderItems(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getItemDisplayName(item: any) {
  return normalizeText(item?.product_name || item?.name || "Produto nao informado");
}

function getItemQuantity(item: any) {
  const quantity = toNumber(item?.quantity);
  return quantity > 0 ? quantity : 1;
}

function getItemUnitPrice(item: any) {
  const price = toNumber(item?.unit_price ?? item?.price);
  return price >= 0 ? price : 0;
}

function getOptionsExtra(item: any) {
  const options = Array.isArray(item?.options) ? item.options : [];
  return options.reduce((total: number, option: any) => {
    if (!option || typeof option === "string") return total;
    const extra = toNumber(option?.price ?? option?.additional_price);
    return total + (extra > 0 ? extra : 0);
  }, 0);
}

function getItemTotal(item: any) {
  const explicitTotal = toNumber(item?.total_price ?? item?.subtotal ?? item?.total);
  if (explicitTotal > 0) return explicitTotal;

  const quantity = getItemQuantity(item);
  const unitPrice = getItemUnitPrice(item);
  return quantity * unitPrice + quantity * getOptionsExtra(item);
}

function appendDetailLine(
  bucket: Map<string, { key: string; text: string; price?: number }>,
  text: string,
  price?: number,
  keyHint?: string
) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return;

  const normalizedPrice = typeof price === "number" && price > 0 ? price : undefined;
  const fallbackKey = normalizedText.toLowerCase();
  const key = normalizeText(keyHint) || fallbackKey;
  const existing = bucket.get(key);

  if (existing) {
    if (normalizedPrice !== undefined && existing.price === undefined) {
      bucket.set(key, { ...existing, price: normalizedPrice });
    }
    return;
  }

  const existingByText = bucket.get(fallbackKey);
  if (existingByText) {
    if (normalizedPrice !== undefined && existingByText.price === undefined) {
      bucket.set(fallbackKey, { ...existingByText, price: normalizedPrice });
    }
    return;
  }

  bucket.set(key, { key, text: normalizedText, price: normalizedPrice });
}

function getItemDetailLines(item: any) {
  const bucket = new Map<string, { key: string; text: string; price?: number }>();
  const options = Array.isArray(item?.options) ? item.options : [];
  const hasStoredOptions = options.length > 0;
  const variations = Array.isArray(item?.variations) ? item.variations : [];

  for (const variation of variations) {
    if (!variation) continue;

    if (typeof variation === "string") {
      if (hasStoredOptions) continue;
      appendDetailLine(bucket, variation);
      continue;
    }

    if (typeof variation === "object") {
      const label = normalizeText(variation?.name || variation?.label || variation?.receipt_label);
      const value =
        Array.isArray(variation?.options) && variation.options.length > 0
          ? variation.options.map((option: any) => normalizeText(option)).filter(Boolean).join(", ")
          : normalizeText(variation?.value || variation?.selected_option || variation?.choice);

      appendDetailLine(
        bucket,
        label && value ? `${label}: ${value}` : label || value,
        toNumber(variation?.price ?? variation?.additional_price) || undefined,
        variation?.key
      );
    }
  }

  for (const option of options) {
    if (!option) continue;

    if (typeof option === "string") {
      appendDetailLine(bucket, option);
      continue;
    }

    if (typeof option === "object") {
      const label = normalizeText(option?.name || option?.option_name || option?.title || option?.label || "Opcao");
      const value = normalizeText(option?.value || option?.selected_option || option?.choice);
      const price = toNumber(option?.price ?? option?.additional_price);

      appendDetailLine(bucket, value ? `${label}: ${value}` : label, price > 0 ? price : undefined, option?.key);
    }
  }

  const lines = Array.from(bucket.values());
  const inferredExtraTotal = Math.max(0, getItemTotal(item) - (getItemUnitPrice(item) * getItemQuantity(item)));
  const pricedTotal = lines.reduce((total: number, detail: any) => total + toNumber(detail?.price), 0);
  const missingPriceLines = lines.filter((detail: any) => detail?.price === undefined);
  const remainingExtra = Math.max(0, inferredExtraTotal - pricedTotal);

  if (remainingExtra > 0 && missingPriceLines.length === 1) {
    missingPriceLines[0].price = remainingExtra;
  }

  return lines;
}

function splitDetailLabelValue(text: string) {
  const normalized = normalizeText(text);
  const idx = normalized.indexOf(":");
  if (idx <= 0) return null;

  const label = normalizeText(normalized.slice(0, idx));
  const value = normalizeText(normalized.slice(idx + 1));
  if (!label || !value) return null;

  return { label, value };
}

function splitGroupedValues(value: string) {
  return normalizeText(value)
    .split(/\s*,\s*/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function getItemDetailGroups(item: any) {
  const groups: Array<{
    key: string;
    label?: string;
    items: Array<{ key: string; text: string; price?: number }>;
    itemMap: Map<string, { key: string; text: string; price?: number }>;
  }> = [];
  const groupMap = new Map<string, (typeof groups)[number]>();

  const ensureGroup = (label?: string) => {
    const normalizedLabel = normalizeText(label);
    const groupKey = normalizedLabel ? normalizedLabel.toLowerCase() : "__plain__";
    const existing = groupMap.get(groupKey);
    if (existing) return existing;

    const next = {
      key: groupKey,
      ...(normalizedLabel ? { label: normalizedLabel } : {}),
      items: [],
      itemMap: new Map<string, { key: string; text: string; price?: number }>(),
    };
    groupMap.set(groupKey, next);
    groups.push(next);
    return next;
  };

  const appendGroupItem = (
    group: (typeof groups)[number],
    text: string,
    price?: number,
    keyHint?: string
  ) => {
    const normalizedText = normalizeText(text);
    if (!normalizedText) return;

    const normalizedPrice = typeof price === "number" && price > 0 ? price : undefined;
    const itemKey = normalizeText(keyHint) || normalizedText.toLowerCase();
    const existing = group.itemMap.get(itemKey);
    if (existing) {
      if (normalizedPrice !== undefined && existing.price === undefined) {
        existing.price = normalizedPrice;
      }
      return;
    }

    const existingByText = group.items.find((item) => item.text.toLowerCase() === normalizedText.toLowerCase());
    if (existingByText) {
      if (normalizedPrice !== undefined && existingByText.price === undefined) {
        existingByText.price = normalizedPrice;
      }
      group.itemMap.set(itemKey, existingByText);
      return;
    }

    const nextItem = {
      key: itemKey,
      text: normalizedText,
      ...(normalizedPrice !== undefined ? { price: normalizedPrice } : {}),
    };
    group.items.push(nextItem);
    group.itemMap.set(itemKey, nextItem);
  };

  getItemDetailLines(item).forEach((detail: any) => {
    const parsed = splitDetailLabelValue(detail?.text || "");
    if (!parsed) {
      appendGroupItem(ensureGroup(), detail?.text || "", detail?.price, detail?.key);
      return;
    }

    const valueParts =
      detail?.price === undefined && parsed.value.includes(",")
        ? splitGroupedValues(parsed.value)
        : [parsed.value];

    const group = ensureGroup(parsed.label);
    valueParts.forEach((value, index) => {
      appendGroupItem(group, value, detail?.price, `${detail?.key || group.key}:${index}`);
    });
  });

  return groups.map(({ itemMap, ...group }) => group);
}

function getMapsLink(order: any) {
  const explicitLink = normalizeText(order?.google_maps_link);
  if (explicitLink) return explicitLink;

  const latitude = toNumber(order?.customer_latitude);
  const longitude = toNumber(order?.customer_longitude);
  if (latitude && longitude) {
    return `https://www.google.com/maps?q=${latitude},${longitude}`;
  }

  return "";
}

function getOrderSubtotal(order: any) {
  const explicitSubtotal = toNumber(order?.subtotal);
  if (explicitSubtotal > 0) return explicitSubtotal;

  const items = parseOrderItems(order?.items);
  const itemsSubtotal = items.reduce((total: number, item: any) => total + getItemTotal(item), 0);
  if (itemsSubtotal > 0) return itemsSubtotal;

  const total = toNumber(order?.total);
  const deliveryFee = toNumber(order?.delivery_fee);
  return Math.max(0, total - deliveryFee);
}

function buildDetailedOrderMessage(order: any, trackingUrl?: string) {
  const lines: string[] = [];
  const orderNumber = normalizeText(order?.order_number || order?.id || "");
  const customerName = normalizeText(order?.customer_name || "Cliente");
  const customerPhone = normalizeText(order?.customer_phone);
  const customerAddress = normalizeText(order?.customer_address);
  const deliveryInstructions = normalizeText(order?.delivery_instructions);
  const mapsLink = getMapsLink(order);
  const items = parseOrderItems(order?.items);
  const subtotal = getOrderSubtotal(order);
  const deliveryFee = Math.max(0, toNumber(order?.delivery_fee));
  const discount = Math.max(0, toNumber(order?.discount));
  const total = toNumber(order?.total) || Math.max(0, subtotal + deliveryFee - discount);
  const paymentMethod = formatPaymentMethodLabel(order?.payment_method, order);

  lines.push(`Pedido #${orderNumber || "sem numero"}`);
  if (trackingUrl) lines.push(`Acompanhe: ${trackingUrl}`);
  lines.push(`Cliente: ${customerName}`);
  if (customerPhone) lines.push(`Telefone: ${customerPhone}`);
  if (customerAddress) lines.push(`Endereco: ${customerAddress}`);
  if (mapsLink) lines.push(`Maps: ${mapsLink}`);

  lines.push("", "Itens:");

  if (items.length === 0) {
    lines.push("- Nenhum item informado");
  } else {
    for (const item of items) {
      const quantity = getItemQuantity(item);
      const unitPrice = getItemUnitPrice(item);
      const itemTotal = getItemTotal(item);
      const itemNotes = normalizeText(item?.notes || item?.observations);
      const detailGroups = getItemDetailGroups(item);
      const baseLineTotal = unitPrice * quantity;

      lines.push(`${quantity}x ${getItemDisplayName(item)} = ${formatCurrency(baseLineTotal)}`);
      for (const group of detailGroups) {
        if (group.label) {
          lines.push(`   ${group.label}:`);
        }
        for (const detail of group.items) {
          lines.push(
            detail.price && detail.price > 0
              ? `   - ${detail.text} (+${formatCurrency(detail.price)})`
              : `   - ${detail.text}`
          );
        }
      }
      if (itemNotes) lines.push(`   - Obs: ${itemNotes}`);
      lines.push(`   Subtotal do item: ${formatCurrency(itemTotal)}`);
    }
  }

  if (deliveryInstructions) {
    lines.push("", "*OBSERVAÇÕES:*");
    lines.push(deliveryInstructions);
  }

  lines.push("", "*Resumo:*");
  lines.push(`Subtotal dos itens: ${formatCurrency(subtotal)}`);
  if (deliveryFee > 0) lines.push(`Taxa de entrega: ${formatCurrency(deliveryFee)}`);
  if (discount > 0) lines.push(`Desconto: -${formatCurrency(discount)}`);
  lines.push(`*Total com entrega: ${formatCurrency(total)}*`);
  lines.push(`Pagamento: ${paymentMethod}`);

  return lines.join("\n").trim();
}

export async function loadRestaurantContext(supabase: any, restaurantId: string): Promise<RestaurantContext> {
  const [profileResult, settingsResult] = await Promise.all([
    supabase.from("profiles").select("restaurant_name").eq("id", restaurantId).maybeSingle(),
    supabase.from("whatsapp_settings").select("enabled, auto_responses").eq("user_id", restaurantId).maybeSingle()
  ]);

  const restaurantName = profileResult?.data?.restaurant_name?.trim() || "PopSystem";
  const enabled = settingsResult?.data?.enabled !== false;
  const autoResponses = {
    ...defaultResponses,
    ...parseAutoResponses(settingsResult?.data?.auto_responses)
  };

  return { enabled, restaurantName, autoResponses };
}

export function buildMenuShareUrl(restaurantId: string) {
  return `${baseUrl()}/share/menu/${restaurantId}`;
}

export function buildTrackShareUrl(orderId: string, restaurantId?: string, orderNumber?: string) {
  const url = new URL(`/share/track/${orderId}`, baseUrl());
  if (restaurantId) url.searchParams.set("u", restaurantId);
  if (orderNumber) url.searchParams.set("n", orderNumber);
  return url.toString();
}

async function loadEvolutionUrl(supabase: any, restaurantId: string) {
  if (!supabase || !restaurantId) return EVOLUTION_URL;
  const { data } = await supabase
    .from("whatsapp_settings")
    .select("evolution_url")
    .eq("user_id", restaurantId)
    .maybeSingle();

  return String(data?.evolution_url || EVOLUTION_URL).replace(/\/+$/, "");
}

async function recordNotificationAttempt(
  supabase: any,
  params: {
    restaurantId: string;
    orderId?: string;
    eventType: string;
    phone: string;
    result: any;
  }
) {
  if (!supabase || !params.restaurantId) return;
  const result = params.result || {};
  const providerError = String(
    result?.error || result?.data?.error || result?.data?.message || ""
  ).slice(0, 500);

  await supabase.from("whatsapp_notification_logs").insert({
    restaurant_id: params.restaurantId,
    order_id: params.orderId || null,
    event_type: params.eventType,
    recipient_phone: normalizePhone(params.phone),
    success: Boolean(result?.ok),
    skipped: Boolean(result?.skipped),
    provider_status: Number(result?.status) || null,
    provider_error: providerError || null,
    provider_transport: String(result?.transport || "legacy_send_text"),
  }).then(() => undefined).catch(() => undefined);
}

export async function sendRestaurantWhatsApp(restaurantId: string, phone: string, text: string, supabase?: any): Promise<any> {
  const to = normalizePhone(phone);
  const message = String(text || "").trim();
  if (!restaurantId || !to || !message) return { ok: false, skipped: true };

  const configuredProviderResult = await sendWhatsAppByConfiguredProvider({
    supabase,
    restaurantId,
    phone: to,
    text: message,
  });
  if (configuredProviderResult) return configuredProviderResult;

  const instanceToken = `token_${restaurantId.replace(/-/g, "")}`;
  const evolutionUrl = await loadEvolutionUrl(supabase, restaurantId);
  const response = await fetch(`${evolutionUrl}/send/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: instanceToken
    },
    body: JSON.stringify({
      number: to,
      text: message
    })
  });

  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    data,
    status: response.status,
    transport: "legacy_send_text",
    error: response.ok ? null : String(data?.error || data?.message || `http_${response.status}`),
  };
}

export async function notifyOrderCreated(supabase: any, order: any) {
  const restaurantId = String(order?.user_id || "");
  const orderId = String(order?.id || "");
  const orderNumber = String(order?.order_number || "");
  const customerPhone = normalizePhone(order?.customer_phone);
  if (!restaurantId || !orderId || !customerPhone) return { ok: false, skipped: true };

  const context = await loadRestaurantContext(supabase, restaurantId);
  if (!context.enabled) return { ok: false, skipped: true };

  const variables = {
    restaurant_name: context.restaurantName,
    order_number: orderNumber,
    track_link: buildTrackShareUrl(orderId, restaurantId, orderNumber),
    menu_link: buildMenuShareUrl(restaurantId),
    customer_name: String(order?.customer_name || "Cliente")
  };

  const intro = fillTemplate(context.autoResponses.order_received, variables).trim();
  const detailTrackingUrl = intro.includes(variables.track_link) ? "" : variables.track_link;
  const details = buildDetailedOrderMessage(order, detailTrackingUrl);
  const text = [intro, details].filter(Boolean).join("\n\n");
  const result = await sendRestaurantWhatsApp(restaurantId, customerPhone, text, supabase);
  await recordNotificationAttempt(supabase, {
    restaurantId,
    orderId,
    eventType: "order_created",
    phone: customerPhone,
    result,
  });
  return result;
}

export async function notifyOrderStatus(supabase: any, order: any, status: string) {
  const restaurantId = String(order?.user_id || "");
  const orderId = String(order?.id || "");
  const orderNumber = String(order?.order_number || "");
  const customerPhone = normalizePhone(order?.customer_phone);
  if (!restaurantId || !orderId || !customerPhone) return { ok: false, skipped: true };

  const context = await loadRestaurantContext(supabase, restaurantId);
  if (!context.enabled) return { ok: false, skipped: true };

  const templateByStatus: Record<string, keyof Required<AutoResponses>> = {
    preparing: "preparing",
    ready: "ready",
    in_delivery: "out_for_delivery",
    delivered: "delivered",
    cancelled: "cancelled"
  };

  const templateKey = templateByStatus[status];
  if (!templateKey) return { ok: false, skipped: true };

  const variables = {
    restaurant_name: context.restaurantName,
    order_number: orderNumber,
    track_link: buildTrackShareUrl(orderId, restaurantId, orderNumber),
    menu_link: buildMenuShareUrl(restaurantId),
    customer_name: String(order?.customer_name || "Cliente")
  };

  const text = fillTemplate(context.autoResponses[templateKey], variables);
  const result = await sendRestaurantWhatsApp(restaurantId, customerPhone, text, supabase);
  await recordNotificationAttempt(supabase, {
    restaurantId,
    orderId,
    eventType: `order_${status}`,
    phone: customerPhone,
    result,
  });
  return result;
}

export async function autoReplyWithMenu(supabase: any, restaurantId: string, phone: string, customerName?: string) {
  const normalizedPhone = normalizePhone(phone);
  if (!restaurantId || !normalizedPhone) return { ok: false, skipped: true };

  const context = await loadRestaurantContext(supabase, restaurantId);
  if (!context.enabled) return { ok: false, skipped: true };

  const variables = {
    restaurant_name: context.restaurantName,
    menu_link: buildMenuShareUrl(restaurantId),
    customer_name: customerName || "Cliente",
    order_number: "",
    track_link: ""
  };

  const text = fillTemplate(context.autoResponses.welcome, variables);
  return await sendRestaurantWhatsApp(restaurantId, normalizedPhone, text, supabase);
}
