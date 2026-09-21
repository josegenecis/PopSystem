// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiGenerateContent, safeParseJson } from "../_shared/gemini.ts";
import { findBestCatalogMatch } from "../_shared/catalogMatching.ts";
import { reconcilePurchaseUnits, type PurchaseUnit } from "../_shared/purchaseUnits.ts";

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

function onlyDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function numberValue(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanName(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUnit(value: unknown) {
  const unit = String(value || "un").toLowerCase().trim();
  if (["un", "und", "unidade", "unidades"].includes(unit)) return "un";
  if (["kg", "quilo", "quilograma", "quilogramas"].includes(unit)) return "kg";
  if (["g", "gr", "grama", "gramas"].includes(unit)) return "g";
  if (["l", "lt", "litro", "litros"].includes(unit)) return "l";
  if (["ml", "mililitro", "mililitros"].includes(unit)) return "ml";
  if (["cx", "caixa", "caixas"].includes(unit)) return "cx";
  if (["pct", "pacote", "pacotes"].includes(unit)) return "pct";
  if (["fd", "fardo", "fardos"].includes(unit)) return "fd";
  if (["bd", "balde", "baldes"].includes(unit)) return "bd";
  if (["dz", "duzia", "dúzia", "duzias", "dúzias"].includes(unit)) return "dz";
  return "un";
}

function recognizedUnit(value: unknown) {
  const unit = String(value || "").toLowerCase().trim().replace(/\./g, "");
  return [
    "un", "und", "unidade", "unidades", "kg", "quilo", "quilograma", "quilogramas",
    "g", "gr", "grama", "gramas", "l", "lt", "litro", "litros", "ml", "mililitro",
    "mililitros", "cx", "caixa", "caixas", "pct", "pacote", "pacotes", "fd", "fardo",
    "fardos", "bd", "balde", "baldes", "dz", "duzia", "dúzia", "duzias", "dúzias",
  ].includes(unit);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchWithDeadline(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("A leitura da nota demorou mais de 45 segundos. Tente uma foto mais próxima e bem iluminada.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function nfePaymentMethod(code: string) {
  const methods: Record<string, string> = {
    "01": "dinheiro", "03": "credito", "04": "debito", "15": "boleto",
    "16": "deposito", "17": "pix", "18": "transferencia", "99": "outros",
  };
  return methods[String(code || "").padStart(2, "0")] || null;
}

async function uploadReceipt(supabase: any, userId: string, fileBase64: string, mimeType: string, fileName: string) {
  const ext = mimeType.includes("xml") || fileName.toLowerCase().endsWith(".xml")
    ? "xml"
    : mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : mimeType.includes("pdf") ? "pdf" : "jpg";
  const path = `${userId}/smart-invoices/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const bytes = Uint8Array.from(atob(fileBase64), (char) => char.charCodeAt(0));
  const { error } = await supabase.storage
    .from("purchase-invoice-attachments")
    .upload(path, bytes, { contentType: mimeType, cacheControl: "3600", upsert: false });
  if (error) throw new Error(`Não foi possível salvar o anexo da nota: ${error.message}`);
  return {
    path,
    name: String(fileName || `nota.${ext}`).trim().slice(0, 180),
    mimeType,
    sizeBytes: bytes.byteLength,
  };
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

function xmlTag(xml: string, tagName: string) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<(?:\\w+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${escaped}>`, "i"));
  return match ? decodeXmlEntities(match[1].replace(/<[^>]+>/g, "")) : "";
}

function parseNfeXml(fileBase64: string) {
  const bytes = Uint8Array.from(atob(fileBase64), (char) => char.charCodeAt(0));
  const xml = new TextDecoder("utf-8").decode(bytes);
  if (!/<(?:\w+:)?NFe[\s>]/i.test(xml) && !/<(?:\w+:)?infNFe[\s>]/i.test(xml)) {
    throw new Error("O XML enviado não contém uma NF-e/NFC-e válida.");
  }
  const emitBlock = xml.match(/<(?:\w+:)?emit(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?emit>/i)?.[1] || "";
  const totalBlock = xml.match(/<(?:\w+:)?ICMSTot(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?ICMSTot>/i)?.[1] || "";
  const infId = xml.match(/<(?:\w+:)?infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i)?.[1] || xmlTag(xml, "chNFe");
  const detBlocks = Array.from(xml.matchAll(/<(?:\w+:)?det\b[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/gi));
  const items = detBlocks.map((match, index) => {
    const product = match[1].match(/<(?:\w+:)?prod(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?prod>/i)?.[1] || match[1];
    const quantity = numberValue(xmlTag(product, "qCom"), 1);
    const unitPrice = numberValue(xmlTag(product, "vUnCom"), 0);
    const total = numberValue(xmlTag(product, "vProd"), quantity * unitPrice);
    const description = xmlTag(product, "xProd") || `Item ${xmlTag(product, "cProd") || index + 1}`;
    return {
      description,
      normalized_name: cleanName(description),
      category: "Insumos",
      subcategory: "",
      quantity: Math.max(quantity, 0.001),
      unit: normalizeUnit(xmlTag(product, "uCom")),
      stock_unit: normalizeUnit(xmlTag(product, "uCom")),
      conversion_factor: 1,
      unit_source: recognizedUnit(xmlTag(product, "uCom")) ? "xml" : "unknown",
      unit_confirmed: recognizedUnit(xmlTag(product, "uCom")),
      unit_price: unitPrice,
      total_price: total,
      confidence: 1,
      similar_to: null,
      control_stock: true,
    };
  }).filter((item) => item.normalized_name);
  if (items.length === 0) throw new Error("O XML não possui produtos para lançamento.");

  return {
    supplier_name: xmlTag(emitBlock, "xNome") || xmlTag(emitBlock, "xFant"),
    supplier_document: xmlTag(emitBlock, "CNPJ") || xmlTag(emitBlock, "CPF"),
    invoice_number: xmlTag(xml, "nNF"),
    invoice_date: (xmlTag(xml, "dhEmi") || xmlTag(xml, "dEmi") || todayIso()).slice(0, 10),
    due_date: (xmlTag(xml, "dVenc") || "").slice(0, 10) || null,
    payment_method: nfePaymentMethod(xmlTag(xml, "tPag")),
    document_key: onlyDigits(infId).slice(0, 44) || null,
    total_amount: numberValue(xmlTag(totalBlock, "vNF"), items.reduce((sum, item) => sum + item.total_price, 0)),
    expense_category: "insumos",
    items,
  };
}

async function findIngredient(supabase: any, userId: string, name: string) {
  const cleaned = cleanName(name);
  if (!cleaned) return null;
  const { data } = await supabase
    .from("ingredients")
    .select("*")
    .eq("user_id", userId)
    .ilike("name", cleaned)
    .limit(1)
    .maybeSingle();
  if (data) return data;

  const firstWord = cleaned.split(" ").filter((word) => word.length > 2)[0];
  if (!firstWord) return null;
  const { data: fuzzy } = await supabase
    .from("ingredients")
    .select("*")
    .eq("user_id", userId)
    .ilike("name", `%${firstWord}%`)
    .limit(1)
    .maybeSingle();
  return fuzzy || null;
}

function looksLikeSaleProduct(item: any) {
  const category = cleanName(item?.category).toLowerCase();
  const subcategory = cleanName(item?.subcategory).toLowerCase();
  const name = cleanName(item?.normalized_name || item?.description).toLowerCase();
  const text = `${category} ${subcategory} ${name}`;

  const stockOnlyWords = [
    "insumo",
    "ingrediente",
    "limpeza",
    "operacional",
    "embalagem",
    "embalagens",
    "descartavel",
    "descartaveis",
    "fruta",
    "frutas",
    "calda",
    "cobertura",
    "topping",
    "complemento",
    "massa",
    "farinha",
    "oleo",
    "acucar",
    "leite condensado",
  ];
  const resaleWords = [
    "bebida",
    "bebidas",
    "refrigerante",
    "suco",
    "agua",
    "cerveja",
    "energetico",
    "bomboniere",
    "chocolate",
    "biscoito",
    "salgadinho",
    "produto industrializado",
    "mercadoria",
    "revenda",
  ];

  if (resaleWords.some((word) => text.includes(word))) return true;
  if (stockOnlyWords.some((word) => text.includes(word))) return false;
  return false;
}

function inferInventoryKind(item: any) {
  const explicit = String(item?.inventory_kind || "").toLowerCase().trim();
  if (["ingredient", "resale_product", "packaging", "cleaning", "service", "other"].includes(explicit)) return explicit;
  const value = cleanName(`${item?.category || ""} ${item?.subcategory || ""} ${item?.normalized_name || item?.description || ""}`).toLowerCase();
  if (/servico|taxa|frete|mao de obra/.test(value)) return "service";
  if (/limpeza|higiene|detergente|desinfetante/.test(value)) return "cleaning";
  if (/embalagem|descartavel|copo|tampa|sacola|guardanapo/.test(value)) return "packaging";
  if (looksLikeSaleProduct(item)) return "resale_product";
  return "ingredient";
}

function enrichCatalogMatches(items: any[], ingredients: any[], products: any[]) {
  return items.map((item) => {
    const { similar_ingredient: _similarIngredient, similar_product: _similarProduct, ...baseItem } = item;
    const ingredientMatch = findBestCatalogMatch(item.normalized_name || item.description, ingredients, item.similar_ingredient || item.similar_to);
    const productMatch = findBestCatalogMatch(item.normalized_name || item.description, products, item.similar_product || item.similar_to);
    const inventoryKind = inferInventoryKind(item);
    const preferred = inventoryKind === "resale_product"
      ? productMatch?.candidate || ingredientMatch?.candidate
      : ingredientMatch?.candidate || productMatch?.candidate;
    const unitFromCatalog = preferred?.unit ? normalizeUnit(preferred.unit) : null;
    const shouldUseCatalogUnit = !item.unit_confirmed && unitFromCatalog;
    return {
      ...baseItem,
      normalized_name: preferred?.name || item.normalized_name,
      category: preferred?.category || item.category || "Insumos",
      subcategory: preferred?.subcategory || item.subcategory || "",
      unit: shouldUseCatalogUnit ? unitFromCatalog : normalizeUnit(item.unit),
      stock_unit: shouldUseCatalogUnit ? unitFromCatalog : normalizeUnit(item.stock_unit || item.unit),
      unit_source: shouldUseCatalogUnit ? "catalog" : item.unit_source,
      unit_confirmed: Boolean(item.unit_confirmed || shouldUseCatalogUnit),
      inventory_kind: inventoryKind,
      ingredient_id: ingredientMatch?.candidate.id || null,
      product_id: productMatch?.candidate.id || null,
      matched_product_tracks_stock: productMatch?.candidate.track_stock === true,
      create_sale_product: inventoryKind === "resale_product" && !productMatch,
      similar_to: preferred?.name || item.similar_to || null,
      match_confidence: Math.max(ingredientMatch?.score || 0, productMatch?.score || 0),
    };
  });
}

async function ensureCategory(supabase: any, userId: string, name: string) {
  const categoryName = String(name || "Mercadorias").trim() || "Mercadorias";
  const { data: existing } = await supabase
    .from("categories")
    .select("id, name")
    .eq("user_id", userId)
    .ilike("name", categoryName)
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("categories")
    .insert([{
      user_id: userId,
      name: categoryName,
      description: "Categoria criada automaticamente pela nota inteligente.",
    }])
    .select("id, name")
    .single();
  if (error) throw error;
  return created;
}

async function findProduct(supabase: any, userId: string, name: string) {
  const cleaned = cleanName(name);
  if (!cleaned) return null;
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .ilike("name", cleaned)
    .limit(1)
    .maybeSingle();
  if (data) return data;

  const firstWord = cleaned.split(" ").filter((word) => word.length > 2)[0];
  if (!firstWord) return null;
  const { data: fuzzy } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .ilike("name", `%${firstWord}%`)
    .limit(1)
    .maybeSingle();
  return fuzzy || null;
}

async function upsertSaleProductFromInvoice(supabase: any, userId: string, item: any) {
  if (!looksLikeSaleProduct(item)) return null;

  const category = await ensureCategory(supabase, userId, item.category || "Mercadorias");
  const quantity = Math.max(1, Math.floor(numberValue(item.quantity, 1)));
  const costPrice = numberValue(item.unit_price, 0);
  let product = await findProduct(supabase, userId, item.normalized_name);

  if (!product) {
    const suggestedPrice = Number((costPrice > 0 ? costPrice * 1.8 : 0).toFixed(2));
    const { data: created, error } = await supabase
      .from("products")
      .insert([{
        user_id: userId,
        name: item.normalized_name,
        description: item.description || item.normalized_name,
        category: category.name,
        category_id: category.id,
        price: suggestedPrice,
        available: true,
        is_available: true,
        show_in_pdv: true,
        show_in_delivery: false,
        track_stock: true,
        stock_quantity: quantity,
        low_stock_threshold: 5,
      }])
      .select("*")
      .single();
    if (error) throw error;
    return created;
  }

  const nextStock = Math.max(0, Math.floor(numberValue(product.stock_quantity, 0) + quantity));
  const { data: updated, error } = await supabase
    .from("products")
    .update({
      category: product.category || category.name,
      category_id: product.category_id || category.id,
      track_stock: true,
      stock_quantity: nextStock,
      low_stock_threshold: Math.max(1, Math.floor(numberValue(product.low_stock_threshold, 5))),
      available: product.available !== false,
      is_available: product.is_available !== false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", product.id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return updated || product;
}

async function analyzeInvoice(supabase: any, userId: string, body: any) {
  const fileName = String(body.fileName || body.file_name || "nota-de-compra");
  const mimeType = String(body.mimeType || body.mime_type || (fileName.toLowerCase().endsWith(".xml") ? "application/xml" : "image/jpeg"));
  const fileBase64 = String(body.fileBase64 || body.file_base64 || "").replace(/^data:[^,]+,/, "");
  if (!fileBase64) throw new Error("Envie uma imagem, PDF ou XML da nota.");

  const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  const geminiModel = Deno.env.get("GEMINI_VISION_MODEL") || Deno.env.get("GEMINI_MODEL") || "gemini-1.5-flash";
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  // Não herdar OPENAI_MODEL: ele atende o agente geral e pode ser um modelo de
  // raciocínio mais lento. A leitura de cupom precisa de visão e baixa latência.
  const openAiModel = Deno.env.get("OPENAI_VISION_MODEL") || "gpt-4.1-mini";
  const isXml = mimeType.includes("xml") || fileName.toLowerCase().endsWith(".xml");
  if (!isXml && !geminiKey && !openAiKey) throw new Error("Configure GEMINI_API_KEY ou OPENAI_API_KEY para processar notas com IA.");

  const [{ data: ingredients }, { data: products }] = await Promise.all([
    supabase.from("ingredients")
      .select("id, name, category, subcategory, unit, cost_price, price, current_stock")
      .eq("user_id", userId).limit(500),
    supabase.from("products")
      .select("id, name, category, unit, track_stock, stock_quantity")
      .eq("user_id", userId).limit(500),
  ]);

  const knownCatalog = [
    ...(ingredients || []).map((item: any) => ({ kind: "ingredient", name: item.name, category: item.category || "Insumos", subcategory: item.subcategory || "", unit: item.unit || "un" })),
    ...(products || []).map((item: any) => ({ kind: "product", name: item.name, category: item.category || "Mercadorias", unit: item.unit || "un", track_stock: item.track_stock === true })),
  ];

  const system = [
    "Voce e um especialista em compras, estoque e restaurantes no Brasil.",
    "Extraia a nota fiscal/cupom/recibo da imagem e classifique os itens para um sistema de restaurante.",
    "Nunca invente item que nao esteja na nota. Se tiver duvida, use confidence baixo.",
    "Crie categoria/subcategoria coerente quando nao existir no catalogo. Para acaiteria, exemplos: Complementos/Toppings naturais, Complementos/Confeitos, Frutas, Caldas, Embalagens, Bebidas, Limpeza, Operacional.",
    "Retorne somente JSON valido.",
  ].join("\n");

  const userPrompt = [
    "Catalogo atual de insumos do restaurante:",
    JSON.stringify(knownCatalog).slice(0, 18000),
    "",
    "Responda somente em JSON valido neste formato:",
    `{
  "supplier_name": "Fornecedor",
  "supplier_document": "CNPJ/CPF se houver",
  "invoice_number": "numero se houver",
  "document_key": "chave de acesso com 44 digitos se houver",
  "invoice_date": "YYYY-MM-DD ou vazio",
  "due_date": "YYYY-MM-DD ou vazio",
  "payment_method": "pix|dinheiro|debito|credito|boleto|transferencia|outros ou vazio",
  "total_amount": 0,
  "expense_category": "insumos",
  "items": [
    {
      "description": "texto original da nota",
      "normalized_name": "nome limpo para estoque",
      "category": "Categoria",
      "subcategory": "Subcategoria",
      "quantity": 1,
      "unit": "un|kg|g|l|ml|cx|pct|fd|bd|dz",
      "unit_price": 0,
      "total_price": 0,
      "stock_unit": "un|kg|g|l|ml|cx|pct|fd|bd|dz",
      "inventory_kind": "ingredient|resale_product|packaging|cleaning|service|other",
      "conversion_factor": 1,
      "unit_source": "invoice|catalog|inferred|unknown",
      "unit_confirmed": true,
      "control_stock": true,
      "similar_to": "nome de item parecido do catalogo se houver",
      "similar_ingredient": "nome EXATO do insumo correspondente no catalogo ou vazio",
      "similar_product": "nome EXATO do produto de venda correspondente no catalogo ou vazio",
      "confidence": 0.90
    }
  ]
}`,
    "",
    "Regras:",
    "- Para compras de ingredientes/complementos, expense_category deve ser insumos.",
    "- Quantidade e total devem bater com a nota sempre que legivel.",
    "- Preserve CX, PCT, FD, BD e DZ quando estiverem escritos na nota.",
    "- conversion_factor informa quanto entra na unidade de estoque (ex.: 1 CX = 12 UN => 12). Use 1 se a nota nao informar.",
    "- Nunca invente unidade silenciosamente: se houver duvida, use unit_source unknown, unit_confirmed false e confidence baixo.",
    "- control_stock deve ser true para insumos, embalagens e mercadorias controlaveis; false para servicos/taxas/frete.",
    "- Identifique inventory_kind e reutilize itens do catalogo quando forem realmente o mesmo produto, mesmo com abreviacoes de marca/volume.",
    "- Nunca associe produtos apenas por uma palavra generica. Em caso de duvida, deixe similar_ingredient e similar_product vazios.",
  ].join("\n");

  let parsed: any = isXml ? parseNfeXml(fileBase64) : null;
  if (!isXml && geminiKey) {
    const ai = await geminiGenerateContent({
      apiKey: geminiKey,
      model: geminiModel,
      system,
      user: "",
      temperature: 0.1,
      responseMimeType: "application/json",
      contents: [{
        role: "user",
        parts: [
          { text: userPrompt },
          { inline_data: { mime_type: mimeType, data: fileBase64 } },
        ],
      }],
    });
    parsed = safeParseJson(ai.text);
  } else if (!isXml) {
    const content = mimeType.includes("pdf")
      ? [{ type: "input_file", filename: fileName, file_data: `data:${mimeType};base64,${fileBase64}` }, { type: "input_text", text: userPrompt }]
      : [{ type: "input_text", text: userPrompt }, { type: "input_image", image_url: `data:${mimeType};base64,${fileBase64}`, detail: "high" }];
    const response = await fetchWithDeadline("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel,
        instructions: system,
        temperature: 0.1,
        max_output_tokens: 6000,
        store: false,
        text: { format: { type: "json_object" } },
        input: [{ role: "user", content }],
      }),
    }, 45_000);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || "Erro ao processar a nota com OpenAI.");
    const outputText = data?.output_text || (data?.output || [])
      .flatMap((entry: any) => entry?.content || [])
      .map((entry: any) => entry?.text || "")
      .join("\n");
    parsed = safeParseJson(outputText);
  }
  if (!parsed || !Array.isArray(parsed.items)) throw new Error("A IA nao conseguiu ler itens validos da nota.");

  const parsedItems = parsed.items.map((item: any) => {
    const total = numberValue(item.total_price);
    const quantity = Math.max(0.001, numberValue(item.quantity, 1));
    const inventoryKind = inferInventoryKind(item);
    const units = reconcilePurchaseUnits({
      description: item.description,
      normalized_name: item.normalized_name,
      unit: normalizeUnit(item.unit) as PurchaseUnit,
      stock_unit: normalizeUnit(item.stock_unit || item.unit) as PurchaseUnit,
      conversion_factor: Math.max(0.000001, numberValue(item.conversion_factor, 1)),
      unit_source: String(item.unit_source || (recognizedUnit(item.unit) ? "invoice" : "unknown")),
      unit_confirmed: item.unit_confirmed === true && recognizedUnit(item.unit),
      inventory_kind: inventoryKind,
    });
    return {
      description: String(item.description || item.normalized_name || "Item").trim(),
      normalized_name: cleanName(item.normalized_name || item.description || "Item"),
      category: String(item.category || "Insumos").trim(),
      subcategory: String(item.subcategory || "").trim(),
      quantity,
      unit: units.unit,
      stock_unit: units.stock_unit,
      unit_price: numberValue(item.unit_price, total > 0 ? total / quantity : 0),
      total_price: total || numberValue(item.unit_price) * quantity,
      confidence: Math.max(0, Math.min(1, numberValue(item.confidence, 0.7))),
      similar_to: String(item.similar_to || "").trim() || null,
      control_stock: item.control_stock !== false,
      conversion_factor: units.conversion_factor,
      unit_source: units.unit_source,
      unit_confirmed: units.unit_confirmed,
      inventory_kind: inventoryKind,
      similar_ingredient: String(item.similar_ingredient || "").trim() || null,
      similar_product: String(item.similar_product || "").trim() || null,
    };
  }).filter((item: any) => item.normalized_name);
  const aiItems = enrichCatalogMatches(parsedItems, ingredients || [], products || []);

  const totalAmount = numberValue(parsed.total_amount, aiItems.reduce((sum: number, item: any) => sum + Number(item.total_price || 0), 0));
  const attachment = await uploadReceipt(supabase, userId, fileBase64, mimeType, fileName);
  const { data: importRow, error: importError } = await supabase
    .from("smart_invoice_imports")
    .insert([{
      user_id: userId,
      source_type: isXml ? "xml" : mimeType.includes("pdf") ? "pdf" : "image",
      supplier_name: String(parsed.supplier_name || "").trim() || null,
      supplier_document: onlyDigits(parsed.supplier_document) || null,
      invoice_number: String(parsed.invoice_number || "").trim() || null,
      document_key: onlyDigits(parsed.document_key || parsed.access_key).slice(0, 44) || null,
      invoice_date: String(parsed.invoice_date || "").slice(0, 10) || todayIso(),
      due_date: String(parsed.due_date || "").slice(0, 10) || null,
      payment_method: String(parsed.payment_method || "").trim() || null,
      total_amount: totalAmount,
      expense_category: String(parsed.expense_category || "insumos").trim() || "insumos",
      receipt_url: null,
      attachment_path: attachment.path,
      attachment_name: attachment.name,
      attachment_mime_type: attachment.mimeType,
      attachment_size_bytes: attachment.sizeBytes,
      raw_ai_response: parsed,
    }])
    .select("*")
    .single();
  if (importError) {
    await supabase.storage.from("purchase-invoice-attachments").remove([attachment.path]);
    throw importError;
  }

  const rows = aiItems.map((item: any) => ({
    ...item,
    import_id: importRow.id,
    user_id: userId,
  }));
  const { data: insertedItems, error: itemError } = await supabase
    .from("smart_invoice_import_items")
    .insert(rows)
    .select("*");
  if (itemError) {
    await supabase.from("smart_invoice_imports").delete().eq("id", importRow.id).eq("user_id", userId);
    await supabase.storage.from("purchase-invoice-attachments").remove([attachment.path]);
    throw itemError;
  }

  return json({ ok: true, import: importRow, items: insertedItems || [] });
}

async function classifyManualItems(supabase: any, userId: string, rawItems: any[]) {
  const [{ data: ingredients }, { data: products }] = await Promise.all([
    supabase.from("ingredients").select("id,name,category,subcategory,unit,current_stock").eq("user_id", userId).limit(500),
    supabase.from("products").select("id,name,category,unit,track_stock,stock_quantity").eq("user_id", userId).limit(500),
  ]);
  let classified = rawItems.map((item, index) => ({
    ...item,
    local_id: String(item.local_id || item.id || index),
    description: String(item.description || item.normalized_name || `Item ${index + 1}`).trim(),
    normalized_name: cleanName(item.normalized_name || item.description || `Item ${index + 1}`),
    category: String(item.category || "Insumos").trim(),
    inventory_kind: inferInventoryKind(item),
  }));

  const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  if (geminiKey && classified.length > 0) {
    try {
      const catalog = [
        ...(ingredients || []).map((item: any) => ({ kind: "ingredient", name: item.name, category: item.category, subcategory: item.subcategory, unit: item.unit })),
        ...(products || []).map((item: any) => ({ kind: "product", name: item.name, category: item.category, unit: item.unit, track_stock: item.track_stock === true })),
      ];
      const ai = await geminiGenerateContent({
        apiKey: geminiKey,
        model: Deno.env.get("GEMINI_MODEL") || "gemini-1.5-flash",
        system: "Classifique itens de compra de restaurante. Nao invente correspondencias. Retorne somente JSON valido.",
        user: [
          `Itens: ${JSON.stringify(classified).slice(0, 12000)}`,
          `Catalogo desta loja: ${JSON.stringify(catalog).slice(0, 18000)}`,
          'Retorne {"items":[{"local_id":"...","normalized_name":"...","category":"...","subcategory":"...","inventory_kind":"ingredient|resale_product|packaging|cleaning|service|other","control_stock":true,"similar_ingredient":"nome exato ou vazio","similar_product":"nome exato ou vazio","confidence":0.9}]}',
        ].join("\n"),
        temperature: 0.1,
        responseMimeType: "application/json",
      });
      const parsed = safeParseJson(ai.text);
      if (Array.isArray(parsed?.items)) {
        const byId = new Map(parsed.items.map((item: any) => [String(item.local_id || ""), item]));
        classified = classified.map((item) => ({ ...item, ...(byId.get(item.local_id) || {}) }));
      }
    } catch (error) {
      console.warn("manual item AI classification fallback:", error);
    }
  }

  return enrichCatalogMatches(classified, ingredients || [], products || []).map((item) => ({
    ...item,
    quantity: Math.max(0.000001, numberValue(item.quantity, 1)),
    unit: normalizeUnit(item.unit),
    stock_unit: normalizeUnit(item.stock_unit || item.unit),
    conversion_factor: Math.max(0.000001, numberValue(item.conversion_factor, 1)),
    unit_price: Math.max(0, numberValue(item.unit_price, 0)),
    total_price: Math.max(0, numberValue(item.total_price, numberValue(item.quantity, 1) * numberValue(item.unit_price, 0))),
    control_stock: item.control_stock !== false && item.inventory_kind !== "service",
    unit_confirmed: item.unit_confirmed !== false && recognizedUnit(item.unit),
  }));
}

async function commitManualPurchase(supabase: any, userId: string, body: any) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) throw new Error("Adicione ao menos um item à compra manual.");
  const items = await classifyManualItems(supabase, userId, rawItems);
  const { data, error } = await supabase.rpc("commit_manual_purchase_import", {
    p_store_user_id: userId,
    p_purchase: body.purchase || {},
    p_items: items,
    p_launch_expense: body.launchExpense !== false,
    p_launch_stock: body.launchStock !== false,
  });
  if (error) throw error;
  return json({ ...(data || { ok: true }), items });
}

async function commitInvoice(supabase: any, userId: string, body: any) {
  const importId = String(body.importId || body.import_id || "");
  if (!importId) throw new Error("Importacao nao informada.");
  const launchExpense = body.launchExpense !== false;
  const launchStock = body.launchStock !== false;
  const reviewedItems = Array.isArray(body.items) ? body.items : [];
  const purchase = body.purchase && typeof body.purchase === "object" ? body.purchase : null;
  if (purchase) {
    const { error: metadataError } = await supabase
      .from("smart_invoice_imports")
      .update({
        supplier_name: String(purchase.supplier_name || "").trim() || null,
        supplier_document: onlyDigits(purchase.supplier_document) || null,
        invoice_number: String(purchase.invoice_number || "").trim() || null,
        invoice_date: String(purchase.invoice_date || "").slice(0, 10) || todayIso(),
        due_date: String(purchase.due_date || "").slice(0, 10) || null,
        payment_method: String(purchase.payment_method || "").trim() || null,
        expense_category: String(purchase.expense_category || "insumos").trim() || "insumos",
        total_amount: Math.max(0, numberValue(purchase.total_amount, 0)),
      })
      .eq("id", importId)
      .eq("user_id", userId)
      .eq("status", "draft");
    if (metadataError) throw metadataError;
  }

  const items = reviewedItems.map((merged: any) => {
    const quantity = Math.max(0.001, numberValue(merged.quantity, 1));
    const total = numberValue(merged.total_price, numberValue(merged.unit_price) * quantity);
    return {
      ...merged,
      description: String(merged.description || merged.normalized_name || "Item").trim(),
      normalized_name: cleanName(merged.normalized_name || merged.description || "Item"),
      category: String(merged.category || "Insumos").trim(),
      subcategory: String(merged.subcategory || "").trim(),
      quantity,
      unit: normalizeUnit(merged.unit),
      stock_unit: normalizeUnit(merged.stock_unit || merged.unit),
      unit_price: numberValue(merged.unit_price, total / quantity),
      total_price: total,
      control_stock: merged.control_stock !== false,
      conversion_factor: Math.max(0.000001, numberValue(merged.conversion_factor, 1)),
      unit_source: String(merged.unit_source || "confirmed"),
      unit_confirmed: merged.control_stock === false
        ? true
        : merged.unit_confirmed === true || (merged.unit_confirmed === undefined && recognizedUnit(merged.unit)),
      create_sale_product: merged.create_sale_product === true
        || (!merged.product_id && looksLikeSaleProduct(merged)),
    };
  }).filter((item: any) => item.normalized_name);
  const { data, error } = await supabase.rpc("commit_purchase_invoice_import", {
    p_import_id: importId,
    p_store_user_id: userId,
    p_items: items,
    p_launch_expense: launchExpense,
    p_launch_stock: launchStock,
  });
  if (error) throw error;
  return json(data || { ok: true });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Authorization header is required");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Invalid authorization token");

    const body = await req.json().catch(() => ({}));
    const requestedUserId = String(body.userId || body.user_id || user.id);
    if (requestedUserId !== user.id) {
      const { data: ownedNetworks } = await supabase
        .from("store_networks")
        .select("id")
        .eq("owner_user_id", user.id);
      const networkIds = (ownedNetworks || []).map((network: any) => network.id);
      if (networkIds.length === 0) throw new Error("Você não possui acesso a esta loja.");
      const { data: accessibleStore } = await supabase
        .from("store_network_stores")
        .select("store_user_id")
        .eq("store_user_id", requestedUserId)
        .eq("status", "active")
        .in("network_id", networkIds)
        .limit(1)
        .maybeSingle();
      if (!accessibleStore) throw new Error("Você não possui acesso a esta loja.");
    }
    const operation = String(body.operation || "analyze");
    if (operation === "analyze") return await analyzeInvoice(supabase, requestedUserId, body);
    if (operation === "classify-manual") return json({ ok: true, items: await classifyManualItems(supabase, requestedUserId, Array.isArray(body.items) ? body.items : []) });
    if (operation === "commit-manual") return await commitManualPurchase(supabase, requestedUserId, body);
    if (operation === "commit") return await commitInvoice(supabase, requestedUserId, body);
    throw new Error("Operacao nao suportada.");
  } catch (error: any) {
    console.error("smart-invoice-import error:", error);
    const message = error?.code === "23505"
      ? "Esta nota fiscal já foi importada para este restaurante."
      : error?.message || "Erro interno";
    return json({ ok: false, error: message }, 400);
  }
});
