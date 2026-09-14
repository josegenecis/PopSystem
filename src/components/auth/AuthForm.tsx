
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Logo from '@/components/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useInputValidation } from '@/hooks/useInputValidation';
import { loginSchema, signupSchema, type LoginData, type SignupData } from '@/schemas/authSchemas';
import { logSecurityEvent, logSignupEvent } from '@/utils/securityLogger';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { debugLogger } from '@/utils/debugLogger';
import { cn } from '@/lib/utils';

import { handleOAuthError } from '../../utils/oauth-errors';
import { logOAuthLoginAttempt, logOAuthLoginFailure } from '../../utils/oauth-security-logger';

type AuthFormProps = {
  defaultTab?: 'login' | 'register';
  embedded?: boolean;
  onTabChange?: (tab: 'login' | 'register') => void;
};

const fieldClassName = 'h-12 rounded-2xl border-[#DCE4DE] bg-[#FBFCFA] px-4 text-[#082F23] shadow-none placeholder:text-slate-400 focus-visible:border-[#85C441] focus-visible:ring-[#85C441]/30';
const passwordFieldClassName = `${fieldClassName} pr-12`;
const labelClassName = 'text-sm font-semibold text-[#123F33]';
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Erro inesperado';

const AuthForm: React.FC<AuthFormProps> = ({ defaultTab = 'login', embedded = false, onTabChange }) => {
  const { signIn, signUp } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  // Estados para controle de submissão
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [isSubmittingSignup, setIsSubmittingSignup] = useState(false);
  const [isSubmittingGoogle, setIsSubmittingGoogle] = useState(false);

  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupConfirmPassword, setShowSignupConfirmPassword] = useState(false);
  
  // Refs para debounce
  const loginTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const signupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const googleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Login form state
  const [loginData, setLoginData] = useState<LoginData>({
    email: '',
    password: ''
  });
  
  // Register form state
  const [signupData, setSignupData] = useState<SignupData>({
    email: '',
    password: '',
    confirmPassword: '',
    restaurantName: '',
    name: ''
  });
  
  // Validation hooks
  const loginValidation = useInputValidation(loginSchema);
  const signupValidation = useInputValidation(signupSchema);
  
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevenir múltiplas submissões
    if (isSubmittingLogin) {
      debugLogger.form('login_submission_blocked', { 
        isSubmittingLogin
      }, 'warn');
      return;
    }
    
    if (!loginValidation.validate(loginData)) {
      return;
    }
    
    debugLogger.form('login_submission_started', { email: loginData.email });
    setIsSubmittingLogin(true);
    
    // Debounce para evitar cliques duplos
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
    }
    
    try {
      await signIn(loginData.email, loginData.password);
      void logSecurityEvent('login', `Successful login for ${loginData.email}`, 'low');
      debugLogger.form('login_submission_success', { email: loginData.email });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      debugLogger.form('login_submission_error', { 
        email: loginData.email,
        error: message,
      }, 'error');
    } finally {
      // Reset com delay REDUZIDO para 500ms para evitar cliques rápidos
      loginTimeoutRef.current = setTimeout(() => {
        setIsSubmittingLogin(false);
      }, 500);
    }
  };
  
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevenir múltiplas submissões
    if (isSubmittingSignup) {
      console.log('🚫 [AUTH FORM] Signup já em andamento - ignorando');
      return;
    }
    
    if (!signupValidation.validate(signupData)) {
      return;
    }
    
    console.log('📝 [AUTH FORM] Iniciando cadastro...');
    setIsSubmittingSignup(true);
    
    // Debounce para evitar cliques duplos
    if (signupTimeoutRef.current) {
      clearTimeout(signupTimeoutRef.current);
    }
    
    try {
      await signUp(signupData.email, signupData.password, signupData.restaurantName);
      await logSignupEvent(signupData.email);
      console.log('✅ [AUTH FORM] Cadastro realizado com sucesso');
    } catch (error: unknown) {
      console.error('❌ [AUTH FORM] Erro no cadastro:', error);
    } finally {
      // Reset com delay REDUZIDO para 500ms para evitar cliques rápidos
      signupTimeoutRef.current = setTimeout(() => {
        setIsSubmittingSignup(false);
      }, 500);
    }
  };
  
  const handleGoogleLogin = async () => {
    // Prevenir múltiplas submissões
    if (isSubmittingGoogle) {
      console.log('🚫 [AUTH FORM] Login Google já em andamento - ignorando');
      return;
    }
    
    console.log('🔐 [AUTH FORM] Iniciando login com Google...');
    setIsSubmittingGoogle(true);
    
    // Debounce para evitar cliques duplos
    if (googleTimeoutRef.current) {
      clearTimeout(googleTimeoutRef.current);
    }
    
    try {
      // Log da tentativa de login
      await logOAuthLoginAttempt('google', {
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        referrer: document.referrer
      });

      const desktopApi = window.electronAPI;
      const isDesktop = Boolean(desktopApi?.isElectron && desktopApi.openExternal);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: isDesktop ? 'https://popsystem.com.br/auth/callback?desktop=1' : `${window.location.origin}/auth/callback`,
          skipBrowserRedirect: isDesktop,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent'
          }
        }
      });

      if (error) {
        console.error('❌ [AUTH FORM] Erro no login com Google:', error);
        
        // Log da falha no login
        await logOAuthLoginFailure('google', error.message, {
          errorCode: error.status,
          errorDetails: error
        });
        
        handleOAuthError(error);
        return;
      }

      if (isDesktop && data?.url) {
        const openResult = await desktopApi.openExternal(data.url);
        if (!openResult?.success) throw new Error(openResult?.error || 'Não foi possível abrir o navegador.');
        toast({
          title: 'Continue no navegador',
          description: 'Após entrar com o Google, você voltará automaticamente ao PopSystem.',
        });
      }

      console.log('✅ [AUTH FORM] Redirecionamento para Google OAuth iniciado');
      
    } catch (error: unknown) {
      const normalizedError = error instanceof Error ? error : new Error('Erro inesperado durante login');
      const oauthStatus = typeof error === 'object' && error !== null && 'status' in error
        ? Number(error.status)
        : undefined;
      console.error('❌ [AUTH FORM] Erro inesperado no login com Google:', error);
      
      // Log da falha inesperada
      await logOAuthLoginFailure('google', 'Erro inesperado durante login', {
        error: normalizedError.message,
        stack: normalizedError.stack,
        status: oauthStatus,
      });
      
      handleOAuthError(normalizedError);
    } finally {
      // Reset com delay REDUZIDO para 1 segundo para OAuth
      googleTimeoutRef.current = setTimeout(() => {
        setIsSubmittingGoogle(false);
      }, 1000);
    }
  };

  const handleForgotPassword = async () => {
    if (!loginData.email) {
      toast({
        title: "Email necessário",
        description: "Por favor digite seu email para recuperar sua senha.",
        variant: "destructive",
      });
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('auth-recovery-email', {
        body: {
          email: loginData.email.trim().toLowerCase(),
          redirectTo: 'https://popsystem.com.br/reset-password',
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));

      toast({
        title: "Email enviado",
        description: "Enviamos um link seguro para redefinir sua senha. Verifique também a caixa de spam.",
      });
    } catch (error: unknown) {
      console.error('Erro ao enviar email de recuperação:', error);
      const errorStatus = typeof error === 'object' && error !== null && 'status' in error
        ? Number(error.status)
        : undefined;
      const message = getErrorMessage(error);
      const isRateLimit = errorStatus === 429 || /rate|seconds|segundos|security purposes/i.test(message);
      toast({
        title: isRateLimit ? "Aguarde um momento" : "Não foi possível concluir",
        description: isRateLimit
          ? "O link já foi solicitado. Aguarde cerca de 1 minuto antes de tentar novamente."
          : "Não foi possível enviar o email de recuperação. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  // Cleanup dos timeouts
  React.useEffect(() => {
    return () => {
      if (loginTimeoutRef.current) clearTimeout(loginTimeoutRef.current);
      if (signupTimeoutRef.current) clearTimeout(signupTimeoutRef.current);
      if (googleTimeoutRef.current) clearTimeout(googleTimeoutRef.current);
    };
  }, []);

  const GoogleIcon = () => (
    <svg className="mr-2 h-5 w-5" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );

  return (
    <Card className={cn(
      'mx-auto w-full max-w-md',
      embedded && 'max-w-none border-0 bg-transparent shadow-none',
    )}>
      <CardHeader className={cn('space-y-1', embedded && 'hidden')}>
        <div className="flex justify-center mb-4">
          <Logo />
        </div>
        <CardDescription className="text-center">
          Sistema completo para seu restaurante
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(embedded && 'p-0')}>
        <Tabs
          defaultValue={defaultTab}
          className="w-full"
          onValueChange={(value) => onTabChange?.(value as 'login' | 'register')}
        >
          <TabsList className="grid h-12 w-full grid-cols-2 rounded-2xl bg-[#F0F3EE] p-1.5">
            <TabsTrigger
              value="login"
              className="h-9 rounded-xl font-bold text-slate-500 data-[state=active]:bg-white data-[state=active]:text-[#0B4A37] data-[state=active]:shadow-[0_5px_14px_-8px_rgba(0,50,35,0.42)]"
            >
              Entrar
            </TabsTrigger>
            <TabsTrigger
              value="register"
              className="h-9 rounded-xl font-bold text-slate-500 data-[state=active]:bg-white data-[state=active]:text-[#0B4A37] data-[state=active]:shadow-[0_5px_14px_-8px_rgba(0,50,35,0.42)]"
            >
              Cadastrar
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="login" className="mt-6 space-y-5">
            <form onSubmit={handleLoginSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className={labelClassName}>E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={loginData.email}
                  onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                  disabled={isSubmittingLogin}
                  required
                  autoComplete="email"
                  className={fieldClassName}
                />
                {loginValidation.errors.email && (
                  <p className="text-sm text-red-500">{loginValidation.errors.email}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password" className={labelClassName}>Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showLoginPassword ? 'text' : 'password'}
                    placeholder="Sua senha"
                    value={loginData.password}
                    onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                  disabled={isSubmittingLogin}
                  required
                  autoComplete="current-password"
                  className={passwordFieldClassName}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-xl text-slate-400 hover:bg-[#EEF3EF] hover:text-[#0B4A37]"
                    onClick={() => setShowLoginPassword((v) => !v)}
                    aria-label={showLoginPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showLoginPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
                {loginValidation.errors.password && (
                  <p className="text-sm text-red-500">{loginValidation.errors.password}</p>
                )}
              </div>
              
              <Button 
                type="submit" 
                className="h-12 w-full rounded-2xl bg-[#FF6400] text-base font-bold text-white shadow-[0_14px_28px_-16px_rgba(255,100,0,0.75)] hover:bg-[#E85B00]"
                disabled={isSubmittingLogin}
              >
                {isSubmittingLogin ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  'Entrar'
                )}
              </Button>
              
              <Button
                type="button"
                variant="outline"
                className="relative h-12 w-full rounded-2xl border-[#D9E2DC] bg-white font-bold text-[#123F33] hover:border-[#BFD2C6] hover:bg-[#F6F9F7]"
                onClick={handleGoogleLogin}
                disabled={isSubmittingGoogle}
              >
                {isSubmittingGoogle ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Conectando...
                  </>
                ) : (
                  <>
                    <GoogleIcon />
                    Entrar com Google
                  </>
                )}
              </Button>
              
              <Button
                type="button"
                variant="link"
                className="h-auto w-full py-1 text-sm font-bold text-[#6CA936] hover:text-[#56882B]"
                onClick={handleForgotPassword}
                disabled={isSubmittingLogin}
              >
                Esqueci minha senha
              </Button>
            </form>
          </TabsContent>
          
          <TabsContent value="register" className="mt-6 space-y-4">
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className={labelClassName}>Nome completo</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Seu nome completo"
                  value={signupData.name}
                  onChange={(e) => setSignupData({ ...signupData, name: e.target.value })}
                  disabled={isSubmittingSignup}
                  required
                  autoComplete="name"
                  className={fieldClassName}
                />
                {signupValidation.errors.name && (
                  <p className="text-sm text-red-500">{signupValidation.errors.name}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="restaurantName" className={labelClassName}>Nome do restaurante</Label>
                <Input
                  id="restaurantName"
                  type="text"
                  placeholder="Nome do seu restaurante"
                  value={signupData.restaurantName}
                  onChange={(e) => setSignupData({ ...signupData, restaurantName: e.target.value })}
                  disabled={isSubmittingSignup}
                  required
                  autoComplete="organization"
                  className={fieldClassName}
                />
                {signupValidation.errors.restaurantName && (
                  <p className="text-sm text-red-500">{signupValidation.errors.restaurantName}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="registerEmail" className={labelClassName}>E-mail</Label>
                <Input
                  id="registerEmail"
                  type="email"
                  placeholder="seu@email.com"
                  value={signupData.email}
                  onChange={(e) => setSignupData({ ...signupData, email: e.target.value })}
                  disabled={isSubmittingSignup}
                  required
                  autoComplete="email"
                  className={fieldClassName}
                />
                {signupValidation.errors.email && (
                  <p className="text-sm text-red-500">{signupValidation.errors.email}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="registerPassword" className={labelClassName}>Senha</Label>
                <div className="relative">
                  <Input
                    id="registerPassword"
                    type={showSignupPassword ? 'text' : 'password'}
                    placeholder="Mínimo 6 caracteres"
                    value={signupData.password}
                    onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
                  disabled={isSubmittingSignup}
                  required
                  autoComplete="new-password"
                  className={passwordFieldClassName}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-xl text-slate-400 hover:bg-[#EEF3EF] hover:text-[#0B4A37]"
                    onClick={() => setShowSignupPassword((v) => !v)}
                    aria-label={showSignupPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showSignupPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
                {signupValidation.errors.password && (
                  <p className="text-sm text-red-500">{signupValidation.errors.password}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className={labelClassName}>Confirmar senha</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showSignupConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirme sua senha"
                    value={signupData.confirmPassword}
                    onChange={(e) => setSignupData({ ...signupData, confirmPassword: e.target.value })}
                  disabled={isSubmittingSignup}
                  required
                  autoComplete="new-password"
                  className={passwordFieldClassName}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-xl text-slate-400 hover:bg-[#EEF3EF] hover:text-[#0B4A37]"
                    onClick={() => setShowSignupConfirmPassword((v) => !v)}
                    aria-label={showSignupConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showSignupConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
                {signupValidation.errors.confirmPassword && (
                  <p className="text-sm text-red-500">{signupValidation.errors.confirmPassword}</p>
                )}
              </div>
              
              <Button 
                type="submit" 
                className="h-12 w-full rounded-2xl bg-[#FF6400] text-base font-bold text-white shadow-[0_14px_28px_-16px_rgba(255,100,0,0.75)] hover:bg-[#E85B00]"
                disabled={isSubmittingSignup}
              >
                {isSubmittingSignup ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cadastrando...
                  </>
                ) : (
                  'Criar conta'
                )}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default AuthForm;
