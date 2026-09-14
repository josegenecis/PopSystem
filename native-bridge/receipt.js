const ESC = '\x1B'
const GS = '\x1D'

const normalizeLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

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

  output.push(`${ESC}\x40`)
  output.push(`${ESC}\x61\x01`)
  output.push(`${ESC}\x45\x01`)
  appendWrapped(output, resolveStoreName(data), width)
  output.push(`${ESC}\x45\x00`)
  appendWrapped(output, store.description, width)
  appendWrapped(output, store.address, width)
  if (store.phone) appendWrapped(output, `Tel: ${store.phone}`, width)
  if (store.cnpj) appendWrapped(output, `CNPJ: ${store.cnpj}`, width)
  output.push(`${separator}\n`)

  output.push(`${ESC}\x61\x00`)
  if (data.order_number) appendWrapped(output, `Pedido: #${data.order_number}`, width)
  if (data.date) {
    const parsed = new Date(data.date)
    if (!Number.isNaN(parsed.getTime())) appendWrapped(output, `Data: ${parsed.toLocaleString('pt-BR')}`, width)
  }
  const type = orderTypeLabel(data.order_type)
  if (type) appendWrapped(output, `Tipo: ${type}`, width)
  if (data.customer_name) appendWrapped(output, `Cliente: ${data.customer_name}`, width)
  if (data.customer_phone) appendWrapped(output, `Telefone: ${data.customer_phone}`, width)
  if (data.customer_address_display || data.customer_address) {
    appendWrapped(output, `Endereço: ${data.customer_address_display || data.customer_address}`, width)
  }
  if (data.delivery_zone_name) appendWrapped(output, `Região: ${data.delivery_zone_name}`, width)
  output.push(`${separator}\n`)

  items.forEach((item) => {
    const name = normalizeLine(item.product_name || item.name || 'Item')
    const quantity = Number(item.quantity || item.qty || 1)
    appendWrapped(output, `${quantity}x ${name}`, width)
    const variations = Array.isArray(item.variations) ? item.variations : []
    variations.forEach((variation) => appendWrapped(output, variation, width, '  '))
    if (item.notes || item.observations) {
      appendWrapped(output, `Obs: ${item.notes || item.observations}`, width, '  ')
    }
    const subtotal = Number(item.subtotal ?? item.total ?? (Number(item.price || 0) * quantity))
    output.push(`${ESC}\x61\x02R$ ${money(subtotal)}\n${ESC}\x61\x00`)
  })

  output.push(`${separator}\n`)
  const subtotal = Number(data.subtotal || 0)
  const discount = Number(data.discount || 0)
  const deliveryFee = Number(data.delivery_fee || 0)
  if (subtotal > 0 && (discount > 0 || deliveryFee > 0)) output.push(`${ESC}\x61\x02Subtotal: R$ ${money(subtotal)}\n`)
  if (discount > 0) output.push(`Desconto: -R$ ${money(discount)}\n`)
  if (deliveryFee > 0) output.push(`Taxa de entrega: R$ ${money(deliveryFee)}\n`)
  output.push(`${ESC}\x45\x01TOTAL: R$ ${money(data.total)}\n${ESC}\x45\x00`)
  output.push(`${ESC}\x61\x00`)
  if (data.payment_method) appendWrapped(output, `Pagamento: ${data.payment_method}`, width)

  output.push(`${ESC}\x61\x01${separator}\n`)
  appendWrapped(output, data?.receipt?.footer || data.print_footer || 'Obrigado pela preferência!', width)
  output.push('\n\n\n')
  output.push(`${GS}\x56\x00`)
  return output.join('')
}
