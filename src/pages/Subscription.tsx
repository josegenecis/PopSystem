
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, Clock, AlertTriangle, Crown, ArrowLeft, ArrowRight, Store, CreditCard, QrCode, Copy, CalendarDays, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { formatBRL } from '@/lib/currency';
import {
  BILLING_PERIODS,
  PLAN_CATALOG,
  calculatePlanPeriodPrice,
  calculatePeriodPrice,
  getBillingPeriodConfig,
  getPlanCatalogItem,
  type BillingPeriod,
  type PlanCatalogItem,
} from '@/data/planCatalog';

const onlyDigits = (value: string) => value.replace(/\D/g, '');

const isValidCpfCnpj = (value: string) => {
  const digits = onlyDigits(value);
  return digits.length === 11 || digits.length === 14;
};

type PaymentMethod = 'PIX' | 'CREDIT_CARD';

type CheckoutPlan = {
  planId: number;
  storeCount: number;
  planName: string;
  value: number;
  monthlyValue: number;
  periodValue: number;
  monthlyEquivalent: number;
  creditAmount: number;
  isUpgrade: boolean;
  billingPeriod: BillingPeriod;
  billingMonths: number;
  billingLabel: string;
  discountPercent: number;
};

type PeriodOffer = { planId: number; storeCount: number };

const emptyCardForm = {
  holderName: '',
  number: '',
  expiryMonth: '',
  expiryYear: '',
  ccv: '',
  postalCode: '',
  addressNumber: '',
  mobilePhone: '',
};

