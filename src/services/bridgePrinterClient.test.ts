import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bridgeOpenCashDrawer,
  bridgePrintReport,
  bridgeReadScaleWeight,
  isBridgeScaleReadingFromRequest,
} from './bridgePrinterClient';

test('requires a scale reading produced after the PDV request', () => {
  assert.equal(
    isBridgeScaleReadingFromRequest(
      { weight: 0.75, unit: 'kg', stable: true, readAt: 9_999 },
      10_000,
      10_100,
    ),
    false,
  );
  assert.equal(
    isBridgeScaleReadingFromRequest(
      { weight: 0, unit: 'kg', stable: true, readAt: 10_001 },
      10_000,
      10_100,
    ),
    true,
  );
  assert.equal(
    isBridgeScaleReadingFromRequest(
      { weight: 0.75, unit: 'kg', stable: true, readAt: 10_001 },
      10_000,
      10_100,
    ),
    true,
  );
});

test('rejects the previous weight returned by an older Pop Connect', async () => {
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
      const response = message.action === 'get_status'
        ? { ok: true, event: 'status', scale: { connected: true } }
        : {
            ok: true,
            event: 'weight_read',
            cached: true,
            reading: { weight: 0.75, unit: 'kg', stable: true, readAt: Date.now() - 5000 },
          };
      queueMicrotask(() => this.listeners.forEach((listener) => listener({ data: JSON.stringify(response) })));
    }
    close() {}
  }

  const originalWindow = (globalThis as any).window;
  const originalWebSocket = (globalThis as any).WebSocket;
  (globalThis as any).window = globalThis;
  (globalThis as any).WebSocket = MockWebSocket;

  try {
    const result = await bridgeReadScaleWeight({ websocketUrl: 'ws://localhost:8766', timeoutMs: 2000 });
    assert.equal(result.reading, undefined);
    assert.equal(result.error, 'stale_scale_reading');
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).WebSocket = originalWebSocket;
  }
});

test('accepts a fresh zero reading so the PDV knows the scale is empty', async () => {
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
      const response = message.action === 'get_status'
        ? { ok: true, event: 'status', scale: { connected: true } }
        : {
            ok: true,
            event: 'weight_read',
            reading: { weight: 0, unit: 'kg', stable: true, readAt: Date.now() },
          };
      queueMicrotask(() => this.listeners.forEach((listener) => listener({ data: JSON.stringify(response) })));
    }
    close() {}
  }

  const originalWindow = (globalThis as any).window;
  const originalWebSocket = (globalThis as any).WebSocket;
  (globalThis as any).window = globalThis;
  (globalThis as any).WebSocket = MockWebSocket;

  try {
    const result = await bridgeReadScaleWeight({ websocketUrl: 'ws://localhost:8766', timeoutMs: 2000 });
    assert.equal(result.error, undefined);
    assert.equal(result.reading?.weight, 0);
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).WebSocket = originalWebSocket;
  }
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
