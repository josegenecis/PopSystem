const RECOVERY_KEY = 'popsystem:chunk-recovery';
const RECOVERY_WINDOW_MS = 60_000;

export function isStaleChunkError(error: unknown): boolean {
  const candidate = error as { name?: unknown; message?: unknown; cause?: unknown } | null;
  const message = [candidate?.name, candidate?.message, candidate?.cause, error]
    .filter(Boolean)
    .map(String)
    .join(' ');

  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk .+ failed|not a valid JavaScript MIME type|Expected a JavaScript(?:-or-Wasm)? module script|MIME type.{0,80}(?:text\/html|application\/html)/i.test(message);
}

export async function recoverFromStaleChunk(error: unknown): Promise<boolean> {
  if (!isStaleChunkError(error)) return false;

  const previousAttempt = Number(sessionStorage.getItem(RECOVERY_KEY) || 0);
  if (Date.now() - previousAttempt < RECOVERY_WINDOW_MS) return false;
  sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('popsystem-')).map((key) => caches.delete(key)));
    }
  } finally {
    const url = new URL(window.location.href);
    url.searchParams.set('_app_version', String(Date.now()));
    window.location.replace(url.toString());
  }
  return true;
}
