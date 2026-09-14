import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff } from 'lucide-react';

function parseHashParams(hash: string): Record<string, string> {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const sp = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  sp.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function parseSearchParams(search: string): Record<string, string> {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const sp = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  sp.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const hashParams = useMemo(() => {
    try {
      return parseHashParams(window.location.hash || '');
    } catch {
      return {};
    }
  }, []);

  const searchParams = useMemo(() => {
    try {
      return parseSearchParams(window.location.search || '');
    } catch {
      return {};
    }
  }, []);

  const isOperatorPinRecovery = searchParams.mode === 'operator-pin';
  const operatorId = String(searchParams.operatorId || '').trim();
  const operatorStoreId = String(searchParams.storeId || '').trim();

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code) {
          try {
            await supabase.auth.exchangeCodeForSession(code);
          } catch {}
        }

        const accessToken = hashParams.access_token || searchParams.access_token || '';
        const refreshToken = hashParams.refresh_token || searchParams.refresh_token || '';
        if (accessToken && refreshToken) {
          try {
            await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          } catch {}
        }

        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setHasRecoverySession(!!data?.session?.user);

        if (!code && (accessToken || refreshToken)) {
          try {
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch {}
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [hashParams, searchParams]);

  const handleUpdatePassword = async () => {
    if (saving) return;
    const trimmed = password.trim();
    const isValidPin = /^\d{4,6}$/.test(trimmed);
    if (isOperatorPinRecovery ? !isValidPin : trimmed.length < 6) {
      toast({
        title: isOperatorPinRecovery ? 'PIN inválido' : 'Senha fraca',
        description: isOperatorPinRecovery ? 'Use um PIN numérico de 4 a 6 dígitos.' : 'Use uma senha com pelo menos 6 caracteres.',
        variant: 'destructive',
      });
      return;
    }
    if (isOperatorPinRecovery && (!operatorId || !operatorStoreId)) {
      toast({
        title: 'Link inválido',
        description: 'Solicite um novo link de recuperação do PIN.',
        variant: 'destructive',
      });
      return;
    }
    if (trimmed !== confirmPassword.trim()) {
      toast({
        title: isOperatorPinRecovery ? 'PINs não conferem' : 'Senhas não conferem',
        description: `Digite o mesmo ${isOperatorPinRecovery ? 'PIN' : 'valor'} nos dois campos.`,
        variant: 'destructive',
      });
      return;
    }

    try {
      setSaving(true);
      const result = isOperatorPinRecovery
        ? await supabase.from('waiters')
            .update({ pin: trimmed })
            .eq('id', operatorId)
            .eq('user_id', operatorStoreId)
            .select('id')
            .single()
        : await supabase.auth.updateUser({ password: trimmed });
      const { error } = result;
      if (error) throw error;
      toast({
        title: isOperatorPinRecovery ? 'PIN atualizado' : 'Senha atualizada',
        description: isOperatorPinRecovery ? 'O operador já pode acessar com o novo PIN.' : 'Você já pode acessar com a nova senha.',
      });
      navigate(isOperatorPinRecovery ? '/operator-login' : '/login', { replace: true });
    } catch (e: any) {
      toast({
        title: isOperatorPinRecovery ? 'Erro ao atualizar PIN' : 'Erro ao atualizar senha',
        description: e?.message || (isOperatorPinRecovery ? 'Não foi possível atualizar o PIN.' : 'Não foi possível atualizar sua senha.'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{isOperatorPinRecovery ? 'Redefinir PIN' : 'Redefinir senha'}</CardTitle>
            <CardDescription>Carregando…</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    );
  }

  if (!hasRecoverySession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Link inválido ou expirado</CardTitle>
            <CardDescription>
              Solicite um novo link de recuperação na tela de login.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex justify-end">
            <Button onClick={() => navigate(isOperatorPinRecovery ? '/operator-login' : '/login')} disabled={saving}>
              {isOperatorPinRecovery ? 'Voltar à identificação' : 'Ir para login'}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{isOperatorPinRecovery ? 'Redefinir PIN do operador' : 'Redefinir senha'}</CardTitle>
          <CardDescription>{isOperatorPinRecovery ? 'Crie um novo PIN numérico de 4 a 6 dígitos.' : 'Crie uma nova senha para sua conta.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">{isOperatorPinRecovery ? 'Novo PIN' : 'Nova senha'}</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(isOperatorPinRecovery ? e.target.value.replace(/\D/g, '') : e.target.value)}
                autoComplete="new-password"
                inputMode={isOperatorPinRecovery ? 'numeric' : undefined}
                maxLength={isOperatorPinRecovery ? 6 : undefined}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{isOperatorPinRecovery ? 'Confirmar novo PIN' : 'Confirmar nova senha'}</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(isOperatorPinRecovery ? e.target.value.replace(/\D/g, '') : e.target.value)}
                autoComplete="new-password"
                inputMode={isOperatorPinRecovery ? 'numeric' : undefined}
                maxLength={isOperatorPinRecovery ? 6 : undefined}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                onClick={() => setShowConfirmPassword((v) => !v)}
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </Button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button onClick={handleUpdatePassword} disabled={saving || (isOperatorPinRecovery ? !/^\d{4,6}$/.test(password.trim()) : password.trim().length < 6)}>
            {saving ? 'Salvando…' : isOperatorPinRecovery ? 'Atualizar PIN' : 'Atualizar senha'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default ResetPassword;