const Subscription = () => {
  const navigate = useNavigate();
  const { subscription, refreshSubscription, user, accountUser, billingOwnerId } = useAuth();
  const { toast } = useToast();
  const [loadingPlanId, setLoadingPlanId] = useState<number | null>(null);
  const [storeCounts, setStoreCounts] = useState<Record<number, number>>({});
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PIX');
  const [installmentCount, setInstallmentCount] = useState(1);
  const [pixPayment, setPixPayment] = useState<{ encodedImage: string; payload: string; expirationDate?: string } | null>(null);
  const [creditPaymentComplete, setCreditPaymentComplete] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [cardForm, setCardForm] = useState(emptyCardForm);
  const [checkoutError, setCheckoutError] = useState('');
  const [billingDocument, setBillingDocument] = useState('');
  const [lastPaidPaymentMethod, setLastPaidPaymentMethod] = useState<PaymentMethod | null>(null);
  const [pricingMode, setPricingMode] = useState<'monthly' | 'yearly'>('monthly');
  const [periodOffer, setPeriodOffer] = useState<PeriodOffer | null>(null);
  const checkoutInFlightRef = useRef(false);
  const checkoutRequestIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    refreshSubscription();
    // O contexto recria esta função; esta leitura deve acontecer somente ao abrir a página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!accountUser?.id || (billingOwnerId && accountUser.id !== billingOwnerId)) return;
    if (subscription?.payment_method === 'PIX' || subscription?.payment_method === 'CREDIT_CARD') {
      setLastPaidPaymentMethod(subscription.payment_method);
      return;
    }

    let stopped = false;
    const loadLastPaymentMethod = async () => {
      const { data } = await supabase
        .from('subscription_plan_changes')
        .select('payment_method')
        .eq('user_id', accountUser.id)
        .eq('status', 'paid')
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (!stopped && (data?.payment_method === 'PIX' || data?.payment_method === 'CREDIT_CARD')) {
        setLastPaidPaymentMethod(data.payment_method);
      }
    };

    void loadLastPaymentMethod();
    return () => {
      stopped = true;
    };
  }, [accountUser?.id, billingOwnerId, subscription?.payment_method]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('choosePlan') !== '1') return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('planos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!pixPayment || !accountUser?.id) return;

    let stopped = false;
    const checkPaymentStatus = async () => {
      const { data } = await supabase
        .from('subscriptions')
        .select('status,plan_id,store_count,billing_cycle')
        .eq('user_id', billingOwnerId || accountUser.id)
        .maybeSingle();

      const expectedPlanActive = data?.status === 'active'
        && Number(data.plan_id) === Number(checkoutPlan?.planId)
        && Number(data.store_count || 1) === Number(checkoutPlan?.storeCount || 1)
        && String(data.billing_cycle || 'MONTHLY') === getBillingPeriodConfig(checkoutPlan?.billingPeriod || 'monthly').asaasCycle;
      if (!stopped && expectedPlanActive) {
        setPixPayment(null);
        setPaymentConfirmed(true);
        setCreditPaymentComplete(true);
        await refreshSubscription();
        toast({
          title: 'Pagamento confirmado',
          description: 'Seu plano já está ativo no PopSystem.',
        });
      }
    };

    void checkPaymentStatus();
    const intervalId = window.setInterval(checkPaymentStatus, 2000);
    return () => {
      stopped = true;
      window.clearInterval(intervalId);
    };
    // As funções do contexto são instáveis; o polling deve reiniciar apenas quando a cobrança mudar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixPayment, accountUser?.id, billingOwnerId, checkoutPlan?.planId, checkoutPlan?.storeCount, checkoutPlan?.billingPeriod]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return format(parseISO(dateStr), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  };

  const daysLeft = (endDateStr: string | null) => {
    if (!endDateStr) return 0;
    const endDate = parseISO(endDateStr);
    return Math.max(0, differenceInDays(endDate, new Date()));
  };

  const formatCurrency = (value: number) => formatBRL(value);

  const openCheckout = (planId: number, storeCount = 1, billingPeriod: BillingPeriod = 'monthly') => {
    const plan = getPlanCatalogItem(planId);
    if (!plan) return;
    const additionalStores = Math.max(0, storeCount - plan.includedStores);
    const monthlyValue = plan.monthlyPrice + additionalStores * Number(plan.extraStorePrice || 0);
    const periodPricing = calculatePlanPeriodPrice(plan, billingPeriod, storeCount);
    const oldPlan = getPlanCatalogItem(subscription?.plan_id);
    const oldStoreCount = Math.max(1, Number(subscription?.store_count || 1));
    const oldAdditionalStores = oldPlan ? Math.max(0, oldStoreCount - oldPlan.includedStores) : 0;
    const oldMonthlyValue = oldPlan
      ? oldPlan.monthlyPrice + oldAdditionalStores * Number(oldPlan.extraStorePrice || 0)
      : 0;
    const periodStart = subscription?.current_period_start ? new Date(subscription.current_period_start).getTime() : 0;
    const periodEnd = subscription?.current_period_end ? new Date(subscription.current_period_end).getTime() : 0;
    const now = Date.now();
    const hasActiveBalance = subscription?.status === 'active' && periodEnd > now && periodEnd > periodStart;
    const oldBillingMonths = Math.max(1, Number(subscription?.billing_months || 1));
    const oldPeriod: BillingPeriod = oldBillingMonths === 12
      ? 'yearly'
      : oldBillingMonths === 6
        ? 'semiannual'
        : oldBillingMonths === 3
          ? 'quarterly'
          : 'monthly';
    const oldBillingAmount = Number(subscription?.billing_amount)
      || (oldPlan ? calculatePlanPeriodPrice(oldPlan, oldPeriod, oldStoreCount).totalValue : 0);
    const configurationChanged = subscription?.plan_id !== planId
      || oldStoreCount !== storeCount
      || String(subscription?.billing_cycle || 'MONTHLY') !== periodPricing.asaasCycle;
    const isUpgrade = Boolean(hasActiveBalance && configurationChanged && (
      monthlyValue > oldMonthlyValue
      || (subscription?.plan_id === planId && oldStoreCount === storeCount && periodPricing.months > oldBillingMonths)
    ));
    const creditAmount = isUpgrade
      ? Number((oldBillingAmount * ((periodEnd - now) / (periodEnd - periodStart))).toFixed(2))
      : 0;
    setCheckoutPlan({
      planId,
      storeCount,
      planName: plan.name,
      value: isUpgrade ? Number(Math.max(0.01, periodPricing.totalValue - creditAmount).toFixed(2)) : periodPricing.totalValue,
      monthlyValue,
      periodValue: periodPricing.totalValue,
      monthlyEquivalent: periodPricing.monthlyEquivalent,
      creditAmount,
      isUpgrade,
      billingPeriod,
      billingMonths: periodPricing.months,
      billingLabel: periodPricing.label,
      discountPercent: periodPricing.discountPercent,
    });
    setPaymentMethod('PIX');
    setInstallmentCount(1);
    setPixPayment(null);
    setCreditPaymentComplete(false);
    setPaymentConfirmed(false);
    setCheckoutError('');
    checkoutRequestIdRef.current = crypto.randomUUID();
  };

  const handlePlanClick = (planId: number, storeCount = 1) => {
    if (pricingMode === 'yearly') {
      openCheckout(planId, storeCount, 'yearly');
      return;
    }
    setPeriodOffer({ planId, storeCount });
  };

  const handleSubscribeAsaas = async () => {
    if (!checkoutPlan || checkoutInFlightRef.current) return;
    if (!user) {
      toast({
        title: "Erro",
        description: "Você precisa estar logado para assinar um plano.",
        variant: "destructive",
      });
      return;
    }

    if (!isValidCpfCnpj(billingDocument)) {
      setCheckoutError('Informe um CPF com 11 números ou CNPJ com 14 números.');
      return;
    }

    if (paymentMethod === 'CREDIT_CARD') {
      const requiredCardFields = Object.values(cardForm).every((value) => value.trim());
      if (!requiredCardFields) {
        setCheckoutError('Preencha todos os dados do cartão e do titular.');
        return;
      }
    }

    checkoutInFlightRef.current = true;
    setCheckoutError('');
    setLoadingPlanId(checkoutPlan.planId);
    try {
      const { data, error } = await supabase.functions.invoke('create-asaas-subscription', {
        body: {
          planId: checkoutPlan.planId,
          storeCount: checkoutPlan.storeCount,
          billingPeriod: checkoutPlan.billingPeriod,
          paymentMethod,
          installmentCount: paymentMethod === 'CREDIT_CARD' ? installmentCount : 1,
          billingDocument: onlyDigits(billingDocument),
          checkoutRequestId: checkoutRequestIdRef.current,
          ...(paymentMethod === 'CREDIT_CARD' ? {
            creditCard: {
              holderName: cardForm.holderName,
              number: onlyDigits(cardForm.number),
              expiryMonth: onlyDigits(cardForm.expiryMonth),
              expiryYear: onlyDigits(cardForm.expiryYear),
              ccv: onlyDigits(cardForm.ccv),
            },
            creditCardHolderInfo: {
              name: cardForm.holderName,
              cpfCnpj: onlyDigits(billingDocument),
              postalCode: onlyDigits(cardForm.postalCode),
              addressNumber: cardForm.addressNumber,
              mobilePhone: onlyDigits(cardForm.mobilePhone),
            },
          } : {}),
        }
      });

      if (error) {
        let message = error.message;
        const context = (error as { context?: Response }).context;
        if (context?.json) {
          const body = await context.json().catch(() => null) as { message?: string; error?: string } | null;
          message = body?.message || body?.error || message;
        }
        throw new Error(message);
      }

      if (paymentMethod === 'PIX') {
        if (!data?.pix?.encodedImage || !data?.pix?.payload) {
          throw new Error('O Asaas criou a cobrança, mas ainda não disponibilizou o QR Code. Tente novamente em instantes.');
        }
        if (data?.proration) {
          setCheckoutPlan((current) => current ? {
            ...current,
            value: Number(data.proration.chargeAmount),
            monthlyValue: Number(data.proration.newMonthlyValue),
            periodValue: Number(data.proration.newPeriodValue),
            creditAmount: Number(data.proration.creditAmount),
            isUpgrade: true,
          } : current);
        }
        setPixPayment(data.pix);
      } else {
        setCreditPaymentComplete(true);
        setPaymentConfirmed(false);
        toast({
          title: "Pagamento enviado",
          description: "O cartão foi processado. A confirmação do Asaas liberará o plano automaticamente.",
        });
        await refreshSubscription();
      }
    } catch (error: unknown) {
      console.error('Erro ao criar assinatura:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : "Não foi possível criar a cobrança no Asaas. Tente novamente.";
      setCheckoutError(errorMessage);
    } finally {
      checkoutInFlightRef.current = false;
      setLoadingPlanId(null);
    }
  };

  const copyPixCode = async () => {
    if (!pixPayment?.payload) return;
    await navigator.clipboard.writeText(pixPayment.payload);
    toast({ title: 'Código PIX copiado' });
  };

  const getPlanDisplay = (plan: PlanCatalogItem) => {
    const accent = plan.accent || 'green';
    const palette = accent === 'orange'
      ? {
          border: 'border-[#FF6400]/40',
          glow: 'shadow-[0_30px_80px_-45px_rgba(255,100,0,0.55)]',
          header: 'from-[#FF6400] to-[#FF8A3D]',
          chip: 'bg-[#FFF1E8] text-[#C14E00]',
          icon: 'text-[#FF6400]',
          check: 'text-[#FF6400]',
          button: 'bg-[#FF6400] hover:bg-[#e55a00]',
          soft: 'bg-[#FFF7F2]'
        }
      : accent === 'purple'
        ? {
            border: 'border-purple-300',
            glow: 'shadow-[0_30px_80px_-45px_rgba(124,58,237,0.55)]',
            header: 'from-purple-600 to-fuchsia-500',
            chip: 'bg-purple-100 text-purple-700',
            icon: 'text-purple-600',
            check: 'text-purple-600',
            button: 'bg-purple-600 hover:bg-purple-700',
            soft: 'bg-purple-50'
          }
        : {
            border: 'border-[#8CC850]/35',
            glow: 'shadow-[0_30px_80px_-45px_rgba(140,200,80,0.55)]',
            header: 'from-[#003223] to-[#166534]',
            chip: 'bg-[#EEF7E4] text-[#4E8A1F]',
            icon: 'text-[#4E8A1F]',
            check: 'text-[#4E8A1F]',
            button: 'bg-[#003223] hover:bg-[#0b4733]',
            soft: 'bg-[#F8FCF3]'
          };

    const Icon = plan.slug === 'multi' ? Store : Crown;

    return {
      name: plan.name,
      description: plan.description,
      audience: plan.audience,
      features: plan.features || [],
      featureGroups: plan.featureGroups || [],
      modules: plan.modules || [],
      badge: plan.badge || '',
      featured: Boolean(plan.featured),
      palette,
      Icon
    };
  };

  const renderTrialInfo = () => {
    if (!subscription?.trial_end) return null;
    
    const days = daysLeft(subscription.trial_end);
    return (
      <Card className="mb-8 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 shadow-[0_24px_60px_-40px_rgba(245,158,11,0.45)]">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock size={20} className="text-amber-600" />
              Período de Avaliação
            </CardTitle>
            <Badge variant={days > 0 ? "outline" : "destructive"} className="border-amber-300 text-amber-700">
              {days > 0 ? "Ativo" : "Expirado"}
            </Badge>
          </div>
          <CardDescription>
            Você está no período de avaliação com acesso liberado para explorar a plataforma.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-2">
          <div className="flex items-center space-x-2 text-muted-foreground">
            {days > 0 ? (
              <>
                <Clock size={16} />
                <span>Restam {days} dias - Expira em {formatDate(subscription.trial_end)}</span>
              </>
            ) : (
              <>
                <AlertTriangle size={16} className="text-destructive" />
                <span>Seu período de avaliação expirou em {formatDate(subscription.trial_end)}</span>
              </>
            )}
          </div>
        </CardContent>
        {days <= 3 && (
          <CardFooter>
            <Button 
              onClick={() => handlePlanClick(2)}
              className="w-full bg-amber-600 hover:bg-amber-700"
              disabled={loadingPlanId !== null}
            >
              <Crown size={16} className="mr-2" />
              Fazer Upgrade Agora
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  };

  const renderCurrentPlan = () => {
    if (!subscription?.plan_id) return null;
    
    const currentPlan = getPlanCatalogItem(subscription.plan_id);
    if (!currentPlan) return null;
    const display = getPlanDisplay(currentPlan);
    const storeCount = Math.max(1, Number(subscription.store_count || currentPlan.includedStores || 1));
    const extraStores = currentPlan.slug === 'multi' ? Math.max(0, storeCount - currentPlan.includedStores) : 0;
    const monthlyTotal = currentPlan.monthlyPrice + extraStores * Number(currentPlan.extraStorePrice || 0);
    const currentBillingMonths = Math.max(1, Number(subscription.billing_months || 1));
    const currentPeriod: BillingPeriod = currentBillingMonths === 12
      ? 'yearly'
      : currentBillingMonths === 6
        ? 'semiannual'
        : currentBillingMonths === 3
          ? 'quarterly'
          : 'monthly';
    const currentPeriodConfig = getBillingPeriodConfig(currentPeriod);
    const recurringAmount = Number(subscription.billing_amount)
      || calculatePlanPeriodPrice(currentPlan, currentPeriod, storeCount).totalValue;
    const currentInstallments = Math.max(1, Number(subscription.installment_count || 1));
    const storedPaymentMethod = subscription.payment_method || lastPaidPaymentMethod;
    const paymentMethodLabel = storedPaymentMethod === 'PIX'
      ? 'PIX'
      : storedPaymentMethod === 'CREDIT_CARD'
        ? 'Cartão de crédito'
        : 'Não registrada';
    const subscriptionStatus = String(subscription.status || '').toLowerCase();
    const statusLabel = subscriptionStatus === 'active'
      ? 'Ativo'
      : subscriptionStatus === 'pending'
        ? 'Aguardando pagamento'
        : subscriptionStatus === 'past_due'
          ? 'Pagamento atrasado'
          : subscriptionStatus === 'canceled'
            ? 'Cancelado'
            : 'Em processamento';

    return (
      <Card className={`mb-8 overflow-hidden border-2 ${display.palette.border} ${display.palette.glow}`}>
        <CardHeader className={`pb-4 text-white bg-gradient-to-r ${display.palette.header}`}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <display.Icon size={20} />
              Seu Plano Atual
            </CardTitle>
            <Badge variant="outline" className="border-white/30 bg-white/15 text-white">
              {statusLabel}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className={`pt-5 ${display.palette.soft}`}>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="font-bold text-2xl text-slate-900">{display.name}</h3>
              <p className="text-sm text-slate-600">{display.description}</p>
            </div>
            <div className="text-left md:text-right">
              <span className="text-3xl font-bold text-slate-900">
                {formatCurrency(recurringAmount)}
              </span>
              <p className="text-xs text-slate-500">por período {currentPeriodConfig.label.toLowerCase()}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><CalendarDays className="h-4 w-4" /> Vencimento</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{formatDate(subscription.current_period_end)}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><CreditCard className="h-4 w-4" /> Próxima cobrança</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{formatCurrency(recurringAmount)}</p>
              <p className="text-xs text-slate-500">em {formatDate(subscription.current_period_end)}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><CreditCard className="h-4 w-4" /> Pagamento</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{paymentMethodLabel}</p>
              <p className="text-xs text-slate-500">Ciclo {currentPeriodConfig.label.toLowerCase()}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Store className="h-4 w-4" /> Unidades</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {currentPlan.slug === 'multi'
                  ? `${storeCount} loja${storeCount === 1 ? '' : 's'}${extraStores > 0 ? ` (${extraStores} extra)` : ''}`
                  : 'Uma loja'}
              </p>
            </div>
            {currentInstallments > 1 && (
              <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 sm:col-span-2 lg:col-span-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parcelamento do período</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {currentInstallments}x de aproximadamente {formatCurrency(recurringAmount / currentInstallments)}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const isTrialSubscription = String(subscription?.status || '').toLowerCase().includes('trial');
  const offeredPlan = periodOffer ? getPlanCatalogItem(periodOffer.planId) : null;
  const offeredStoreCount = Math.max(1, Number(periodOffer?.storeCount || 1));
  const maxCheckoutInstallments = Math.min(12, Math.max(1, Number(checkoutPlan?.billingMonths || 1)));

  const backToSystemButton = (
    <Button
      type="button"
      variant="outline"
      onClick={() => navigate('/dashboard')}
      className="gap-2 border-slate-300 bg-white text-[#003223] shadow-sm hover:bg-slate-50 hover:text-[#003223]"
      aria-label="Voltar ao painel do sistema"
    >
      <ArrowLeft className="h-4 w-4" />
      Voltar ao sistema
    </Button>
  );

  if (accountUser && billingOwnerId && accountUser.id !== billingOwnerId) {
    return (
      <div className="min-h-full bg-[radial-gradient(circle_at_top,#fff4ea_0%,#fff_45%,#f8fafc_100%)] px-4 py-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6">{backToSystemButton}</div>
          <Card className="overflow-hidden border-[#B8D7CA] shadow-lg">
            <div className="h-2 bg-gradient-to-r from-[#003223] via-[#087A55] to-[#FF6400]" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#003223]"><Store className="h-5 w-5 text-[#087A55]" /> Assinatura administrada pela matriz</CardTitle>
              <CardDescription>Esta unidade utiliza o plano Multi da rede. Alterações de plano, quantidade de lojas e pagamentos ficam disponíveis somente para a conta principal.</CardDescription>
            </CardHeader>
            <CardContent>
              <Badge className="bg-[#EAF7F0] text-[#087A55] hover:bg-[#EAF7F0]">Unidade vinculada e ativa</Badge>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top,#fff4ea_0%,#fff_45%,#f8fafc_100%)] px-2 py-4 sm:px-4 sm:py-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 text-center">
          <Badge className="mb-4 bg-[#FFF1E8] text-[#C14E00] hover:bg-[#FFF1E8]">Planos PopSystem</Badge>
          <h1 className="mx-auto max-w-4xl text-3xl font-bold tracking-tight text-[#003223] md:text-5xl">
            Escolha o plano certo para o seu restaurante.
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-base text-slate-600 md:text-lg">
            Assine pelo Asaas e libere o PopSystem conforme o plano escolhido.
          </p>
          <div className="mt-7 grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <div className="sm:justify-self-start">{backToSystemButton}</div>
            <div className="inline-flex justify-self-center rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm" aria-label="Período dos preços">
              <button
                type="button"
                onClick={() => setPricingMode('monthly')}
                aria-pressed={pricingMode === 'monthly'}
                className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition ${pricingMode === 'monthly' ? 'bg-[#003223] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Mensal
              </button>
              <button
                type="button"
                onClick={() => setPricingMode('yearly')}
                aria-pressed={pricingMode === 'yearly'}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${pricingMode === 'yearly' ? 'bg-[#003223] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Anual
                <span className={`rounded-full px-2 py-0.5 text-xs ${pricingMode === 'yearly' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                  Melhor preço
                </span>
              </button>
            </div>
            <div className="hidden sm:block" aria-hidden="true" />
          </div>
        </div>

        {isTrialSubscription && renderTrialInfo()}

        {subscription?.plan_id && !isTrialSubscription && renderCurrentPlan()}

        <div id="planos" className="mb-10 scroll-mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {PLAN_CATALOG.map((plan) => {
            const currentCatalogPlan = subscription?.plan_id ? getPlanCatalogItem(subscription.plan_id) : null;
            const display = getPlanDisplay(plan);
            const isProcessing = loadingPlanId === plan.id;
            const isMulti = plan.slug === 'multi';
            const currentPlanStoreCount = currentCatalogPlan?.slug === plan.slug
              ? Number(subscription?.store_count || 1)
              : 1;
            const selectedStores = Math.max(1, Number(storeCounts[plan.id] || currentPlanStoreCount));
            const extraStores = isMulti ? Math.max(0, selectedStores - plan.includedStores) : 0;
            const extraStorePrice = Number(plan.extraStorePrice || 189);
            const monthlyTotal = Number(plan.monthlyPrice || 0) + extraStores * extraStorePrice;
            const displayedPeriod: BillingPeriod = pricingMode === 'yearly' ? 'yearly' : 'monthly';
            const displayedPricing = calculatePlanPeriodPrice(plan, displayedPeriod, selectedStores);
            const selectedCycle = getBillingPeriodConfig(displayedPeriod).asaasCycle;
            const isCurrentPlan = currentCatalogPlan?.slug === plan.slug
              && subscription?.status === 'active';
            const isCurrentOffer = isCurrentPlan
              && String(subscription?.billing_cycle || 'MONTHLY') === selectedCycle;
            const disableCurrentOffer = isCurrentOffer && pricingMode === 'yearly';

            return (
              <Card
                key={plan.id} 
                className={`relative flex h-full flex-col overflow-hidden border-2 bg-white transition-all duration-300 hover:-translate-y-1 ${display.palette.border} ${display.palette.glow}`}
              >
                {isCurrentPlan && (
                  <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-[#003223] px-4 py-1 text-xs font-bold text-white">
                    Plano Atual
                  </div>
                )}

                {display.featured && !isCurrentPlan && (
                  <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#FF6400] px-4 py-1 text-xs font-bold text-white shadow-md">
                    <Crown size={12} />
                    {display.badge}
                  </div>
                )}
                
                <CardHeader className={`bg-gradient-to-br px-6 pb-6 pt-14 text-white ${display.palette.header}`}>
                  <CardTitle className="flex items-center justify-center gap-2 text-2xl">
                    <display.Icon size={24} />
                    {display.name}
                  </CardTitle>
                  <CardDescription className="text-center text-white/90">
                    {display.description}
                  </CardDescription>
                  <div className="mt-5 text-center">
                    {pricingMode === 'yearly' && (
                      <p className="mb-1 text-sm text-white/70 line-through">{formatCurrency(monthlyTotal)}/mês</p>
                    )}
                    <span className="text-4xl font-bold">
                      {formatCurrency(displayedPricing.monthlyEquivalent)}
                    </span>
                    <span className="text-sm text-white/80">/mês</span>
                    {pricingMode === 'yearly' && (
                      <p className="mt-2 text-sm font-semibold text-white/90">
                        {formatCurrency(displayedPricing.totalValue)} cobrados por ano · economize {formatCurrency(displayedPricing.savings)}
                      </p>
                    )}
                    {isMulti && (
                      <p className="mt-2 text-sm font-semibold text-white/90">
                        + {formatCurrency(calculatePeriodPrice(extraStorePrice, displayedPeriod).monthlyEquivalent)}/mês por loja adicional
                      </p>
                    )}
                  </div>
                </CardHeader>
                
                <CardContent className="flex-grow px-6 pt-6">
                  <div className={`mb-5 rounded-2xl px-4 py-3 text-sm font-medium ${display.palette.soft} ${display.palette.icon}`}>
                    {display.audience}
                  </div>

                  {isMulti && (
                    <div className="mb-5 rounded-2xl border border-purple-200 bg-purple-50 p-4">
                      <label className="text-sm font-semibold text-purple-900">
                        Quantas lojas vão usar?
                      </label>
                      <div className="mt-3 flex items-center gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 w-10 rounded-xl p-0"
                          onClick={() => setStoreCounts((current) => ({
                            ...current,
                            [plan.id]: Math.max(1, selectedStores - 1)
                          }))}
                        >
                          -
                        </Button>
                        <input
                          className="h-11 w-20 rounded-xl border border-purple-200 bg-white text-center text-lg font-bold text-purple-900 outline-none focus:border-purple-500"
                          type="number"
                          min={1}
                          value={selectedStores}
                          onChange={(event) => {
                            const nextValue = Math.max(1, Math.floor(Number(event.target.value) || 1));
                            setStoreCounts((current) => ({ ...current, [plan.id]: nextValue }));
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 w-10 rounded-xl p-0"
                          onClick={() => setStoreCounts((current) => ({
                            ...current,
                            [plan.id]: selectedStores + 1
                          }))}
                        >
                          +
                        </Button>
                        <div className="ml-auto text-right">
                          <p className="text-xs text-purple-700">{pricingMode === 'yearly' ? 'Equivalente mensal' : 'Total mensal'}</p>
                          <p className="text-xl font-bold text-purple-950">{formatCurrency(displayedPricing.monthlyEquivalent)}</p>
                        </div>
                      </div>
                      <p className="mt-3 text-xs font-medium text-purple-700">
                        Uma loja já está incluída. {extraStores > 0 ? `${extraStores} loja(s) adicional(is) entram na mensalidade.` : 'Você pode usar o Multi com uma loja pelo valor base do plano.'}
                      </p>
                    </div>
                  )}

                  <div className="space-y-5">
                    {display.featureGroups.map((group) => {
                      const isHomologation = group.status === 'homologation';
                      return (
                        <section
                          key={group.title}
                          className={isHomologation ? 'rounded-2xl border border-amber-200 bg-amber-50 p-4' : undefined}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <h4 className={`text-sm font-bold ${isHomologation ? 'text-amber-900' : 'text-slate-900'}`}>
                              {group.title}
                            </h4>
                            {isHomologation && (
                              <Badge variant="outline" className="border-amber-300 bg-white text-amber-700">
                                Em homologação
                              </Badge>
                            )}
                          </div>
                          <ul className="space-y-2.5">
                            {group.features.map((feature) => (
                              <li key={feature} className="flex items-start">
                                {isHomologation
                                  ? <Clock className="mr-3 mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                                  : <Check className={`mr-3 mt-0.5 h-4 w-4 flex-shrink-0 ${display.palette.check}`} />}
                                <span className={`text-sm leading-5 ${isHomologation ? 'text-amber-800' : 'text-slate-700'}`}>{feature}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                </CardContent>
                
                <CardFooter className="pb-6 pt-4">
                  <Button
                    className={`w-full rounded-2xl text-base font-semibold text-white ${display.palette.button}`}
                    onClick={() => handlePlanClick(plan.id, selectedStores)}
                    disabled={loadingPlanId !== null || disableCurrentOffer}
                    variant={disableCurrentOffer ? "outline" : "default"}
                    size="lg"
                  >
                    {disableCurrentOffer ? (
                      "Plano anual atual"
                    ) : (
                      <>
                        {isProcessing
                          ? "Processando..."
                          : isCurrentPlan
                            ? 'Alterar período'
                            : `Assinar ${display.name} ${pricingMode === 'yearly' ? 'anual' : ''}${isMulti ? ` - ${formatCurrency(displayedPricing.monthlyEquivalent)}/mês` : ''}`}
                        <ArrowRight size={16} className="ml-2" />
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {isTrialSubscription && (
          <Card className="border-0 bg-gradient-to-r from-[#FF6400] to-[#ff8d4d] text-white shadow-[0_25px_80px_-40px_rgba(255,100,0,0.7)]">
            <CardContent className="pt-6">
              <div className="text-center">
                <h3 className="mb-2 text-2xl font-bold">Pronto para crescer?</h3>
                <p className="mb-4 text-orange-100">
                  Mantenha todas as funcionalidades ativas escolhendo um plano hoje mesmo.
                </p>
                <Button 
                  onClick={() => handlePlanClick(2)}
                  variant="secondary" 
                  size="lg"
                  disabled={loadingPlanId !== null}
                >
                  <Crown size={16} className="mr-2" />
                  {loadingPlanId === 2 ? "Processando..." : "Fazer Upgrade Agora"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={Boolean(periodOffer)} onOpenChange={(open) => !open && setPeriodOffer(null)}>
          <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-0">
            <DialogHeader className="border-b bg-gradient-to-br from-emerald-50 via-orange-50 to-purple-100 px-6 py-6 text-left">
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#003223] to-[#FF6400] text-white shadow-lg shadow-orange-200">
                <Sparkles className="h-5 w-5" />
              </div>
              <DialogTitle className="text-2xl text-[#003223]">Economize escolhendo um período maior</DialogTitle>
              <DialogDescription className="text-base">
                {offeredPlan
                  ? `${offeredPlan.name}: escolha como prefere pagar. O desconto vale sobre todo o período contratado.`
                  : 'Escolha o período da sua assinatura.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 px-6 py-6 sm:grid-cols-2">
              {(Object.keys(BILLING_PERIODS) as BillingPeriod[]).map((period) => {
                if (!offeredPlan) return null;
                const periodPricing = calculatePlanPeriodPrice(offeredPlan, period, offeredStoreCount);
                const isBestOffer = period === 'yearly';
                const periodStyle = {
                  monthly: {
                    card: 'border-sky-200 bg-gradient-to-br from-sky-50 via-white to-blue-50 hover:border-sky-400 hover:shadow-sky-100',
                    icon: 'bg-sky-500 text-white',
                    price: 'text-sky-800',
                    badge: 'bg-sky-100 text-sky-700 hover:bg-sky-100',
                    saving: 'text-sky-700',
                  },
                  quarterly: {
                    card: 'border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 hover:border-orange-400 hover:shadow-orange-100',
                    icon: 'bg-[#FF6400] text-white',
                    price: 'text-orange-800',
                    badge: 'bg-orange-100 text-orange-700 hover:bg-orange-100',
                    saving: 'text-orange-700',
                  },
                  semiannual: {
                    card: 'border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 hover:border-violet-400 hover:shadow-violet-100',
                    icon: 'bg-violet-600 text-white',
                    price: 'text-violet-800',
                    badge: 'bg-violet-100 text-violet-700 hover:bg-violet-100',
                    saving: 'text-violet-700',
                  },
                  yearly: {
                    card: 'border-emerald-400 bg-gradient-to-br from-emerald-100 via-white to-lime-100 hover:border-emerald-600 hover:shadow-emerald-200',
                    icon: 'bg-[#003223] text-white',
                    price: 'text-[#003223]',
                    badge: 'bg-emerald-200 text-emerald-800 hover:bg-emerald-200',
                    saving: 'text-emerald-800',
                  },
                }[period];
                const isExactCurrentPeriod = subscription?.status === 'active'
                  && Number(subscription.plan_id) === Number(periodOffer?.planId)
                  && Number(subscription.store_count || 1) === offeredStoreCount
                  && String(subscription.billing_cycle || 'MONTHLY') === periodPricing.asaasCycle;
                const isShorterSamePlanPeriod = subscription?.status === 'active'
                  && Number(subscription.plan_id) === Number(periodOffer?.planId)
                  && Number(subscription.store_count || 1) === offeredStoreCount
                  && periodPricing.months < Number(subscription.billing_months || 1);
                const isUnavailablePeriod = isExactCurrentPeriod || isShorterSamePlanPeriod;

                return (
                  <button
                    key={period}
                    type="button"
                    disabled={isUnavailablePeriod}
                    onClick={() => {
                      if (!periodOffer) return;
                      const selectedOffer = periodOffer;
                      setPeriodOffer(null);
                      openCheckout(selectedOffer.planId, selectedOffer.storeCount, period);
                    }}
                    className={`relative overflow-hidden rounded-2xl border-2 p-4 text-left transition hover:-translate-y-1 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-55 ${periodStyle.card}`}
                  >
                    {isBestOffer && (
                      <span className="absolute right-3 top-3 rounded-full bg-[#003223] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                        Maior economia
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-sm ${periodStyle.icon}`}>
                        <CalendarDays className="h-5 w-5" />
                      </span>
                      <span className="font-bold text-slate-900">{periodPricing.label}</span>
                      {periodPricing.discountPercent > 0 && (
                        <Badge className={periodStyle.badge}>
                          -{periodPricing.discountPercent}%
                        </Badge>
                      )}
                    </div>
                    <p className={`mt-4 text-2xl font-bold ${periodStyle.price}`}>
                      {formatCurrency(periodPricing.monthlyEquivalent)}
                      <span className="text-sm font-medium text-slate-500">/mês</span>
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatCurrency(periodPricing.totalValue)} por {periodPricing.shortLabel}
                    </p>
                    {periodPricing.months > 1 && (
                      <p className={`mt-1 text-xs font-semibold ${periodStyle.saving}`}>
                        No cartão: até {Math.min(12, periodPricing.months)}x
                      </p>
                    )}
                    {periodPricing.savings > 0 && (
                      <p className={`mt-2 text-sm font-semibold ${periodStyle.saving}`}>
                        Você economiza {formatCurrency(periodPricing.savings)}
                      </p>
                    )}
                    {isUnavailablePeriod && (
                      <p className="mt-2 text-xs font-semibold text-slate-500">
                        {isExactCurrentPeriod ? 'Período atual' : 'Disponível no próximo vencimento'}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="border-t px-6 py-4 text-center text-xs leading-5 text-slate-500">
              A cobrança é feita antecipadamente pelo período escolhido. A renovação segue o mesmo ciclo.
            </p>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(checkoutPlan)} onOpenChange={(open) => {
          if (!open) {
            setCheckoutPlan(null);
            setPixPayment(null);
            setCreditPaymentComplete(false);
            setPaymentConfirmed(false);
            setCheckoutError('');
            setCardForm(emptyCardForm);
            setInstallmentCount(1);
          }
        }}>
          <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto p-0">
            <DialogHeader className="border-b px-6 py-4 text-left">
              <DialogTitle>Finalizar assinatura</DialogTitle>
              <DialogDescription>
                {checkoutPlan
                  ? `${checkoutPlan.planName} ${checkoutPlan.billingLabel.toLowerCase()} · ${formatCurrency(checkoutPlan.periodValue)} por ${checkoutPlan.billingMonths === 1 ? 'mês' : `${checkoutPlan.billingMonths} meses`}`
                  : 'Finalize o pagamento para ativar o plano.'}
              </DialogDescription>
            </DialogHeader>

            {creditPaymentComplete ? (
              <div className="space-y-5 px-6 py-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-7 w-7 text-emerald-700" />
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-slate-900">
                    {paymentConfirmed ? 'Pagamento confirmado' : 'Pagamento enviado com sucesso'}
                  </p>
                  <p className="text-sm leading-6 text-slate-600">
                    {paymentConfirmed
                      ? 'Seu plano está ativo e todos os recursos contratados já foram liberados.'
                      : 'Assim que o Asaas confirmar a transação, o plano será liberado automaticamente.'}
                  </p>
                </div>
                <Button className="w-full bg-[#003223] hover:bg-[#0b4733]" onClick={() => setCheckoutPlan(null)}>
                  Concluir
                </Button>
              </div>
            ) : pixPayment ? (
              <div className="space-y-5 px-6 py-6 text-center">
                <div>
                  <p className="font-semibold text-slate-900">Escaneie o QR Code para pagar</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Valor: {checkoutPlan ? formatCurrency(checkoutPlan.value) : ''}. A confirmação acontece automaticamente após o pagamento.
                  </p>
                </div>
                <img
                  src={`data:image/png;base64,${pixPayment.encodedImage}`}
                  alt="QR Code PIX da assinatura"
                  className="mx-auto h-56 w-56 rounded-xl border bg-white p-2"
                />
                <div className="rounded-xl border bg-slate-50 p-3 text-left">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">PIX copia e cola</p>
                  <p className="break-all text-xs text-slate-700">{pixPayment.payload}</p>
                </div>
                <Button className="w-full bg-[#003223] hover:bg-[#0b4733]" onClick={copyPixCode}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar código PIX
                </Button>
              </div>
            ) : (
              <div className="space-y-5 px-6 py-6">
                {checkoutPlan && (
                  <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                    <div className="flex justify-between text-slate-600">
                      <span>{checkoutPlan.discountPercent > 0 ? 'Valor mensal sem desconto' : 'Valor mensal'}</span>
                      <span>{formatCurrency(checkoutPlan.monthlyValue)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Período contratado</span>
                      <span>{checkoutPlan.billingLabel} · {checkoutPlan.billingMonths} {checkoutPlan.billingMonths === 1 ? 'mês' : 'meses'}</span>
                    </div>
                    {checkoutPlan.discountPercent > 0 && (
                      <>
                        <div className="flex justify-between font-medium text-emerald-700">
                          <span>Desconto do período</span>
                          <span>-{checkoutPlan.discountPercent}%</span>
                        </div>
                        <div className="flex justify-between font-medium text-emerald-700">
                          <span>Equivalente mensal com desconto</span>
                          <span>{formatCurrency(checkoutPlan.monthlyEquivalent)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-slate-600">
                      <span>Total do período</span>
                      <span>{formatCurrency(checkoutPlan.periodValue)}</span>
                    </div>
                    {checkoutPlan.isUpgrade && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Crédito do plano atual</span>
                        <span>- {formatCurrency(checkoutPlan.creditAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-emerald-200 pt-2 font-bold text-[#003223]">
                      <span>Total a pagar agora</span>
                      <span>{formatCurrency(checkoutPlan.value)}</span>
                    </div>
                    {paymentMethod === 'CREDIT_CARD' && installmentCount > 1 && (
                      <div className="flex justify-between rounded-lg bg-white/70 px-2 py-1.5 font-semibold text-violet-700">
                        <span>Parcelamento escolhido</span>
                        <span>{installmentCount}x de aproximadamente {formatCurrency(checkoutPlan.value / installmentCount)}</span>
                      </div>
                    )}
                    {checkoutPlan.isUpgrade && (
                      <p className="pt-1 text-xs leading-5 text-slate-500">
                        Seu saldo atual foi abatido. A próxima renovação ocorrerá em {checkoutPlan.billingMonths} {checkoutPlan.billingMonths === 1 ? 'mês' : 'meses'} pelo valor integral deste período.
                      </p>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => { setPaymentMethod('PIX'); setInstallmentCount(1); setCheckoutError(''); }}
                    className={`flex items-center justify-center gap-2 rounded-xl border-2 p-3 font-semibold transition ${paymentMethod === 'PIX' ? 'border-[#003223] bg-emerald-50 text-[#003223]' : 'border-slate-200 text-slate-600'}`}
                  >
                    <QrCode className="h-5 w-5" /> PIX
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPaymentMethod('CREDIT_CARD'); setCheckoutError(''); }}
                    className={`flex items-center justify-center gap-2 rounded-xl border-2 p-3 font-semibold transition ${paymentMethod === 'CREDIT_CARD' ? 'border-[#003223] bg-emerald-50 text-[#003223]' : 'border-slate-200 text-slate-600'}`}
                  >
                    <CreditCard className="h-5 w-5" /> Crédito
                  </button>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#003223]">CPF ou CNPJ</label>
                  <Input value={billingDocument} onChange={(event) => setBillingDocument(event.target.value)} inputMode="numeric" placeholder="Somente números" />
                </div>

                {paymentMethod === 'PIX' ? (
                  <div className="rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                    O QR Code será exibido nesta tela. A cada renovação {checkoutPlan?.billingLabel.toLowerCase()}, uma nova cobrança PIX será gerada e o plano permanecerá ativo após a confirmação.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {maxCheckoutInstallments > 1 && (
                      <div className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-4">
                        <label htmlFor="installment-count" className="mb-2 block text-sm font-bold text-violet-950">
                          Como deseja pagar no cartão?
                        </label>
                        <select
                          id="installment-count"
                          value={installmentCount}
                          onChange={(event) => setInstallmentCount(Number(event.target.value))}
                          className="h-12 w-full rounded-xl border border-violet-200 bg-white px-3 font-semibold text-violet-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                        >
                          {Array.from({ length: maxCheckoutInstallments }, (_, index) => index + 1).map((count) => (
                            <option key={count} value={count}>
                              {count === 1
                                ? `À vista · ${checkoutPlan ? formatCurrency(checkoutPlan.value) : ''}`
                                : `${count}x de aprox. ${checkoutPlan ? formatCurrency(checkoutPlan.value / count) : ''}`}
                            </option>
                          ))}
                        </select>
                        <p className="mt-2 text-xs leading-5 text-violet-700">
                          O valor total compromete o limite do cartão e é parcelado pela operadora. Na próxima renovação, ao final do período, a cobrança recorrente será feita pelo valor integral do novo ciclo.
                        </p>
                      </div>
                    )}
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-[#003223]">Nome impresso no cartão</label>
                      <Input value={cardForm.holderName} onChange={(event) => setCardForm({ ...cardForm, holderName: event.target.value })} autoComplete="cc-name" />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-[#003223]">Número do cartão</label>
                      <Input value={cardForm.number} onChange={(event) => setCardForm({ ...cardForm, number: event.target.value })} inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-[#003223]">Mês</label>
                        <Input value={cardForm.expiryMonth} onChange={(event) => setCardForm({ ...cardForm, expiryMonth: event.target.value })} inputMode="numeric" autoComplete="cc-exp-month" placeholder="MM" maxLength={2} />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-[#003223]">Ano</label>
                        <Input value={cardForm.expiryYear} onChange={(event) => setCardForm({ ...cardForm, expiryYear: event.target.value })} inputMode="numeric" autoComplete="cc-exp-year" placeholder="AAAA" maxLength={4} />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-[#003223]">CVV</label>
                        <Input value={cardForm.ccv} onChange={(event) => setCardForm({ ...cardForm, ccv: event.target.value })} inputMode="numeric" autoComplete="cc-csc" placeholder="000" maxLength={4} type="password" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-[#003223]">CEP do titular</label>
                        <Input value={cardForm.postalCode} onChange={(event) => setCardForm({ ...cardForm, postalCode: event.target.value })} inputMode="numeric" autoComplete="postal-code" />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-[#003223]">Número</label>
                        <Input value={cardForm.addressNumber} onChange={(event) => setCardForm({ ...cardForm, addressNumber: event.target.value })} />
                      </div>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-[#003223]">Celular do titular</label>
                      <Input value={cardForm.mobilePhone} onChange={(event) => setCardForm({ ...cardForm, mobilePhone: event.target.value })} inputMode="tel" autoComplete="tel" />
                    </div>
                    <p className="text-xs leading-5 text-slate-500">Os dados do cartão são enviados por conexão segura diretamente ao Asaas e não são armazenados pelo PopSystem.</p>
                  </div>
                )}

                {checkoutError && (
                  <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{checkoutError}</div>
                )}

                <Button className="w-full bg-[#003223] hover:bg-[#0b4733]" onClick={handleSubscribeAsaas} disabled={loadingPlanId !== null}>
                  {loadingPlanId !== null
                    ? 'Processando...'
                    : paymentMethod === 'PIX'
                      ? 'Gerar QR Code PIX'
                      : installmentCount > 1
                        ? `Pagar em ${installmentCount}x de aprox. ${checkoutPlan ? formatCurrency(checkoutPlan.value / installmentCount) : ''}`
                        : `Pagar ${checkoutPlan ? formatCurrency(checkoutPlan.value) : ''}`}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Subscription;
