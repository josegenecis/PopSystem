import assert from 'node:assert/strict';
import test from 'node:test';
import { fillWhatsAppQuickReply, isPossiblePaymentReceipt, latestDeliveryStatus, minutesUntilTomorrow, normalizeSuggestedProductSearch, orderItemSuggestions } from './whatsappCentral';

test('preenche respostas rápidas apenas com dados fornecidos', () => {
  const result = fillWhatsAppQuickReply('Oi {{cliente_nome}}, pedido {{pedido_numero}}: {{link_cardapio}}', {
    customerName: 'Ana', orderNumber: '123', menuLink: 'https://menu/loja',
  });
  assert.equal(result, 'Oi Ana, pedido 123: https://menu/loja');
});

test('não inventa prazo ausente', () => {
  assert.equal(fillWhatsAppQuickReply('Prazo: {{tempo_entrega}}', {}), 'Prazo: a confirmar');
});

test('extrai itens reais do pedido para revisão no PDV', () => {
  assert.deepEqual(orderItemSuggestions([{ quantity: 2, product_name: 'X-Bacon' }, { qty: 1, product: { name: 'Suco' } }]), ['2x X-Bacon', '1x Suco']);
  assert.deepEqual(orderItemSuggestions(null), []);
});

test('remove quantidade da busca inicial do PDV', () => {
  assert.equal(normalizeSuggestedProductSearch('2x X-Bacon'), 'X-Bacon');
});

test('confirmação atrasada não regride mensagem lida', () => {
  assert.equal(latestDeliveryStatus('read', 'sent'), 'read');
  assert.equal(latestDeliveryStatus('sent', 'delivered'), 'delivered');
});

test('calcula pausa até as 8h do dia seguinte', () => {
  assert.equal(minutesUntilTomorrow(new Date('2026-09-12T20:30:00-03:00')), 690);
});

test('sinaliza possível comprovante sem alterar pagamento', () => {
  assert.equal(isPossiblePaymentReceipt({ message_type: 'image', content: 'Segue o comprovante do PIX' }), true);
  assert.equal(isPossiblePaymentReceipt({ message_type: 'image', content: 'Foto do endereço' }), false);
  assert.equal(isPossiblePaymentReceipt({ message_type: 'document', content: 'comprovante' }), false);
});
