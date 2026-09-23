// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { isMiniChefUrl, normalizeMiniChefMenu } from "../_shared/minichef-menu.ts";
import { resolveStoreUserId } from "../_shared/multi-store.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class RequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();

const slugify = (value: unknown) =>
  clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const money = (cents: unknown) => {
  const numeric = Number(cents);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric / 100) * 100) / 100;
};

const brendiImageUrl = (raw: unknown) => {
  const value = clean(raw);
  if (!value || value === "null" || value === "undefined") return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://firebasestorage.googleapis.com/v0/b/brendi-app.appspot.com/o/${encodeURIComponent(value)}?alt=media`;
};

function decodeNuxtPayload(html: string) {
  const match = html.match(/<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) throw new Error("Não encontrei o payload do cardápio Brendi.");

  const values = JSON.parse(match[1]);
  const cache = new Map<number, any>();

  function hydrate(index: number): any {
    if (index === -1) return undefined;
    const value = values[index];
    if (value === null || typeof value !== "object") return value;
    if (cache.has(index)) return cache.get(index);

    if (Array.isArray(value)) {
      const tag = value[0];
      if (typeof tag === "string" && ["Reactive", "ShallowReactive", "Ref", "EmptyRef", "Set"].includes(tag)) {
        if (tag === "EmptyRef") return null;
        if (tag === "Set") {
          const set = new Set((value.slice(1) || []).map((item: number) => hydrate(item)));
          cache.set(index, set);
          return set;
        }
        return hydrate(value[1]);
      }

      const array: any[] = [];
      cache.set(index, array);
      for (const item of value) array.push(typeof item === "number" ? hydrate(item) : item);
      return array;
    }

    const object: Record<string, any> = {};
    cache.set(index, object);
    for (const [key, ref] of Object.entries(value)) {
      object[key] = typeof ref === "number" ? hydrate(ref) : ref;
    }
    return object;
  }

  const root = hydrate(0);
  const entries = Object.values(root?.data || {}) as any[];
  return entries.find((entry) => entry?.categories && entry?.productsByCategory && entry?.store);
}

