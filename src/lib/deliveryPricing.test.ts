import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDeliveryFee } from './deliveryPricing';

test('usa delivery_fee retornado pela cotacao de frete', () => {
  assert.equal(resolveDeliveryFee({
    isDeliveryMode: true,
    showNeighborhoodSelect: false,
    storePricingMode: 'distance_km',
    deliveryQuote: { ok: true, zone: { delivery_fee: 8.75 } },
  }), 8.75);
});

test('usa delivery_fee configurado no frete fixo antes da cotacao', () => {
  assert.equal(resolveDeliveryFee({
    isDeliveryMode: true,
    showNeighborhoodSelect: false,
    storePricingMode: 'fixed',
    deliverySettings: { pricing: { fixed: { delivery_fee: '6,50' } } },
  }), 6.5);
});

test('usa a taxa do bairro selecionado e aceita valores numericos em texto', () => {
  assert.equal(resolveDeliveryFee({
    isDeliveryMode: true,
    showNeighborhoodSelect: true,
    deliveryZoneId: 'bairro-1',
    selectedZone: { delivery_fee: '12.30' },
    storePricingMode: 'neighborhood',
  }), 12.3);
});

test('mantem compatibilidade com o antigo campo fee', () => {
  assert.equal(resolveDeliveryFee({
    isDeliveryMode: true,
    showNeighborhoodSelect: false,
    storePricingMode: 'fixed',
    deliveryQuote: { ok: true, fee: 4 },
  }), 4);
});

test('preserva frete gratis calculado mesmo com campo legado preenchido', () => {
  assert.equal(resolveDeliveryFee({
    isDeliveryMode: true,
    showNeighborhoodSelect: false,
    storePricingMode: 'distance_km',
    deliveryQuote: { ok: true, fee: 9, zone: { delivery_fee: 0 } },
  }), 0);
});

test('retirada e modo de frete gratis nunca cobram taxa', () => {
  assert.equal(resolveDeliveryFee({
    isDeliveryMode: false,
    showNeighborhoodSelect: false,
    storePricingMode: 'fixed',
    deliverySettings: { pricing: { fixed: { delivery_fee: 10 } } },
  }), 0);
  assert.equal(resolveDeliveryFee({
    isDeliveryMode: true,
    showNeighborhoodSelect: false,
    storePricingMode: 'free',
    deliveryQuote: { ok: true, zone: { delivery_fee: 10 } },
  }), 0);
});
