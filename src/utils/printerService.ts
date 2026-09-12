import { supabase } from '@/integrations/supabase/client';
import { getOrderItemDetailGroups } from '@/lib/orderDetails';
import { toast } from 'sonner';
import { getPublicWebBaseUrl } from '@/utils/publicUrl';
import { bridgePrintReceipt } from '@/services/bridgePrinterClient';
import { discoverBridgeWebsocketUrl } from '@/services/bridgeDiscovery';
import { loadPrinterConfig } from '@/services/printerConfig';

// ESC/POS Commands
const ESC = '\x1B';
const GS = '\x1D';
const INIT = ESC + '@';
const CUT_PARTIAL = GS + 'V' + '\x41' + '\x00';
const CUT_FULL = GS + 'V' + '\x00';
const BOLD_ON = ESC + 'E' + '\x01';
const BOLD_OFF = ESC + 'E' + '\x00';
const DOUBLE_STRIKE_ON = ESC + 'G' + '\x01';
const DOUBLE_STRIKE_OFF = ESC + 'G' + '\x00';
const ALIGN_CENTER = ESC + 'a' + '\x01';
const ALIGN_LEFT = ESC + 'a' + '\x00';
const ALIGN_RIGHT = ESC + 'a' + '\x02';
const BRAND_NAME = 'PopSystem';
const BRAND_POS_NAME = 'POPSYSTEM PDV';

// Variável global para manter a conexão ativa (singleton pattern simples)
let usbDevice: any = null;
const printedAcceptedOrderIds =
  (globalThis as any).__popsystemPrintedAcceptedOrders || new Set<string>();
(globalThis as any).__popsystemPrintedAcceptedOrders = printedAcceptedOrderIds;

type PrintOrderOptions = {
  onlyIfAuto?: boolean;
  openCashDrawer?: boolean;
  rasterizeSystemReceipt?: boolean;
};

type NormalizedPrintConfig = {
  paper_width: '58mm' | '80mm';
  font_size: 'small' | 'normal' | 'large';
  print_header: string;
  print_footer: string;
  copies: number;
  receipt_logo_url: string;
  print_kitchen_ticket: boolean;
};

type ElectronTarget =
  | { type: 'system'; printerName: string }
  | { type: 'device'; deviceId: string; protocol: string };

function escapeHtml(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitLabelValue(line: string): { label: string; value: string } | null {
  const raw = String(line || '').trim();
  if (!raw) return null;
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const label = raw.slice(0, idx).trim();
  const value = raw.slice(idx + 1).trim();
  if (!label) return null;
  return { label, value };
}

function normalizeSingleLine(value: any) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function breakLongTextForHtml(value: string, chunkSize = 22) {
  const text = normalizeSingleLine(value);
  if (!text) return '';
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks.map(escapeHtml).join('<br />');
}

function formatAccessKeyForPrint(value: string) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 44);
  if (!digits) return '';
  return (digits.match(/.{1,4}/g) || [digits]).join(' ');
}

function getNfceConsultaBaseUrl(qrCodeUrl: string) {
  const value = normalizeSingleLine(qrCodeUrl);
  if (!value) return '';
  const queryIndex = value.indexOf('?');
  return queryIndex >= 0 ? value.slice(0, queryIndex) : value;
}

function extractNfceQrAccessKey(qrCodeUrl: string) {
  const p = String(qrCodeUrl || '').match(/[?&]p=([^&\s]+)/)?.[1] || '';
  const decoded = decodeURIComponent(p).replace(/%7C/gi, '|');
  return decoded.split('|')[0]?.replace(/\D/g, '').slice(0, 44) || '';
}

function decodeXmlEntities(value: string) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractNfceQrCodeFromXml(value: string) {
  const match = String(value || '').match(/<qrCode>([\s\S]*?)<\/qrCode>/i);
  return match ? normalizeSingleLine(decodeXmlEntities(match[1])) : '';
}

function extractNfceAccessKeyFromXml(value: string) {
  const xml = String(value || '');
  const idMatch = xml.match(/<infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i);
  if (idMatch?.[1]) return idMatch[1];
  const keyMatch = xml.match(/<chNFe>(\d{44})<\/chNFe>/i);
  return keyMatch?.[1] || '';
}

function normalizeNfceQrCodeUrl(qrCodeUrl: string, ambiente: string, chave: string) {
  let url = normalizeSingleLine(qrCodeUrl);
  if (!url) return '';

  const isHomologacao = ambiente && ambiente !== 'producao';
  if (isHomologacao && url.includes('://nfce.sefaz.ce.gov.br/')) {
    url = url.replace('://nfce.sefaz.ce.gov.br/', '://nfceh.sefaz.ce.gov.br/');
  }

  const qrAccessKey = extractNfceQrAccessKey(url);
  const accessKey = String(chave || '').replace(/\D/g, '').slice(0, 44);
  if (accessKey && qrAccessKey && accessKey !== qrAccessKey) {
    console.warn('NFC-e QR Code ignorado: chave do QR diferente da chave autorizada.', {
      accessKey,
      qrAccessKey,
    });
    return '';
  }

  return url;
}

function getNfceQrCodePayloadUrl(qrCodeUrl: string) {
  return normalizeSingleLine(qrCodeUrl).replace(/%7C/gi, '|');
}

function resolveReceiptLogoUrl(store: any, config: any) {
  return String(config?.receipt_logo_url || store?.receipt_logo_url || store?.logo_url || '').trim();
}

function resolveCustomerAddressLine(order: any) {
  const address = normalizeSingleLine(order?.customer_address);
  const neighborhood = normalizeSingleLine(order?.delivery_zone_name || order?.customer_neighborhood);
  if (!address) return neighborhood;
  if (!neighborhood) return address;

  const lowerAddress = address.toLowerCase();
  const lowerNeighborhood = neighborhood.toLowerCase();
  if (lowerAddress.includes(lowerNeighborhood)) return address;
  return `${address} - Bairro: ${neighborhood}`;
}

function getOrderTypeLabel(order: any) {
  const orderType = String(order?.order_type || '').trim().toLowerCase();
  if (orderType === 'delivery') return 'Delivery';
  if (orderType === 'pickup') return 'Retirada';
  if (orderType === 'dine_in') return 'Mesa';
  return 'Balcão';
}

function getPaymentSplitLines(order: any) {
  const lines = order?.variations?.payment_split?.lines;
  if (!Array.isArray(lines)) return [];
  const normalized = lines
    .map((line: any) => ({
      label: normalizeSingleLine(line?.method ? formatPaymentMethodLabel(line.method, order) : line?.label),
      amount: Number(line?.amount || 0),
    }))
    .filter((line) => line.label && Number.isFinite(line.amount) && line.amount > 0);
  const totals = new Map<string, number>();
  normalized.forEach((line) => totals.set(line.label, (totals.get(line.label) || 0) + line.amount));
  return Array.from(totals, ([label, amount]) => ({ label, amount }));
}

function formatPaymentMethodLabel(method: any, order?: any) {
  const value = String(method || '').trim().toLowerCase();
  const acceptanceStatus = String(order?.acceptance_status || '').trim().toLowerCase();
  if (value === 'pix' && acceptanceStatus === 'awaiting_pix_payment') return 'PIX ONLINE';
  if (value === 'pix') return 'PIX';
  if (value === 'pix_online') return 'PIX ONLINE';
  if (value === 'pix_entrega') return 'PIX NA ENTREGA';
  if (value === 'cartao' || value === 'cartão') return 'CARTAO';
  if (value === 'dinheiro') return 'DINHEIRO';
  if (value === 'cartao_credito') return 'CREDITO';
  if (value === 'cartao_debito') return 'DEBITO';
  return String(method || 'N/A').toUpperCase().replace('_', ' ');
}

function normalizeNfcePrintData(order: any) {
  const rawCandidate = order?.nfce || order?.fiscal || order?.nfce_data || null;
  const raw =
    rawCandidate?.cupom && typeof rawCandidate.cupom === 'object'
      ? { ...rawCandidate.cupom, ...rawCandidate }
      : rawCandidate;
  if (!raw || typeof raw !== 'object') return null;

  const numero = normalizeSingleLine(raw.numero || raw.number || raw.nfce_number);
  const serie = normalizeSingleLine(raw.serie || raw.series || raw.nfce_serie || '1');
  const xmlContent = normalizeSingleLine(raw.xml_content || raw.xmlContent || raw.xml_enviado || raw.xmlEnviado || raw.xml_autorizado || raw.xmlAutorizado);
  const protocolo = normalizeSingleLine(raw.protocolo || raw.protocolo_autorizacao || raw.protocol);
  const chave = normalizeSingleLine(raw.chave_acesso || raw.access_key || raw.chave || extractNfceAccessKeyFromXml(xmlContent));
  const ambiente = normalizeSingleLine(raw.ambiente || raw.environment);
  const modelCode = normalizeSingleLine(raw.model_code || raw.modelCode || xmlContent.match(/<mod>(55|65)<\/mod>/i)?.[1] || '65');
  const cupomId = normalizeSingleLine(raw.cupom_id || raw.cupomId || raw.id);
  const qrCodeUrl = normalizeNfceQrCodeUrl(
    extractNfceQrCodeFromXml(xmlContent) || raw.qr_code_url || raw.qrCodeUrl || raw.qrcode_url || raw.qr_url,
    ambiente,
    chave
  );

  if (!numero && !protocolo && !chave && !qrCodeUrl) return null;
  return { numero, serie, protocolo, chave, qrCodeUrl: modelCode === '55' ? '' : qrCodeUrl, ambiente, modelCode, cupomId };
}

