import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCashCloseRevenue } from './cashClose';

test('não reaplica desconto e entrega sobre o total final dos pedidos', () => {
  const summary = summarizeCashCloseRevenue([{
    total: 1950.39,
    discount: 1.5,
    delivery_fee: 64,
  }]);

  assert.deepEqual(summary, {
    grossRevenue: 1887.89,
    discounts: 1.5,
    deliveryFee: 64,
    surcharge: 0,
    netRevenue: 1950.39,
  });
});

test('separa acréscimos registrados nas variações financeiras', () => {
  const summary = summarizeCashCloseRevenue([
    { total: 115, discount: 5, delivery_fee: 10, variations: { financial_adjustments: { surcharge: 10 } } },
    { total: 52.5, variations: JSON.stringify({ financial_adjustments: { surcharge: 2.5 } }) },
  ]);

  assert.deepEqual(summary, {
    grossRevenue: 150,
    discounts: 5,
    deliveryFee: 10,
    surcharge: 12.5,
    netRevenue: 167.5,
  });
});
