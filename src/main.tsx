import { createRoot } from 'react-dom/client'
import './index.css'
import { recoverFromStaleChunk } from './utils/chunkRecovery'

if (import.meta.env.PROD) {
  const noop = () => {};
  console.log = noop;
  console.debug = noop;
  console.info = noop;
}

// Global Error Handler for debugging white screens
window.addEventListener('error', (event) => {
  console.error('Global Error Caught:', event.error);
  // Optional: You could render a fallback UI directly into document.body here if React fails completely
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise Rejection:', event.reason);
});

// Service Worker: registrar sempre em produção para habilitar PWA
if ('serviceWorker' in navigator) {
  let reloadingForServiceWorkerUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForServiceWorkerUpdate) return;
    reloadingForServiceWorkerUpdate = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    (async () => {
      try {
        const res = await fetch('/sw.js', { cache: 'no-store' });
        if (!res.ok) {
          const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
          (regs || []).forEach((r) => r.unregister());
          return;
        }
        const reg = await navigator.serviceWorker.register('/sw.js');
        reg.update().catch(() => {});
      } catch {
        const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
        (regs || []).forEach((r) => r.unregister());
      }
    })();
  })
}

// Link de força para limpar SW/caches e recarregar automaticamente
(function() {
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('clear_sw') === '1') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {})
      }
      if ('caches' in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {})
      }
      url.searchParams.delete('clear_sw')
      url.searchParams.set('v', String(Date.now()))
      window.location.replace(url.toString())
    }
  } catch {
    // Ignore malformed URLs; the application can continue without cache cleanup.
  }
})();

const marketingPaths = new Set(['/', '/landing', '/termos', '/privacidade', '/lgpd', '/exclusao-de-dados']);
const mainDomains = new Set([
  'popsystem.com.br',
  'www.popsystem.com.br',
  'boracume.com',
  'www.boracume.com',
  'localhost',
  '127.0.0.1',
]);
const hostname = window.location.hostname;
const isMainDomain = mainDomains.has(hostname) || hostname.endsWith('.vercel.app');
const isDesktopRuntime = Boolean(window.electronAPI?.isElectron);

// Instalações antigas podem ter salvo "/" como URL inicial. Dentro do PWA,
// essa entrada deve abrir o fluxo operacional sem alterar a landing no navegador.
const isStandalonePwa = !isDesktopRuntime && (
  window.matchMedia('(display-mode: standalone)').matches
  || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
);
if (isMainDomain && isStandalonePwa && window.location.pathname === '/') {
  window.history.replaceState(window.history.state, '', '/pwa?source=installed');
}

const isMarketingEntry = !isDesktopRuntime && isMainDomain && marketingPaths.has(window.location.pathname);

const root = createRoot(document.getElementById('root')!);

void (isMarketingEntry ? import('./LandingApp.tsx') : import('./App.tsx'))
  .then(({ default: RootApp }) => {
    root.render(<RootApp />);
  })
  .catch(async (error) => {
    if (await recoverFromStaleChunk(error)) return;
    throw error;
  });
