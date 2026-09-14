import assert from 'node:assert/strict';
import test from 'node:test';
import { isRecentBridgeScaleReading } from './bridgePrinterClient';

test('accepts a current cached scale reading for instant PWA feedback', () => {
  assert.equal(isRecentBridgeScaleReading({ weight: 0.75, unit: 'kg', stable: true, readAt: 9_500 }, 10_000), true);
});

test('rejects old or invalid cached scale readings', () => {
  assert.equal(isRecentBridgeScaleReading({ weight: 0.75, unit: 'kg', stable: true, readAt: 7_000 }, 10_000), false);
  assert.equal(isRecentBridgeScaleReading({ weight: Number.NaN, unit: 'kg', stable: true, readAt: 9_900 }, 10_000), false);
});
