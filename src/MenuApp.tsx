import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/toaster';
import MenuDigital from '@/pages/MenuDigital';

const menuQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

/**
 * Entrada dedicada ao cardapio publico. Evita baixar e inicializar os providers
 * do painel (assinatura, WhatsApp, hardware, caixa e notificacoes) no celular
 * do consumidor.
 */
export default function MenuApp() {
  return (
    <QueryClientProvider client={menuQueryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route path="/menu/:userId" element={<MenuDigital />} />
            <Route path="/menu-digital" element={<MenuDigital />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
