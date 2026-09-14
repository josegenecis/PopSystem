import React, { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logSecurityEvent, logSignupEvent } from '@/utils/securityLogger';
import { debugLogger } from '@/utils/debugLogger';
import { debugSystem, measurePerformance, debugLog } from '@/utils/debugSystem';

import { 
  SessionCache, 
  UserCache, 
  ProfileCache, 
  SubscriptionCache, 
  SyncCache, 
  clearAllCache 
} from '@/utils/session-cache';
import { logOAuthSessionCreated, logOAuthSessionDestroyed, logOAuthUserSync } from '../utils/oauth-security-logger';
import { validateOAuthUser, validateProfileData } from '@/utils/oauth-validation';
import { startTokenAutoRefresh, stopTokenAutoRefresh, checkAndRefreshToken } from '@/utils/token-refresh';


interface Profile {
  id: string;
  restaurant_name?: string;
  description?: string;
  phone?: string;
  owner_phone?: string;
  address?: string;
  opening_hours?: string;
  logo_url?: string;
  delivery_fee?: number;
  minimum_order?: number;
  onboarding_completed?: boolean;
  email?: string;
  website?: string;
  created_at: string;
  updated_at: string;
}

interface Subscription {
  id: string;
  user_id: string;
  status: string;
  plan_id?: number;
  trial_start?: string;
  trial_end?: string;
  current_period_start?: string;
  current_period_end?: string;
  store_count?: number;
  billing_cycle?: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
  billing_months?: number;
  billing_discount_percent?: number;
  billing_amount?: number;
  installment_count?: number;
  payment_method?: 'PIX' | 'CREDIT_CARD' | null;
  asaas_environment?: 'sandbox' | 'production';
  billing_exempt?: boolean;
  access_override_until?: string | null;
  access_override_granted_at?: string | null;
  access_override_granted_for_period_end?: string | null;
  access_override_granted_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoreAccess {
  network_id: string | null;
  network_name: string;
  store_user_id: string;
  store_name: string;
  store_email: string | null;
  is_primary: boolean;
  store_status: 'active' | 'suspended';
  billing_owner_id: string;
  can_manage: boolean;
}

interface AuthContextType {
  user: User | null;
  accountUser: User | null;
  session: Session | null;
  profile: Profile | null;
  subscription: Subscription | null;
  subscriptionLoading: boolean;
  loading: boolean;
  isLoading: boolean;
  stores: StoreAccess[];
  activeStore: StoreAccess | null;
  activeStoreId: string | null;
  billingOwnerId: string | null;
  canManageStores: boolean;
  storesLoading: boolean;
  switchStore: (storeUserId: string) => Promise<void>;
  refreshStores: () => Promise<void>;
  signOut: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, restaurantName: string, ownerPhone: string, ownerName: string) => Promise<void>;
  refreshSubscription: () => Promise<void>;
  refreshUser: () => Promise<void>;
  syncGoogleUserData: (googleUser: any) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Circuit breaker para evitar múltiplas inicializações
let initializationInProgress = false;
let initializationPromise: Promise<void> | null = null;

const withAuthTimeout = async <T,>(promise: PromiseLike<T>, timeoutMs = 5000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tempo limite ao carregar a sessão da loja.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const readCachedAuthSession = (): Session | null => {
  if (typeof window === 'undefined') return null;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
      const stored = window.localStorage.getItem(key);
      if (!stored) continue;
      const parsed = JSON.parse(stored);
      const candidate = parsed?.currentSession || parsed;
      const expiresAt = Number(candidate?.expires_at || 0);
      const isUsable = !expiresAt || expiresAt > Math.floor(Date.now() / 1000) - 60;
      if (candidate?.access_token && candidate?.user?.id && isUsable) return candidate as Session;
    }
  } catch (error) {
    console.warn('[AUTH] Sessão local inválida; seguindo com validação normal.', error);
  }
  return null;
};

const initialCachedSession = readCachedAuthSession();
const cachedSubscription = initialCachedSession?.user ? SubscriptionCache.getSubscription() : null;
const initialCachedSubscription = cachedSubscription?.user_id === initialCachedSession?.user?.id
  ? cachedSubscription
  : null;

