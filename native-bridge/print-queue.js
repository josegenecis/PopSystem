const RECENT_SUCCESS_TTL_MS = 12 * 60 * 60 * 1000

export function createPrintQueue({ now = () => Date.now() } = {}) {
  let queue = Promise.resolve()
  const inFlight = new Map()
  const recentSuccess = new Map()

  const prune = () => {
    const cutoff = now() - RECENT_SUCCESS_TTL_MS
    for (const [key, printedAt] of recentSuccess) {
      if (printedAt < cutoff) recentSuccess.delete(key)
    }
  }

  const run = (job, options = {}) => {
    const key = String(options.key || '').trim()
    prune()
    if (key && recentSuccess.has(key)) return Promise.resolve({ ok: true, duplicate: true })
    if (key && inFlight.has(key)) return inFlight.get(key)

    const task = queue
      .catch(() => undefined)
      .then(async () => {
        const ok = Boolean(await job())
        if (ok && key) recentSuccess.set(key, now())
        return { ok, duplicate: false }
      })

    queue = task.then(() => undefined, () => undefined)
    if (key) {
      inFlight.set(key, task)
      task.finally(() => inFlight.delete(key))
    }
    return task
  }

  return { run }
}
