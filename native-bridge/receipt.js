const ESC = '\x1B'
const GS = '\x1D'
const FONT_A = `${ESC}\x4D\x00`
const SIZE_NORMAL = `${GS}\x21\x00`
const SIZE_TALL = `${GS}\x21\x10`
const SIZE_DOUBLE = `${GS}\x21\x11`

// Impressoras ESC/POS variam muito na tabela de caracteres configurada. Enviar
// UTF-8 diretamente faz textos como "Açaí" virarem "A├ºaí" em vários modelos.
// ASCII é a representação estável em Epson, Elgin, Bematech e genéricas.
export const normalizePrinterText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[–—]/g, '-')
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/…/g, '...')
  .replace(/º/g, 'o')
  .replace(/ª/g, 'a')
  .replace(/[^\x20-\x7E\r\n\t]/g, '')

const normalizeLine = (value) => normalizePrinterText(value).replace(/\s+/g, ' ').trim()

const money = (value) => Number(value || 0).toFixed(2).replace('.', ',')

const orderTypeLabel = (value) => {
  const normalized = normalizeLine(value).toLowerCase()
  if (normalized === 'delivery') return 'Entrega'
  if (normalized === 'pickup') return 'Retirada'
  if (normalized === 'dine_in') return 'Mesa'
  if (normalized === 'counter') return 'Balcão'
  return normalizeLine(value)
}
const wrapLine = (value, width, prefix = '') => {
  const text = normalizeLine(value)
  if (!text) return []
  const available = Math.max(8, width - prefix.length)
  const words = text.split(' ')
  const lines = []
  let current = ''
  for (const word of words) {
    if (!current) {
      current = word
      continue
    }
    if (`${current} ${word}`.length <= available) current = `${current} ${word}`
    else {
      lines.push(`${prefix}${current}`)
      current = word
    }
  }
  if (current) lines.push(`${prefix}${current}`)
  return lines
}

const appendWrapped = (target, value, width, prefix = '') => {
  for (const line of wrapLine(value, width, prefix)) target.push(`${line}\n`)
}

const formatColumns = (leftValue, rightValue, width) => {
  const left = normalizeLine(leftValue)
  const right = normalizeLine(rightValue)
  const available = Math.max(8, width - right.length - 1)
  const leftLines = wrapLine(left, available)
  if (leftLines.length === 0) return [`${' '.repeat(Math.max(0, width - right.length))}${right}`]
  return leftLines.map((line, index) => {
    if (index !== leftLines.length - 1) return line
    return `${line}${' '.repeat(Math.max(1, width - line.length - right.length))}${right}`
  })
}

const appendColumns = (target, left, right, width) => {
  for (const line of formatColumns(left, right, width)) target.push(`${line}\n`)
}

const isLegacyStoreName = (value) => /^bora\s*cum[eê]\s*hub$/i.test(normalizeLine(value))

const resolveStoreName = (data) => {
  const candidates = [
    data?.store?.restaurant_name,
    data?.store?.name,
    data?.receipt?.header,
    data?.print_header,
  ]
  const currentName = candidates.find((value) => normalizeLine(value) && !isLegacyStoreName(value))
  return normalizeLine(currentName || 'POPSYSTEM')
}

export function buildReceiptLogoHtml(data = {}) {
  const logoUrl = String(
    data?.receipt?.logo_url
      || data?.store?.receipt_logo_url
      || data?.store?.logo_url
      || '',
  ).trim()
  if (!/^(https?:\/\/|data:image\/)/i.test(logoUrl)) return ''
  const safeLogoUrl = logoUrl
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const paperWidth = data?.receipt?.paper_width === '58mm' || data?.paper_width === '58mm' ? '58mm' : '80mm'
  return `<!doctype html><html data-paper-width="${paperWidth}"><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{width:${paperWidth};margin:0;padding:0;background:#fff}body{display:flex;justify-content:center;align-items:flex-start}img{display:block;max-width:34mm;max-height:20mm;object-fit:contain;margin:1mm auto 2mm}</style></head><body><img src="${safeLogoUrl}" alt="Logo"></body></html>`
}

