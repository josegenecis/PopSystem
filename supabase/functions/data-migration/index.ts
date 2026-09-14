// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { resolveStoreUserId } from "../_shared/multi-store.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_DECOMPRESSED_BYTES = 140 * 1024 * 1024;

type DatasetType =
  | "products"
  | "customers"
  | "orders"
  | "order_items"
  | "sales"
  | "unknown";
type Dataset = {
  name: string;
  rows: Record<string, any>[];
  detectedType: DatasetType;
};

const ENTITY_LABELS: Record<DatasetType, string> = {
  products: "Produtos",
  customers: "Clientes",
  orders: "Vendas",
  order_items: "Itens das vendas",
  sales: "Vendas com itens",
  unknown: "Não identificado",
};

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const clean = (value: unknown) =>
  String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value: unknown) =>
  clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const slug = (value: unknown) => key(value).replace(/_/g, "-");
const digits = (value: unknown) => clean(value).replace(/\D/g, "");

function rowIndex(row: Record<string, any>) {
  const indexed: Record<string, any> = {};
  Object.entries(row || {}).forEach(([column, value]) => {
    indexed[key(column)] = value;
  });
  return indexed;
}

function pick(row: Record<string, any>, aliases: string[]) {
  const indexed = rowIndex(row);
  for (const alias of aliases) {
    const value = indexed[key(alias)];
    if (value !== undefined && value !== null && clean(value) !== "") {
      return value;
    }
  }
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let raw = clean(value).replace(/R\$/gi, "").replace(/\s/g, "");
  if (!raw) return 0;
  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  }
  raw = raw.replace(/[^0-9.-]/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return Math.round(numberValue(value) * 100) / 100;
}

function boolValue(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value;
  const normalized = key(value);
  if (["0", "false", "nao", "inativo", "indisponivel"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "sim", "ativo", "disponivel"].includes(normalized)) {
    return true;
  }
  return fallback;
}

function dateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && value > 20000 && value < 100000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(
        Date.UTC(
          parsed.y,
          parsed.m - 1,
          parsed.d,
          parsed.H,
          parsed.M,
          Math.floor(parsed.S),
        ),
      ).toISOString();
    }
  }
  const raw = clean(value);
  if (!raw) return new Date().toISOString();
  const br = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (br) {
    const parsed = new Date(
      Number(br[3]),
      Number(br[2]) - 1,
      Number(br[1]),
      Number(br[4] || 12),
      Number(br[5] || 0),
      Number(br[6] || 0),
    );
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

export function parseCsv(text: string) {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const delimiters = [";", ",", "\t"];
  const delimiter =
    delimiters.sort((a, b) =>
      sample.split(b).length - sample.split(a).length
    )[0];
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => clean(cell))) records.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => clean(cell))) records.push(row);
  const headers = (records.shift() || []).map((header, index) =>
    clean(header) || `coluna_${index + 1}`
  );
  return records.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    )
  );
}

export function classify(
  name: string,
  rows: Record<string, any>[],
): DatasetType {
  const datasetKey = key(name);
  const columns = new Set(Object.keys(rows[0] || {}).map(key));
  const has = (...aliases: string[]) =>
    aliases.some((alias) => columns.has(key(alias)));
  const orderSignal = has(
    "pedido",
    "pedido_id",
    "numero_pedido",
    "venda",
    "venda_id",
    "order_id",
    "sale_id",
  );
  const productSignal = has(
    "produto",
    "produto_id",
    "nome_produto",
    "product",
    "product_id",
    "item",
    "descricao_item",
  );
  if (/itens.*(venda|pedido)|(order|sale).*items/.test(datasetKey)) {
    return "order_items";
  }
  if (orderSignal && productSignal && has("quantidade", "qtd", "quantity")) {
    return "sales";
  }
  if (/vendas|pedidos|sales|orders|cupons|movimentos/.test(datasetKey)) {
    return productSignal ? "sales" : "orders";
  }
  if (/clientes|customers|consumidores|pessoas/.test(datasetKey)) {
    return "customers";
  }
  if (/produtos|products|cardapio|itens/.test(datasetKey)) return "products";
  if (has("telefone", "celular", "phone") && has("cliente", "nome", "name")) {
    return "customers";
  }
  if (orderSignal && has("total", "valor_total", "data")) {
    return productSignal ? "sales" : "orders";
  }
  if (productSignal && has("preco", "price", "valor_unitario", "categoria")) {
    return "products";
  }
  return "unknown";
}