async function openAuthorizedNfeDanfe(fiscal: ReturnType<typeof normalizeNfcePrintData>) {
  if (!fiscal?.cupomId) throw new Error('Identificador da NF-e autorizada não encontrado.');
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Login não confirmado para abrir o DANFE.');

  const isElectron = Boolean((window as any)?.electronAPI?.isElectron);
  const previewWindow = !isElectron ? window.open('', '_blank') : null;
  if (!isElectron && !previewWindow) throw new Error('Pop-up bloqueado. Permita pop-ups para visualizar o DANFE.');
  if (previewWindow) {
    previewWindow.document.write('<!doctype html><title>Gerando DANFE...</title><p style="font:16px sans-serif;padding:24px">Gerando DANFE a partir do XML autorizado...</p>');
  }

  try {
    const danfeEndpoint = new URL('/api/nfce/danfe', getPublicWebBaseUrl()).toString();
    const response = await fetch(danfeEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cupom_id: fiscal.cupomId }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'Não foi possível gerar o DANFE da NF-e autorizada.');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (isElectron) {
      const result = await (window as any).electronAPI?.previewPdfBuffer?.(
        bytes,
        `DANFE-NFe-${fiscal.numero || 'documento'}`,
      );
      if (!result?.success) throw new Error(result?.error || 'Não foi possível abrir o DANFE no leitor de PDF.');
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (previewWindow) previewWindow.location.replace(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (error) {
    try { previewWindow?.close(); } catch {}
    throw error;
  }
}

function buildNfceHtmlBlock(order: any) {
  const nfce = normalizeNfcePrintData(order);
  if (!nfce) return '';
  const qrPayloadUrl = nfce.qrCodeUrl ? getNfceQrCodePayloadUrl(nfce.qrCodeUrl) : '';
  const qrImageUrl = nfce.qrCodeUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(qrPayloadUrl)}`
    : '';
  const qrAccessKey = nfce.qrCodeUrl ? extractNfceQrAccessKey(nfce.qrCodeUrl) : '';
  const printedAccessKey = nfce.chave || qrAccessKey;
  const consultaBaseUrl = getNfceConsultaBaseUrl(nfce.qrCodeUrl);

  return `
          <div class="divider"></div>
          <div class="center bold" style="font-size: 1.05em;">${nfce.modelCode === '55' ? 'DANFE NF-e - MODELO 55' : 'CUPOM FISCAL NFC-e'}</div>
          ${nfce.numero ? `<div class="center">${nfce.modelCode === '55' ? 'NF-e' : 'NFC-e'} ${escapeHtml(nfce.numero)}${nfce.serie ? ` / Série ${escapeHtml(nfce.serie)}` : ''}</div>` : ''}
          ${nfce.protocolo ? `<div class="center">Protocolo: ${escapeHtml(nfce.protocolo)}</div>` : ''}
          ${nfce.ambiente && nfce.ambiente !== 'producao' ? `<div class="center bold">AMBIENTE: ${escapeHtml(nfce.ambiente.toUpperCase())}</div>` : ''}
          ${printedAccessKey ? `<div class="nfce-long center" style="margin-top: 6px;"><span class="bold">CHAVE DE ACESSO</span><br />${escapeHtml(formatAccessKeyForPrint(printedAccessKey))}</div>` : ''}
          ${qrImageUrl ? `<div class="center" style="margin-top: 8px;"><img src="${escapeHtml(qrImageUrl)}" alt="QR Code NFC-e" style="width: 210px; height: 210px; image-rendering: pixelated;" /></div>` : ''}
          ${consultaBaseUrl ? `<div class="nfce-long nfce-url center" style="margin-top: 6px;"><span class="bold">Consulta pela chave:</span><br />${breakLongTextForHtml(consultaBaseUrl, 28)}</div>` : ''}
  `;
}

function escPosQrCodeCommands(value: string, size = 5) {
  const data = String(value || '').trim();
  if (!data) return '';

  const bytes = Array.from(new TextEncoder().encode(data));
  const storeLength = bytes.length + 3;
  const pL = storeLength % 256;
  const pH = Math.floor(storeLength / 256);
  const chr = (...values: number[]) => String.fromCharCode(...values);

  let commands = '';
  commands += chr(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
  commands += chr(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.max(3, Math.min(8, size)));
  commands += chr(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);
  commands += chr(0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30);
  commands += String.fromCharCode(...bytes);
  commands += chr(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
  return commands;
}

function appendNfceEscPosCommands(order: any, lineWidth: number) {
  const nfce = normalizeNfcePrintData(order);
  if (!nfce) return '';

  let commands = '';
  const text = (str: string) => str + '\n';
  const line = () => { commands += `${'-'.repeat(lineWidth)}\n`; };

  line();
  commands += ALIGN_CENTER + BOLD_ON;
  commands += text(nfce.modelCode === '55' ? 'DANFE NF-e - MODELO 55' : 'CUPOM FISCAL NFC-e');
  commands += BOLD_OFF;
  if (nfce.numero) commands += text(`${nfce.modelCode === '55' ? 'NF-e' : 'NFC-e'} ${nfce.numero}${nfce.serie ? ` / Serie ${nfce.serie}` : ''}`);
  if (nfce.protocolo) commands += text(`Protocolo: ${nfce.protocolo}`);
  if (nfce.ambiente && nfce.ambiente !== 'producao') commands += text(`AMBIENTE: ${nfce.ambiente.toUpperCase()}`);
  commands += ALIGN_LEFT;

  if (nfce.chave) {
    commands += ALIGN_CENTER + text('CHAVE DE ACESSO');
    commands += ALIGN_LEFT;
    wrapTextLine(formatAccessKeyForPrint(nfce.chave), lineWidth).forEach((value) => {
      commands += text(value);
    });
  }

  if (nfce.qrCodeUrl) {
    commands += ALIGN_CENTER;
    commands += escPosQrCodeCommands(getNfceQrCodePayloadUrl(nfce.qrCodeUrl), lineWidth <= 32 ? 4 : 5);
    commands += ALIGN_LEFT;
    commands += text('Consulta pela chave:');
    wrapTextLine(getNfceConsultaBaseUrl(nfce.qrCodeUrl), lineWidth).forEach((value) => {
      commands += text(value);
    });
  }

  return commands;
}

function getKitchenCustomerLabel(order: any) {
  const customerName = normalizeSingleLine(order?.customer_name);
  if (customerName) return customerName;
  if (String(order?.order_type || '').trim().toLowerCase() === 'dine_in') return 'Mesa';
  return 'Balcão';
}

function shouldPrintTicketCode(order: any) {
  const orderType = String(order?.order_type || '').trim().toLowerCase();
  return orderType === 'dine_in' || orderType === 'counter' || (!orderType && !order?.delivery_zone_id);
}

function normalizePrintConfig(settings: any): NormalizedPrintConfig {
  const paperWidth = String(settings?.paper_width || '80mm').trim() === '58mm' ? '58mm' : '80mm';
  const fontSizeRaw = String(settings?.font_size || 'normal').trim();
  const fontSize: NormalizedPrintConfig['font_size'] =
    fontSizeRaw === 'small' || fontSizeRaw === 'large' ? fontSizeRaw : 'normal';

  return {
    paper_width: paperWidth,
    font_size: fontSize,
    print_header: String(settings?.print_header || BRAND_POS_NAME).trim() || BRAND_POS_NAME,
    print_footer: String(settings?.print_footer || 'Obrigado!').trim() || 'Obrigado!',
    copies: Math.max(1, Number(settings?.copies || 1) || 1),
    receipt_logo_url: String(settings?.receipt_logo_url || '').trim(),
    print_kitchen_ticket: Boolean(settings?.print_kitchen_ticket),
  };
}

async function fetchVariationOrderMaps(productIds: string[]) {
  const ids = Array.from(new Set((productIds || []).map((x) => String(x || '').trim()).filter(Boolean)));
  const result = new Map<string, Map<string, number>>();
  if (ids.length === 0) return result;

  const [{ data: linkRows }, { data: productVarRows }] = await Promise.all([
    supabase
      .from('product_global_variation_links')
      .select('product_id,global_variation_id,display_order')
      .in('product_id', ids as any)
      .order('product_id', { ascending: true })
      .order('display_order', { ascending: true }) as any,
    supabase
      .from('product_variations')
      .select('product_id,name,receipt_label,display_order,created_at')
      .in('product_id', ids as any) as any
  ]);

  const links = Array.isArray(linkRows) ? linkRows : [];
  const globalIds = Array.from(new Set(links.map((l: any) => String(l.global_variation_id || '').trim()).filter(Boolean)));
  let globals: any[] = [];
  if (globalIds.length > 0) {
    const { data } = await supabase.from('global_variations').select('id,name,receipt_label').in('id', globalIds as any) as any;
    globals = Array.isArray(data) ? data : [];
  }
  const globalById = new Map(globals.map((g: any) => [String(g.id), g]));

  for (const pid of ids) result.set(pid, new Map<string, number>());

  for (const link of links) {
    const pid = String(link.product_id || '').trim();
    const gv = globalById.get(String(link.global_variation_id || ''));
    if (!pid || !gv) continue;
    const order = link.display_order !== undefined && link.display_order !== null ? Math.max(0, Math.floor(Number(link.display_order) || 0)) : 10000;
    const map = result.get(pid);
    if (!map) continue;
    const keys = [gv.receipt_label, gv.name].map((v: any) => String(v || '').trim().toLowerCase()).filter(Boolean);
    for (const k of keys) {
      if (!map.has(k) || (map.get(k) as number) > order) map.set(k, order);
    }
  }

  const prodVars = Array.isArray(productVarRows) ? productVarRows : [];
  const byProduct = new Map<string, any[]>();
  for (const row of prodVars) {
    const pid = String(row.product_id || '').trim();
    if (!pid) continue;
    const list = byProduct.get(pid) || [];
    list.push(row);
    byProduct.set(pid, list);
  }
  for (const [pid, list] of byProduct.entries()) {
    const map = result.get(pid);
    if (!map) continue;
    const sorted = [...list].sort((a, b) => {
      const ao = a.display_order !== undefined && a.display_order !== null ? Number(a.display_order) : 10_000;
      const bo = b.display_order !== undefined && b.display_order !== null ? Number(b.display_order) : 10_000;
      if (ao !== bo) return ao - bo;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      const order = row.display_order !== undefined && row.display_order !== null ? Math.max(0, Math.floor(Number(row.display_order) || 0)) : 20000 + i;
      const keys = [row.receipt_label, row.name].map((v: any) => String(v || '').trim().toLowerCase()).filter(Boolean);
      for (const k of keys) {
        if (!map.has(k) || (map.get(k) as number) > order) map.set(k, order);
      }
    }
  }

  return result;
}

async function fetchProductDescriptions(productIds: string[]) {
  const ids = Array.from(new Set((productIds || []).map((x) => String(x || '').trim()).filter(Boolean)));
  const result = new Map<string, string>();
  if (ids.length === 0) return result;

  const { data } = await supabase
    .from('products')
    .select('id,receipt_ingredients_enabled,receipt_ingredients')
    .in('id', ids as any) as any;

  (Array.isArray(data) ? data : []).forEach((row: any) => {
    if (!row?.receipt_ingredients_enabled) return;
    const ingredients = String(row?.receipt_ingredients || '').trim();
    if (ingredients) result.set(String(row.id), ingredients);
  });

  return result;
}

function sortReceiptVariations(variations: any[], orderMap?: Map<string, number>) {
  const arr = Array.isArray(variations) ? variations.map((v) => String(v || '').trim()).filter(Boolean) : [];
  if (!orderMap || orderMap.size === 0) return arr;
  return arr
    .map((line, idx) => {
      const parsed = splitLabelValue(line);
      const key = String(parsed?.label || '').trim().toLowerCase();
      const order = orderMap.get(key);
      return { line, idx, order: order !== undefined ? order : 99999 };
    })
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.idx - b.idx))
    .map((x) => x.line);
}

function extractOptionNames(raw: any): string[] {
  const out: string[] = [];
  if (!raw) return out;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item) continue;
      if (typeof item === 'string') {
        const v = item.trim();
        if (v) out.push(v);
        continue;
      }
      const name = String((item as any).name || (item as any).label || '').trim();
      if (name) out.push(name);
    }
  } else if (typeof raw === 'string') {
    const v = raw.trim();
    if (v) out.push(v);
  }
  return out;
}

function parseGroupOptions(raw: any): string[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((o: any) => String(o?.name || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

type VariationGroupMeta = {
  order: number;
  receiptLabel: string;
  optionKeySet: Set<string>;
};

async function fetchVariationGroups(productIds: string[]) {
  const ids = Array.from(new Set((productIds || []).map((x) => String(x || '').trim()).filter(Boolean)));
  const result = new Map<string, VariationGroupMeta[]>();
  if (ids.length === 0) return result;

  const [{ data: linkRows }, { data: productVarRows }] = await Promise.all([
    supabase
      .from('product_global_variation_links')
      .select('product_id,global_variation_id,display_order')
      .in('product_id', ids as any) as any,
    supabase
      .from('product_variations')
      .select('product_id,name,receipt_label,options,display_order,created_at')
      .in('product_id', ids as any) as any
  ]);

  const links = Array.isArray(linkRows) ? linkRows : [];
  const globalIds = Array.from(new Set(links.map((l: any) => String(l.global_variation_id || '').trim()).filter(Boolean)));
  let globals: any[] = [];
  if (globalIds.length > 0) {
    const { data } = await supabase.from('global_variations').select('id,name,receipt_label,options').in('id', globalIds as any) as any;
    globals = Array.isArray(data) ? data : [];
  }
  const globalById = new Map(globals.map((g: any) => [String(g.id), g]));

  for (const pid of ids) result.set(pid, []);

  for (const link of links) {
    const pid = String(link.product_id || '').trim();
    const gv = globalById.get(String(link.global_variation_id || ''));
    if (!pid || !gv) continue;
    const order = link.display_order !== undefined && link.display_order !== null ? Math.max(0, Math.floor(Number(link.display_order) || 0)) : 10000;
    const label = String(gv.receipt_label || gv.name || '').trim();
    const opts = parseGroupOptions(gv.options);
    const set = new Set(opts.map((o) => o.toLowerCase()));
    result.get(pid)?.push({ order, receiptLabel: label, optionKeySet: set });
  }

  const prodVars = Array.isArray(productVarRows) ? productVarRows : [];
  const byProduct = new Map<string, any[]>();
  for (const row of prodVars) {
    const pid = String(row.product_id || '').trim();
    if (!pid) continue;
    const list = byProduct.get(pid) || [];
    list.push(row);
    byProduct.set(pid, list);
  }
  for (const [pid, list] of byProduct.entries()) {
    const sorted = [...list].sort((a, b) => {
      const ao = a.display_order !== undefined && a.display_order !== null ? Number(a.display_order) : 10_000;
      const bo = b.display_order !== undefined && b.display_order !== null ? Number(b.display_order) : 10_000;
      if (ao !== bo) return ao - bo;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      const order = row.display_order !== undefined && row.display_order !== null ? Math.max(0, Math.floor(Number(row.display_order) || 0)) : 20000 + i;
      const label = String(row.receipt_label || row.name || '').trim();
      const opts = parseGroupOptions(row.options);
      const set = new Set(opts.map((o) => o.toLowerCase()));
      result.get(pid)?.push({ order, receiptLabel: label, optionKeySet: set });
    }
  }

  for (const [pid, groups] of result.entries()) {
    result.set(
      pid,
      [...groups].sort((a, b) => a.order - b.order || a.receiptLabel.localeCompare(b.receiptLabel, 'pt-BR'))
    );
  }

  return result;
}

function optionsToReceiptLines(optionNames: string[], groups?: VariationGroupMeta[]) {
  const names = (optionNames || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!groups || groups.length === 0) return names;

  const selectedByLabel = new Map<string, string[]>();
  const used = new Set<number>();

  for (let idx = 0; idx < names.length; idx++) {
    const name = names[idx];
    const key = name.toLowerCase();
    let matchedIndex = -1;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].optionKeySet.has(key)) {
        matchedIndex = i;
        break;
      }
    }
    if (matchedIndex === -1) continue;
    used.add(idx);
    const label = groups[matchedIndex].receiptLabel || 'Complementos';
    const list = selectedByLabel.get(label) || [];
    list.push(name);
    selectedByLabel.set(label, list);
  }

  const lines: string[] = [];
  for (const g of groups) {
    const label = g.receiptLabel || 'Complementos';
    const selected = selectedByLabel.get(label);
    if (!selected || selected.length === 0) continue;
    lines.push(`${label}: ${selected.join(', ')}`);
  }

  const leftovers = names.filter((_, idx) => !used.has(idx));
  lines.push(...leftovers);

  return lines;
}

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function formatCurrencyValue(value: number) {
  return `R$ ${Number(value || 0).toFixed(2)}`;
}

function padRight(value: string, width: number) {
  const text = String(value || '');
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

function wrapTextLine(value: string, width: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return [''];
  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > width) {
    let cut = remaining.lastIndexOf(' ', width);
    if (cut <= 0) cut = width;
    lines.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) lines.push(remaining);
  return lines;
}

function formatColumns(left: string, right: string, width: number) {
  const safeRight = String(right || '').trim();
  const safeLeft = String(left || '').trim();
  const maxLeft = Math.max(8, width - safeRight.length - 1);
  const leftLines = wrapTextLine(safeLeft, maxLeft);
  const lines = leftLines.map((line, index) => {
    if (index !== leftLines.length - 1) return line;
    const spacing = Math.max(1, width - line.length - safeRight.length);
    return `${line}${' '.repeat(spacing)}${safeRight}`;
  });
  return lines;
}

function getThermalLineWidth(config: Pick<NormalizedPrintConfig, 'paper_width'>) {
  return config.paper_width === '58mm' ? 32 : 48;
}

function getCashReportLineWidth(config: Pick<NormalizedPrintConfig, 'paper_width'>) {
  return config.paper_width === '58mm' ? 30 : 46;
}

function centerReceiptLine(value: string, width: number) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length >= width) return text.slice(0, width);
  const leftPadding = Math.max(0, Math.floor((width - text.length) / 2));
  return `${' '.repeat(leftPadding)}${text}`;
}

function normalizeReportLines(lines: string[], width: number) {
  const out: string[] = [];

  for (const raw of lines || []) {
    const line = String(raw ?? '').replace(/\t/g, '  ').replace(/\r/g, '');
    const trimmed = line.trim();

    if (!trimmed) {
      out.push('');
      continue;
    }

    if (/^[=\-]+$/.test(trimmed)) {
      out.push(trimmed[0].repeat(width));
      continue;
    }

    if (/^_+$/.test(trimmed)) {
      out.push('_'.repeat(Math.min(width, 32)));
      continue;
    }

    const looksCentered = line.startsWith(' ') && !trimmed.includes(':');
    if (looksCentered) {
      out.push(centerReceiptLine(trimmed, width));
      continue;
    }

    if (line.length <= width) {
      out.push(line);
      continue;
    }

    const columnMatch = trimmed.match(/^(.{2,}?:)\s+(.+)$/);
    if (columnMatch) {
      formatColumns(columnMatch[1], columnMatch[2], width).forEach((value) => out.push(value));
      continue;
    }

    wrapTextLine(trimmed, width).forEach((value) => out.push(value));
  }

  return out;
}

function buildRawCashReportText(lines: string[]) {
  const normalized = (lines || []).map((line) => String(line ?? '').replace(/\r/g, '').trimEnd());
  return `${normalized.join('\n')}\n`;
}

function resolveElectronTarget(): ElectronTarget | null {
  try {
    const mode = (localStorage.getItem('hw.receipt.mode') || '').trim();
    const systemPrinterName = (localStorage.getItem('hw.report.printer') || '').trim();
    const serialDeviceId = (localStorage.getItem('hw.receipt.port') || '').trim();
    const serialProtocol = (localStorage.getItem('hw.receipt.protocol') || 'epson').trim() || 'epson';

    if (mode === 'serial') {
      if (serialDeviceId) return { type: 'device', deviceId: serialDeviceId, protocol: serialProtocol };
      if (systemPrinterName) return { type: 'system', printerName: systemPrinterName };
    }

    if (mode === 'system') {
      if (systemPrinterName) return { type: 'system', printerName: systemPrinterName };
      if (serialDeviceId) return { type: 'device', deviceId: serialDeviceId, protocol: serialProtocol };
    }

    if (systemPrinterName) return { type: 'system', printerName: systemPrinterName };
    if (serialDeviceId) return { type: 'device', deviceId: serialDeviceId, protocol: serialProtocol };

    const legacy = safeJsonParse<{
      mode?: 'system' | 'network';
      systemName?: string;
      ip?: string;
      port?: number;
      protocol?: string;
    }>(localStorage.getItem('pdv_printer'));

    if (legacy?.mode === 'system') {
      const printerName = String(legacy.systemName || '').trim();
      if (printerName) return { type: 'system', printerName };
    }

    if (legacy?.mode === 'network') {
      const ip = String(legacy.ip || '').trim();
      const port = Number(legacy.port || 9100) || 9100;
      const protocol = String(legacy.protocol || 'epson').trim() || 'epson';
      if (ip) return { type: 'device', deviceId: `tcp://${ip}:${port}`, protocol };
    }

    return null;
  } catch {
    return null;
  }
}

