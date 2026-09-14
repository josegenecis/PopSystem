import type { PrinterTransport } from '@/services/printerConfig'

type BridgeResponse = {
  ok: boolean
  event?: string
  error?: string
  printer?: { connected?: boolean }
  scale?: {
    connected?: boolean
    config?: { portPath?: string }
    reading?: BridgeScaleReading | null
  }
  reading?: Partial<BridgeScaleReading>
}

export type BridgePrintResult = {
  available: boolean
  printerConnected: boolean
  printed: boolean
  error?: string
}

export type BridgeScaleReading = {
  weight: number
  unit: string
  stable: boolean
  readAt?: number
}

export type BridgeScaleResult = {
  available: boolean
  scaleConnected: boolean
  reading?: BridgeScaleReading
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
        // Ignore unrelated or malformed bridge messages while waiting for the expected event.
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

const openBridgeSocket = async (websocketUrl: string, timeoutMs: number) => {
  const ws = new WebSocket(websocketUrl)
  const opened = await new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => resolve(false), Math.min(3000, timeoutMs))
    ws.onopen = () => {
      window.clearTimeout(timeout)
      resolve(true)
    }
    ws.onerror = () => {
      window.clearTimeout(timeout)
      resolve(false)
    }
  })
  return { ws, opened }
}

const normalizeScaleReading = (reading?: Partial<BridgeScaleReading> | null): BridgeScaleReading | undefined => {
  const weight = Number(reading?.weight)
  if (!Number.isFinite(weight) || weight < 0) return undefined
  const readAt = Number(reading?.readAt)
  return {
    weight,
    unit: String(reading?.unit || 'kg'),
    stable: reading?.stable !== false,
    ...(Number.isFinite(readAt) && readAt > 0 ? { readAt } : {}),
  }
}

export const isRecentBridgeScaleReading = (
  reading?: Partial<BridgeScaleReading> | null,
  now = Date.now(),
  maxAgeMs = 2000,
) => {
  const normalized = normalizeScaleReading(reading)
  return Boolean(normalized?.readAt && now - normalized.readAt >= 0 && now - normalized.readAt <= maxAgeMs)
}

export const bridgeReadScaleWeight = async (params: {
  websocketUrl: string
  timeoutMs?: number
}): Promise<BridgeScaleResult> => {
  const timeoutMs = Math.max(1000, params.timeoutMs ?? 4000)
  const { ws, opened } = await openBridgeSocket(params.websocketUrl, timeoutMs)

  if (!opened) {
    try { ws.close() } catch { /* Socket did not finish opening. */ }
    return { available: false, scaleConnected: false, error: 'bridge_unavailable' }
  }

  let scaleConnected = false
  try {
    const status = await sendAndWait(ws, 'get_status', {}, 'status', timeoutMs)
    if (!status?.ok || !status?.scale?.connected) {
      return { available: true, scaleConnected: false, error: 'scale_not_connected' }
    }
    scaleConnected = true

    const statusReading = normalizeScaleReading(status.scale.reading)
    if (statusReading && statusReading.weight > 0 && isRecentBridgeScaleReading(statusReading)) {
      return { available: true, scaleConnected: true, reading: statusReading }
    }

    const response = await sendAndWait(
      ws,
      'read_weight',
      { timeoutMs: Math.max(1800, timeoutMs - 1000) },
      'weight_read',
      timeoutMs,
    )
    if (!response?.ok || !response?.reading) {
      return {
        available: true,
        scaleConnected: true,
        error: response?.error || 'scale_read_timeout',
      }
    }

    const reading = normalizeScaleReading(response.reading)
    if (!reading) {
      return { available: true, scaleConnected: true, error: 'invalid_scale_reading' }
    }

    return {
      available: true,
      scaleConnected: true,
      reading,
    }
  } catch (error: unknown) {
    return {
      available: true,
      scaleConnected,
      error: error instanceof Error ? error.message : 'bridge_command_failed',
    }
  } finally {
    try { ws.close() } catch { /* Connection cleanup is best effort. */ }
  }
}

export const bridgePrintReceipt = async (params: {
  websocketUrl: string
  transport: PrinterTransport
  address?: string
  payload: unknown
  timeoutMs?: number
}): Promise<BridgePrintResult> => {
  const timeoutMs = Math.max(1000, params.timeoutMs ?? 10000)
  const { ws, opened } = await openBridgeSocket(params.websocketUrl, timeoutMs)

  if (!opened) {
    try { ws.close() } catch { /* Socket did not finish opening. */ }
    return { available: false, printerConnected: false, printed: false, error: 'bridge_unavailable' }
  }

  try {
    const status = await sendAndWait(ws, 'get_status', {}, 'status', timeoutMs)
    const printerConnected = Boolean(status?.printer?.connected)

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
  } catch (error: unknown) {
    return {
      available: true,
      printerConnected: false,
      printed: false,
      error: error instanceof Error ? error.message : 'bridge_command_failed',
    }
  } finally {
    try { ws.close() } catch { /* Connection cleanup is best effort. */ }
  }
}
