import type { PrinterTransport } from '@/services/printerConfig'

type BridgeResponse =
  | { ok: boolean; event?: string; error?: string }
  | { ok: boolean; error: string }

export type BridgePrintResult = {
  available: boolean
  printerConnected: boolean
  printed: boolean
  error?: string
}

const waitForEvent = (ws: WebSocket, event: string, timeoutMs: number) => {
  return new Promise<BridgeResponse>((resolve) => {
    const timeout = window.setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      resolve({ ok: false, error: 'timeout' })
    }, timeoutMs)

    const onMessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data)
        if (data?.event === event) {
          window.clearTimeout(timeout)
          ws.removeEventListener('message', onMessage)
          resolve(data)
        }
      } catch {
      }
    }

    ws.addEventListener('message', onMessage)
  })
}

const sendAndWait = (
  ws: WebSocket,
  action: string,
  payload: unknown,
  event: string,
  timeoutMs: number,
) => {
  const response = waitForEvent(ws, event, timeoutMs)
  ws.send(JSON.stringify({ action, payload }))
  return response
}

export const bridgePrintReceipt = async (params: {
  websocketUrl: string
  transport: PrinterTransport
  address?: string
  payload: any
  timeoutMs?: number
}): Promise<BridgePrintResult> => {
  const timeoutMs = Math.max(1000, params.timeoutMs ?? 10000)
  const ws = new WebSocket(params.websocketUrl)

  const opened = await new Promise<boolean>((resolve) => {
    const t = window.setTimeout(() => resolve(false), Math.min(3000, timeoutMs))
    ws.onopen = () => {
      window.clearTimeout(t)
      resolve(true)
    }
    ws.onerror = () => {
      window.clearTimeout(t)
      resolve(false)
    }
  })

  if (!opened) {
    try { ws.close() } catch {}
    return { available: false, printerConnected: false, printed: false, error: 'bridge_unavailable' }
  }

  try {
    const status = await sendAndWait(ws, 'get_status', {}, 'status', timeoutMs)
    const printerConnected = Boolean((status as any)?.printer?.connected)

    if (!printerConnected) {
      const address = String(params.address || '').trim()
      if (!address) {
        return { available: true, printerConnected: false, printed: false, error: 'printer_not_configured' }
      }

      const connected = await sendAndWait(
        ws,
        'connect_printer',
        { transport: params.transport, address },
        'printer_connected',
        timeoutMs,
      )
      if (!connected?.ok) {
        return { available: true, printerConnected: false, printed: false, error: connected?.error || 'printer_connection_failed' }
      }
    }

    const printed = await sendAndWait(ws, 'print_receipt', params.payload, 'printed_receipt', timeoutMs)
    return {
      available: true,
      printerConnected: true,
      printed: !!printed?.ok,
      error: printed?.ok ? undefined : printed?.error || 'print_failed',
    }
  } catch (error: any) {
    return {
      available: true,
      printerConnected: false,
      printed: false,
      error: error?.message || 'bridge_command_failed',
    }
  } finally {
    try { ws.close() } catch {}
  }
}