function buildOrderHtml(order: any, config: any, store?: any) {
  const width = config.paper_width === '58mm' ? '58mm' : '80mm';
  const bodyWidth = config.paper_width === '58mm' ? '54mm' : '76mm';
  const fontSize = config.font_size === 'small' ? '12px' : config.font_size === 'large' ? '16px' : '14px';
  const storeName = escapeHtml(store?.restaurant_name || store?.name || config.print_header || 'RESTAURANTE');
  const storeDesc = escapeHtml(store?.description || '');
  const storeLogo = resolveReceiptLogoUrl(store, config);
  const storeLogoHtml = storeLogo ? `<img src="${escapeHtml(storeLogo)}" alt="Logo" style="max-width: 160px; max-height: 68px; object-fit: contain; margin: 0 auto 8px auto; display:block;" />` : '';
  const storeAddress = escapeHtml(store?.address || '');
  const storePhone = escapeHtml(store?.phone || '');
  const storeCnpj = escapeHtml(store?.cnpj || '');
  const customerAddressLine = escapeHtml(resolveCustomerAddressLine(order));

  return `
      <!DOCTYPE html>
      <html data-print-format="receipt" data-paper-width="${width}">
      <head>
        <meta charset="utf-8" />
        <title>Imprimir Pedido #${order.order_number}</title>
        <style>
          @page { margin: 0; size: ${width} auto; }
          * { box-sizing: border-box; }
          html, body {
            width: ${width};
            max-width: ${width};
            min-height: 0;
            height: auto;
            overflow: visible;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: ${bodyWidth};
            max-width: ${bodyWidth};
            margin: 0 auto;
            padding: 2mm 1mm 3mm 1mm;
            font-size: ${fontSize};
            color: #000;
            font-weight: 700;
            line-height: 1.28;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            text-rendering: geometricPrecision;
            font-smooth: never;
            -webkit-font-smoothing: none;
          }
          .container {
            width: 100%;
            max-width: none;
            margin: 0;
            overflow: hidden;
          }
          .center { text-align: center; }
          .bold { font-weight: 800; }
          .divider { border-top: 2px dashed #000; margin: 9px 0; }
          .flex { display: flex; justify-content: space-between; gap: 8px; }
          .item-row {
            margin-bottom: 8px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .brand-block { padding-bottom: 2px; }
          .ticket-code { font-size: 1.52em; letter-spacing: 0.08em; }
          .section-title { font-weight: 700; letter-spacing: 0.06em; }
          .item-title {
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
            font-weight: 800;
          }
          .item-meta,
          .total-line {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
          }
          .item-meta-left,
          .total-label {
            min-width: 0;
            flex: 1;
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          .item-meta-right,
          .total-value {
            flex: 0 0 auto;
            white-space: nowrap;
            text-align: right;
          }
          .notes {
            font-size: 0.9em;
            font-style: italic;
            margin-left: 10px;
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          .nfce-long {
            width: 100%;
            max-width: 100%;
            white-space: normal;
            word-break: break-all;
            overflow-wrap: anywhere;
            line-height: 1.18;
          }
          .nfce-url {
            font-size: 0.82em;
            line-height: 1.12;
          }
          .total-row {
            font-size: 1.2em;
            margin-top: 10px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .muted { color: #000; font-size: 0.95em; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="center brand-block">
            ${storeLogoHtml}
          </div>
          <div class="center bold" style="font-size: 1.2em; letter-spacing: 0.04em;">${storeName}</div>
          ${storeDesc ? `<div class="center muted" style="margin-top: 2px;">${storeDesc}</div>` : ''}
          ${storeAddress ? `<div class="center muted" style="margin-top: 2px;">${storeAddress}</div>` : ''}
          ${storePhone ? `<div class="center muted">Tel: ${storePhone}</div>` : ''}
          ${storeCnpj ? `<div class="center muted">CNPJ: ${storeCnpj}</div>` : ''}
          <div class="center">${new Date(order.created_at).toLocaleString('pt-BR')}</div>
          <div class="divider"></div>
          
          ${shouldPrintTicketCode(order) ? `<div class="center bold ticket-code">SENHA: ${order.order_number?.slice(-4) || '----'}</div>` : ''}
          <div class="center">Pedido #${order.order_number}</div>
          
          <div class="divider"></div>
          
          <div class="section-title">CLIENTE:</div>
          <div>${order.customer_name || 'Balcão'}</div>
          ${order.customer_phone ? `<div>Tel: ${order.customer_phone}</div>` : ''}
          ${customerAddressLine ? `<div>End: ${customerAddressLine}</div>` : ''}
          ${order.delivery_zone_id ? `<div>Entrega: ${order.order_type === 'delivery' ? 'Delivery' : 'Retirada'}</div>` : ''}
          
          <div class="divider"></div>
          
          <div class="section-title" style="margin-bottom: 5px;">ITENS:</div>
          ${(order.items || []).map((item: any) => `
            <div class="item-row">
              <div class="item-title bold">${item.quantity}x ${escapeHtml(item.product_name || item.name || 'Produto')}</div>
              <div class="item-meta">
                <span class="item-meta-left">${formatCurrencyValue(Number(item.price || item.unit_price || 0))} x ${Number(item.quantity || 1)}</span>
                <span class="item-meta-right">${formatCurrencyValue(Number(item.total || item.subtotal || item.price * item.quantity || 0))}</span>
              </div>
              ${(() => {
                const detailGroups = getOrderItemDetailGroups(item);
                const ingredientLines = Array.isArray(item.receiptDescriptionLines) ? item.receiptDescriptionLines : [];
                const ingredients = ingredientLines.length > 0
                  ? `
                    <div class="notes"><span class="bold">Ingredientes:</span></div>
                    ${ingredientLines.map((line: string) => `<div class="notes">&nbsp;&nbsp;&bull; ${escapeHtml(line)}</div>`).join('')}
                  `
                  : '';
                return `${ingredients}${detailGroups.map((group) => `
                  ${group.label ? `<div class="notes"><span class="bold">${escapeHtml(group.label)}:</span></div>` : ''}
                  ${group.items.map((detail) => `
                    <div class="notes">
                      ${group.label ? '&nbsp;&nbsp;&bull; ' : ''}${escapeHtml(detail.text)}
                      ${detail.price && detail.price > 0
                        ? Number(item.quantity || 1) > 1
                          ? ` (${escapeHtml(formatCurrencyValue(detail.price))} cada; total ${escapeHtml(formatCurrencyValue(detail.price * Number(item.quantity || 1)))})`
                          : ` (${escapeHtml(formatCurrencyValue(detail.price))})`
                        : ''}
                    </div>
                  `).join('')}
                `).join('')}`;
              })()}
              ${item.notes ? `<div class="notes"><span class="bold">Obs:</span> ${escapeHtml(item.notes)}</div>` : ''}
            </div>
          `).join('')}
          
          <div class="divider"></div>
          
          <div class="total-line">
            <span class="total-label">Subtotal:</span>
            <span class="total-value">${formatCurrencyValue(order.total - (order.delivery_fee || 0))}</span>
          </div>
          ${order.delivery_fee ? `
          <div class="total-line">
            <span class="total-label">Taxa Entrega:</span>
            <span class="total-value">${formatCurrencyValue(order.delivery_fee)}</span>
          </div>` : ''}
          ${order.discount ? `
          <div class="total-line">
            <span class="total-label">Desconto:</span>
            <span class="total-value">- ${formatCurrencyValue(order.discount)}</span>
          </div>` : ''}
          
          <div class="divider"></div>
          
          <div class="total-line total-row bold">
            <span class="total-label">TOTAL:</span>
            <span class="total-value">${formatCurrencyValue(order.total)}</span>
          </div>
          
          ${(() => {
            const splitLines = getPaymentSplitLines(order);
            if (splitLines.length === 0) {
              return `<div style="margin-top: 5px;">Pagamento: ${formatPaymentMethodLabel(order.payment_method, order)}</div>`;
            }
            if (splitLines.length === 1) {
              return `<div style="margin-top: 5px;">Pagamento: ${splitLines[0].label}</div>`;
            }
            return `
              <div style="margin-top: 5px;">Pagamento: MISTO</div>
              ${splitLines.map((line) => `<div>${line.label}: ${formatCurrencyValue(line.amount)}</div>`).join('')}
            `;
          })()}
          ${order.change_amount ? `<div>Troco: ${formatCurrencyValue(Number(order.change_amount || 0))}</div>` : ''}

          ${buildNfceHtmlBlock(order)}
          
          <div class="divider"></div>
          <div class="center" style="margin-top: 10px;">${config.print_footer}</div>
          <div class="center" style="font-size: 0.8em; margin-top: 5px;">Sistema ${BRAND_NAME}</div>
        </div>
      </body>
      </html>
    `;
}