function datasetsFromJson(parsed: any, filename: string): Dataset[] {
  if (Array.isArray(parsed)) {
    const rows = parsed.filter((row) =>
      row && typeof row === "object" && !Array.isArray(row)
    );
    return [{
      name: filename.replace(/\.[^.]+$/, "") || "dados",
      rows,
      detectedType: classify(filename, rows),
    }];
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("O JSON não contém listas de dados.");
  }
  const result: Dataset[] = [];
  const visit = (value: any, path: string, depth: number) => {
    if (depth > 3 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      const rows = value.filter((row) =>
        row && typeof row === "object" && !Array.isArray(row)
      ) as Record<string, any>[];
      if (rows.length) {
        result.push({
          name: path || "dados",
          rows,
          detectedType: classify(path, rows),
        });
      }
      return;
    }
    Object.entries(value).forEach(([name, child]) =>
      visit(child, path ? `${path}.${name}` : name, depth + 1)
    );
  };
  visit(parsed, "", 0);
  if (!result.length) {
    throw new Error(
      "Não encontrei listas de produtos, clientes ou vendas no JSON.",
    );
  }
  return result;
}

export function parseSource(
  bytes: Uint8Array,
  filename: string,
  contentType = "",
): Dataset[] {
  const extension = key(filename.split(".").pop() || "");
  if (
    ["xlsx", "xls"].includes(extension) ||
    /spreadsheet|excel/i.test(contentType)
  ) {
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    return workbook.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(
        workbook.Sheets[name],
        { defval: null, raw: true },
      );
      return { name, rows, detectedType: classify(name, rows) };
    }).filter((dataset) => dataset.rows.length > 0);
  }
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  if (
    extension === "json" || /json/i.test(contentType) ||
    /^[\s\r\n]*[\[{]/.test(text)
  ) {
    return datasetsFromJson(JSON.parse(text), filename);
  }
  const rows = parseCsv(text);
  return [{
    name: filename.replace(/\.[^.]+$/, "") || "dados",
    rows,
    detectedType: classify(filename, rows),
  }];
}

function safeUrl(raw: string) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Use um link HTTP ou HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("O link não pode conter usuário ou senha.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" || host === "0.0.0.0" || host === "::" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^(127|10)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
      .test(host) ||
    /^(fc|fd|fe[89ab]|2001:db8)/.test(host)
  ) {
    throw new Error(
      "O link precisa estar acessível publicamente. Para banco offline, envie o arquivo.",
    );
  }
  return url.toString();
}

async function fetchPublicSource(rawUrl: string) {
  let currentUrl = safeUrl(rawUrl);
  for (let redirect = 0; redirect <= 5; redirect++) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: {
        accept:
          "application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: currentUrl };
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new Error("O link retornou um redirecionamento inválido.");
    }
    currentUrl = safeUrl(new URL(location, currentUrl).toString());
  }
  throw new Error("O link possui redirecionamentos demais.");
}

async function readLimited(
  response: Response,
  maximumBytes: number,
  limitMessage = "O arquivo do link ultrapassa 50 MB.",
) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(limitMessage);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function decompressGzip(bytes: Uint8Array) {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  return await readLimited(
    new Response(stream),
    MAX_DECOMPRESSED_BYTES,
    "Os dados descompactados ultrapassam 140 MB. Solicite uma importação assistida.",
  );
}