export function buildEscposReport(data = {}) {
  const width = data?.paper_width === '58mm' || data?.receipt?.paper_width === '58mm' ? 30 : 46
  const separator = '-'.repeat(width)
  const store = data.store || {}
  const output = [`${ESC}\x40`, FONT_A, SIZE_NORMAL]
  const appendReportLine = (value = '') => {
    const raw = normalizePrinterText(value).replace(/\r/g, '').trimEnd()
    if (!raw) {
      output.push('\n')
      return
    }
    if (/^[=\-_]+$/.test(raw.trim())) {
      output.push(`${raw.trim()[0].repeat(width)}\n`)
      return
    }
    const leadingSpaces = raw.length - raw.trimStart().length
    const prefix = ' '.repeat(Math.min(leadingSpaces, Math.floor(width / 2)))
    appendWrapped(output, raw.trimStart(), width, prefix)
  }

  if (!data.hide_store_header) {
    output.push(`${ESC}\x61\x01${ESC}\x45\x01`)
    appendWrapped(output, resolveStoreName(data), width)
    output.push(`${ESC}\x45\x00`)
    appendWrapped(output, store.address, width)
    if (store.phone) appendWrapped(output, `Tel: ${store.phone}`, width)
    if (store.cnpj) appendWrapped(output, `CNPJ: ${store.cnpj}`, width)
    output.push(`${separator}\n`)
  }

  if (data.title) {
    output.push(`${ESC}\x61\x01${ESC}\x45\x01`)
    appendWrapped(output, data.title, width)
    output.push(`${ESC}\x45\x00${separator}\n`)
  }

  output.push(`${ESC}\x61\x00`)
  for (const line of Array.isArray(data.lines) ? data.lines : []) appendReportLine(line)

  if (data.footer) {
    output.push(`${separator}\n${ESC}\x61\x01`)
    appendWrapped(output, data.footer, width)
  }
  output.push(`${ESC}\x61\x00\n\n\n\n\n\n${GS}\x56\x00`)
  return output.join('')
}

