import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dequeuePendingOrderPrint,
  enqueuePendingOrderPrint,
  readPendingOrderPrintIds,
} from './orderPrintQueue';

const values = new Map<string, string>();

Object.defineProperty(globalThis, 'window', { value: {
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
} });

test.beforeEach(() => values.clear());

test('mantém pedidos pendentes sem duplicar identificadores', () => {
  enqueuePendingOrderPrint('restaurant-1', 'order-1');
  enqueuePendingOrderPrint('restaurant-1', 'order-1');
  enqueuePendingOrderPrint('restaurant-1', 'order-2');

  assert.deepEqual(readPendingOrderPrintIds('restaurant-1'), ['order-1', 'order-2']);
});

test('remove somente o pedido cuja impressão foi confirmada', () => {
  enqueuePendingOrderPrint('restaurant-1', 'order-1');
  enqueuePendingOrderPrint('restaurant-1', 'order-2');

  dequeuePendingOrderPrint('restaurant-1', 'order-1');

  assert.deepEqual(readPendingOrderPrintIds('restaurant-1'), ['order-2']);
});

test('ignora conteúdo local inválido sem quebrar o fluxo', () => {
  values.set('orders_auto_print_pending:restaurant-1', '{invalido');

  assert.deepEqual(readPendingOrderPrintIds('restaurant-1'), []);
});

test('limita a fila aos 100 pedidos mais recentes', () => {
  for (let index = 0; index < 105; index += 1) {
    enqueuePendingOrderPrint('restaurant-1', `order-${index}`);
  }

  const pending = readPendingOrderPrintIds('restaurant-1');
  assert.equal(pending.length, 100);
  assert.equal(pending[0], 'order-5');
  assert.equal(pending.at(-1), 'order-104');
});