const buildFallbackStore = (authenticatedUser: User): StoreAccess => ({
  network_id: null,
  network_name: String(authenticatedUser.user_metadata?.restaurant_name || 'Meu restaurante'),
  store_user_id: authenticatedUser.id,
  store_name: String(authenticatedUser.user_metadata?.restaurant_name || 'Meu restaurante'),
  store_email: authenticatedUser.email || null,
  is_primary: true,
  store_status: 'active',
  billing_owner_id: authenticatedUser.id,
  can_manage: false,
});

const initialFallbackStore = initialCachedSession?.user
  ? buildFallbackStore(initialCachedSession.user)
  : null;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accountUser, setAccountUser] = useState<User | null>(() => initialCachedSession?.user || null);
  const [session, setSession] = useState<Session | null>(() => initialCachedSession);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(() => initialCachedSubscription);
  const [subscriptionLoading, setSubscriptionLoading] = useState(() => Boolean(initialCachedSession?.user));
  const [loading, setLoading] = useState(() => !initialCachedSession?.user);
  // A loja da própria conta é uma informação segura que já existe na sessão.
  // Disponibilizá-la imediatamente evita bloquear a entrada do operador enquanto
  // a lista de lojas da rede é atualizada em segundo plano.
  const [stores, setStores] = useState<StoreAccess[]>(() => initialFallbackStore ? [initialFallbackStore] : []);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(() => initialFallbackStore?.store_user_id || null);
  const [billingOwnerId, setBillingOwnerId] = useState<string | null>(() => initialFallbackStore?.billing_owner_id || null);
  const [storesLoading, setStoresLoading] = useState(false);
  const { toast } = useToast();

  const activeStore = useMemo(
    () => stores.find((store) => store.store_user_id === activeStoreId) || stores[0] || null,
    [stores, activeStoreId]
  );
  const user = useMemo<User | null>(() => {
    if (!accountUser || !activeStore || activeStore.store_user_id === accountUser.id) return accountUser;
    return {
      ...accountUser,
      id: activeStore.store_user_id,
      email: activeStore.store_email || accountUser.email,
      user_metadata: {
        ...accountUser.user_metadata,
        restaurant_name: activeStore.store_name,
        delegated_by: accountUser.id,
      },
    } as User;
  }, [accountUser, activeStore]);
  const canManageStores = Boolean(stores.some((store) => store.can_manage));

  useEffect(() => {
    if (!user?.id || typeof window === 'undefined') return;
    const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
    const key = `popsystem_activity_${user.id}_${bucket}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    void (supabase as any).rpc('record_client_activity', {
      p_event_type: 'app_active',
      p_source: window.matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'web',
      p_metadata: { path: window.location.pathname, store_user_id: user.id },
    }).then(({ error }: { error?: { message?: string } | null }) => {
      if (error) sessionStorage.removeItem(key);
    });
  }, [user?.id]);

  // Refs para controle de debounce e cleanup
  const initTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const authSubscriptionRef = useRef<any>(null);
  const isMountedRef = useRef(true);
  const lastInitTimeRef = useRef<number>(0);
  const storeAccessRequestRef = useRef<{ userId: string; promise: Promise<StoreAccess> } | null>(null);
  const subscriptionLoadSequenceRef = useRef(0);

  const primeSingleStoreAccess = useCallback((authenticatedUser: User) => {
    const fallback = buildFallbackStore(authenticatedUser);
    setStores((current) => current.some((store) => store.store_user_id === authenticatedUser.id) ? current : [fallback]);
    setActiveStoreId(fallback.store_user_id);
    setBillingOwnerId(fallback.billing_owner_id);
    localStorage.setItem('popsystem_active_store_id', fallback.store_user_id);
  }, []);

  const loadStoreAccess = (authenticatedUser: User): Promise<StoreAccess> => {
    const inFlight = storeAccessRequestRef.current;
    if (inFlight?.userId === authenticatedUser.id) return inFlight.promise;

    const request = (async () => {
      setStoresLoading(true);
      try {
      const { data, error } = await withAuthTimeout((supabase as any).rpc('get_my_store_access'));
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []).filter(
        (row: StoreAccess) => row?.store_user_id && row?.store_status === 'active'
      ) as StoreAccess[];
      const fallback = buildFallbackStore(authenticatedUser);
      const availableStores = rows.length ? rows : [fallback];
      const storageKey = `popsystem_active_store_${authenticatedUser.id}`;
      const savedStoreId = localStorage.getItem(storageKey);
      const selected = availableStores.find((store) => store.store_user_id === savedStoreId)
        || availableStores.find((store) => store.store_user_id === authenticatedUser.id)
        || availableStores[0];
      if (isMountedRef.current) {
        setStores(availableStores);
        setActiveStoreId(selected.store_user_id);
        setBillingOwnerId(selected.billing_owner_id || authenticatedUser.id);
        localStorage.setItem('popsystem_active_store_id', selected.store_user_id);
      }
      return selected;
      } catch (error) {
      // Compatibility while the multi-store migration is not present yet.
      console.warn('[MULTILOJAS] Usando loja única:', error);
      const fallback = buildFallbackStore(authenticatedUser);
      if (isMountedRef.current) {
        setStores([fallback]);
        setActiveStoreId(authenticatedUser.id);
        setBillingOwnerId(authenticatedUser.id);
        localStorage.setItem('popsystem_active_store_id', authenticatedUser.id);
      }
      return fallback;
      } finally {
        if (isMountedRef.current) setStoresLoading(false);
      }
    })();

    storeAccessRequestRef.current = { userId: authenticatedUser.id, promise: request };
    void request.then(
      () => {
        if (storeAccessRequestRef.current?.promise === request) storeAccessRequestRef.current = null;
      },
      () => {
        if (storeAccessRequestRef.current?.promise === request) storeAccessRequestRef.current = null;
      },
    );
    return request;
  };

  // O primeiro acesso deve poder avançar com a loja da própria conta sem
  // depender da latência do RPC de redes/multilojas. A confirmação completa
  // continua ocorrendo em background e substitui este fallback quando chega.
  useEffect(() => {
    if (!accountUser) return;
    if (activeStoreId && stores.some((store) => store.store_user_id === activeStoreId)) return;
    primeSingleStoreAccess(accountUser);
  }, [accountUser, activeStoreId, stores, primeSingleStoreAccess]);

  useEffect(() => {
    debugLogger.auth('provider_mounted', { timestamp: Date.now() });
    
    // Evitar múltiplas inicializações muito próximas - REDUZIDO para 100ms
    const now = Date.now();
    if (now - lastInitTimeRef.current < 100) {
      debugLogger.auth('initialization_debounced', { 
        timeSinceLastInit: now - lastInitTimeRef.current,
        delay: 100 
      }, 'warn');
      
      // Debounce REDUZIDO para 100ms
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
      }
      
      initTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current && !initializationInProgress) {
          initializeAuth();
        }
      }, 100);
      return;
    }
    
    lastInitTimeRef.current = now;
    
    // Inicialização imediata sem debounce desnecessário
    if (isMountedRef.current && !initializationInProgress) {
      initializeAuth();
    }

    return () => {
      debugLogger.auth('provider_cleanup', { timestamp: Date.now() });
      isMountedRef.current = false;
      
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
      }
      
      if (authSubscriptionRef.current) {
        authSubscriptionRef.current.data.subscription.unsubscribe();
      }
      
      stopTokenAutoRefresh();
    };
  }, []); // Dependências vazias - executar apenas uma vez

  useEffect(() => {
    const onFocus = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const s = data?.session;
        if (!s) return;
        const exp = Number((s as any).expires_at || 0);
        const now = Math.floor(Date.now() / 1000);
        if (exp && exp - now > 120) return;
        const refreshed = await supabase.auth.refreshSession();
        const next = refreshed?.data?.session;
        if (next?.user && isMountedRef.current) {
          setAccountUser(next.user);
          setSession(next);
        }
      } catch {}
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void onFocus();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const initializeAuth = async () => {
    const performanceTracker = measurePerformance('AuthContext', 'initializeAuth');
    
    // Circuit breaker - evitar múltiplas inicializações simultâneas
    if (initializationInProgress) {
      debugLog('AuthContext', 'initialization_blocked', { 
        hasPromise: !!initializationPromise,
        reason: 'already_in_progress'
      });
      debugLogger.auth('initialization_already_in_progress', { 
        hasPromise: !!initializationPromise 
      }, 'warn');
      if (initializationPromise) {
        await initializationPromise;
      }
      performanceTracker.end({ status: 'blocked' });
      return;
    }

    initializationInProgress = true;
    debugLog('AuthContext', 'initializeAuth', { 
      timestamp: Date.now(),
      loading,
      mounted: isMountedRef.current 
    });
    debugLogger.auth('initialization_started', { timestamp: Date.now() });

    // A inicialização nunca deve bloquear o caixa por causa de uma chamada remota
    // lenta. A sessão local costuma estar disponível imediatamente; este limite
    // mantém o aplicativo utilizável mesmo durante instabilidade do Auth/RPC.
    const safetyTimeout = setTimeout(() => {
      if (isMountedRef.current && loading) {
        debugLogger.auth('safety_timeout_triggered', { 
          timeout: 4000,
          loading,
          mounted: isMountedRef.current 
        }, 'warn');
        setLoading(false);
        initializationInProgress = false;
      }
    }, 4000);

    initializationPromise = (async () => {
      try {
        debugLogger.auth('checking_existing_session', { timestamp: Date.now() });
        // Verificar e atualizar token se necessário antes de consultar a sessão
        try {
          // Temporarily disabled checkAndRefreshToken to prevent potential loops
          // await checkAndRefreshToken();
        } catch (e: any) {
          console.warn('⚠️ [AUTH] Falha ao verificar/atualizar token:', e?.message || e);
        }
        
        // Não deixe a tela inteira presa aguardando o cliente de autenticação.
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout na verificação de sessão')), 800)
        );
        
        let sessionData: any = null;
        
        try {
          sessionData = await Promise.race([sessionPromise, timeoutPromise]);
        } catch (timeoutError) {
          debugLogger.auth('session_check_timeout', { 
              timeout: 800,
            error: timeoutError.message 
          }, 'error');
        }
        
        if (sessionData) {
          const { data: { session }, error } = sessionData;
          
          if (error) {
            debugLogger.auth('session_check_error', { error: error.message }, 'error');
            // Continuamos mesmo com erro, pois o onAuthStateChange pode recuperar
          }

          if (session?.user && isMountedRef.current) {
            debugLogger.auth('session_found', { 
              userId: session.user.id,
              email: session.user.email 
            });
            setAccountUser(session.user);
            setSession(session);
            setSubscriptionLoading(true);
            // A sessão já é suficiente para renderizar o painel. Loja, perfil e
            // assinatura continuam carregando sem segurar a interface inteira.
            setLoading(false);
            void loadStoreAccess(session.user).then((selectedStore) => {
              if (!isMountedRef.current) return;
              void loadUserDataInBackground(selectedStore.store_user_id, selectedStore.billing_owner_id);
            });
          } else {
            console.log('ℹ️ [AUTH] Nenhuma sessão encontrada via getSession');
          }
        }
        
        if (isMountedRef.current) {
          setLoading(false);
          clearTimeout(safetyTimeout);
        }

        // Configurar listener de mudanças de auth - APENAS UMA VEZ
        if (!authSubscriptionRef.current) {
          authSubscriptionRef.current = supabase.auth.onAuthStateChange((event, session) => {
            if (!isMountedRef.current) return;
            
            console.log('🔄 [AUTH] Auth state changed:', event, session?.user?.email);

            if ((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && session?.user) {
              console.log('✅ [AUTH] SIGNED_IN - Processando nova autenticação');
              setAccountUser(session.user);
              setSession(session);
              if (event !== 'TOKEN_REFRESHED') setSubscriptionLoading(true);
              // Reiniciar auto-refresh quando um novo login ocorrer
              /*
              try {
                startTokenAutoRefresh(session);
              } catch (e: any) {
                console.warn('⚠️ [AUTH] Falha ao reiniciar auto-refresh:', e?.message || e);
              }
              */
              // Nunca consultar o Supabase dentro do callback de onAuthStateChange.
              // O cliente mantém um lock interno durante este evento e uma nova
              // chamada aqui pode bloquear todas as consultas seguintes.
              // TOKEN_REFRESHED só precisa atualizar a sessão local.
              if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY' || event === 'INITIAL_SESSION') {
                const authenticatedUser = session.user;
                window.setTimeout(() => {
                  if (!isMountedRef.current) return;
                  void loadStoreAccess(authenticatedUser).then((selectedStore) => {
                    if (!isMountedRef.current) return;
                    void loadUserDataInBackground(selectedStore.store_user_id, selectedStore.billing_owner_id);
                  });
                }, 0);
              }
              
            } else if (event === 'SIGNED_OUT') {
              console.log('🚪 [AUTH] SIGNED_OUT - Limpando dados');
              setAccountUser(null);
              setSession(null);
              setProfile(null);
              setSubscription(null);
              setSubscriptionLoading(false);
              setStores([]);
              setActiveStoreId(null);
              setBillingOwnerId(null);
              // stopTokenAutoRefresh();
            }
          });
        }

      } catch (error) {
        console.error('❌ [AUTH] Erro na inicialização:', error);
        debugLog('AuthContext', 'initialization_error', { 
          error: error.message,
          mounted: isMountedRef.current 
        });
        if (isMountedRef.current) {
          setLoading(false);
        }
      } finally {
        initializationInProgress = false;
        initializationPromise = null;
        clearTimeout(safetyTimeout);
        performanceTracker.end({ 
          status: 'completed',
          hasUser: !!user,
          hasSession: !!session 
        });
        debugLog('AuthContext', 'initialization_completed', {
          hasUser: !!user,
          hasSession: !!session,
          loading
        });
        console.log('🔍 [AUTH] === FIM INICIALIZAÇÃO AUTH ===');
      }
    })();

    await initializationPromise;
  };

  // Função otimizada para carregar dados do usuário em background
  const loadUserDataInBackground = useCallback(async (storeUserId: string, subscriptionOwnerId?: string) => {
    const loadSequence = ++subscriptionLoadSequenceRef.current;
    if (isMountedRef.current) setSubscriptionLoading(true);
    try {
      console.log('📊 [AUTH] Carregando dados do usuário em background...');
      
      // Carregar em paralelo com timeout REDUZIDO para 1.5 segundos
      const profilePromise = fetchProfileWithTimeout(storeUserId, 1500);
      const subscriptionPromise = fetchSubscriptionWithTimeout(subscriptionOwnerId || storeUserId, 1500);
      
      const [profileResult, subscriptionResult] = await Promise.allSettled([
        profilePromise,
        subscriptionPromise
      ]);
      
      if (profileResult.status === 'fulfilled') {
        console.log('✅ [AUTH] Perfil carregado');
      } else {
        console.error('❌ [AUTH] Erro ao carregar perfil:', profileResult.reason);
      }
      
      if (subscriptionResult.status === 'fulfilled') {
        console.log('✅ [AUTH] Assinatura carregada');
      } else {
        console.error('❌ [AUTH] Erro ao carregar assinatura:', subscriptionResult.reason);
      }
      
    } catch (error) {
      console.error('❌ [AUTH] Erro no carregamento em background:', error);
    } finally {
      if (isMountedRef.current && loadSequence === subscriptionLoadSequenceRef.current) {
        setSubscriptionLoading(false);
      }
    }
  }, []);

  const fetchProfileWithTimeout = async (userId: string, timeout: number = 1500) => {
    const profilePromise = supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
      
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout no carregamento do perfil')), timeout)
    );
    
    const { data, error } = await Promise.race([profilePromise, timeoutPromise]) as any;
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    if (data && isMountedRef.current) {
      setProfile(data);
      ProfileCache.setProfile(data);
    }
    
    return data;
  };

  const fetchSubscriptionWithTimeout = async (userId: string, timeout: number = 1500) => {
    const subscriptionPromise = (async () => {
      const effectiveResult = await (supabase as any).rpc('get_my_billing_subscription');
      if (!effectiveResult.error) {
        return { data: Array.isArray(effectiveResult.data) ? effectiveResult.data[0] || null : effectiveResult.data, error: null };
      }
      // Backward-compatible fallback before the multi-store migration exists.
      return supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
    })();
      
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout no carregamento da assinatura')), timeout)
    );
    
    const { data, error } = await Promise.race([subscriptionPromise, timeoutPromise]) as any;
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    if (isMountedRef.current) {
      setSubscription(data || null);
      SubscriptionCache.setSubscription(data || null);
    }
    
    return data;
  };

  const fetchProfile = async (userId: string) => {
    try {
      await fetchProfileWithTimeout(userId);
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const fetchSubscription = async (userId: string) => {
    try {
      await fetchSubscriptionWithTimeout(userId);
    } catch (error) {
      console.error('Error fetching subscription:', error);
    }
  };

  const refreshSubscription = async () => {
    if (accountUser) {
      setSubscriptionLoading(true);
      try {
        await fetchSubscription(billingOwnerId || accountUser.id);
      } finally {
        if (isMountedRef.current) setSubscriptionLoading(false);
      }
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      setLoading(true);
      localStorage.removeItem('operator_session');
      localStorage.removeItem('waiter_session');
      sessionStorage.removeItem('operator_session');
      sessionStorage.removeItem('waiter_session');
      const { data, error } = await withAuthTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        8000,
      );

      if (error) {
        let errorMessage = 'Erro ao entrar. Tente novamente.';
        
        if (error.message.includes('Invalid login credentials')) {
          errorMessage = 'Credenciais inválidas. Verifique seu email e senha.';
        } else if (error.message.includes('Email not confirmed')) {
          errorMessage = 'Email não confirmado. Verifique sua caixa de entrada.';
        } else if (error.message.includes('Too many requests')) {
          errorMessage = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
        }

        toast({
          title: "Erro ao entrar",
          description: errorMessage,
          variant: "destructive",
        });
        void logSecurityEvent('failed_login', `Failed login for ${email}: ${error.message}`, 'medium');
        throw error;
      }

      // Não espere o listener global para refletir o login. Em várias abas e no
      // Electron o lock do Supabase pode atrasar o evento apesar de a sessão já
      // ter sido devolvida com sucesso.
      if (data.session?.user && isMountedRef.current) {
        setAccountUser(data.session.user);
        setSession(data.session);
        setSubscription(null);
        setSubscriptionLoading(true);
        primeSingleStoreAccess(data.session.user);
        setLoading(false);
        void loadStoreAccess(data.session.user).then((selectedStore) => {
          if (!isMountedRef.current) return;
          void loadUserDataInBackground(selectedStore.store_user_id, selectedStore.billing_owner_id);
        });
      }
      
      // Success is logged by the auth state change listener
    } catch (error) {
      console.error('Error signing in:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, restaurantName: string, ownerPhone: string, ownerName: string) => {
    try {
      setLoading(true);
      
      // Configurar redirect URL corretamente
      const redirectUrl = `${window.location.origin}/dashboard`;
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            restaurant_name: restaurantName,
            owner_phone: ownerPhone,
            full_name: ownerName,
          }
        }
      });

      if (error) {
        let errorMessage = 'Erro ao criar conta. Tente novamente.';
        
        if (error.message.includes('User already registered')) {
          errorMessage = 'Este email já está cadastrado. Tente fazer login.';
        } else if (error.message.includes('Password should be at least')) {
          errorMessage = 'A senha deve ter pelo menos 6 caracteres.';
        } else if (error.message.includes('Invalid email')) {
          errorMessage = 'Email inválido. Verifique o formato.';
        }

        toast({
          title: "Erro ao criar conta",
          description: errorMessage,
          variant: "destructive",
        });
        
        await logSecurityEvent('failed_signup', `Failed signup for ${email}: ${error.message}`, 'medium');
        throw error;
      }

      if (data.user && !data.user.email_confirmed_at) {
        toast({
          title: "Conta criada com sucesso!",
          description: "Verifique seu email para confirmar a conta antes de fazer login.",
        });
        
        await logSignupEvent(email, restaurantName, 'pending_confirmation');
      }
      
    } catch (error) {
      console.error('Error signing up:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      localStorage.removeItem('operator_session');
      localStorage.removeItem('waiter_session');
      sessionStorage.removeItem('operator_session');
      sessionStorage.removeItem('waiter_session');
      await supabase.auth.signOut({ scope: 'local' });
      
      // Limpar cache
      clearAllCache();
      
      // Resetar estados
      setAccountUser(null);
      setSession(null);
      setProfile(null);
      setSubscription(null);
      setSubscriptionLoading(false);
      setStores([]);
      setActiveStoreId(null);
      setBillingOwnerId(null);
      
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const refreshUser = async () => {
    if (accountUser && activeStoreId) {
      await loadUserDataInBackground(activeStoreId, billingOwnerId || accountUser.id);
    }
  };

  const refreshStores = async () => {
    if (!accountUser) return;
    const selectedStore = await loadStoreAccess(accountUser);
    await loadUserDataInBackground(selectedStore.store_user_id, selectedStore.billing_owner_id);
  };

  const switchStore = async (storeUserId: string) => {
    if (!accountUser) return;
    const selected = stores.find((store) => store.store_user_id === storeUserId && store.store_status === 'active');
    if (!selected) throw new Error('Loja não disponível para esta conta.');
    localStorage.setItem(`popsystem_active_store_${accountUser.id}`, selected.store_user_id);
    localStorage.removeItem('operator_session');
    localStorage.removeItem('waiter_session');
    sessionStorage.removeItem('operator_session');
    sessionStorage.removeItem('waiter_session');
    setProfile(null);
    setSubscription(null);
    setSubscriptionLoading(true);
    setActiveStoreId(selected.store_user_id);
    setBillingOwnerId(selected.billing_owner_id || accountUser.id);
    localStorage.setItem('popsystem_active_store_id', selected.store_user_id);
    await loadUserDataInBackground(selected.store_user_id, selected.billing_owner_id || accountUser.id);
    window.dispatchEvent(new CustomEvent('active-store-changed', { detail: selected }));
  };

  const syncGoogleUserData = async (googleUser: any) => {
    try {
      console.log('🔄 Sincronizando dados do Google User...');
      
      if (!validateOAuthUser(googleUser)) {
        throw new Error('Dados do usuário Google inválidos');
      }

      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error || !user) {
        throw new Error('Usuário não autenticado');
      }

      // Verificar se já existe perfil
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      const profileData = {
        id: user.id,
        email: googleUser.email,
        restaurant_name: existingProfile?.restaurant_name || googleUser.name || 'Meu Restaurante',
        updated_at: new Date().toISOString()
      };

      if (!validateProfileData(profileData)) {
        throw new Error('Dados do perfil inválidos');
      }

      const { id, ...updateData } = profileData as any;
      const upd = await supabase.from('profiles').update(updateData).eq('id', id).select('id');
      let profileError = (upd as any).error;
      const updatedRows = (upd as any).data;
      if (!profileError && (!Array.isArray(updatedRows) || updatedRows.length === 0)) {
        const ins = await supabase.from('profiles').insert(profileData as any);
        profileError = (ins as any).error;
      }

      if (profileError) {
        console.error('Erro ao sincronizar perfil:', profileError);
        throw profileError;
      }

      // Atualizar estado local
      setProfile(profileData as Profile);
      ProfileCache.setProfile(profileData);

      await logOAuthUserSync(user.id, 'google', 'success');
      console.log('✅ Dados do Google User sincronizados com sucesso');
      
    } catch (error) {
      console.error('❌ Erro na sincronização do Google User:', error);
      if (accountUser) {
        await logOAuthUserSync(accountUser.id, 'google', 'error', error instanceof Error ? error.message : 'Unknown error');
      }
      throw error;
    }
  };

  const value = {
    user,
    accountUser,
    session,
    profile,
    subscription,
    subscriptionLoading,
    loading,
    isLoading: loading,
    stores,
    activeStore,
    activeStoreId,
    billingOwnerId,
    canManageStores,
    storesLoading,
    switchStore,
    refreshStores,
    signOut,
    signIn,
    signUp,
    refreshSubscription,
    refreshUser,
    syncGoogleUserData,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
