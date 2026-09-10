const probeBridge = async (websocketUrl: string, timeoutMs: number) => {
  return await new Promise<boolean>((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      resolve(ok)
    }

    let ws: WebSocket | null = null
    try {
      ws = new WebSocket(websocketUrl)
    } catch {
      finish(false)
      return
    }

    const timeout = window.setTimeout(() => {
      try { ws?.close() } catch {}
      finish(false)
    }, Math.max(200, timeoutMs))

    ws.onerror = () => {
      window.clearTimeout(timeout)
      try { ws?.close() } catch {}
      finish(false)
    }

    ws.onopen = () => {
      const onMessage = (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data)
          if (data?.event === 'connected' && data?.ok === true) {
            ws?.removeEventListener('message', onMessage)
            window.clearTimeout(timeout)
            try { ws?.close() } catch {}
            finish(true)
          }
        } catch {
        }
      }
      ws!.addEventListener('message', onMessage)
    }
  })
}

export const discoverBridgeWebsocketUrl = async (opts?: { timeoutMs?: number }) => {
  const timeoutMs = opts?.timeoutMs ?? 800
  const candidates = [
    'ws://localhost:8766',
    'ws://127.0.0.1:8766',
    'ws://pop-connect.local:8766',
    'ws://boracume-bridge.local:8766',
    'ws://bridge.local:8766',
  ]

  for (const url of candidates) {
    const ok = await probeBridge(url, timeoutMs)
    if (ok) return url
  }
  return ''
}