function buildNfeDanfeA4Html(order: any, store?: any) {
  const fiscal = normalizeNfcePrintData(order);
  const recipient = order?.variations?.fiscal_recipient || {};
  const items = Array.isArray(order?.items) ? order.items : [];
  const accessKey = formatAccessKeyForPrint(fiscal?.chave || '');
  const issueDate = order?.created_at ? new Date(order.created_at).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
  const subtotal = Math.max(0, Number(order?.total || 0) - Number(order?.delivery_fee || 0) + Number(order?.discount || 0));

  return `<!DOCTYPE html>
    <html data-print-format="a4">
      <head>
        <meta charset="utf-8" />
        <title>DANFE NF-e ${escapeHtml(fiscal?.numero || '')}</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          * { box-sizing: border-box; }
          html, body { width: 210mm; min-height: 297mm; margin: 0; padding: 0; }
          body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 9px; line-height: 1.22; }
          .danfe { width: 194mm; margin: 0 auto; }
          .box { border: 1px solid #000; }
          .header { display: grid; grid-template-columns: 42% 18% 40%; min-height: 29mm; }
          .header > div { padding: 3mm; border-right: 1px solid #000; }
          .header > div:last-child { border-right: 0; }
          .issuer { text-align: center; }
          .issuer strong { display: block; font-size: 14px; margin-bottom: 2mm; }
          .danfe-title { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }
          .danfe-title strong { font-size: 19px; letter-spacing: .8px; }
          .danfe-title span { font-size: 8px; }
          .number { margin-top: 2mm; font-size: 11px; font-weight: 700; }
          .key { font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700; letter-spacing: .35px; word-spacing: 1px; }
          .label { display:block; font-size: 7px; font-weight: 700; text-transform: uppercase; margin-bottom: 1mm; }
          .row { display:grid; border: 1px solid #000; border-top: 0; }
          .row > div { min-height: 12mm; padding: 2mm; border-right: 1px solid #000; }
          .row > div:last-child { border-right:0; }
          .nature { grid-template-columns: 48% 26% 26%; }
          .recipient { grid-template-columns: 52% 24% 24%; }
          .address { grid-template-columns: 52% 18% 18% 12%; }
          .totals { grid-template-columns: repeat(5, 1fr); }
          .section { margin-top: 3mm; font-size: 8px; font-weight: 700; }
          table { width:100%; border-collapse:collapse; table-layout:fixed; }
          th, td { border:1px solid #000; padding:1.4mm 1mm; vertical-align:top; }
          th { font-size:7px; text-transform:uppercase; background:#eee; }
          td { font-size:8px; }
          .right { text-align:right; }
          .center { text-align:center; }
          .additional { min-height: 24mm; padding:2mm; border:1px solid #000; }
          .footer { margin-top:2mm; text-align:center; font-size:7px; }
        </style>
      </head>
      <body>
        <main class="danfe">
          <section class="box header">
            <div class="issuer">
              <strong>${escapeHtml(store?.restaurant_name || store?.name || 'EMITENTE')}</strong>
              <div>${escapeHtml(store?.address || '')}</div>
              ${store?.phone ? `<div>Telefone: ${escapeHtml(store.phone)}</div>` : ''}
              <div>CNPJ: ${escapeHtml(store?.cnpj || '')}</div>
            </div>
            <div class="danfe-title">
              <strong>DANFE</strong>
              <span>Documento Auxiliar da Nota Fiscal Eletrônica</span>
              <div class="number">NF-e nº ${escapeHtml(fiscal?.numero || '')}<br/>Série ${escapeHtml(fiscal?.serie || '1')}</div>
            </div>
            <div>
              <span class="label">Chave de acesso</span>
              <div class="key">${escapeHtml(accessKey)}</div>
              <div style="margin-top:3mm">Consulta de autenticidade no portal nacional da NF-e ou no site da SEFAZ autorizadora.</div>
              ${fiscal?.protocolo ? `<div style="margin-top:2mm"><span class="label">Protocolo de autorização</span>${escapeHtml(fiscal.protocolo)}</div>` : ''}
              ${fiscal?.ambiente && fiscal.ambiente !== 'producao' ? '<div style="margin-top:2mm;font-weight:700">SEM VALOR FISCAL — AMBIENTE DE HOMOLOGAÇÃO</div>' : ''}
            </div>
          </section>
          <section class="row nature">
            <div><span class="label">Natureza da operação</span>Venda de mercadoria</div>
            <div><span class="label">Número da venda</span>${escapeHtml(order?.order_number || '')}</div>
            <div><span class="label">Data e hora da emissão</span>${escapeHtml(issueDate)}</div>
          </section>
          <div class="section">DESTINATÁRIO / REMETENTE</div>
          <section class="row recipient">
            <div><span class="label">Nome / Razão social</span>${escapeHtml(recipient.name || order?.customer_name || '')}</div>
            <div><span class="label">CPF / CNPJ</span>${escapeHtml(recipient.cpf_cnpj || order?.customer_document || '')}</div>
            <div><span class="label">Inscrição estadual</span>${escapeHtml(recipient.state_registration || '')}</div>
          </section>
          <section class="row address">
            <div><span class="label">Endereço</span>${escapeHtml([recipient.address, recipient.address_number, recipient.address_complement].filter(Boolean).join(', ') || order?.customer_address || '')}</div>
            <div><span class="label">Bairro</span>${escapeHtml(recipient.neighborhood || '')}</div>
            <div><span class="label">Município</span>${escapeHtml(recipient.city || '')}</div>
            <div><span class="label">UF / CEP</span>${escapeHtml([recipient.state, recipient.postal_code].filter(Boolean).join(' / '))}</div>
          </section>
          <div class="section">DADOS DOS PRODUTOS / SERVIÇOS</div>
          <table>
            <thead><tr><th style="width:8%">Código</th><th style="width:34%">Descrição</th><th style="width:10%">NCM/SH</th><th style="width:8%">CST/CSOSN</th><th style="width:8%">CFOP</th><th style="width:6%">Un.</th><th style="width:8%">Qtd.</th><th style="width:9%">V. unit.</th><th style="width:9%">V. total</th></tr></thead>
            <tbody>${items.map((item: any) => {
              const quantity = Number(item.quantity || 1);
              const unitPrice = Number(item.price || item.unit_price || 0);
              const total = Number(item.subtotal || item.total || unitPrice * quantity);
              const productCode = item.internal_code || item.codigo_produto || item.sku || String(item.product_id || '').slice(0, 8);
              return `<tr><td>${escapeHtml(productCode)}</td><td>${escapeHtml(item.product_name || item.name || 'Produto')}</td><td class="center">${escapeHtml(item.fiscal_ncm || '')}</td><td class="center">${escapeHtml(item.fiscal_csosn || '')}</td><td class="center">${escapeHtml(item.fiscal_cfop || '')}</td><td class="center">${escapeHtml(item.sale_unit || 'UN')}</td><td class="right">${quantity.toFixed(3)}</td><td class="right">${formatCurrencyValue(unitPrice)}</td><td class="right">${formatCurrencyValue(total)}</td></tr>`;
            }).join('')}</tbody>
          </table>
          <div class="section">CÁLCULO DO IMPOSTO</div>
          <section class="row totals">
            <div><span class="label">Valor dos produtos</span>${formatCurrencyValue(subtotal)}</div>
            <div><span class="label">Valor do frete</span>${formatCurrencyValue(Number(order?.delivery_fee || 0))}</div>
            <div><span class="label">Desconto</span>${formatCurrencyValue(Number(order?.discount || 0))}</div>
            <div><span class="label">Outras despesas</span>${formatCurrencyValue(0)}</div>
            <div><span class="label">Valor total da NF-e</span><strong>${formatCurrencyValue(Number(order?.total || 0))}</strong></div>
          </section>
          <div class="section">DADOS ADICIONAIS</div>
          <section class="additional"><span class="label">Informações complementares</span>Documento referente à venda ${escapeHtml(order?.order_number || '')}. ${escapeHtml(fiscal?.ambiente && fiscal.ambiente !== 'producao' ? 'NF-e emitida em ambiente de homologação, sem valor fiscal.' : '')}</section>
          <div class="footer">Sistema ${BRAND_NAME}</div>
        </main>
      </body>
    </html>`;
}

