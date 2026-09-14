import {
  buildIfoodEventMetadata,
  buildIfoodBenefitsSummary,
  parseIfoodPaymentSummary,
} from './ifood.ts'

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nEsperado: ${JSON.stringify(expected)}\nRecebido: ${JSON.stringify(actual)}`)
  }
}

Deno.test('iFood: interpreta o objeto payments atual e preserva bandeira e troco', () => {
  const summary = parseIfoodPaymentSummary({
    prepaid: 25,
    pending: 35,
    methods: [
      {
        value: 25,
        type: 'ONLINE',
        method: 'CREDIT',
        card: { brand: 'VISA' },
      },
      {
        value: 35,
        type: 'OFFLINE',
        method: 'CASH',
        cash: { changeFor: 50 },
      },
    ],
  })

  assertEquals(summary.payment_method, 'cartao_credito', 'forma principal incorreta')
  assertEquals(summary.brand, 'VISA', 'bandeira não preservada')
  assertEquals(summary.change_amount, 50, 'troco não preservado')
  assertEquals(summary.prepaid, 25, 'valor pré-pago incorreto')
  assertEquals(summary.pending, 35, 'valor pendente incorreto')
  assertEquals(summary.methods.length, 2, 'múltiplas formas não preservadas')
})

Deno.test('iFood: identifica a responsabilidade financeira de cada benefício', () => {
  const summary = buildIfoodBenefitsSummary([
    {
      value: 10,
      target: 'CART',
      campaign: { name: 'Cupom de teste' },
      sponsorshipValues: [
        { name: 'IFOOD', value: 6, description: 'Subsídio iFood' },
        { name: 'MERCHANT', value: 4, description: 'Subsídio da loja' },
      ],
    },
  ])

  assertEquals(summary[0].description, 'Cupom de teste', 'descrição do benefício incorreta')
  assertEquals(summary[0].responsibility, 'iFood + Loja', 'responsáveis não identificados')
  assertEquals(summary[0].sponsorships.map((item: any) => item.value), [6, 4], 'valores dos subsídios incorretos')
})

Deno.test('iFood: mantém metadados canônicos ao registrar uma negociação', () => {
  const metadata = buildIfoodEventMetadata(
    {
      variations: {
        provider: 'ifood',
        externalOrderId: 'order-1',
        ifood: { deliveredBy: 'MERCHANT', legacyOnly: true },
      },
      integration_payload: {
        provider: 'ifood',
        ifood: { paymentSummary: { method: 'CREDIT' }, canonicalOnly: true },
      },
    },
    {
      id: 'event-1',
      fullCode: 'HANDSHAKE_DISPUTE',
      createdAt: '2026-09-03T12:00:00.000Z',
      metadata: { dispute: { id: 'dispute-1', alternatives: [{ type: 'ADDITIONAL_TIME' }] } },
    },
  )

  const expectedNegotiation = {
    id: 'dispute-1',
    alternatives: [{ type: 'ADDITIONAL_TIME' }],
    disputeId: 'dispute-1',
    status: 'OPEN',
    eventId: 'event-1',
    receivedAt: '2026-09-03T12:00:00.000Z',
  }

  for (const payload of [metadata.nextVariations.ifood, metadata.nextIntegrationPayload.ifood]) {
    assertEquals(payload.deliveredBy, 'MERCHANT', 'metadado legado de entrega foi perdido')
    assertEquals(payload.canonicalOnly, true, 'metadado canônico foi perdido')
    assertEquals(payload.paymentSummary, { method: 'CREDIT' }, 'resumo de pagamento foi perdido')
    assertEquals(payload.negotiation, expectedNegotiation, 'negociação não foi persistida integralmente')
  }
})
