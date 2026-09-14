import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEscposReceipt, normalizePrinterText } from './receipt.js'

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
  assert.match(receipt, /Endereco: Rua do Cliente, 20/)
  assert.match(receipt, /Sabores: Chocolate, Morango/)
  assert.match(receipt, /Adicionais: Granulado/)
  assert.match(receipt, /Obs: Sem colher/)
  assert.match(receipt, /Desconto: -R\$ 2,00/)
  assert.match(receipt, /Taxa de entrega: R\$ 3,00/)
  assert.match(receipt, /Pagamento: PIX/)
  assert.match(receipt, /Volte sempre!/)
})

test('uses PopSystem instead of the removed legacy brand when identity is missing', () => {
  const receipt = readable(buildEscposReceipt({ items: [], total: 0 }))
  assert.match(receipt, /POPSYSTEM/)
  assert.doesNotMatch(receipt, /BORA CUME/i)
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
})
