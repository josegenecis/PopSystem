import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEscposReceipt, buildEscposReport, buildReceiptLogoHtml, normalizePrinterText } from './receipt.js'

const readable = (value) => value.replace(/[\x00-\x1f]/g, '')

test('uses the restaurant identity and prints the complete operational order', () => {
  const receipt = readable(buildEscposReceipt({
    store: {
      restaurant_name: 'Sorveteria da Diana',
      address: 'Rua Principal, 10',
      phone: '(85) 99999-0000',
      cnpj: '12.345.678/0001-90',
    },
    receipt: { paper_width: '80mm', footer: 'Volte sempre!' },
    order_number: 'PED596698',
    ticket_code: true,
    order_type: 'delivery',
    customer_name: 'Diana Karla Lima da Costa',
    customer_phone: '85986620784',
    customer_address_display: 'Rua do Cliente, 20',
    items: [{
      product_name: 'Kit 1 Litro',
      quantity: 1,
      subtotal: 46,
      variations: ['Sabores: Chocolate, Morango', 'Adicionais: Granulado'],
      notes: 'Sem colher',
    }],
    subtotal: 45,
    delivery_fee: 3,
    discount: 2,
    total: 46,
    payment_method: 'PIX',
  }))

  assert.match(receipt, /Sorveteria da Diana/)
  assert.doesNotMatch(receipt, /BORA CUME/i)
  assert.match(receipt, /Tipo: Entrega/)
  assert.match(receipt, /SENHA: 6698/)
  assert.match(receipt, /CLIENTE:/)
  assert.match(receipt, /End: Rua do Cliente, 20/)
  assert.match(receipt, /ITENS:/)
  assert.match(receipt, /R\$ 46,00/)
  assert.match(receipt, /Sabores: Chocolate, Morango/)
  assert.match(receipt, /Adicionais: Granulado/)
  assert.match(receipt, /Obs: Sem colher/)
  assert.match(receipt, /Desconto:\s+-R\$ 2,00/)
  assert.match(receipt, /Taxa Entrega:\s+R\$ 3,00/)
  assert.match(receipt, /Pagamento: PIX/)
  assert.match(receipt, /Volte sempre!/)
  assert.match(receipt, /Sistema PopSystem/)
})

test('uses a commercial hierarchy without widening the receipt body', () => {
  const receipt = buildEscposReceipt({
    store: { restaurant_name: 'The place Acai' },
    receipt: { paper_width: '80mm', font_size: 'normal' },
    order_number: '4739',
    ticket_code: true,
    customer_name: 'Venda Balcao',
    items: [{ name: 'ACAI PESO', quantity: 0.364, price: 49.99, subtotal: 18.2 }],
    subtotal: 18.2,
    total: 18.2,
    payment_method: 'CREDITO',
  })

  assert.ok(receipt.includes(`${String.fromCharCode(0x1b)}M${String.fromCharCode(0)}`), 'selects ESC/POS font A')
  assert.ok(receipt.includes(`${String.fromCharCode(0x1d)}!${String.fromCharCode(0)}`), 'keeps the body at the printer native width')
  assert.ok(!receipt.includes(`${String.fromCharCode(0x1d)}!${String.fromCharCode(0x10)}`), 'does not widen the body on incompatible printers')
  assert.ok(receipt.includes(`${String.fromCharCode(0x1d)}!${String.fromCharCode(0x11)}`), 'uses double-size highlights')
  const text = readable(receipt)
  assert.match(text, /SENHA: 4739/)
  assert.match(text, /CLIENTE:/)
  assert.match(text, /ITENS:/)
  assert.match(text, /R\$ 49,99 x 0.364/)
  assert.match(text, /Subtotal:\s+R\$ 18,20/)
  assert.match(text, /TOTAL:\s+R\$ 18,20/)
})

test('removes the duplicated PED prefix from the printed order number', () => {
  const receipt = readable(buildEscposReceipt({
    order_number: 'PED959877',
    items: [],
    total: 0,
  }))

  assert.match(receipt, /Pedido #959877/)
  assert.doesNotMatch(receipt, /Pedido #PED959877/)
})

test('does not repeat the delivery region when it is already in the address', () => {
  const receipt = readable(buildEscposReceipt({
    customer_address_display: 'Rua do Ariaco - Bairro: CHACARA I',
    delivery_zone_name: 'CHACARA I',
    items: [],
    total: 0,
  }))

  assert.match(receipt, /End: Rua do Ariaco - Bairro: CHACARA I/)
  assert.doesNotMatch(receipt, /Regiao: CHACARA I/)
})

test('uses PopSystem instead of the removed legacy brand when identity is missing', () => {
  const receipt = readable(buildEscposReceipt({ items: [], total: 0 }))
  assert.match(receipt, /POPSYSTEM/)
  assert.doesNotMatch(receipt, /BORA CUME/i)
})

test('renders only a safe establishment logo before the text receipt', () => {
  const html = buildReceiptLogoHtml({
    store: { logo_url: 'https://cdn.example.com/logo.png?size=large&theme=light' },
    receipt: { paper_width: '80mm' },
  })
  assert.match(html, /data-paper-width="80mm"/)
  assert.match(html, /https:\/\/cdn\.example\.com\/logo\.png\?size=large&amp;theme=light/)
  assert.equal(buildReceiptLogoHtml({ store: { logo_url: 'javascript:alert(1)' } }), '')
})

test('normalizes Portuguese accents for printers with incompatible code pages', () => {
  assert.equal(
    normalizePrinterText('Açaí da Júlia — Água sem gás, balcão e preferência'),
    'Acai da Julia - Agua sem gas, balcao e preferencia',
  )

  const receipt = buildEscposReceipt({
    store: { restaurant_name: 'Açaí da Jú Aquiraz' },
    customer_name: 'João Gonçalves',
    order_type: 'counter',
    items: [{ name: 'Água sem gás 500 ml', quantity: 1, subtotal: 2.5 }],
    total: 2.5,
    receipt: { footer: 'Obrigado pela preferência!' },
  })

  assert.match(readable(receipt), /Acai da Ju Aquiraz/)
  assert.match(readable(receipt), /Joao Goncalves/)
  assert.match(readable(receipt), /Tipo: Balcao/)
  assert.match(readable(receipt), /Agua sem gas 500 ml/)
  assert.match(readable(receipt), /Obrigado pela preferencia!/)
  assert.equal([...receipt].some((character) => character.charCodeAt(0) > 127), false)
  assert.ok(receipt.includes('Sistema PopSystem\n\x1D\x21\x00\n\n\n\n\n\n'))
})

test('builds a cash report for silent ESC/POS printing', () => {
  const report = buildEscposReport({
    title: 'Abertura de Caixa',
    paper_width: '80mm',
    store: { restaurant_name: 'Loja Teste' },
    lines: ['Data/Hora: 14/09/2026 15:00', 'Valor inicial: R$ 100,00'],
  })
  const text = readable(report)

  assert.match(text, /Loja Teste/)
  assert.match(text, /Abertura de Caixa/)
  assert.match(text, /Valor inicial: R\$ 100,00/)
  assert.ok(report.endsWith('\n\n\n\n\n\n\x1d\x56\x00'))
})
