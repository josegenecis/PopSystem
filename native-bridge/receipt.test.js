import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEscposKitchenTicket, buildEscposReceipt, buildEscposReport, buildReceiptLogoHtml, normalizePrinterText } from './receipt.js'

const readable = (value) => value.replace(/[\x00-\x1f]/g, '')

for (const paperWidth of ['58mm', '80mm']) {
  test(`partial receipt preserves the complete bill without payment (${paperWidth})`, () => {
    const order = {
      store: { restaurant_name: 'Restaurante X', address: 'Rua Principal, 10', phone: '85999999999', cnpj: '12.345.678/0001-90', logo_url: 'https://cdn.example.com/restaurante.png' },
      receipt: { paper_width: paperWidth, footer: 'Volte sempre!' },
      order_number: 'PED123', table_number: '7', customer_name: 'Cliente da mesa', waiter_name: 'Ana Silva',
      items: [{ product_name: 'Refeicao', quantity: 2, price: 25, subtotal: 50, variations: ['Sem cebola'] }],
      subtotal: 50, discount: 5,
      charges: [{ label: 'Acrescimo', amount: 5 }, { label: 'Servico (10%)', amount: 5 }],
      total: 55, payment_method: 'DINHEIRO', change_amount: 100, change_value: 45,
    }
    const partial = readable(buildEscposReceipt({ ...order, receipt_partial: true }))
    for (const text of ['Restaurante X', 'Rua Principal, 10', 'CNPJ: 12.345.678/0001-90', 'Tel: 85999999999', 'Cliente da mesa', 'Refeicao', 'Sem cebola', 'Subtotal:', 'Desconto:', 'Acrescimo:', 'Servico (10%):', 'TOTAL:', 'Volte sempre!']) {
      assert.ok(partial.includes(text), `missing ${text}`)
    }
    assert.match(partial, /COMANDA PARCIAL/)
    assert.match(partial, /Mesa: 7/)
    assert.match(partial, /Garcom: Ana Silva/)
    assert.doesNotMatch(partial, /Pagamento:|Troco/)
    const final = readable(buildEscposReceipt(order))
    assert.match(final, /Garcom: Ana Silva/)
    assert.match(final, /Pagamento: DINHEIRO/)
    assert.match(final, /Troco:/)
    assert.doesNotMatch(final, /COMANDA PARCIAL/)
    const partialLogo = buildReceiptLogoHtml({ ...order, receipt_partial: true })
    assert.match(partialLogo, /restaurante\.png/)
    assert.equal(partialLogo, buildReceiptLogoHtml(order))
    const withoutPayment = final.replace(/Pagamento: DINHEIRO/, '').replace(/Troco para:\s+R\$ 100,00/, '').replace(/Troco:\s+R\$ 45,00/, '')
    assert.equal(partial.replace('COMANDA PARCIAL', ''), withoutPayment)
  })
}

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

test('prints the cash amount and calculated change', () => {
  const receipt = readable(buildEscposReceipt({
    items: [],
    total: 46,
    payment_method: 'DINHEIRO',
    change_amount: 50,
  }))

  assert.match(receipt, /Troco para:\s+R\$ 50,00/)
  assert.match(receipt, /Troco:\s+R\$ 4,00/)
})

test('prints the explicit received amount and change sent by the PDV', () => {
  const receipt = readable(buildEscposReceipt({
    items: [],
    total: 30,
    payment_method: 'DINHEIRO',
    change_amount: 100,
    change_value: 70,
  }))

  assert.match(receipt, /Troco para:\s+R\$ 100,00/)
  assert.match(receipt, /Troco:\s+R\$ 70,00/)
})