function detectPlatform(url: string) {
  try {
    const host = new URL(url).host.toLowerCase();
    if (host.includes("brendi.com.br")) return "brendi";
    if (isMiniChefUrl(url)) return "minichef";
  } catch {}
  return "unknown";
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Não consegui abrir o link (${response.status}).`);
  return response.text();
}

function normalizeChoice(choice: any) {
  return {
    name: clean(choice?.title),
    price: money(choice?.extraPrice),
    active: choice?.active !== false && choice?.missing !== true,
  };
}

function normalizeVariation(group: any) {
  const options = (group?.choices || [])
    .map(normalizeChoice)
    .filter((option: any) => option.name && option.active)
    .map(({ name, price }: any) => ({ name, price }));

  return {
    name: clean(group?.title) || "Adicionais",
    required: Number(group?.minChoices || 0) > 0,
    max_selections: Math.max(1, Number(group?.maxChoices || 1)),
    options,
  };
}

function normalizeBrendiMenu(sourceUrl: string, data: any) {
  const categoryOrder = (data.store?.config?.menu?.orderedCategories || [])
    .map((path: string) => String(path || "").split("/").pop())
    .filter(Boolean);

  const categories = [...(data.categories || [])]
    .filter((category) => category?.active !== false)
    .sort((a, b) => {
      const ai = categoryOrder.indexOf(a.id);
      const bi = categoryOrder.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })
    .map((category, categoryIndex) => {
      const products = (data.productsByCategory?.[category.id] || [])
        .filter((product: any) => product?.active !== false && product?.missing !== true)
        .map((product: any, productIndex: number) => ({
          sourceId: product.id,
          slug: clean(product.slug) || slugify(product.name),
          name: clean(product.name),
          description: clean(product.description),
          price: money(product.price),
          image_url: brendiImageUrl(product.picture),
          available: product.active !== false && product.missing !== true,
          display_order: productIndex,
          variations: (product.customs || [])
            .filter((group: any) => group?.active !== false)
            .map(normalizeVariation)
            .filter((group: any) => group.name && group.options.length > 0),
        }))
        .filter((product: any) => product.name);

      return {
        sourceId: category.id,
        name: clean(category.name) || "Geral",
        display_order: categoryIndex,
        products,
      };
    })
    .filter((category) => category.products.length > 0);

  const regions = (data.store?.deliveryRegions || [])
    .flatMap((entry: any) => entry?.regions || [])
    .map((region: any) => ({
      name: clean(region.name),
      delivery_fee: money(region.price),
      delivery_time: `${Number(region.minTime || 0)} - ${Number(region.maxTime || 0)}min`,
      minimum_order: money(data.store?.minimumOrder || 0),
      active: true,
      coverage_area: {
        type: "neighborhood",
        city: clean(data.store?.address?.city),
        state: clean(data.store?.address?.state),
        source: "brendi",
      },
    }))
    .filter((region: any) => region.name);

  const banners = (data.promotionalBanners || data.store?.promotionalBanners || [])
    .filter((banner: any) => banner?.image)
    .map((banner: any, index: number) => ({
      image_url: clean(banner.image),
      product_slug: clean(banner.productSlug),
      active: banner.active !== false,
      display_order: index,
    }));

  const address = data.store?.address || {};
  const fullAddress = [
    clean(address.street),
    clean(address.number),
    clean(address.neighborhood),
    clean(address.city),
    clean(address.state),
  ].filter(Boolean).join(", ");

  const products = categories.flatMap((category) => category.products);
  return {
    platform: "brendi",
    source_url: sourceUrl,
    restaurant: {
      name: clean(data.store?.brand?.name) || clean(data.store?.name),
      phone: clean(data.store?.phoneNumber),
      address: fullAddress,
      raw_address: address,
      minimum_order: money(data.store?.minimumOrder || 0),
      delivery_fee: regions.length ? Math.min(...regions.map((region: any) => region.delivery_fee)) : 0,
    },
    categories,
    delivery_zones: regions,
    banners,
    stats: {
      categories: categories.length,
      products: products.length,
      productsWithImages: products.filter((product: any) => product.image_url).length,
      variationLinks: products.reduce((sum: number, product: any) => sum + product.variations.length, 0),
      deliveryRegions: regions.length,
      banners: banners.length,
    },
  };
}

async function analyzeUrl(url: string) {
  const platform = detectPlatform(url);
  if (platform === "unknown") {
    throw new Error("Esse link ainda não é compatível com o importador estruturado. Use a importação por link tradicional.");
  }
  const html = await fetchHtml(url);
  const normalized = platform === "minichef"
    ? normalizeMiniChefMenu(url, html)
    : normalizeBrendiMenu(url, decodeNuxtPayload(html));
  if (!normalized.stats.categories || !normalized.stats.products) {
    throw new Error("Não encontrei categorias ou produtos nesse cardápio.");
  }
  return normalized;
}

async function assertUser(supabaseUrl: string, anonKey: string, authHeader: string | null) {
  const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new RequestError("Sua sessão expirou. Entre novamente para continuar.", 401);
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) {
    console.warn("[menu-importer] sessão rejeitada", { reason: error?.message || "user_missing" });
    throw new RequestError("Sua sessão expirou. Entre novamente para continuar.", 401);
  }
  return data.user.id;
}

async function must(label: string, promise: PromiseLike<{ data: any; error: any }>) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function removeCurrent(admin: any, userId: string, includeStoreData = true) {
  const products = await must("buscar produtos atuais", admin.from("products").select("id").eq("user_id", userId));
  const productIds = (products || []).map((product: any) => product.id);
  if (productIds.length > 0) {
    await must("apagar vínculos de complementos", admin.from("product_global_variation_links").delete().in("product_id", productIds));
    await must("apagar variações de preço", admin.from("product_variants").delete().in("product_id", productIds));
  }
  await must("apagar variações do produto", admin.from("product_variations").delete().eq("user_id", userId));
  await must("apagar produtos", admin.from("products").delete().eq("user_id", userId));
  await must("apagar categorias", admin.from("product_categories").delete().eq("user_id", userId));
  await must("apagar complementos globais", admin.from("global_variations").delete().eq("user_id", userId));
  if (includeStoreData) {
    await must("apagar bairros de entrega", admin.from("delivery_zones").delete().eq("user_id", userId));
    await must("apagar configurações de entrega", admin.from("delivery_settings").delete().eq("user_id", userId));
    await must("apagar banners", admin.from("promotional_banners").delete().eq("user_id", userId));
  }
}

const variationKey = (variation: any) => `${slugify(variation.name)}|${JSON.stringify(variation.options || [])}`;

async function applyImport(admin: any, userId: string, normalized: any, replace: boolean) {
  if (replace) await removeCurrent(admin, userId, normalized.platform !== "minichef");

  const existingCategories = replace
    ? []
    : await must("buscar categorias existentes", admin.from("product_categories").select("id,name").eq("user_id", userId));
  const categoryIds = new Map<string, string>();
  for (const category of existingCategories || []) categoryIds.set(slugify(category.name), category.id);

  const existingProducts = replace
    ? []
    : await must("buscar produtos existentes", admin.from("products").select("id,name").eq("user_id", userId));
  const productIdsBySlug = new Map<string, string>();
  for (const product of existingProducts || []) productIdsBySlug.set(slugify(product.name), product.id);

  if (normalized.platform !== "minichef") {
    await must("atualizar perfil", admin.from("profiles").update({
      restaurant_name: normalized.restaurant.name || null,
      phone: normalized.restaurant.phone || null,
      address: normalized.restaurant.address || null,
      delivery_fee: normalized.restaurant.delivery_fee || 0,
      minimum_order: normalized.restaurant.minimum_order || 0,
      description: `Cardápio importado de ${normalized.platform}.`,
      updated_at: new Date().toISOString(),
    }).eq("id", userId));
  }

  const variationIds = new Map<string, string>();
  let categoriesCreated = 0;
  let productsCreated = 0;
  let productsSkipped = 0;
  let globalVariationsCreated = 0;
  let linksCreated = 0;

  for (const category of normalized.categories) {
    const key = slugify(category.name);
    let categoryId = categoryIds.get(key);
    if (!categoryId) {
      const created = await must("criar categoria", admin.from("product_categories").insert({
        user_id: userId,
        name: category.name,
        display_order: category.display_order,
        active: true,
      }).select("id").single());
      categoryId = created.id;
      categoryIds.set(key, String(categoryId));
      categoriesCreated++;
    }

    for (const product of category.products) {
      const productKey = slugify(product.name);
      if (!replace && productIdsBySlug.has(productKey)) {
        productsSkipped++;
        continue;
      }

      const createdProduct = await must("criar produto", admin.from("products").insert({
        user_id: userId,
        name: product.name,
        description: product.description,
        price: product.price,
        category: category.name,
        category_id: categoryId,
        image_url: product.image_url,
        available: product.available,
        is_available: product.available,
        available_delivery: product.available,
        available_pdv: product.available,
        show_in_delivery: product.available,
        show_in_pdv: product.available,
        send_to_kds: false,
        display_order: product.display_order,
        track_stock: false,
        weight_based: product.weight_based === true,
        stock_quantity: 0,
        low_stock_threshold: 5,
      }).select("id").single());
      productIdsBySlug.set(productKey, createdProduct.id);
      productsCreated++;

      for (const variation of product.variations || []) {
        const key = variationKey(variation);
        let variationId = variationIds.get(key);
        if (!variationId) {
          const createdVariation = await must("criar complemento", admin.from("global_variations").insert({
            user_id: userId,
            name: variation.name,
            required: variation.required,
            max_selections: variation.max_selections,
            options: JSON.stringify(variation.options || []),
            description: "",
          }).select("id").single());
          variationId = createdVariation.id;
          variationIds.set(key, String(variationId));
          globalVariationsCreated++;
        }
        await must("vincular complemento", admin.from("product_global_variation_links").insert({
          product_id: createdProduct.id,
          global_variation_id: variationId,
        }));
        linksCreated++;
      }
    }
  }

  if (replace && normalized.delivery_zones?.length) {
    await must("criar bairros de entrega", admin.from("delivery_zones").insert(
      normalized.delivery_zones.map((zone: any) => ({ ...zone, user_id: userId })),
    ));
    await must("criar configurações de entrega", admin.from("delivery_settings").insert({
      user_id: userId,
      maps_integration_enabled: false,
      delivery_areas: normalized.delivery_zones.map((zone: any) => ({
        name: zone.name,
        fee: zone.delivery_fee,
        time: zone.delivery_time,
        city: zone.coverage_area?.city,
        state: zone.coverage_area?.state,
      })),
    }));
  }

  if (replace && normalized.banners?.length) {
    const products = await must("buscar produtos para banners", admin.from("products").select("id,name").eq("user_id", userId));
    const productBySlug = new Map<string, any>((products || []).map((product: any) => [slugify(product.name), product]));
    await must("criar banners", admin.from("promotional_banners").insert(
      normalized.banners.map((banner: any, index: number) => {
        const product = productBySlug.get(banner.product_slug);
        return {
          user_id: userId,
          title: product?.name || `Banner importado ${index + 1}`,
          description: `Banner importado de ${normalized.platform}.`,
          image_url: banner.image_url,
          active: banner.active !== false,
          display_order: banner.display_order ?? index,
          product_id: product?.id || null,
        };
      }),
    ));
  }

  return { categoriesCreated, productsCreated, productsSkipped, globalVariationsCreated, linksCreated };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = String(body?.action || "analyze");
    const url = clean(body?.url);
    if (!url) return json({ success: false, error: "Informe o link do cardápio." }, 200);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Configuração do Supabase ausente.");

    const authenticatedUserId = await assertUser(supabaseUrl, anonKey, req.headers.get("Authorization"));
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    let userId: string;
    try {
      userId = await resolveStoreUserId(admin, authenticatedUserId, body?._storeId);
    } catch (error) {
      if (error instanceof Error && error.message === "store_access_denied") {
        throw new RequestError("Você não tem acesso à loja selecionada.", 403);
      }
      throw error;
    }
    const normalized = await analyzeUrl(url);

    if (action === "analyze") {
      return json({
        success: true,
        status: "preview",
        platform: normalized.platform,
        restaurant: normalized.restaurant,
        stats: normalized.stats,
        preview: {
          categories: normalized.categories.slice(0, 8).map((category: any) => ({
            name: category.name,
            products: category.products.length,
          })),
          products: normalized.categories.flatMap((category: any) =>
            category.products.slice(0, 4).map((product: any) => ({
              name: product.name,
              price: product.price,
              category: category.name,
              image_url: product.image_url,
              variations: product.variations.length,
            })),
          ).slice(0, 12),
          delivery_zones: normalized.delivery_zones.slice(0, 8),
        },
      });
    }

    if (action === "apply") {
      const result = await applyImport(admin, userId, normalized, body?.replace !== false);
      return json({ success: true, status: "completed", platform: normalized.platform, stats: normalized.stats, result });
    }

    return json({ success: false, error: "Ação inválida." }, 200);
  } catch (error) {
    console.error("[menu-importer]", error);
    const status = error instanceof RequestError ? error.status : 200;
    return json({ success: false, status: "failed", error: error instanceof Error ? error.message : String(error) }, status);
  }
});
