import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Analytics } from '@vercel/analytics/react';
import LandingPage from '@/pages/LandingPage';
import { lazyWithChunkRecovery } from '@/utils/lazyWithChunkRecovery';

const LegalPage = lazyWithChunkRecovery(() => import('@/pages/LegalPage'));

export default function LandingApp() {
  return (
    <HelmetProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/termos" element={<Suspense fallback={<div className="min-h-screen bg-[#f6f8f4]" />}><LegalPage /></Suspense>} />
          <Route path="/privacidade" element={<Suspense fallback={<div className="min-h-screen bg-[#f6f8f4]" />}><LegalPage /></Suspense>} />
          <Route path="/lgpd" element={<Suspense fallback={<div className="min-h-screen bg-[#f6f8f4]" />}><LegalPage /></Suspense>} />
          <Route path="/exclusao-de-dados" element={<Suspense fallback={<div className="min-h-screen bg-[#f6f8f4]" />}><LegalPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Analytics />
    </HelmetProvider>
  );
}