function buildKitchenTicketHtml(order: any, config: any) {
  const width = config.paper_width === '58mm' ? '58mm' : '80mm';
  const bodyWidth = config.paper_width === '58mm' ? '54mm' : '76mm';
  const fontSize = config.font_size === 'small' ? '12px' : config.font_size === 'large' ? '16px' : '14px';
  const customerName = escapeHtml(getKitchenCustomerLabel(order));
  const orderTypeLabel = escapeHtml(getOrderTypeLabel(order));
  const orderNumber = escapeHtml(order?.order_number || '----');
  const ticketCode = escapeHtml(order?.order_number?.slice(-4) || '----');

  return `
      <!DOCTYPE html>
      <html data-print-format="receipt" data-paper-width="${width}">
      <head>
        <meta charset="utf-8" />
        <title>Comanda Cozinha #${order.order_number || ''}</title>
        <style>
          @page { margin: 0; size: ${width} auto; }
          * { box-sizing: border-box; }
          html, body {
            width: ${width};
            max-width: ${width};
            min-height: 0;
            height: auto;
            overflow: visible;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: ${bodyWidth};
            max-width: ${bodyWidth};
            margin: 0 auto;
            padding: 2mm 1mm 3mm 1mm;
            font-size: ${fontSize};
            color: #000;
            font-weight: 700;
            line-height: 1.28;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .container {
            width: 100%;
            max-width: none;
            margin: 0;
            overflow: hidden;
          }
          .center { text-align: center; }
          .bold { font-weight: 800; }
          .divider { border-top: 2px dashed #000; margin: 9px 0; }
          .title { font-size: 1.15em; letter-spacing: 0.06em; }
          .ticket-code { font-size: 1.52em; letter-spacing: 0.08em; }
          .section-title { font-weight: 700; letter-spacing: 0.06em; }
          .item-row {
            margin-bottom: 10px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .item-title {
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
            font-weight: 800;
          }
          .notes {
            font-size: 0.92em;
            margin-left: 10px;
            white-space: normal;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          .muted { color: #000; font-size: 0.95em; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="center bold title">COMANDA DA COZINHA</div>
          <div class="center muted">${new Date(order.created_at || Date.now()).toLocaleString('pt-BR')}</div>
          <div class="divider"></div>

          ${shouldPrintTicketCode(order) ? `<div class="center bold ticket-code">SENHA: ${ticketCode}</div>` : ''}
          <div class="center">Pedido #${orderNumber}</div>
          <div class="center">${orderTypeLabel}</div>

          <div class="divider"></div>

          <div class="section-title">CLIENTE:</div>
          <div class="bold">${customerName}</div>

          <div class="divider"></div>

          <div class="section-title" style="margin-bottom: 5px;">ITENS:</div>
          ${(order.items || []).map((item: any) => `
            <div class="item-row">
              <div class="item-title">${Number(item.quantity || 1)}x ${escapeHtml(item.product_name || item.name || 'Produto')}</div>
              ${(() => {
                const detailGroups = getOrderItemDetailGroups(item);
                const ingredientLines = Array.isArray(item.receiptDescriptionLines) ? item.receiptDescriptionLines : [];
                const ingredients = ingredientLines.length > 0
                  ? `
                    <div class="notes"><span class="bold">Ingredientes:</span></div>
                    ${ingredientLines.map((line: string) => `<div class="notes">&nbsp;&nbsp;&bull; ${escapeHtml(line)}</div>`).join('')}
                  `
                  : '';
                return `${ingredients}${detailGroups.map((group) => `
                  ${group.label ? `<div class="notes"><span class="bold">${escapeHtml(group.label)}:</span></div>` : ''}
                  ${group.items.map((detail) => `
                    <div class="notes">${group.label ? '&nbsp;&nbsp;&bull; ' : ''}${escapeHtml(detail.text)}</div>
                  `).join('')}
                `).join('')}`;
              })()}
              ${item.notes ? `<div class="notes"><span class="bold">Obs:</span> ${escapeHtml(item.notes)}</div>` : ''}
            </div>
          `).join('')}

          <div class="divider"></div>
        </div>
      </body>
      </html>
    `;
}

function extractBodyInnerHtml(documentHtml: string) {
  const match = String(documentHtml || '').match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : documentHtml;
}

function buildCombinedTicketHtml(order: any, config: any, store?: any) {
  const primaryHtml = buildOrderHtml(order, config, store);
  const kitchenHtml = buildKitchenTicketHtml(order, config);
  const combinedBody = `${extractBodyInnerHtml(primaryHtml)}<div class="ticket-break"></div>${extractBodyInnerHtml(kitchenHtml)}`;

  return primaryHtml
    .replace(
      '</style>',
      `
          .ticket-break {
            page-break-before: always;
            break-before: page;
          }
        </style>`
    )
    .replace(/<body[^>]*>[\s\S]*<\/body>/i, `<body>${combinedBody}</body>`);
}

