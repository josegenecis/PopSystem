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

const resolveStoreName = (data) => normalizeLine(
  data?.store?.restaurant_name
    || data?.store?.name
    || data?.receipt?.header
    || data?.print_header
    || 'POPSYSTEM',
)

export function buildEscposReceipt(data = {}) {
  const width = data?.receipt?.paper_width === '58mm' || data?.paper_width === '58mm' ? 32 : 48
  const separator = '-'.repeat(width)
  const store = data.store || {}
  const items = Array.isArray(data.items) ? data.items : []
  const output = []
  const configuredFontSize = normalizeLine(data?.receipt?.font_size || data?.font_size).toLowerCase()
  const bodySize = configuredFontSize === 'small' ? SIZE_NORMAL : SIZE_TALL

  output.push(`${ESC}\x40`)
  // Algumas termicas reiniciam usando a fonte B, que e menor. Selecionar a
  // fonte A e altura dupla recupera a leitura visual do antigo cupom HTML sem
  // voltar ao bitmap, que era descartado por parte das filas do Windows.
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
  if (data.order_number) appendWrapped(output, `Pedido #${data.order_number}`, width)
  output.push(`${separator}\n`)

  output.push(`${ESC}\x61\x00${ESC}\x45\x01CLIENTE:\n${ESC}\x45\x00`)
  appendWrapped(output, data.customer_name || 'Balcao', width)
  if (data.customer_phone) appendWrapped(output, `Tel: ${data.customer_phone}`, width)
  if (data.customer_address_display || data.customer_address) {
    appendWrapped(output, `End: ${data.customer_address_display || data.customer_address}`, width)
  }
  if (data.delivery_zone_name) appendWrapped(output, `Regiao: ${data.delivery_zone_name}`, width)
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
  output.push('\n\n\n')
  output.push(`${GS}\x56\x00`)
  return output.join('')
}
