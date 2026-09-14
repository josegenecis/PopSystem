import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeOpenCashDrawer, bridgePrintReport, isRecentBridgeScaleReading } from './bridgePrinterClient';

test('accepts a current cached scale reading for instant PWA feedback', () => {
  assert.equal(isRecentBridgeScaleReading({ weight: 0.75, unit: 'kg', stable: true, readAt: 9_500 }, 10_000), true);
});

test('rejects old or invalid cached scale readings', () => {
  assert.equal(isRecentBridgeScaleReading({ weight: 0.75, unit: 'kg', stable: true, readAt: 7_000 }, 10_000), false);
  assert.equal(isRecentBridgeScaleReading({ weight: Number.NaN, unit: 'kg', stable: true, readAt: 9_900 }, 10_000), false);
});

test('sends the automatic dual-connector drawer command to Pop Connect', async () => {
  const sentMessages: Array<{ action: string; payload: unknown }> = [];

  class MockWebSocket {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private listeners = new Set<(event: { data: string }) => void>();

    constructor(_url: string) {
      queueMicrotask(() => this.onopen?.());
    }

    addEventListener(event: string, listener: (event: { data: string }) => void) {
      if (event === 'message') this.listeners.add(listener);
    }

    removeEventListener(event: string, listener: (event: { data: string }) => void) {
      if (event === 'message') this.listeners.delete(listener);
    }

    send(raw: string) {
      const message = JSON.parse(raw);
      sentMessages.push(message);
      queueMicrotask(() => {
        const response = JSON.stringify({ ok: true, event: 'cash_drawer_opened' });
        this.listeners.forEach((listener) => listener({ data: response }));
      });
    }

    close() {}
  }

  const originalWindow = (globalThis as any).window;
  const originalWebSocket = (globalThis as any).WebSocket;
  (globalThis as any).window = globalThis;
  (globalThis as any).WebSocket = MockWebSocket;

  try {
    assert.equal(await bridgeOpenCashDrawer({ websocketUrl: 'ws://localhost:8766' }), true);
    assert.deepEqual(sentMessages, [{ action: 'open_cash_drawer', payload: { connector: 'auto' } }]);
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).WebSocket = originalWebSocket;
  }
});

test('prints cash reports through Pop Connect without opening the browser dialog', async () => {
  const sentMessages: Array<{ action: string; payload: any }> = [];

  class MockWebSocket {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private listeners = new Set<(event: { data: string }) => void>();

    constructor(_url: string) { queueMicrotask(() => this.onopen?.()); }
    addEventListener(event: string, listener: (event: { data: string }) => void) {
      if (event === 'message') this.listeners.add(listener);
    }
    removeEventListener(event: string, listener: (event: { data: string }) => void) {
      if (event === 'message') this.listeners.delete(listener);
    }
    send(raw: string) {
      const message = JSON.parse(raw);
      sentMessages.push(message);
      const response = message.action === 'get_status'
        ? { ok: true, event: 'status', printer: { connected: true } }
        : { ok: true, event: 'printed_report' };
      queueMicrotask(() => this.listeners.forEach((listener) => listener({ data: JSON.stringify(response) })));
    }
    close() {}
  }

  const originalWindow = (globalThis as any).window;
  const originalWebSocket = (globalThis as any).WebSocket;
  (globalThis as any).window = globalThis;
  (globalThis as any).WebSocket = MockWebSocket;

  try {
    const result = await bridgePrintReport({
      websocketUrl: 'ws://localhost:8766',
      transport: 'system',
      payload: { title: 'Abertura de Caixa', lines: ['Valor inicial: R$ 100,00'] },
    });
    assert.equal(result.printed, true);
    assert.deepEqual(sentMessages.map((message) => message.action), ['get_status', 'print_report']);
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).WebSocket = originalWebSocket;
  }
});