test('builds a kitchen copy without prices, address or payment totals', () => {
  const ticket = readable(buildEscposKitchenTicket({
    order_number: 'PED1234',
    order_type: 'dine_in',
    table_number: '12',
    customer_name: 'Comanda João',
    customer_address_display: 'Rua que nao deve sair',
    items: [{
      product_name: 'Pizza grande',
      quantity: 1,
      subtotal: 79.9,
      variations: ['Sabor: Calabresa'],
      notes: 'Sem cebola',
    }],
    total: 79.9,
    payment_method: 'PIX',
  }))

  assert.match(ticket, /COZINHA/)
  assert.match(ticket, /PEDIDO #1234/)
  assert.match(ticket, /Mesa: 12/)
  assert.match(ticket, /1x Pizza grande/)
  assert.match(ticket, /Sabor: Calabresa/)
  assert.match(ticket, /OBS: Sem cebola/)
  assert.doesNotMatch(ticket, /79,90/)
  assert.doesNotMatch(ticket, /Rua que nao deve sair/)
  assert.doesNotMatch(ticket, /PIX/)
})

test('identifies a bar copy without exposing payment data', () => {
  const ticket = readable(buildEscposKitchenTicket({
    print_route: 'bar',
    order_number: 'B55',
    table_number: '8',
    items: [{ product_name: 'Refrigerante', quantity: 2, subtotal: 20 }],
    total: 20,
  }))

  assert.match(ticket, /BAR \/ COPA/)
  assert.match(ticket, /Mesa: 8/)
  assert.match(ticket, /2x Refrigerante/)
  assert.doesNotMatch(ticket, /20,00/)
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

test('rejects the removed legacy brand received from an old print configuration', () => {
  const receipt = readable(buildEscposReceipt({
    receipt: { header: 'BORA CUME HUB' },
    print_header: 'BORA CUME HUB',
    items: [],
    total: 0,
  }))

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

for (const route of ['kitchen', 'bar']) {
  for (const paperWidth of ['58mm', '80mm']) {
    test(`prints the attending waiter on ${route} (${paperWidth})`, () => {
      const payload = {
        receipt: { paper_width: paperWidth }, print_route: route,
        waiter_name: 'Ana Silva', table_number: '7', order_type: 'dine_in',
        items: [{ product_name: 'Produto', quantity: 1, subtotal: 25 }],
      }
      const receipt = readable(buildEscposKitchenTicket(payload))
      assert.match(receipt, /Garcom: Ana Silva/)
      assert.match(receipt, /Mesa: 7/)
      assert.match(receipt, route === 'bar' ? /BAR \/ COPA/ : /COZINHA/)
      assert.doesNotMatch(receipt, /R\$/)
      assert.doesNotMatch(readable(buildEscposKitchenTicket({ ...payload, waiter_name: '' })), /Garcom:/)
      assert.doesNotMatch(readable(buildEscposReceipt({ ...payload, waiter_name: '' })), /Garcom:/)
    })
  }
}

test('NFC-e uses the same native body as a normal receipt and preserves fiscal QR payload', () => {
  const base = { store: { name: 'Loja' }, total: 13, payment_method: 'DEBITO', items: [{name:'Produto',quantity:1,price:13}], receipt: {paper_width:'80mm'} }
  const nfce = {numero:'90',serie:'1',protocolo:'323260000240342',ambiente:'homologacao',chave:'1'.repeat(44),qrCodeUrl:'https://example.com/qrcode?p='+'1'.repeat(44)+'|2|2|token'}
  const normal = buildEscposReceipt(base)
  const fiscal = buildEscposReceipt({...base,nfce})
  const endBody = normal.indexOf('Pagamento: DEBITO') + 'Pagamento: DEBITO'.length
  assert.equal(fiscal.slice(0,endBody),normal.slice(0,endBody))
  assert.ok(fiscal.includes('SEM VALOR FISCAL'))
  assert.ok(fiscal.includes(nfce.protocolo))
  assert.ok(fiscal.includes(nfce.qrCodeUrl))
  assert.ok(fiscal.includes('\x1d(k\x03\x00\x31\x51\x30'))
  assert.equal((fiscal.match(/Sistema PopSystem/g)||[]).length,1)
  assert.ok(!buildEscposReceipt({...base,nfce,receipt_partial:true}).includes('CUPOM FISCAL'))
})

 test('assigned attendance ticket is stable in customer and kitchen copies without replacing order number', () => {
  const data = { order_number: 'PED987654', attendance_ticket: '001', ticket_code: true, items: [], total: 0 };
  for (const build of [buildEscposReceipt, buildEscposKitchenTicket]) {
    const result=readable(build(data));
    assert.match(result,/SENHA: 001/);
    assert.match(result,/987654/);
    assert.doesNotMatch(result,/SENHA: 7654/);
    assert.match(readable(build({...data, attendance_ticket:'10001'})),/SENHA: 10001/);
  }
 });


test('kitchen financial summary is opt-in, preserves zero totals and hides partial payment', () => {
  const order = { total: 14.99, payment_method: 'debit', items: [{ name: 'Pastel', quantity: 1 }] };
  assert.doesNotMatch(buildEscposKitchenTicket(order), /TOTAL DO PEDIDO|Pagamento:/);
  const enabled = buildEscposKitchenTicket({ ...order, kitchen_show_total_payment: true });
  assert.match(enabled, /TOTAL DO PEDIDO:/);
  assert.match(enabled, /14,99/);
  assert.match(enabled, /Pagamento: DEBITO/);
  assert.match(buildEscposKitchenTicket({ kitchen_show_total_payment: true, total: 0 }), /Pagamento: PENDENTE/);
  const partial = buildEscposKitchenTicket({ ...order, kitchen_show_total_payment: true, receipt_partial: true });
  assert.match(partial, /TOTAL DO PEDIDO:/);
  assert.doesNotMatch(partial, /Pagamento:/);
});
