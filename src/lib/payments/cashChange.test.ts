import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCashReceiptAmounts } from './cashChange';

test('recovers the received amount from older PDV orders', () => {
  assert.deepEqual(resolveCashReceiptAmounts({
    total: 30,
    change_amount: 70,
    variations: {
      payment_split: {
        cash_received: 100,
        change_amount: 70,
      },
    },
  }), { cashReceived: 100, change: 70 });
});

test('calculates change for legacy orders that store the amount received', () => {
  assert.deepEqual(resolveCashReceiptAmounts({
    total: 30,
    change_amount: 100,
  }), { cashReceived: 100, change: 70 });
});

test('uses the explicit change for split payments', () => {
  assert.deepEqual(resolveCashReceiptAmounts({
    total: 130,
    change_amount: 100,
    variations: {
      payment_split: {
        cash_received: 100,
        change_amount: 20,
      },
    },
  }), { cashReceived: 100, change: 20 });
});
