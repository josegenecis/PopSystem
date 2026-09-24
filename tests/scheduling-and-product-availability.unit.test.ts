import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrderScheduleSlots, isScheduledOrderReady } from '../src/lib/orderScheduling';
import { isProductAvailableAt } from '../src/lib/productAvailability';

test('respeita os dias e horários configurados no produto', () => {
  const product = {
    availability_schedule: {
      enabled: true,
      days: [1],
      start_time: '11:00',
      end_time: '14:00',
    },
  };

  assert.equal(isProductAvailableAt(product, new Date(2026, 8, 21, 12, 0)), true);
  assert.equal(isProductAvailableAt(product, new Date(2026, 8, 21, 15, 0)), false);
  assert.equal(isProductAvailableAt(product, new Date(2026, 8, 22, 12, 0)), false);
});

test('mantém disponibilidade após meia-noite usando o dia em que o turno começou', () => {
  const product = {
    availability_schedule: {
      enabled: true,
      days: [6],
      start_time: '18:00',
      end_time: '02:00',
    },
  };

  assert.equal(isProductAvailableAt(product, new Date(2026, 8, 26, 23, 0)), true);
  assert.equal(isProductAvailableAt(product, new Date(2026, 8, 27, 1, 30)), true);
  assert.equal(isProductAvailableAt(product, new Date(2026, 8, 27, 3, 0)), false);
});

test('gera agendamentos somente dentro do expediente e após a antecedência', () => {
  const now = new Date(2026, 8, 21, 10, 10);
  const slots = buildOrderScheduleSlots({
    monday: { open: '10:00', close: '13:00' },
  }, {
    enabled: true,
    minimumLeadMinutes: 60,
    preparationLeadMinutes: 30,
    maximumAdvanceDays: 1,
    slotIntervalMinutes: 30,
  }, now);

  assert.deepEqual(slots.map((slot) => slot.timeLabel), ['11:30', '12:00', '12:30']);
});

test('só libera o pedido agendado no horário de preparação', () => {
  const now = new Date('2026-09-21T15:00:00.000Z');
  assert.equal(isScheduledOrderReady({
    scheduled_at: '2026-09-21T17:00:00.000Z',
    variations: { scheduledPreparationAt: '2026-09-21T16:30:00.000Z' },
  }, now), false);
  assert.equal(isScheduledOrderReady({
    scheduled_at: '2026-09-21T17:00:00.000Z',
    variations: { scheduledPreparationAt: '2026-09-21T14:30:00.000Z' },
  }, now), true);
});
