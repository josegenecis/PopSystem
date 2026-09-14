import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Lock, Loader2, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import Logo from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { clearLocalOperatorSession, getLocalOperatorSession, getOperatorPathForRequestedPath, setLocalOperatorSession } from '@/services/operatorAuth';

type WaiterOperator = {
  id: string;
  name: string;
  pin: string;
  active: boolean;
  role?: string | null;
  permissions?: Record<string, boolean> | null;
};

const buildSessionPayload = (operator: WaiterOperator, restaurantUserId: string) => ({
  id: operator.id,
  name: operator.name,
  role: operator.role || 'cashier',
  permissions: operator.permissions || {},
  user_id: restaurantUserId,
  set_at: new Date().toISOString(),
});

const clearCachedRestaurantAccount = () => {
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
      window.localStorage.removeItem(key);
    }
  }
  window.localStorage.removeItem('popsystem_active_store_id');
};

const OperatorLogin = () => {
  const { user, isLoading, activeStoreId, storesLoading, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [operators, setOperators] = useState<WaiterOperator[]>([]);
  const [operatorId, setOperatorId] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sendingPinRecovery, setSendingPinRecovery] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [creatingFirst, setCreatingFirst] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [firstPin, setFirstPin] = useState('');

  const activeSession = getLocalOperatorSession();
  const fromPath = (location.state as any)?.from?.pathname || '';

  const selectedOperator = useMemo(
    () => operators.find((operator) => operator.id === operatorId) || null,
    [operatorId, operators],
  );

  useEffect(() => {
    // A sessão da conta aparece antes de a loja ativa ser resolvida. Consultar
    // nesse intervalo usa o ID da conta (em vez do ID da loja) e produz uma
    // lista vazia falsa para usuários multiloja.
    if (!user?.id || !activeStoreId) return;

    let active = true;
    const loadOperators = async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 4000);
        let result: any;
        try {
          result = await supabase
            .from('waiters' as any)
            .select('id, name, pin, active, role, permissions')
            .eq('user_id', activeStoreId)
            .eq('active', true)
            .order('name')
            .abortSignal(controller.signal);
        } finally {
          window.clearTimeout(timeout);
        }

        const { data, error } = result || {};

        if (error) throw error;
        if (!active) return;

        const rows = ((data as any) || []) as WaiterOperator[];
        setOperators(rows);
        setOperatorId((current) => current || rows[0]?.id || '');
      } catch (error: any) {
        if (!active) return;
        const message = error?.message || 'Nao foi possivel buscar os usuarios da equipe.';
        setLoadError(message);
        toast({
          title: 'Erro ao carregar operadores',
          description: 'A conexao ainda esta se recuperando. Os operadores existentes nao foram alterados.',
          variant: 'destructive',
        });
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadOperators();
    return () => {
      active = false;
    };
  }, [user?.id, activeStoreId, toast, reloadAttempt]);

  if (!isLoading && !user) {
    return <Navigate to="/login" replace />;
  }

  if (activeSession?.user_id && user?.id && activeSession.user_id !== user.id) {
    clearLocalOperatorSession();
  } else if (activeSession) {
    return <Navigate to={getOperatorPathForRequestedPath(activeSession, fromPath)} replace />;
  }

  const finishLogin = (operator: WaiterOperator) => {
    const restaurantUserId = activeStoreId || user?.id;
    if (!restaurantUserId) return;
    const payload = buildSessionPayload(operator, restaurantUserId);
    setLocalOperatorSession(payload);
    window.dispatchEvent(new Event('operator-session-changed'));

    const nextPath = getOperatorPathForRequestedPath(payload, fromPath);
    navigate(nextPath, { replace: true });
  };

  const handleLogin = () => {
    if (!selectedOperator) {
      toast({ title: 'Selecione o usuario', variant: 'destructive' });
      return;
    }
    if (String(selectedOperator.pin || '') !== pin.trim()) {
      toast({ title: 'PIN incorreto', description: 'Confira o PIN do operador e tente novamente.', variant: 'destructive' });
      setPin('');
      return;
    }
    finishLogin(selectedOperator);
  };

  const handleForgotPin = async () => {
    if (!selectedOperator || sendingPinRecovery) return;

    try {
      setSendingPinRecovery(true);
      const { data, error } = await supabase.functions.invoke('auth-recovery-email', {
        body: {
          mode: 'operator_pin',
          operatorId: selectedOperator.id,
          _storeId: activeStoreId,
          redirectTo: window.location.origin,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));

      toast({
        title: 'E-mail enviado',
        description: 'Enviamos ao e-mail do proprietário um link seguro para criar um novo PIN.',
      });
    } catch (error: unknown) {
      toast({
        title: 'Não foi possível enviar o link',
        description: error instanceof Error ? error.message : 'Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
    } finally {
      setSendingPinRecovery(false);
    }
  };

  const handleSwitchAccount = async () => {
    if (switchingAccount) return;

    try {
      setSwitchingAccount(true);
      clearLocalOperatorSession();
      await Promise.race([
        signOut().catch((error) => console.warn('[OPERATOR_LOGIN] Logout remoto indisponível; limpando sessão local.', error)),
        new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
      ]);
      clearCachedRestaurantAccount();
      window.location.replace('/login');
    } catch {
      clearCachedRestaurantAccount();
      window.location.replace('/login');
    }
  };

  const handleCreateFirstOperator = async () => {
    if (!user?.id) return;
    if (!firstName.trim() || firstPin.trim().length < 4) {
      toast({ title: 'Preencha os campos', description: 'Informe nome e PIN com pelo menos 4 digitos.', variant: 'destructive' });
      return;
    }

    try {
      setCreatingFirst(true);
      const payload: any = {
        user_id: user.id,
        name: firstName.trim(),
        pin: firstPin.trim(),
        active: true,
        role: 'admin',
        permissions: {},
      };
      const { data, error } = await supabase
        .from('waiters' as any)
        .insert(payload)
        .select('id, name, pin, active, role, permissions')
        .single();

      if (error) throw error;
      finishLogin(data as any);
      toast({ title: 'Administrador criado', description: 'Esse usuario ja entrou com acesso total.' });
    } catch (error: any) {
      toast({
        title: 'Erro ao criar administrador',
        description: error?.message || 'Nao foi possivel criar o primeiro operador.',
        variant: 'destructive',
      });
    } finally {
      setCreatingFirst(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F8F3] px-4 py-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[28px] bg-white shadow-[0_26px_80px_-44px_rgba(0,50,35,0.45)] lg:grid-cols-[0.95fr,1.05fr]">
          <div className="bg-[#003223] p-8 text-white lg:p-10">
            <Logo size="md" className="brightness-0 invert" />
            <div className="mt-16 max-w-sm">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
                <ShieldCheck className="h-7 w-7 text-[#A4D65E]" />
              </div>
              <h1 className="text-3xl font-bold leading-tight">Identifique o operador antes de acessar.</h1>
              <p className="mt-4 text-sm leading-6 text-white/72">
                Cada funcionario entra com seu proprio PIN e o sistema libera somente as areas marcadas pelo administrador.
              </p>
            </div>
          </div>

          <Card className="min-w-0 border-0 shadow-none">
            <CardContent className="min-w-0 p-6 sm:p-8 lg:p-10">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-[#FF6400]">Acesso operacional</div>
                <h2 className="mt-2 text-2xl font-bold text-[#082F23]">Entrar no sistema</h2>
                <p className="mt-2 text-sm text-slate-500">Conta do restaurante autenticada. Agora informe quem esta operando.</p>
              </div>

              {isLoading || storesLoading || !activeStoreId || loading ? (
                <div className="flex min-h-[240px] items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-[#FF6400]" />
                </div>
              ) : loadError ? (
                <div className="mt-8 space-y-5">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    Nao foi possivel confirmar a equipe desta loja. Nenhum operador foi apagado e o sistema nao criara um cadastro duplicado.
                  </div>
                  <Button
                    className="h-12 w-full rounded-2xl bg-[#08785f] text-base font-bold hover:bg-[#06634f]"
                    onClick={() => setReloadAttempt((attempt) => attempt + 1)}
                  >
                    Tentar carregar novamente
                  </Button>
                </div>
              ) : operators.length > 0 ? (
                <div className="mt-8 space-y-5">
                  <div className="space-y-2">
                    <Label>Usuario</Label>
                    <Select value={operatorId} onValueChange={setOperatorId}>
                      <SelectTrigger className="h-12 min-w-0 rounded-2xl">
                        <SelectValue placeholder="Selecione o operador" />
                      </SelectTrigger>
                      <SelectContent>
                        {operators.map((operator) => (
                          <SelectItem key={operator.id} value={operator.id}>
                            {operator.name} {operator.role === 'admin' ? '(Administrador)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>PIN do operador</Label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                      <Input
                        autoFocus
                        inputMode="numeric"
                        type="password"
                        maxLength={6}
                        value={pin}
                        onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') handleLogin();
                        }}
                        className="h-12 rounded-2xl pl-11 text-lg tracking-[0.2em]"
                        placeholder="••••"
                      />
                    </div>
                  </div>

                  <Button
                    className="h-12 w-full rounded-2xl bg-[#FF6400] text-base font-bold hover:bg-[#E65A00]"
                    onClick={handleLogin}
                    disabled={submitting || !operatorId || pin.length < 4}
                  >
                    {submitting ? 'Entrando...' : 'Entrar com permissoes'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto w-full justify-start gap-3 whitespace-normal rounded-2xl border-[#CFE1D9] bg-[#F3FAF7] px-4 py-3 text-left text-[#075B46] hover:bg-[#EAF6F1] hover:text-[#064A3A]"
                    onClick={handleForgotPin}
                    disabled={!selectedOperator || sendingPinRecovery}
                  >
                    {sendingPinRecovery ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <KeyRound className="h-5 w-5 shrink-0" />}
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        {sendingPinRecovery ? 'Enviando link seguro...' : `Esqueci o PIN de ${selectedOperator?.name || 'este operador'}`}
                      </span>
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        A recuperação será enviada ao e-mail responsável pela loja.
                      </span>
                    </span>
                  </Button>
                </div>
              ) : (
                <div className="mt-8 space-y-5">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    Nenhum operador foi criado ainda. Cadastre o primeiro usuario como administrador.
                  </div>
                  <div className="space-y-2">
                    <Label>Nome do administrador</Label>
                    <div className="relative">
                      <UserRound className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                      <Input value={firstName} onChange={(event) => setFirstName(event.target.value)} className="h-12 rounded-2xl pl-11" placeholder="Ex: Dono do restaurante" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>PIN inicial</Label>
                    <Input
                      inputMode="numeric"
                      type="password"
                      maxLength={6}
                      value={firstPin}
                      onChange={(event) => setFirstPin(event.target.value.replace(/\D/g, ''))}
                      className="h-12 rounded-2xl text-lg tracking-[0.2em]"
                      placeholder="••••"
                    />
                  </div>
                  <Button
                    className="h-12 w-full rounded-2xl bg-[#FF6400] text-base font-bold hover:bg-[#E65A00]"
                    onClick={handleCreateFirstOperator}
                    disabled={creatingFirst || firstName.trim().length < 2 || firstPin.length < 4}
                  >
                    {creatingFirst ? 'Criando...' : 'Criar administrador e entrar'}
                  </Button>
                </div>
              )}

              <div className="mt-7 border-t border-slate-200 pt-5">
                <p className="text-sm font-semibold text-[#082F23]">Esta não é a loja que você quer acessar?</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Saia da conta atual para informar o e-mail e a senha de outra loja.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 h-11 w-full whitespace-normal rounded-2xl border-slate-300 px-3 text-[#082F23] hover:bg-slate-50"
                  onClick={handleSwitchAccount}
                  disabled={switchingAccount}
                >
                  {switchingAccount ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
                  {switchingAccount ? 'Saindo da conta...' : 'Entrar com outro e-mail'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default OperatorLogin;
