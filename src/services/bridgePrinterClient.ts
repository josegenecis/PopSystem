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

export const isBridgeScaleReadingFromRequest = (
  reading: Partial<BridgeScaleReading> | null | undefined,
  requestedAt: number,
  now = Date.now(),
) => {
  const normalized = normalizeScaleReading(reading)
  return Boolean(
    normalized?.readAt &&
    normalized.readAt >= requestedAt &&
    normalized.readAt <= now + 1000
  )
}

export const bridgeReadScaleWeight = async (params: {
  websocketUrl: string
  timeoutMs?: number
}): Promise<BridgeScaleResult> => {
  // O teste do Pop Connect aguarda 2,5 s pela resposta serial. O PDV não pode
  // encerrar a mesma leitura antes disso, nem disputar o mesmo limite com a
  // resposta WebSocket que transporta o resultado.
  const scaleTimeoutMs = Math.max(2500, params.timeoutMs ?? 2500)
  const socketTimeoutMs = Math.max(4000, scaleTimeoutMs + 1000)
  const { ws, opened } = await openBridgeSocket(params.websocketUrl, socketTimeoutMs)

  if (!opened) {
    try { ws.close() } catch { /* Socket did not finish opening. */ }
    return { available: false, scaleConnected: false, error: 'bridge_unavailable' }
  }

  let scaleConnected = false
  try {
    const status = await sendAndWait(ws, 'get_status', {}, 'status', socketTimeoutMs)
    if (!status?.ok || !status?.scale?.connected) {
      return { available: true, scaleConnected: false, error: 'scale_not_connected' }
    }
    scaleConnected = true

    const requestedAt = Date.now()
    const response = await sendAndWait(
      ws,
      'read_weight',
      { timeoutMs: scaleTimeoutMs },
      'weight_read',
      socketTimeoutMs,
    )
    if (!response?.ok || !response?.reading) {
      return {
        available: true,
        scaleConnected: true,
        error: response?.error || 'scale_read_timeout',
      }
    }

    const reading = normalizeScaleReading(response.reading)
    if (!reading || !isBridgeScaleReadingFromRequest(reading, requestedAt)) {
      return { available: true, scaleConnected: true, error: 'stale_scale_reading' }
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
  route?: 'receipt' | 'kitchen' | 'bar' | 'service'
  template?: 'receipt' | 'kitchen_ticket'
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

    const basePayload = params.payload && typeof params.payload === 'object' ? params.payload as Record<string, unknown> : {}
    const printed = await sendAndWait(ws, 'print_receipt', {
      ...basePayload,
      print_route: params.route || 'receipt',
      print_template: params.template || 'receipt',
      printer: {
        transport: params.transport,
        address: params.address || '',
      },
    }, 'printed_receipt', timeoutMs)
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

export const bridgePrintReport = async (params: {
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
      if (!address) return { available: true, printerConnected: false, printed: false, error: 'printer_not_configured' }
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

    const printed = await sendAndWait(ws, 'print_report', params.payload, 'printed_report', timeoutMs)
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

export const bridgeOpenCashDrawer = async (params: {
  websocketUrl: string
  timeoutMs?: number
}): Promise<boolean> => {
  const timeoutMs = Math.max(1000, params.timeoutMs ?? 5000)
  const { ws, opened } = await openBridgeSocket(params.websocketUrl, timeoutMs)

  if (!opened) {
    try { ws.close() } catch { /* Socket did not finish opening. */ }
    return false
  }

  try {
    const result = await sendAndWait(
      ws,
      'open_cash_drawer',
      { connector: 'auto' },
      'cash_drawer_opened',
      timeoutMs,
    )
    return !!result?.ok
  } catch {
    return false
  } finally {
    try { ws.close() } catch { /* Connection cleanup is best effort. */ }
  }
}
