import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSaleQuantity, normalizeSaleUnit } from './saleQuantity';

test('mostra itens unitarios com multiplicador', () => {
  assert.equal(formatSaleQuantity(2, 'un'), '2x');
});

test('mostra fracao de quilo em gramas', () => {
  assert.equal(formatSaleQuantity(0.3, 'kg'), '300 g');
});

test('mostra pesos acima de um quilo sem perder precisao', () => {
  assert.equal(formatSaleQuantity(1.25, 'kg'), '1,250 kg');
});

test('unidade desconhecida permanece compatível com produtos por unidade', () => {
  assert.equal(normalizeSaleUnit(undefined), 'un');
});