export function buildEscposReceipt(data = {}) {
  const width = data?.receipt?.paper_width === '58mm' || data?.paper_width === '58mm' ? 32 : 48
  const separator = '-'.repeat(width)
  const store = data.store || {}
  const items = Array.isArray(data.items) ? data.items : []
  const output = []
  const configuredFontSize = normalizeLine(data?.receipt?.font_size || data?.font_size).toLowerCase()
  // O corpo precisa permanecer em tamanho normal. Algumas termicas genericas
  // interpretam SIZE_TALL (0x10) como largura dupla e passam a comportar so
  // metade das colunas: separadores viram duas linhas e palavras quebram no
  // meio. O tamanho ampliado fica restrito aos destaques, que ja calculam a
  // largura reduzida antes de imprimir.
  const bodySize = configuredFontSize === 'large' ? SIZE_TALL : SIZE_NORMAL

  output.push(`${ESC}\x40`)
  // Algumas termicas reiniciam usando a fonte B, que e menor. A fonte A e o
  // padrao comercial e mantem 32/48 colunas reais em papel de 58/80 mm.
  output.push(FONT_A)
  output.push(bodySize)
  output.push(`${ESC}\x61\x01`)
  output.push(`${ESC}\x45\x01${SIZE_DOUBLE}`)
  appendWrapped(output, resolveStoreName(data), width / 2)
  output.push(`${ESC}\x45\x00${bodySize}`)
  appendWrapped(output, store.description, width)
  appendWrapped(output, store.address, width)
  if (store.phone) appendWrapped(output, `Tel: ${store.phone}`, width)
  if (store.cnpj) appendWrapped(output, `CNPJ: ${store.cnpj}`, width)
  if (data.date) {
    const parsed = new Date(data.date)
    if (!Number.isNaN(parsed.getTime())) appendWrapped(output, parsed.toLocaleString('pt-BR'), width)
  }
  output.push(`${separator}\n`)

  if (data.ticket_code && data.order_number) {
    output.push(`${ESC}\x45\x01${SIZE_DOUBLE}`)
    appendWrapped(output, `SENHA: ${String(data.order_number).slice(-4)}`, width / 2)
    output.push(`${ESC}\x45\x00${bodySize}`)
  }
  if (data.order_number) {
    const displayOrderNumber = normalizeLine(data.order_number).replace(/^PED[-_\s]*/i, '')
    appendWrapped(output, `Pedido #${displayOrderNumber || data.order_number}`, width)
  }
  output.push(`${separator}\n`)

  output.push(`${ESC}\x61\x00${ESC}\x45\x01CLIENTE:\n${ESC}\x45\x00`)
  appendWrapped(output, data.customer_name || 'Balcao', width)
  if (data.customer_phone) appendWrapped(output, `Tel: ${data.customer_phone}`, width)
  const customerAddress = normalizeLine(data.customer_address_display || data.customer_address)
  if (customerAddress) appendWrapped(output, `End: ${customerAddress}`, width)
  const deliveryZone = normalizeLine(data.delivery_zone_name)
  if (deliveryZone && !customerAddress.toLowerCase().includes(deliveryZone.toLowerCase())) {
    appendWrapped(output, `Regiao: ${deliveryZone}`, width)
  }
  const type = orderTypeLabel(data.order_type)
  if (type) appendWrapped(output, `Tipo: ${type}`, width)
  output.push(`${separator}\n`)

  output.push(`${ESC}\x45\x01ITENS:\n${ESC}\x45\x00`)
  items.forEach((item) => {
    const name = normalizeLine(item.product_name || item.name || 'Item')
    const quantity = Number(item.quantity || item.qty || 1)
    const unitPrice = Number(item.price || item.unit_price || 0)
    const subtotal = Number(item.subtotal ?? item.total ?? (unitPrice * quantity))
    output.push(`${ESC}\x45\x01`)
    appendWrapped(output, `${quantity}x ${name}`, width)
    output.push(`${ESC}\x45\x00`)
    if (unitPrice > 0) appendColumns(output, `R$ ${money(unitPrice)} x ${quantity}`, `R$ ${money(subtotal)}`, width)
    else appendColumns(output, '', `R$ ${money(subtotal)}`, width)
    const variations = Array.isArray(item.variations) ? item.variations : []
    variations.forEach((variation) => appendWrapped(output, variation, width, '  '))
    if (item.notes || item.observations) {
      appendWrapped(output, `Obs: ${item.notes || item.observations}`, width, '  ')
    }
    output.push('\n')
  })

  output.push(`${separator}\n`)
  const subtotal = Number(data.subtotal || 0)
  const discount = Number(data.discount || 0)
  const deliveryFee = Number(data.delivery_fee || 0)
  appendColumns(output, 'Subtotal:', `R$ ${money(subtotal || data.total)}`, width)
  if (discount > 0) appendColumns(output, 'Desconto:', `-R$ ${money(discount)}`, width)
  if (deliveryFee > 0) appendColumns(output, 'Taxa Entrega:', `R$ ${money(deliveryFee)}`, width)
  output.push(`${separator}\n${ESC}\x45\x01${SIZE_DOUBLE}`)
  appendColumns(output, 'TOTAL:', `R$ ${money(data.total)}`, width / 2)
  output.push(`${bodySize}${ESC}\x45\x00`)
  if (data.payment_method) appendWrapped(output, `Pagamento: ${data.payment_method}`, width)

  output.push(`${ESC}\x61\x01${separator}\n`)
  appendWrapped(output, data?.receipt?.footer || data.print_footer || 'Obrigado pela preferência!', width)
  output.push('Sistema PopSystem\n')
  output.push(SIZE_NORMAL)
  // Seis linhas deixam o rodape livre da serrilha/guilhotina, inclusive nas
  // termicas em que o corte acontece muito perto da ultima linha impressa.
  output.push('\n\n\n\n\n\n')
  output.push(`${GS}\x56\x00`)
  return output.join('')
}