function buildKitchenEscPosCommands(order: any, lineWidth: number) {
  let commands = '';
  const text = (str: string) => str + '\n';
  const center = () => { commands += ALIGN_CENTER; };
  const left = () => { commands += ALIGN_LEFT; };
  const bold = (enabled: boolean) => { commands += enabled ? BOLD_ON : BOLD_OFF; };
  const line = () => { commands += `${'-'.repeat(lineWidth)}\n`; };

  commands += INIT;
  commands += BOLD_ON + DOUBLE_STRIKE_ON;
  center();
  bold(true);
  commands += text('COMANDA DA COZINHA');
  bold(true);
  commands += text(new Date(order.created_at || Date.now()).toLocaleString('pt-BR'));
  line();

  bold(true);
  if (shouldPrintTicketCode(order)) commands += text(`SENHA: ${order.order_number?.slice(-4) || '----'}`);
  bold(true);
  commands += text(`Pedido #${order.order_number || '----'}`);
  commands += text(`Tipo: ${getOrderTypeLabel(order)}`);
  line();

  left();
  bold(true);
  commands += text('CLIENTE:');
  bold(true);
  commands += text(getKitchenCustomerLabel(order));
  line();

  bold(true);
  commands += text('ITENS:');
  bold(true);

  for (const item of Array.isArray(order.items) ? order.items : []) {
    const quantity = Number(item.quantity || 1);
    const productName = item.product_name || item.name || 'Produto';
    wrapTextLine(`${quantity}x ${productName}`, lineWidth).forEach((value) => {
      commands += text(value);
    });

    const detailGroups = getOrderItemDetailGroups(item);
    for (const group of detailGroups) {
      if (group.label) {
        wrapTextLine(`   ${group.label}:`, lineWidth).forEach((lineValue) => {
          commands += text(lineValue);
        });
      }
      for (const detail of group.items) {
        wrapTextLine(`   ${group.label ? '- ' : ''}${detail.text}`, lineWidth).forEach((lineValue) => {
          commands += text(lineValue);
        });
      }
    }

    if (item.notes) {
      wrapTextLine(`   Obs: ${String(item.notes)}`, lineWidth).forEach((value) => {
        commands += text(value);
      });
    }

    commands += '\n';
  }

  line();
  commands += '\n\n\n\n';
  commands += DOUBLE_STRIKE_OFF + BOLD_OFF;
  commands += CUT_PARTIAL;

  return commands;
}