async function prepareLoadedSource(
  bytes: Uint8Array,
  filename: string,
  contentType: string,
  storageHint = "",
) {
  const compressed = /\.gz$/i.test(filename) || /\.gz(?:$|\?)/i.test(storageHint) ||
    /(?:application\/gzip|application\/x-gzip)/i.test(contentType);
  if (!compressed) return { bytes, filename, contentType };
  return {
    bytes: await decompressGzip(bytes),
    filename: filename.replace(/\.gz$/i, "") || "dados.json",
    contentType: "application/json",
  };
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function loadSource(admin: any, authUserId: string, source: any) {
  if (source?.type === "upload") {
    const path = clean(source.path);
    if (!path.startsWith(`${authUserId}/`)) {
      throw new Error("Arquivo de importação inválido.");
    }
    const { data, error } = await admin.storage.from("data-imports").download(
      path,
    );
    if (error || !data) {
      throw new Error(
        `Não consegui abrir o arquivo: ${error?.message || "arquivo ausente"}`,
      );
    }
    const storedBytes = new Uint8Array(await data.arrayBuffer());
    const filename = clean(source.name) || path.split("/").pop() || "dados";
    const prepared = await prepareLoadedSource(
      storedBytes,
      filename,
      data.type || "",
      path,
    );
    return {
      ...prepared,
      storagePath: path,
      sourceUrl: null,
    };
  }
  if (source?.type === "url") {
    const { response, finalUrl: sourceUrl } = await fetchPublicSource(
      clean(source.url),
    );
    if (!response.ok) {
      throw new Error(`Não consegui baixar o link (${response.status}).`);
    }
    if (/text\/html/i.test(response.headers.get("content-type") || "")) {
      throw new Error(
        "Esse link abriu uma página HTML. Use o link direto de exportação ou envie o arquivo baixado.",
      );
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 52_428_800) {
      throw new Error("O arquivo do link ultrapassa 50 MB.");
    }
    const storedBytes = await readLimited(response, 52_428_800);
    const disposition = response.headers.get("content-disposition") || "";
    const dispositionName = disposition.match(
      /filename\*?=(?:UTF-8''|["']?)([^"';]+)/i,
    )?.[1];
    const filename = decodeURIComponent(
      dispositionName || new URL(sourceUrl).pathname.split("/").pop() ||
        "dados.csv",
    );
    const prepared = await prepareLoadedSource(
      storedBytes,
      filename,
      response.headers.get("content-type") || "",
      sourceUrl,
    );
    return {
      ...prepared,
      storagePath: null,
      sourceUrl,
    };
  }
  throw new Error("Selecione um arquivo ou informe um link.");
}

function previewDatasets(datasets: Dataset[]) {
  return datasets.map((dataset) => ({
    name: dataset.name,
    detectedType: dataset.detectedType,
    detectedLabel: ENTITY_LABELS[dataset.detectedType],
    rowCount: dataset.rows.length,
    columns: Object.keys(dataset.rows[0] || {}).slice(0, 30),
    preview: dataset.rows.slice(0, 4),
  }));
}

function normalizeProduct(row: Record<string, any>, index: number) {
  const name = clean(
    pick(row, [
      "nome",
      "produto",
      "nome_produto",
      "product",
      "product_name",
      "descricao",
    ]),
  );
  return {
    externalId: clean(
      pick(row, [
        "id",
        "produto_id",
        "product_id",
        "codigo",
        "codigo_produto",
        "sku",
        "referencia",
      ]),
    ) || `produto-${index + 1}-${slug(name)}`,
    name,
    description: clean(pick(row, ["descricao", "description", "detalhes"])),
    price: money(
      pick(row, ["preco", "price", "valor", "valor_unitario", "preco_venda"]),
    ),
    category: clean(pick(row, ["categoria", "category", "grupo", "secao"])) ||
      "Importados",
    available: boolValue(
      pick(row, ["ativo", "active", "disponivel", "available"]),
      true,
    ),
    barcode: digits(pick(row, ["codigo_barras", "barcode", "ean", "gtin"])),
    ncm: digits(pick(row, ["ncm"])).slice(0, 8),
  };
}

function normalizeCustomer(row: Record<string, any>, index: number) {
  const phone = digits(
    pick(row, ["telefone", "celular", "phone", "whatsapp", "fone"]),
  );
  const name =
    clean(pick(row, ["nome", "cliente", "customer", "name", "razao_social"])) ||
    `Cliente importado ${index + 1}`;
  return {
    externalId: clean(
      pick(row, [
        "id",
        "cliente_id",
        "customer_id",
        "codigo",
        "codigo_cliente",
      ]),
    ) || phone || `cliente-${index + 1}-${slug(name)}`,
    name,
    phone,
    address: clean(pick(row, ["endereco", "address", "logradouro"])),
    neighborhood: clean(pick(row, ["bairro", "neighborhood"])),
  };
}

function normalizeItem(row: Record<string, any>, index: number) {
  const name = clean(
    pick(row, [
      "produto",
      "nome_produto",
      "product",
      "product_name",
      "item",
      "descricao_item",
      "descricao",
    ]),
  ) || `Item importado ${index + 1}`;
  const quantity = Math.max(
    numberValue(pick(row, ["quantidade", "qtd", "quantity", "qtde"])) || 1,
    0.0001,
  );
  const unitPrice = money(
    pick(row, [
      "preco_unitario",
      "valor_unitario",
      "unit_price",
      "preco",
      "price",
    ]),
  );
  const subtotal =
    money(pick(row, ["subtotal", "total_item", "valor_total_item"])) ||
    money(unitPrice * quantity);
  return {
    externalProductId: clean(
      pick(row, ["produto_id", "product_id", "codigo_produto", "sku"]),
    ),
    product_name: name,
    price: unitPrice,
    quantity,
    subtotal,
    notes: clean(pick(row, ["observacao_item", "item_notes", "complemento"])),
  };
}

function parseEmbeddedItems(value: unknown) {
  if (Array.isArray(value)) return value;
  const raw = clean(value);
  if (!raw || !["[", "{"].includes(raw[0])) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeOrder(row: Record<string, any>, index: number) {
  const externalId = clean(
    pick(row, [
      "venda_id",
      "pedido_id",
      "order_id",
      "sale_id",
      "numero_venda",
      "numero_pedido",
      "cupom",
      "id",
      "codigo",
    ]),
  ) || `venda-${index + 1}`;
  const orderNumber = clean(
    pick(row, [
      "numero_venda",
      "numero_pedido",
      "order_number",
      "pedido",
      "venda",
      "cupom",
    ]),
  ) || externalId;
  const rawItems = parseEmbeddedItems(
    pick(row, ["itens", "items", "produtos", "order_items"]),
  );
  return {
    externalId,
    orderNumber,
    createdAt: dateValue(
      pick(row, [
        "data_hora",
        "data",
        "created_at",
        "date",
        "emissao",
        "data_venda",
      ]),
    ),
    customerExternalId: clean(
      pick(row, ["cliente_id", "customer_id", "codigo_cliente"]),
    ),
    customerName: clean(
      pick(row, ["cliente", "nome_cliente", "customer_name", "consumidor"]),
    ),
    customerPhone: digits(
      pick(row, ["telefone", "cliente_telefone", "customer_phone", "celular"]),
    ),
    customerAddress: clean(
      pick(row, ["endereco", "customer_address", "endereco_cliente"]),
    ),
    paymentMethod: clean(
      pick(row, [
        "forma_pagamento",
        "payment_method",
        "pagamento",
        "meio_pagamento",
      ]),
    ) || "outro",
    total: money(pick(row, ["total", "valor_total", "total_venda", "amount"])),
    deliveryFee: money(pick(row, ["taxa_entrega", "delivery_fee", "frete"])),
    orderType:
      clean(pick(row, ["tipo", "order_type", "canal", "modalidade"])) ||
      "counter",
    items: rawItems.map((item, itemIndex) => normalizeItem(item, itemIndex)),
  };
}

async function must(label: string, promise: PromiseLike<any>): Promise<any> {
  const { data, error } = await promise as any;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function importDatasets(
  admin: any,
  userId: string,
  job: any,
  datasets: Dataset[],
  mapping: Record<string, DatasetType>,
) {
  datasets.forEach((dataset) => {
    dataset.detectedType = mapping[dataset.name] || dataset.detectedType;
  });
  const result = {
    categoriesCreated: 0,
    productsCreated: 0,
    productsReused: 0,
    customersCreated: 0,
    customersReused: 0,
    ordersCreated: 0,
    ordersSkipped: 0,
    rowsIgnored: 0,
    warnings: [] as string[],
  };
  const refs = await must(
    "buscar referências anteriores",
    admin.from("data_import_external_refs").select(
      "entity_type,external_id,internal_id",
    ).eq("user_id", userId).eq("source_system", job.source_system),
  );
  const refMap = new Map<string, string>(
    (refs || []).map((
      ref: any,
    ) => [
      `${ref.entity_type}:${clean(ref.external_id)}`,
      String(ref.internal_id),
    ]),
  );
  const refsToInsert: any[] = [];

  const productRows = datasets.filter((dataset) =>
    dataset.detectedType === "products"
  ).flatMap((dataset) => dataset.rows);
  const products = productRows.map(normalizeProduct).filter((product) =>
    product.name
  );
  const existingCategories = await must(
    "buscar categorias",
    admin.from("product_categories").select("id,name").eq("user_id", userId),
  );
  const categoryMap = new Map<string, string>(
    (existingCategories || []).map((
      category: any,
    ) => [key(category.name), String(category.id)]),
  );
  for (
    const categoryName of Array.from(
      new Set(products.map((product) => product.category)),
    )
  ) {
    if (categoryMap.has(key(categoryName))) continue;
    const category = await must(
      "criar categoria",
      admin.from("product_categories").insert({
        user_id: userId,
        name: categoryName,
        active: true,
      }).select("id").single(),
    );
    categoryMap.set(key(categoryName), category.id);
    result.categoriesCreated++;
  }

  const existingProducts = await must(
    "buscar produtos",
    admin.from("products").select("id,name").eq("user_id", userId),
  );
  const productByName = new Map<string, string>(
    (existingProducts || []).map((
      product: any,
    ) => [key(product.name), String(product.id)]),
  );
  const productByExternal = new Map<string, string>();
  for (const product of products) {
    let productId = refMap.get(`product:${product.externalId}`) ||
      productByName.get(key(product.name));
    if (!productId) {
      const created = await must(
        "criar produto",
        admin.from("products").insert({
          user_id: userId,
          name: product.name,
          description: product.description || null,
          price: product.price,
          category: product.category,
          category_id: categoryMap.get(key(product.category)),
          barcode: product.barcode || null,
          fiscal_ncm: product.ncm || null,
          available: product.available,
          is_available: product.available,
          available_delivery: product.available,
          available_pdv: product.available,
          show_in_delivery: product.available,
          show_in_pdv: product.available,
          send_to_kds: false,
          track_stock: false,
          stock_quantity: 0,
          low_stock_threshold: 5,
        }).select("id").single(),
      );
      productId = String(created.id);
      productByName.set(key(product.name), productId);
      result.productsCreated++;
    } else result.productsReused++;
    if (!productId) {
      throw new Error(`Não foi possível vincular o produto ${product.name}.`);
    }
    productByExternal.set(product.externalId, productId);
    if (!refMap.has(`product:${product.externalId}`)) {
      refsToInsert.push({
        user_id: userId,
        job_id: job.id,
        source_system: job.source_system,
        entity_type: "product",
        external_id: product.externalId,
        internal_id: productId,
      });
    }
  }

  const customerRows = datasets.filter((dataset) =>
    dataset.detectedType === "customers"
  ).flatMap((dataset) => dataset.rows);
  const customers = customerRows.map(normalizeCustomer);
  const existingCustomers = await must(
    "buscar clientes",
    admin.from("customers").select("id,name,phone").eq("user_id", userId),
  );
  const customerByPhone = new Map<string, string>(
    (existingCustomers || []).map((
      customer: any,
    ) => [digits(customer.phone), String(customer.id)]).filter(([phone]: any) =>
      phone
    ),
  );
  const customerByExternal = new Map<string, string>();
  for (const customer of customers) {
    if (!customer.phone) {
      result.rowsIgnored++;
      result.warnings.push(
        `Cliente "${customer.name}" ignorado porque não possui telefone.`,
      );
      continue;
    }
    let customerId = refMap.get(`customer:${customer.externalId}`) ||
      customerByPhone.get(customer.phone);
    if (!customerId) {
      const created = await must(
        "criar cliente",
        admin.from("customers").insert({
          user_id: userId,
          name: customer.name,
          phone: customer.phone,
          address: customer.address || null,
          neighborhood: customer.neighborhood || null,
        }).select("id").single(),
      );
      customerId = String(created.id);
      customerByPhone.set(customer.phone, customerId);
      result.customersCreated++;
    } else result.customersReused++;
    if (!customerId) {
      throw new Error(`Não foi possível vincular o cliente ${customer.name}.`);
    }
    customerByExternal.set(customer.externalId, customerId);
    if (!refMap.has(`customer:${customer.externalId}`)) {
      refsToInsert.push({
        user_id: userId,
        job_id: job.id,
        source_system: job.source_system,
        entity_type: "customer",
        external_id: customer.externalId,
        internal_id: customerId,
      });
    }
  }

  const orders: any[] = datasets.filter((dataset) =>
    dataset.detectedType === "orders"
  ).flatMap((dataset) => dataset.rows).map(normalizeOrder);
  const saleRows = datasets.filter((dataset) =>
    dataset.detectedType === "sales"
  ).flatMap((dataset) => dataset.rows);
  const salesByOrder = new Map<string, any>();
  saleRows.forEach((row, index) => {
    const order = normalizeOrder(row, index);
    const current = salesByOrder.get(order.externalId) ||
      { ...order, items: [] };
    current.items.push(normalizeItem(row, index));
    if (!current.total) {
      current.total = money(
        current.items.reduce(
          (sum: number, item: any) => sum + item.subtotal,
          0,
        ),
      );
    }
    salesByOrder.set(order.externalId, current);
  });
  orders.push(...salesByOrder.values());

  const itemRows = datasets.filter((dataset) =>
    dataset.detectedType === "order_items"
  ).flatMap((dataset) => dataset.rows);
  const standaloneItems = new Map<string, any[]>();
  itemRows.forEach((row, index) => {
    const orderId = clean(
      pick(row, [
        "pedido_id",
        "order_id",
        "venda_id",
        "sale_id",
        "numero_pedido",
        "numero_venda",
        "pedido",
        "venda",
      ]),
    );
    if (!orderId) return;
    standaloneItems.set(orderId, [
      ...(standaloneItems.get(orderId) || []),
      normalizeItem(row, index),
    ]);
  });

  const seenOrderExternalIds = new Set(
    Array.from(refMap.keys())
      .filter((reference) => reference.startsWith("order:"))
      .map((reference) => reference.slice("order:".length)),
  );
  for (const order of orders) {
    const externalId = clean(order.externalId);
    if (seenOrderExternalIds.has(externalId)) {
      result.ordersSkipped++;
      continue;
    }
    if (!order.items.length) {
      order.items = standaloneItems.get(order.externalId) ||
        standaloneItems.get(order.orderNumber) || [];
    }
    order.items = order.items.map((item: any) => ({
      product_id: productByExternal.get(item.externalProductId) ||
        productByName.get(key(item.product_name)) || null,
      product_name: item.product_name,
      price: item.price,
      quantity: item.quantity,
      subtotal: item.subtotal,
      notes: item.notes || "",
      options: [],
      variations: [],
    }));
    if (!order.total) {
      order.total = money(
        order.items.reduce((sum: number, item: any) => sum + item.subtotal, 0) +
          order.deliveryFee,
      );
    }
    const customerId = customerByExternal.get(order.customerExternalId) ||
      customerByPhone.get(order.customerPhone) || null;
    const created = await must(
      "criar venda histórica",
      admin.from("orders").insert({
        user_id: userId,
        order_number: order.orderNumber,
        created_at: order.createdAt,
        updated_at: order.createdAt,
        customer_id: customerId,
        customer_name: order.customerName || null,
        customer_phone: order.customerPhone || null,
        customer_address: order.customerAddress || null,
        items: order.items,
        total: order.total,
        delivery_fee: order.deliveryFee,
        payment_method: order.paymentMethod,
        status: "delivered",
        acceptance_status: "accepted",
        order_type: normalizeOrderType(order.orderType),
        variations: {
          source: "MIGRACAO",
          import: {
            job_id: job.id,
            source_system: job.source_system,
            external_id: order.externalId,
          },
        },
      }).select("id").single(),
    );
    refsToInsert.push({
      user_id: userId,
      job_id: job.id,
      source_system: job.source_system,
      entity_type: "order",
      external_id: externalId,
      internal_id: created.id,
    });
    seenOrderExternalIds.add(externalId);
    result.ordersCreated++;
  }

  for (let index = 0; index < refsToInsert.length; index += 500) {
    await must(
      "gravar referências da migração",
      admin.from("data_import_external_refs").upsert(
        refsToInsert.slice(index, index + 500),
        {
          onConflict: "user_id,source_system,entity_type,external_id",
          ignoreDuplicates: true,
        },
      ),
    );
  }
  result.warnings = Array.from(new Set(result.warnings)).slice(0, 50);
  return result;
}

function normalizeOrderType(value: unknown) {
  const normalized = key(value);
  if (/delivery|entrega/.test(normalized)) return "delivery";
  if (/mesa|salao|dine/.test(normalized)) return "dine_in";
  if (/retirada|pickup/.test(normalized)) return "pickup";
  return "counter";
}

export async function handleRequest(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  let jobId: string | null = null;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader) throw new Error("Sua sessão expirou. Entre novamente.");
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authError } = await authClient.auth.getUser(
      token,
    );
    if (authError || !user) {
      throw new Error("Sua sessão expirou. Entre novamente.");
    }
    const body = await req.json();
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const storeUserId = await resolveStoreUserId(
      admin,
      user.id,
      body?._storeId,
    );
    const action = clean(body?.action);

    if (action === "analyze") {
      const loaded = await loadSource(admin, user.id, body?.source);
      if (!loaded.bytes.length) throw new Error("O arquivo está vazio.");
      const datasets = parseSource(
        loaded.bytes,
        loaded.filename,
        loaded.contentType,
      );
      if (!datasets.length) {
        throw new Error("Não encontrei planilhas ou registros no arquivo.");
      }
      const fingerprint = await sha256(loaded.bytes);
      const sourceSystem = key(
        clean(body?.sourceSystem) ||
          loaded.filename.replace(/\.[^.]+$/, "") || "sistema-legado",
      ) || "sistema-legado";
      const analysis = {
        datasets: previewDatasets(datasets),
        totals: Object.fromEntries(
          Object.keys(ENTITY_LABELS).map((
            type,
          ) => [
            type,
            datasets.filter((dataset) => dataset.detectedType === type).reduce(
              (sum, dataset) => sum + dataset.rows.length,
              0,
            ),
          ]),
        ),
      };
      const job = await must(
        "registrar análise",
        admin.from("data_import_jobs").insert({
          user_id: storeUserId,
          created_by: user.id,
          source_type: body?.source?.type,
          source_name: loaded.filename,
          source_system: sourceSystem,
          source_fingerprint: fingerprint,
          storage_path: loaded.storagePath,
          source_url: loaded.sourceUrl,
          status: "ready",
          analysis,
        }).select("id,source_name,source_system,status,analysis,created_at")
          .single(),
      );
      jobId = job.id;
      return json({ success: true, job });
    }

    if (action === "import") {
      jobId = clean(body?.jobId);
      const job = await must(
        "buscar análise",
        admin.from("data_import_jobs").select("*").eq("id", jobId).eq(
          "user_id",
          storeUserId,
        ).single(),
      );
      if (!job) throw new Error("Análise de migração não encontrada.");
      await must(
        "iniciar migração",
        admin.from("data_import_jobs").update({
          status: "importing",
          updated_at: new Date().toISOString(),
        }).eq("id", job.id),
      );
      const loaded = await loadSource(
        admin,
        user.id,
        job.source_type === "upload"
          ? { type: "upload", path: job.storage_path, name: job.source_name }
          : { type: "url", url: job.source_url },
      );
      const fingerprint = await sha256(loaded.bytes);
      if (fingerprint !== job.source_fingerprint) {
        throw new Error(
          "O conteúdo do arquivo ou link mudou desde a análise. Analise novamente antes de importar.",
        );
      }
      const datasets = parseSource(
        loaded.bytes,
        loaded.filename,
        loaded.contentType,
      );
      const result = await importDatasets(
        admin,
        storeUserId,
        job,
        datasets,
        body?.mapping || {},
      );
      await must(
        "concluir migração",
        admin.from("data_import_jobs").update({
          status: "completed",
          result,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", job.id),
      );
      return json({ success: true, status: "completed", result });
    }

    throw new Error("Ação de migração inválida.");
  } catch (error) {
    console.error("[data-migration]", error);
    if (jobId) {
      try {
        const admin = createClient(
          Deno.env.get("SUPABASE_URL") || "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
          { auth: { persistSession: false } },
        );
        await admin.from("data_import_jobs").update({
          status: "failed",
          errors: [{
            message: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          }],
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);
      } catch { /* preserva o erro original */ }
    }
    return json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 400);
  }
}

if (import.meta.main) serve(handleRequest);
