import { useEffect, useState, useRef } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AuthForm from '@/components/auth/AuthForm';
import { debugLogger } from '@/utils/debugLogger';
import { getLocalOperatorSession, getOperatorPathForRequestedPath } from '@/services/operatorAuth';
import { BadgeCheck, Cloud, Headphones, LockKeyhole, ShieldCheck, Zap } from 'lucide-react';

const creativeAsset = (fileName: string) =>
  `${import.meta.env.BASE_URL}CRIATIVOS/${encodeURIComponent(fileName)}`;

const loginVisuals = {
  logo: creativeAsset('Logo pop.png'),
  mascot: creativeAsset('mascote-login-transparente.png'),
};

const securityHighlights = [
  {
    icon: ShieldCheck,
    title: 'Acesso seguro',
    description: 'Seus dados e do seu restaurante protegidos',
  },
  {
    icon: Cloud,
    title: '100% em nuvem',
    description: 'Acesse de qualquer lugar, a qualquer hora',
  },
  {
    icon: Zap,
    title: 'Performance e agilidade',
    description: 'Sistema rápido, moderno e sempre atualizado',
  },
  {
    icon: Headphones,
    title: 'Suporte especializado',
    description: 'Conte com nosso time sempre que precisar',
  },
];

const Login = () => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const authTab = new URLSearchParams(location.search).get('tab') === 'register' ? 'register' : 'login';
  const [activeAuthTab, setActiveAuthTab] = useState<'login' | 'register'>(authTab);
  const [redirecting, setRedirecting] = useState(false);
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    setActiveAuthTab(authTab);
  }, [authTab]);

  useEffect(() => {
    const search = new URLSearchParams(location.search || '');
    const code = search.get('code') || '';
    const typeFromQuery = search.get('type') || '';
    const hash = window.location.hash || '';
    const isRecovery =
      typeFromQuery.toLowerCase() === 'recovery' ||
      /type=recovery/i.test(hash) ||
      /recovery/i.test(hash) ||
      (code && /recovery/i.test(location.search || ''));
    if (isRecovery) {
      navigate(`/reset-password${location.search || ''}${hash || ''}`, { replace: true });
    }
  }, [location.search, navigate]);

  // Obter destino do redirecionamento
  const requestedPathname = location.state?.from?.pathname || '/dashboard';
  const requestedSearch = location.state?.from?.search || '';
  const requestedFrom = `${requestedPathname}${requestedSearch}`;
  // Convites de loja precisam terminar o aceite antes da identificação do
  // operador. Passar essa rota pelo resolvedor de operador descartava o token.
  const from = requestedPathname === '/lojas/convite'
    ? requestedFrom
    : getOperatorPathForRequestedPath(getLocalOperatorSession(), requestedFrom);

  useEffect(() => {
    isMountedRef.current = true;

    debugLogger.auth('login_page_state', {
      hasUser: !!user,
      isLoading,
      redirecting,
      from
    });

    // Se não está carregando e tem usuário, redirecionar
    if (!isLoading && user && !redirecting) {
      console.log('🔄 [LOGIN] Usuário logado - iniciando redirecionamento para:', from);
      setRedirecting(true);

      // Debounce no redirecionamento para evitar loops
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }

      redirectTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          console.log('✅ [LOGIN] Executando redirecionamento para:', from);
          navigate(from, { replace: true });
        }
      }, 50); // Delay REDUZIDO para 50ms para evitar race conditions
    }

    // Se não tem usuário e não está carregando, resetar estado de redirecionamento
    if (!isLoading && !user && redirecting) {
      console.log('🔄 [LOGIN] Resetando estado de redirecionamento');
      setRedirecting(false);
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
    }

    return () => {
      isMountedRef.current = false;
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
    };
  }, [user, isLoading, navigate, from, redirecting]);

  // Cleanup no unmount
  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  // A verificação inicial da sessão nunca deve esconder o formulário. Em
  // navegadores com várias abas, o lock do Auth pode levar alguns segundos.
  if (redirecting) {
    console.log('⏳ [LOGIN] Exibindo spinner:', { isLoading, redirecting });
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <span className="mx-auto mb-4 block h-2.5 w-2.5 animate-pulse rounded-full bg-[#25d366]" />
          <p className="text-gray-600 text-sm">
            Abrindo seu painel…
          </p>
        </div>
      </div>
    );
  }

  // Se tem usuário mas não está redirecionando ainda, usar Navigate como fallback
  if (user && !redirecting) {
    console.log('🔄 [LOGIN] Fallback - redirecionamento direto para:', from);
    return <Navigate to={from} replace />;
  }

  const isRegistering = activeAuthTab === 'register';

  // Renderizar formulário de login
  console.log('📝 [LOGIN] Renderizando formulário de login');
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#F2F5EF] px-3 py-3 font-sora sm:px-5 sm:py-5 lg:px-8 lg:py-6">
      <div className="pointer-events-none absolute -left-28 top-1/4 h-80 w-80 rounded-full bg-[#9BD14B]/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-[#FF6400]/10 blur-3xl" />

      <div className="relative mx-auto grid min-h-[calc(100vh-1.5rem)] w-full max-w-[1320px] overflow-hidden rounded-[30px] border border-white/80 bg-white shadow-[0_32px_100px_-50px_rgba(0,50,35,0.48)] sm:min-h-[calc(100vh-2.5rem)] lg:grid-cols-2 lg:rounded-[28px]">
        <section className="relative isolate flex min-h-[650px] flex-col overflow-hidden bg-[#033B2C] px-7 py-8 text-white sm:min-h-[760px] sm:px-10 sm:py-10 lg:min-h-[760px] lg:px-14 lg:py-12 xl:px-20">
          <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_78%_18%,rgba(40,176,91,0.18),transparent_27%),radial-gradient(circle_at_20%_70%,rgba(0,120,78,0.22),transparent_34%),linear-gradient(145deg,#023527_0%,#043D2D_54%,#012A20_100%)]" />
          <div className="pointer-events-none absolute -right-20 -top-24 -z-10 h-72 w-72 rotate-[40deg] rounded-[34px] bg-white/[0.025]" />
          <div className="pointer-events-none absolute -bottom-[10%] -left-[22%] z-0 h-[29%] w-[148%] -rotate-[7deg] rounded-[50%] border-t-[10px] border-[#FF6A00] bg-[#064733]" />

          <img
            src={loginVisuals.logo}
            alt="PopSystem"
            className="relative z-20 -ml-9 h-auto w-[280px] sm:w-[300px]"
            decoding="async"
          />

          <div className="relative z-20 mt-6 max-w-[470px]">
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-sm">
              Sistema completo para restaurantes
            </div>
            <h1 className="mt-4 text-[32px] font-bold leading-[1.12] tracking-[-0.04em] sm:text-[38px] lg:text-[40px]">
              Gestão inteligente,<br />
              restaurantes <span className="text-[#43C452]">lucrativos.</span>
            </h1>
            <p className="mt-3 max-w-[440px] text-sm leading-6 text-white/82 sm:text-[15px]">
              Controle pedidos, financeiro, estoque, mesas,<br className="hidden sm:block" /> delivery e muito mais em um só lugar.
            </p>
          </div>

          <div className="relative z-30 mt-7 ml-auto hidden w-[57%] flex-col gap-3 sm:flex lg:mt-8">
            {securityHighlights.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#008C43]/45 text-[#81F06A] shadow-[inset_0_0_0_1px_rgba(129,240,106,0.05)]">
                  <Icon className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold leading-5 text-white">{title}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-white/75">{description}</div>
                </div>
              </div>
            ))}
          </div>

          <img
            src={loginVisuals.mascot}
            alt="Mascote PopSystem"
            className="pointer-events-none absolute -bottom-6 -left-7 z-20 h-[350px] w-auto max-w-none object-contain sm:-bottom-10 sm:-left-11 sm:h-[470px] lg:-left-10"
            loading="eager"
            decoding="async"
          />

          <div className="absolute bottom-7 right-7 z-30 hidden w-[270px] items-start gap-3 rounded-2xl border border-white/15 bg-white/[0.075] px-5 py-4 shadow-[0_18px_40px_-26px_rgba(0,0,0,0.75)] backdrop-blur-sm sm:flex lg:right-10 xl:right-14">
            <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-[#82EB69]" />
            <div>
              <div className="text-xs font-bold text-white">Acesso restrito</div>
              <div className="mt-1 text-[11px] leading-4 text-white/72">
                Somente usuários autorizados podem entrar no sistema.
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-w-0 items-center bg-white px-5 py-9 sm:px-10 sm:py-12 lg:px-12 xl:px-16">
          <div className="mx-auto w-full max-w-[510px]">
            <div className="mb-7">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#EF6C20]">
                {isRegistering ? 'Comece agora' : 'Acesso administrativo'}
              </div>
              <h2 className="mt-2 text-3xl font-bold tracking-[-0.035em] text-[#082F23] sm:text-[38px]">
                {isRegistering ? 'Crie sua conta' : 'Bem-vindo de volta'}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-500 sm:text-base">
                {isRegistering
                  ? 'Cadastre seu restaurante e dê o primeiro passo para uma operação mais simples.'
                  : 'Entre com os dados da conta responsável pelo restaurante.'}
              </p>
            </div>

            <AuthForm
              key={authTab}
              defaultTab={authTab}
              embedded
              onTabChange={setActiveAuthTab}
            />

            <div className="mt-7 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-xs text-slate-400">
              <BadgeCheck className="h-4 w-4 text-[#6CA936]" />
              Seus dados são protegidos com acesso seguro.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default Login;