function buildReportHtml(
  title: string,
  lines: string[],
  store?: any,
  options?: { hideStoreHeader?: boolean; footerText?: string; paperWidth?: '58mm' | '80mm'; fontSize?: NormalizedPrintConfig['font_size'] }
) {
  const escapeHtml = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const paperWidth = options?.paperWidth === '80mm' ? '80mm' : '58mm';
  const bodyWidth = paperWidth === '58mm' ? '54mm' : '76mm';
  const fontSize = options?.fontSize === 'small' ? '10px' : options?.fontSize === 'large' ? '13px' : paperWidth === '58mm' ? '11px' : '12px';
  const storeLogoHtml = store?.logo_url ? `<img src="${escapeHtml(store.logo_url)}" alt="Logo" style="max-width: 160px; max-height: 60px; object-fit: contain; margin: 0 auto 6px auto; display:block;" />` : '';
  const storeHeader = store && !options?.hideStoreHeader ? `
    ${storeLogoHtml}
    <div class="center bold" style="font-size: 14px; margin-bottom: 4px;">${escapeHtml(store.restaurant_name || store.name || 'RESTAURANTE')}</div>
    ${store.address ? `<div class="center" style="font-size: 11px;">${escapeHtml(store.address)}</div>` : ''}
    ${store.phone ? `<div class="center" style="font-size: 11px;">Tel: ${escapeHtml(store.phone)}</div>` : ''}
    ${store.cnpj ? `<div class="center" style="font-size: 11px;">CNPJ: ${escapeHtml(store.cnpj)}</div>` : ''}
    <div class="divider"></div>
  ` : '';
  const safeTitle = String(title || '').trim();
  const titleBlock = safeTitle ? `<div class="center bold" style="font-size: 13px; margin: 6px 0;">${escapeHtml(safeTitle)}</div><div class="divider"></div>` : '';
  const hasFooterOverride = Boolean(options && Object.prototype.hasOwnProperty.call(options, 'footerText'));
  const footerText = hasFooterOverride ? String(options?.footerText ?? '').trim() : BRAND_POS_NAME;
  const footerBlock = footerText
    ? `<div class="divider"></div><div class="center" style="font-size: 0.8em; margin-top: 10px;">${escapeHtml(footerText)}</div>`
    : '';

  return `
      <!DOCTYPE html>
      <html data-print-format="receipt" data-paper-width="${paperWidth}">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          @page { margin: 0; size: ${paperWidth} auto; }
          * { box-sizing: border-box; }
          html, body { width: ${paperWidth}; max-width: ${paperWidth}; overflow: visible; }
          body {
            font-family: 'Courier New', Courier, monospace;
            margin: 0;
            padding: 2mm 1mm 3mm 1mm;
            width: ${bodyWidth};
            max-width: ${bodyWidth};
            font-size: ${fontSize};
            color: #000;
            font-weight: 700;
            line-height: 1.18;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .center { text-align: center; }
          .bold { font-weight: 800; }
          .divider { border-top: 2px dashed #000; margin: 8px 0; }
          .line { white-space: pre; overflow: visible; max-width: none; page-break-inside: avoid; break-inside: avoid; }
        </style>
      </head>
      <body>
        ${storeHeader}
        ${titleBlock}
        ${lines.map((l) => `<div class="line">${String(l).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`).join('')}
        ${footerBlock}
      </body>
      </html>
    `;
}

async function printReportElectron(html: string) {
  const api = (window as any)?.electronAPI;
  if (!api?.printSystem) return { success: false, error: 'API do Desktop indisponível' };
  const target = resolveElectronTarget();
  if (!target) return { success: false, error: 'Impressora não configurada em Configurações' };
  if (target.type !== 'system') return { success: false, error: 'Selecione uma impressora do sistema para imprimir relatórios' };
  const resp = await api.printSystem(target.printerName, html, true);
  if (!resp?.success) return { success: false, error: resp?.error || 'Falha ao imprimir' };
  return { success: true };
}

async function printRawReportElectron(text: string) {
  const api = (window as any)?.electronAPI;
  if (!api?.printRawSystem) return { success: false, error: 'API RAW do Desktop indisponível' };
  const target = resolveElectronTarget();
  if (!target) return { success: false, error: 'Impressora não configurada em Configurações' };
  if (target.type !== 'system') return { success: false, error: 'Selecione uma impressora do sistema para imprimir relatórios' };
  const resp = await api.printRawSystem(target.printerName, text);
  if (!resp?.success) return { success: false, error: resp?.error || resp?.message || 'Falha ao imprimir relatório' };
  return { success: true };
}

async function printElectron(order: any, config: any, options: PrintOrderOptions = {}) {
  const api = (window as any)?.electronAPI;
  if (!api?.printSystem || !api?.printReceipt) return { success: false, error: 'API do Desktop indisponível' };

  const target = resolveElectronTarget();
  if (!target) return { success: false, error: 'Impressora não configurada em Configurações' };

  const copies = Math.max(1, Number(config.copies || 1) || 1);

  if (target.type === 'system') {
    const html = buildOrderHtml(order, config, order.store);
    for (let i = 0; i < copies; i++) {
      let resp = api?.printSystemRaster
        ? await api.printSystemRaster(target.printerName, html)
        : await api.printSystem(target.printerName, html, true);
      if (!resp?.success && api?.printSystemRaster) {
        console.warn('Impressão térmica RAW indisponível; usando impressão do sistema:', resp?.error || resp);
        resp = await api.printSystem(target.printerName, html, true);
      }
      if (!resp?.success) return { success: false, error: resp?.error || 'Falha ao imprimir' };
    }

    if (config.print_kitchen_ticket) {
      const kitchenHtml = buildKitchenTicketHtml(order, config);
      let kitchenResp = api?.printSystemRaster
        ? await api.printSystemRaster(target.printerName, kitchenHtml)
        : await api.printSystem(target.printerName, kitchenHtml, true);
      if (!kitchenResp?.success && api?.printSystemRaster) {
        kitchenResp = await api.printSystem(target.printerName, kitchenHtml, true);
      }
      if (!kitchenResp?.success) return { success: false, error: kitchenResp?.error || 'Falha ao imprimir comanda da cozinha' };
    }

    return { success: true };
  }

  const deviceId = target.deviceId;
  const protocol = target.protocol || 'epson';

  const normalized = {
    store: order.store || null,
    order_number: order.order_number,
    customer_name: order.customer_name || 'Balcão',
    customer_phone: order.customer_phone || '',
    customer_address: order.customer_address || '',
    customer_address_display: resolveCustomerAddressLine(order),
    delivery_zone_name: order.delivery_zone_name || '',
    order_type: order.order_type || '',
    date: order.created_at,
    items: (Array.isArray(order.items) ? order.items : []).map((it: any) => ({
      product_name: it.product_name || it.name,
      name: it.product_name || it.name,
      quantity: Number(it.quantity || 1),
      price: Number(it.price || it.unit_price || 0),
      subtotal: Number(it.subtotal || it.total || (Number(it.price || 0) * Number(it.quantity || 1)) || 0),
      notes: it.notes || it.observations || '',
      variations: [
        ...(Array.isArray(it.receiptDescriptionLines) && it.receiptDescriptionLines.length > 0
          ? [`Ingredientes: ${it.receiptDescriptionLines.join(', ')}`]
          : []),
        ...(Array.isArray(it.variations) ? it.variations : []),
      ]
    })),
    total: Number(order.total || 0),
    subtotal: Number(order.total || 0) - Number(order.delivery_fee || 0),
    discount: Number(order.discount || 0),
    delivery_fee: Number(order.delivery_fee || 0),
    payment_method: formatPaymentMethodLabel(order.payment_method, order),
    nfce: normalizeNfcePrintData(order),
  };

  const conn = await api.connectPrinter(deviceId, protocol, { protocol, width: config.paper_width === '58mm' ? 32 : 48 });
  if (!conn?.success) return { success: false, error: conn?.error || conn?.message || 'Falha ao conectar impressora' };

  for (let i = 0; i < copies; i++) {
    const resp = await api.printReceipt(deviceId, normalized, 'receipt');
    if (!resp?.success) return { success: false, error: resp?.error || resp?.message || 'Falha ao imprimir' };
  }

  if (config.print_kitchen_ticket) {
    const kitchenResp = await api.printReceipt(deviceId, normalized, 'kitchen_ticket');
    if (!kitchenResp?.success) {
      return { success: false, error: kitchenResp?.error || kitchenResp?.message || 'Falha ao imprimir comanda da cozinha' };
    }
  }

  return { success: true };
}

async function openDrawerElectron() {
  const api = (window as any)?.electronAPI;
  if (!api?.openCashDrawer) return { success: false, error: 'API da gaveta indisponível' };

  const serialDeviceId = String(localStorage.getItem('hw.receipt.port') || '').trim();
  const serialProtocol = String(localStorage.getItem('hw.receipt.protocol') || 'epson').trim() || 'epson';
  const systemPrinterName = String(localStorage.getItem('hw.report.printer') || '').trim();

  if (!serialDeviceId && !systemPrinterName) {
    return { success: false, error: 'Configure a impressora térmica ou a impressora do sistema em Hardware para acionar a gaveta' };
  }

  if (!serialDeviceId && systemPrinterName) {
    const resp = await api.openCashDrawer(`system:${systemPrinterName}`);
    if (!resp?.success) return { success: false, error: resp?.error || resp?.message || 'Falha ao abrir gaveta na impressora do sistema' };
    return { success: true };
  }

  const conn = await api.connectPrinter(serialDeviceId, serialProtocol, { protocol: serialProtocol });
  if (!conn?.success) return { success: false, error: conn?.error || conn?.message || 'Falha ao conectar impressora da gaveta' };

  const resp = await api.openCashDrawer(serialDeviceId);
  if (!resp?.success) return { success: false, error: resp?.error || resp?.message || 'Falha ao abrir gaveta' };
  return { success: true };
}

function buildPopConnectReceiptPayload(order: any) {
  return {
    store: order.store || null,
    order_number: order.order_number,
    customer_name: order.customer_name || 'Balcão',
    customer_phone: order.customer_phone || '',
    customer_address: order.customer_address || '',
    customer_address_display: resolveCustomerAddressLine(order),
    delivery_zone_name: order.delivery_zone_name || '',
    order_type: order.order_type || '',
    date: order.created_at,
    items: (Array.isArray(order.items) ? order.items : []).map((it: any) => ({
      product_name: it.product_name || it.name,
      name: it.product_name || it.name,
      quantity: Number(it.quantity || 1),
      price: Number(it.price || it.unit_price || 0),
      subtotal: Number(it.subtotal || it.total || (Number(it.price || 0) * Number(it.quantity || 1)) || 0),
      notes: it.notes || it.observations || '',
      variations: [
        ...(Array.isArray(it.receiptDescriptionLines) && it.receiptDescriptionLines.length > 0
          ? [`Ingredientes: ${it.receiptDescriptionLines.join(', ')}`]
          : []),
        ...(Array.isArray(it.variations) ? it.variations : []),
      ],
    })),
    total: Number(order.total || 0),
    subtotal: Number(order.total || 0) - Number(order.delivery_fee || 0),
    discount: Number(order.discount || 0),
    delivery_fee: Number(order.delivery_fee || 0),
    payment_method: formatPaymentMethodLabel(order.payment_method, order),
    nfce: normalizeNfcePrintData(order),
  };
}

async function printPopConnect(order: any, config: NormalizedPrintConfig) {
  const printerConfig = loadPrinterConfig();
  const configuredUrl = String(printerConfig.bridge.websocketUrl || 'ws://localhost:8766').trim();
  const urls = configuredUrl ? [configuredUrl] : [];
  const discoveredUrl = await discoverBridgeWebsocketUrl({ timeoutMs: 650 });
  if (discoveredUrl && !urls.includes(discoveredUrl)) urls.push(discoveredUrl);
  if (urls.length === 0) return { available: false, printed: false, printerConnected: false };

  const payload = buildPopConnectReceiptPayload(order);
  const copies = Math.max(1, Number(config.copies || 1) || 1);

  for (const websocketUrl of urls) {
    let lastResult = { available: false, printed: false, printerConnected: false };
    for (let copy = 0; copy < copies; copy += 1) {
      const result = await bridgePrintReceipt({
        websocketUrl,
        transport: printerConfig.bridge.transport,
        address: printerConfig.bridge.address,
        payload,
      });
      lastResult = result;
      if (!result.printed) break;
    }
    if (lastResult.printed) return lastResult;
    if (lastResult.available) return lastResult;
  }

  return { available: false, printed: false, printerConnected: false };
}

export const PrinterService = {
  // NF-e modelo 55 nunca passa pela rotina de cupom térmico. Este método
  // existe de forma explícita para impedir fallback acidental para NFC-e.
  async openNfeDanfe(document: any) {
    const fiscal = normalizeNfcePrintData({
      nfce: { ...(document?.cupom || {}), ...document, model_code: '55' },
    });
    if (!fiscal?.cupomId) throw new Error('Identificador da NF-e autorizada não encontrado.');
    await openAuthorizedNfeDanfe({ ...fiscal, modelCode: '55', qrCodeUrl: '' });
  },

  // Conectar Impressora USB
  async connectUsb() {
    if (!('usb' in navigator)) {
      console.error('WebUSB não suportado neste navegador.');
      return false;
    }

    try {
      // Solicita dispositivo USB (filtro genérico para impressoras)
      // Class 0x07 = Printer Interface
      usbDevice = await (navigator as any).usb.requestDevice({
        filters: [{ classCode: 0x07 }] 
      });

      await usbDevice.open();
      await usbDevice.selectConfiguration(1);
      await usbDevice.claimInterface(0);
      
      console.log('Impressora conectada:', usbDevice.productName);
      return true;
    } catch (error) {
      console.error('Erro ao conectar impressora USB:', error);
      return false;
    }
  },

  // Método principal de impressão
  async printOrder(order: any, options: PrintOrderOptions = {}) {
    const api = typeof window !== 'undefined' ? (window as any)?.electronAPI : null;
    const isElectron = Boolean(api?.printSystem && api?.printReceipt);

    // 1. Buscar configurações
    const { data: settings } = await (supabase as any)
      .from('printer_settings')
      .select('*')
      .eq('user_id', order.user_id)
      .maybeSingle();

    if (options.onlyIfAuto) {
      if (isElectron) {
        if (settings?.auto_print === false) return;
      } else {
        if (settings?.auto_print !== true) return;
      }
    }

    // O DANFE NFC-e exige o layout térmico completo de 80 mm. Alguns clientes
    // antigos ficaram com paper_width=58mm nas configurações e, quando o bloco
    // fiscal era acrescentado, todo o cupom passava a ser renderizado em apenas
    // 32 colunas. Para documento fiscal usamos sempre 48 colunas; o cupom
    // operacional sem fiscal continua respeitando a preferência cadastrada.
    const baseConfig = normalizePrintConfig(settings);
    const config: NormalizedPrintConfig = normalizeNfcePrintData(order)
      ? { ...baseConfig, paper_width: '80mm' }
      : baseConfig;

    const { data: profile } = await supabase
      .from('profiles')
      .select('restaurant_name,description,logo_url,phone,address,website')
      .eq('id', order.user_id)
      .maybeSingle();

    // Dados fiscais pertencem exclusivamente ao DANFE. Recibos operacionais
    // comuns nunca dependem de fiscal_settings.
    const { data: fiscal } = normalizeNfcePrintData(order)
      ? await supabase
          .from('fiscal_settings')
          .select('cnpj,endereco_logradouro,endereco_numero,endereco_complemento,endereco_bairro,endereco_municipio,endereco_uf,endereco_cep')
          .eq('user_id', order.user_id)
          .maybeSingle()
      : { data: null as any };

    const { data: deliveryZone } = order?.delivery_zone_id
      ? await supabase
          .from('delivery_zones')
          .select('name')
          .eq('id', order.delivery_zone_id)
          .maybeSingle()
      : { data: null as any };

    const fiscalAddress = fiscal
      ? [
          fiscal.endereco_logradouro,
          fiscal.endereco_numero,
          fiscal.endereco_complemento,
          fiscal.endereco_bairro,
          fiscal.endereco_municipio,
          fiscal.endereco_uf,
          fiscal.endereco_cep,
        ].map((value: any) => String(value || '').trim()).filter(Boolean).join(', ')
      : '';

    const store = profile
      ? {
          name: profile.restaurant_name || '',
          restaurant_name: profile.restaurant_name || '',
          description: profile.description || '',
          logo_url: profile.logo_url || '',
          receipt_logo_url: config.receipt_logo_url,
          phone: profile.phone || '',
          address: fiscalAddress || profile.address || '',
          website: profile.website || '',
          cnpj: String(fiscal?.cnpj || '').trim()
        }
      : null;

    const enrichedOrder = {
      ...order,
      delivery_zone_name: String((deliveryZone as any)?.name || order?.delivery_zone_name || '').trim(),
      store
    };

    const productIds = Array.isArray(enrichedOrder.items)
      ? enrichedOrder.items.map((it: any) => String(it?.product_id || '').trim()).filter(Boolean)
      : [];

    const [groupsByProduct, orderMaps, productDescriptions] = await Promise.all([
      fetchVariationGroups(productIds),
      fetchVariationOrderMaps(productIds),
      fetchProductDescriptions(productIds),
    ]);

    const itemsSorted = (Array.isArray(enrichedOrder.items) ? enrichedOrder.items : []).map((it: any) => {
      const pid = String(it?.product_id || '').trim();
      const groups = pid ? groupsByProduct.get(pid) : undefined;
      const orderMap = pid ? orderMaps.get(pid) : undefined;

      const rawVarLines = Array.isArray(it?.variations) ? it.variations.map((v: any) => String(v || '').trim()).filter(Boolean) : [];
      const labeled = rawVarLines.filter((l) => l.includes(':'));
      const unlabeled = rawVarLines.filter((l) => !l.includes(':'));
      const optionNames = [...extractOptionNames(it?.options), ...unlabeled];

      let finalLines: string[] = [];
      if (labeled.length > 0) {
        finalLines = sortReceiptVariations(labeled, orderMap);
      } else if (optionNames.length > 0) {
        finalLines = optionsToReceiptLines(optionNames, groups);
      }

      const fixedDescription = String(it?.receipt_ingredients || productDescriptions.get(pid) || '').trim();
      const receiptDescriptionLines = fixedDescription
        ? fixedDescription
            .split(/\n|,|;/)
            .map((line: string) => line.trim())
            .filter(Boolean)
            .slice(0, 8)
        : [];

      return { ...it, receiptDescriptionLines, variations: finalLines };
    });
    (enrichedOrder as any).items = itemsSorted;

    const fiscalPrintData = normalizeNfcePrintData(enrichedOrder);
    if (fiscalPrintData?.modelCode === '55') {
      try {
        await openAuthorizedNfeDanfe(fiscalPrintData);
        if (options.openCashDrawer && api?.openCashDrawer) {
          const drawerResult = await openDrawerElectron();
          if (!drawerResult?.success) {
            console.warn('Documento aberto, mas a gaveta não respondeu:', drawerResult?.error || drawerResult);
          }
        }
      } catch (error: any) {
        toast.error(error?.message || 'Falha ao abrir o DANFE oficial da NF-e.');
        throw error;
      }
      return;
    }

    if (isElectron) {
      const resp = await printElectron(enrichedOrder, config, options);
      if (!resp.success) {
        toast.error(resp.error || 'Falha ao imprimir');
        return;
      }
      if (options.openCashDrawer && api?.openCashDrawer) {
        const drawerResult = await openDrawerElectron();
        if (!drawerResult?.success) {
          console.warn('Cupom impresso, mas a gaveta não respondeu:', drawerResult?.error || drawerResult);
        }
      }
      return;
    }

    // 2. O Pop Connect usa a impressora salva no aplicativo e imprime sem
    // abrir o diálogo nativo do navegador.
    const popConnectResult = await printPopConnect(enrichedOrder, config);
    if (popConnectResult.printed) return;
    if (popConnectResult.available) {
      toast.error(
        popConnectResult.printerConnected
          ? 'O Pop Connect não conseguiu imprimir. Confira se a impressora está ligada e disponível.'
          : 'Selecione e salve uma impressora no Pop Connect antes de imprimir.'
      );
      return;
    }

    // 3. Tentar impressão via USB (Silenciosa)
    if (usbDevice && usbDevice.opened) {
      try {
        await this.printUsb(enrichedOrder, config);
        return; // Sucesso, não abre janela
      } catch (e) {
        console.error('Falha na impressão USB, tentando fallback HTML:', e);
        // Fallback para HTML se USB falhar
      }
    }

    // 4. Fallback: Janela de Impressão HTML (Navegador)
    this.printHtml(enrichedOrder, config);
  },

  async openCashDrawer() {
    const api = typeof window !== 'undefined' ? (window as any)?.electronAPI : null;
    const isElectron = Boolean(api?.openCashDrawer);
    if (!isElectron) return { success: false, error: 'Abertura automática da gaveta disponível apenas no app desktop' };
    return openDrawerElectron();
  },

  async printOrderOnAccept(order: any) {
    const api = typeof window !== 'undefined' ? (window as any)?.electronAPI : null;
    const isElectron = Boolean(api?.printSystem && api?.printReceipt);
    const orderId = String(order?.id || '').trim();
    if (orderId) {
      if (printedAcceptedOrderIds.has(orderId)) return { success: true, skipped: true };
      printedAcceptedOrderIds.add(orderId);
    }

    try {
      return await this.printOrder(order, { onlyIfAuto: !isElectron });
    } catch (error) {
      if (orderId) printedAcceptedOrderIds.delete(orderId);
      throw error;
    }
  },

  async printCashReport(report: { title: string; lines: string[]; userId?: string; hideStoreHeader?: boolean; footerText?: string }) {
    const api = typeof window !== 'undefined' ? (window as any)?.electronAPI : null;
    const isElectron = Boolean(api?.printSystem);
    let store: any = null;
    const userId = String(report.userId || '').trim();
    let config = normalizePrintConfig(null);
    if (userId) {
      try {
        const [{ data: profile }, { data: settings }] = await Promise.all([
          supabase
            .from('profiles')
            .select('restaurant_name,description,logo_url,phone,address,website')
            .eq('id', userId)
            .maybeSingle(),
          (supabase as any)
            .from('printer_settings')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle()
        ]);
        config = normalizePrintConfig(settings);

        store = profile
          ? {
              name: (profile as any).restaurant_name || '',
              restaurant_name: (profile as any).restaurant_name || '',
              description: (profile as any).description || '',
              logo_url: (profile as any).logo_url || '',
              phone: (profile as any).phone || '',
              address: (profile as any).address || '',
              website: (profile as any).website || '',
              cnpj: ''
            }
          : null;
      } catch {}
    }

    const reportLineWidth = getCashReportLineWidth(config);
    const safeLines = normalizeReportLines(report.lines || [], reportLineWidth);
    const htmlContent = buildReportHtml(report.title, safeLines, store, {
      hideStoreHeader: report.hideStoreHeader,
      footerText: report.footerText,
      paperWidth: config.paper_width,
      fontSize: config.font_size,
    }).replace(
      '</body>',
      `<script>window.onload=function(){window.print();}</script></body>`
    );

    if (isElectron) {
      let resp = await printRawReportElectron(buildRawCashReportText(safeLines));
      if (!resp.success) {
        resp = await printReportElectron(htmlContent);
      }
      if (!resp.success) {
        toast.error(resp.error || 'Falha ao imprimir');
      }
      return;
    }

    const printWindow = window.open('', '_blank', 'width=420,height=600');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
    } else {
      toast.error('Pop-up bloqueado! Permita pop-ups para imprimir.');
    }
  },

  // Impressão USB (ESC/POS)
  async printUsb(order: any, config: any) {
    if (!usbDevice) return;

    const encoder = new TextEncoder();
    let commands = '';
    const lineWidth = config.paper_width === '58mm' ? 32 : 48;

    // Helpers
    const text = (str: string) => str + '\n';
    const center = () => commands += ALIGN_CENTER;
    const left = () => commands += ALIGN_LEFT;
    const bold = (enabled: boolean) => commands += (enabled ? BOLD_ON : BOLD_OFF);
    const line = () => commands += `${'-'.repeat(lineWidth)}\n`;
    
    // Init
    commands += INIT;
    commands += BOLD_ON + DOUBLE_STRIKE_ON;
    
    // Cabeçalho
    center();
    bold(true);
    const storeName = String(order?.store?.restaurant_name || order?.store?.name || config.print_header || 'RESTAURANTE').trim();
    commands += text(storeName || (config.print_header || 'RESTAURANTE'));
    bold(true);
    const storeDesc = String(order?.store?.description || '').trim();
    if (storeDesc) commands += text(storeDesc);
    const storeAddress = String(order?.store?.address || '').trim();
    if (storeAddress) commands += text(storeAddress);
    const storePhone = String(order?.store?.phone || '').trim();
    if (storePhone) commands += text(`Tel: ${storePhone}`);
    const storeCnpj = String(order?.store?.cnpj || '').trim();
    if (storeCnpj) commands += text(`CNPJ: ${storeCnpj}`);
    commands += text(new Date(order.created_at).toLocaleString('pt-BR'));
    line();

    // Senha/Pedido
    bold(true);
    if (shouldPrintTicketCode(order)) commands += text(`SENHA: ${order.order_number?.slice(-4) || '----'}`);
    bold(true);
    commands += text(`Pedido #${order.order_number}`);
    line();

    // Cliente
    left();
    bold(true);
    commands += text('CLIENTE:');
    bold(true);
    commands += text(order.customer_name || 'Balcão');
    if (order.customer_phone) commands += text(`Tel: ${order.customer_phone}`);
    const customerAddressLine = resolveCustomerAddressLine(order);
    if (customerAddressLine) commands += text(`End: ${customerAddressLine}`);
    if (order.delivery_zone_id) commands += text(`Entrega: ${order.order_type === 'delivery' ? 'Delivery' : 'Retirada'}`);
    line();

    // Itens
    bold(true);
    commands += text('ITENS:');
    bold(true);
    order.items.forEach((item: any) => {
      const quantity = Number(item.quantity || 1);
      const productName = item.product_name || item.name || 'Produto';
      const unitPrice = Number(item.price || item.unit_price || 0);
      const itemTotal = Number(item.total || item.subtotal || unitPrice * quantity || 0);

      wrapTextLine(`${quantity}x ${productName}`, lineWidth).forEach((value) => {
        commands += text(value);
      });
      // Preço e total alinhar à direita é chato em ESC/POS puro sem tabelas, vou deixar simples
      formatColumns(
        `${formatCurrencyValue(unitPrice)} x ${quantity}`,
        formatCurrencyValue(itemTotal),
        lineWidth
      ).forEach((value) => {
        commands += text(value);
      });
      const detailGroups = getOrderItemDetailGroups(item);
      for (const group of detailGroups) {
        if (group.label) {
          wrapTextLine(`   ${group.label}:`, lineWidth).forEach((lineValue) => {
            commands += text(lineValue);
          });
        }
        for (const detail of group.items) {
          wrapTextLine(
            `   ${group.label ? '- ' : ''}${detail.text}${detail.price && detail.price > 0
              ? quantity > 1
                ? ` (${formatCurrencyValue(detail.price)} cada; total ${formatCurrencyValue(detail.price * quantity)})`
                : ` (${formatCurrencyValue(detail.price)})`
              : ''}`,
            lineWidth
          ).forEach((lineValue) => {
            commands += text(lineValue);
          });
        }
      }
      if (item.notes) {
        wrapTextLine(`   Obs: ${String(item.notes)}`, lineWidth).forEach((value) => {
          commands += text(value);
        });
      }
      commands += '\n';
    });
    line();

    // Totais
    formatColumns(
      'Subtotal',
      formatCurrencyValue(Number(order.total || 0) - Number(order.delivery_fee || 0)),
      lineWidth
    ).forEach((value) => {
      commands += text(value);
    });
    if (order.delivery_fee) {
      formatColumns('Taxa Entrega', formatCurrencyValue(Number(order.delivery_fee || 0)), lineWidth).forEach((value) => {
        commands += text(value);
      });
    }
    if (order.discount) {
      formatColumns('Desconto', `- ${formatCurrencyValue(Number(order.discount || 0))}`, lineWidth).forEach((value) => {
        commands += text(value);
      });
    }
    
    bold(true);
    formatColumns('TOTAL', formatCurrencyValue(Number(order.total || 0)), lineWidth).forEach((value) => {
      commands += text(value);
    });
    bold(true);
    
    const splitLines = getPaymentSplitLines(order);
    if (splitLines.length > 1) {
      commands += text('Pagamento: MISTO');
      splitLines.forEach((line) => {
        formatColumns(line.label, formatCurrencyValue(line.amount), lineWidth).forEach((value) => {
          commands += text(value);
        });
      });
    } else if (splitLines.length === 1) {
      commands += text(`Pagamento: ${splitLines[0].label}`);
    } else {
      commands += text(`Pagamento: ${formatPaymentMethodLabel(order.payment_method, order)}`);
    }
    if (order.change_amount) {
      formatColumns('Troco', formatCurrencyValue(Number(order.change_amount || 0)), lineWidth).forEach((value) => {
        commands += text(value);
      });
    }

    commands += appendNfceEscPosCommands(order, lineWidth);
    
    line();
    center();
    commands += text(config.print_footer);
    commands += text(`Sistema ${BRAND_NAME}`);
    
    // Feed e Corte
    commands += '\n\n\n\n'; // Feed
    commands += DOUBLE_STRIKE_OFF + BOLD_OFF;
    commands += CUT_PARTIAL;

    if (config.print_kitchen_ticket) {
      commands += buildKitchenEscPosCommands(order, lineWidth);
    }

    // Enviar dados
    const data = encoder.encode(commands);
    // Endpoint 1 geralmente é OUT em impressoras (mas pode variar, ideal é descobrir dinamicamente)
    // Vou tentar endpoint 1, se falhar, tenta outros ou itera interfaces.
    // Para simplificar: endpointNumber 1 é o padrão da maioria.
    await usbDevice.transferOut(1, data);
  },

  // Impressão HTML (Fallback)
  printHtml(order: any, config: any) {
    const printableHtml = config.print_kitchen_ticket
      ? buildCombinedTicketHtml(order, config, order.store)
      : buildOrderHtml(order, config, order.store);

    const htmlContent = printableHtml.replace(
      '</body>',
      `<script>window.onload=function(){window.print();}</script></body>`
    );

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
    } else {
      alert('Pop-up bloqueado! Permita pop-ups para imprimir.');
    }
  }
};
