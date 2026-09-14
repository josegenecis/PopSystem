import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Clock3, CreditCard, Loader2, ShieldAlert } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SubscriptionAccessState {
  allowed: boolean;
  reason: string;
  trial_end?: string | null;
  current_period_end?: string | null;
  access_override_until?: string | null;
}

const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/reset-password',
  '/landing',
  '/auth/callback',
  '/subscription',
  '/menu',
  '/menu-digital',
  '/checklist',
  '/totem',
  '/track',
  '/mp',
  '/waiter-login',
  '/waiter-dashboard',
  '/waiter-session',
  '/funcionario-login',
  '/funcionario-ponto',
  '/operator-login',
];

const isPublicRoute = (pathname: string) => {
  if (pathname === '/') return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
};

const LicenseExpiredLock: React.FC = () => {
  const { accountUser, loading, subscription, refreshSubscription } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [accessState, setAccessState] = useState<SubscriptionAccessState | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState('');

  const refreshAccess = useCallback(async () => {
    if (!accountUser) {
      setAccessState(null);
      return;
    }
    const { data, error } = await (supabase as any).rpc('get_my_subscription_access_state');
    if (error) {
      console.error('[LICENSE] Não foi possível validar a assinatura:', error);
      return;
    }
    setAccessState(data as SubscriptionAccessState);
  }, [accountUser]);

  useEffect(() => {
    void refreshAccess();
    if (!accountUser) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshAccess();
    };
    // A situação também é atualizada ao voltar para a aba/janela. Cinco
    // minutos aqui servem apenas como contingência e evitam consultar o banco
    // a cada 15 segundos em todas as telas abertas.
    const interval = window.setInterval(() => void refreshAccess(), 5 * 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [accountUser, refreshAccess, subscription?.status, subscription?.trial_end, subscription?.current_period_end, subscription?.access_override_until]);

  const shouldBlock = !loading
    && Boolean(accountUser)
    && accessState?.allowed === false
    && !isPublicRoute(location.pathname);

  if (!shouldBlock) return null;

  const releaseFor24Hours = async () => {
    if (releasing) return;
    try {
      setReleasing(true);
      setReleaseError('');
      const { data, error } = await (supabase as any).rpc('request_my_subscription_temporary_release');
      if (error) throw error;
      if (!data?.ok) throw new Error('Não foi possível confirmar a liberação temporária.');
      setAccessState((current) => ({
        ...(current || { reason: 'temporary_release' }),
        allowed: true,
        reason: 'temporary_release',
        access_override_until: data.access_until || current?.access_override_until || null,
      }));
      await Promise.all([refreshAccess(), refreshSubscription()]);
      toast({
        title: 'Sistema liberado por 24 horas',
        description: 'Aproveite este período para realizar o pagamento e evitar um novo bloqueio.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Realize o pagamento para continuar.';
      setReleaseError(message);
      toast({
        title: 'Não foi possível liberar por 24 horas',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setReleasing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex min-h-screen items-center justify-center bg-[#062d22]/95 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-[520px] overflow-hidden rounded-[28px] border border-white/15 bg-white shadow-2xl">
        <div className="bg-gradient-to-br from-[#063f30] via-[#075640] to-[#0b6b4f] px-7 py-8 text-white">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/14 ring-1 ring-white/20">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#bdeaa3]">Acesso temporariamente bloqueado</p>
          <h1 className="mt-3 text-3xl font-black leading-tight">Pagamento necessário</h1>
          <p className="mt-3 text-base font-medium leading-relaxed text-white/86">
            O período desta conta terminou. Regularize a mensalidade para continuar usando o PopSystem.
          </p>
        </div>

        <div className="space-y-5 px-7 py-7">
          <div className="rounded-2xl border border-[#e7dfd2] bg-[#fffaf2] p-4 text-sm font-semibold leading-relaxed text-[#234438]">
            Escolha um plano e realize o pagamento agora ou use a liberação única de 24 horas disponível para este vencimento.
          </div>

          <a
            href="/subscription?choosePlan=1#planos"
            onClick={(event) => {
              event.preventDefault();
              navigate('/subscription?choosePlan=1#planos');
            }}
            className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#8acb35] px-5 text-base font-black text-[#103b2d] shadow-lg shadow-[#8acb35]/25 transition hover:bg-[#9bdc47] focus:outline-none focus:ring-4 focus:ring-[#8acb35]/30"
          >
            <CreditCard className="h-5 w-5" />
            Realizar pagamento
          </a>

          <button
            type="button"
            onClick={() => void releaseFor24Hours()}
            disabled={releasing}
            className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#087a55] px-5 text-base font-black text-white shadow-lg shadow-[#087a55]/25 transition hover:bg-[#096b4d] focus:outline-none focus:ring-4 focus:ring-[#087a55]/30 disabled:cursor-wait disabled:opacity-70"
          >
            {releasing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Clock3 className="h-5 w-5" />}
            {releasing ? 'Liberando sistema...' : 'Liberar sistema por 24h'}
          </button>

          {releaseError && (
            <div role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold leading-relaxed text-red-800">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{releaseError}</span>
            </div>
          )}

          <p className="text-center text-xs font-semibold leading-relaxed text-[#6b7f78]">
            A liberação temporária pode ser utilizada somente uma vez por vencimento.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LicenseExpiredLock;
