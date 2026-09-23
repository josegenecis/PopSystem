// Parser isolado para cardápios públicos do MiniChef.
// O storefront entrega categorias e produtos estruturados no HTML, sem exigir login.

const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();

const decodeHtml = (value: string) => value
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#039;|&#39;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

const stripTags = (value: string) => clean(decodeHtml(value.replace(/<[^>]*>/g, " ")));

const numericPrice = (value: unknown) => {
  const numeric = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
};

const imageUrl = (value: unknown, sourceUrl: string) => {
  const raw = clean(value);
  if (!raw || /default-placeholder/i.test(raw)) return null;
  try {
    return new URL(raw, sourceUrl).toString();
  } catch {
    return null;
  }
};

const parseEmbeddedProduct = (encoded: string) => {
  try {
    const jsonText = JSON.parse(`"${encoded}"`);
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
};

const normalizeVariation = (group: any) => {
  const minSelections = Math.max(0, Number(group?.min_selecao || 0));
  const maxSelections = Math.max(1, minSelections, Number(group?.max_selecao || 1));
  const options = (Array.isArray(group?.modificadores) ? group.modificadores : [])
    .filter((option: any) => option?.ativo !== false && option?.disponivel !== false && option?.pivot?.ativo !== 0)
    .map((option: any) => ({
      name: clean(option?.nome),
      price: numericPrice(option?.pivot?.preco_override ?? option?.preco),
    }))
    .filter((option: any) => option.name);

  return {
    name: clean(group?.nome) || "Adicionais",
    required: group?.obrigatorio === true || minSelections > 0,
    max_selections: maxSelections,
    options,
  };
};

export function isMiniChefUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.hostname.toLowerCase() === "app.minichef.online" && /^\/delivery\/[^/]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function normalizeMiniChefMenu(sourceUrl: string, html: string) {
  const categoryNames = new Map<string, string>();
  const categoryOrder: string[] = [];
  const categoryPattern = /id=["']cat-(\d+)["'][\s\S]{0,1800}?<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  for (const match of html.matchAll(categoryPattern)) {
    const id = String(match[1]);
    const name = stripTags(match[2]) || "Geral";
    if (!categoryNames.has(id)) categoryOrder.push(id);
    categoryNames.set(id, name);
  }

  const productsById = new Map<string, any>();
  const productPattern = /x-data=["']\{\s*product:\s*JSON\.parse\('([^']+)'\)\s*\}["']/gi;
  for (const match of html.matchAll(productPattern)) {
    const product = parseEmbeddedProduct(match[1]);
    const id = clean(product?.id);
    if (!product || !id || productsById.has(id)) continue;
    productsById.set(id, product);
  }

  const categoriesById = new Map<string, any>();
  for (const [index, id] of categoryOrder.entries()) {
    categoriesById.set(id, {
      sourceId: id,
      name: categoryNames.get(id) || "Geral",
      display_order: index,
      products: [],
    });
  }

  for (const product of productsById.values()) {
    const categoryId = clean(product?.categoria_id) || "geral";
    if (!categoriesById.has(categoryId)) {
      categoriesById.set(categoryId, {
        sourceId: categoryId,
        name: categoryNames.get(categoryId) || "Geral",
        display_order: categoriesById.size,
        products: [],
      });
    }

    const variations = (Array.isArray(product?.grupos_modificadores) ? product.grupos_modificadores : [])
      .map(normalizeVariation)
      .filter((group: any) => group.options.length > 0);
    const formattedImage = imageUrl(product?.imagem_url_formatada, sourceUrl);
    const originalImage = imageUrl(product?.imagem_url, sourceUrl);
    const available = product?.ativo !== false && product?.disponivel !== false && product?.disponivel_delivery !== false;

    categoriesById.get(categoryId).products.push({
      sourceId: clean(product?.id),
      slug: clean(product?.codigo) || clean(product?.id),
      name: clean(product?.nome),
      description: clean(product?.descricao),
      price: numericPrice(product?.preco_delivery ?? product?.preco_promocional ?? product?.preco),
      image_url: formattedImage || originalImage,
      available,
      weight_based: product?.por_peso === true,
      display_order: Number(product?.ordem_delivery ?? product?.ordem ?? 0),
      variations,
    });
  }

  const categories = Array.from(categoriesById.values())
    .map((category: any) => ({
      ...category,
      products: category.products
        .filter((product: any) => product.name)
        .sort((a: any, b: any) => a.display_order - b.display_order),
    }))
    .filter((category: any) => category.products.length > 0)
    .sort((a: any, b: any) => a.display_order - b.display_order);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const restaurantName = stripTags(titleMatch?.[1] || "").replace(/\s*[—|-]\s*Cardápio\s*$/i, "");
  const products = categories.flatMap((category: any) => category.products);

  return {
    platform: "minichef",
    source_url: sourceUrl,
    restaurant: { name: restaurantName },
    categories,
    delivery_zones: [],
    banners: [],
    stats: {
      categories: categories.length,
      products: products.length,
      productsWithImages: products.filter((product: any) => product.image_url).length,
      variationLinks: products.reduce((sum: number, product: any) => sum + product.variations.length, 0),
      deliveryRegions: 0,
      banners: 0,
    },
  };
}
