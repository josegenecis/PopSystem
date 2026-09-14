import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, Crown, Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { formatBRL } from '@/lib/currency';
import {
  FeatureKey,
  getFeatureDefinition,
  getRequiredPlan,
  hasFeatureAccess,
  isFeatureAccessPending,
} from '@/lib/featureAccess';

type FeatureGateContextValue = {
  canAccessFeature: (feature: FeatureKey) => boolean;
  openFeatureDialog: (feature: FeatureKey) => void;
  isFeatureAccessLoading: boolean;
};

const FeatureGateContext = createContext<FeatureGateContextValue | undefined>(undefined);

export const FeatureGateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { subscription, subscriptionLoading } = useAuth();
  const navigate = useNavigate();
  const [feature, setFeature] = useState<FeatureKey | null>(null);
  const isFeatureAccessLoading = isFeatureAccessPending(subscriptionLoading, subscription);

  const activeDefinition = feature ? getFeatureDefinition(feature) : null;
  const requiredPlan = feature ? getRequiredPlan(feature) : null;
  const isMultiPlan = requiredPlan?.slug === 'multi';

  const value = useMemo<FeatureGateContextValue>(() => ({
    canAccessFeature: (nextFeature) => hasFeatureAccess(nextFeature, subscription),
    openFeatureDialog: (nextFeature) => {
      if (isFeatureAccessLoading || hasFeatureAccess(nextFeature, subscription)) return;
      setFeature(nextFeature);
    },
    isFeatureAccessLoading,
  }), [isFeatureAccessLoading, subscription]);

  useEffect(() => {
    if (feature && (isFeatureAccessLoading || hasFeatureAccess(feature, subscription))) {
      setFeature(null);
    }
  }, [feature, isFeatureAccessLoading, subscription]);

  const goToPlan = async () => {
    if (!requiredPlan) return;
    navigate(`/subscription?plan=${requiredPlan.id}`);
    setFeature(null);
  };

  const isComingSoon = Boolean(activeDefinition?.comingSoon);

  return (
    <FeatureGateContext.Provider value={value}>
      {children}

      <Dialog open={Boolean(feature) && !isFeatureAccessLoading} onOpenChange={(open) => !open && setFeature(null)}>
        <DialogContent className="overflow-hidden border-0 p-0 shadow-[0_34px_90px_-35px_rgba(0,50,35,0.5)] sm:max-w-[520px]">
          <div className="bg-gradient-to-br from-[#003223] via-[#0B5137] to-[#FF6400] px-6 py-6 text-white">
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                {isComingSoon ? <Clock className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
              </div>
              <Badge className="border-white/20 bg-white/15 text-white hover:bg-white/15">
                {isComingSoon ? 'Em breve' : `Plano ${requiredPlan?.shortName || requiredPlan?.name}`}
              </Badge>
            </div>
            <DialogHeader className="mt-5 text-left">
              <DialogTitle className="text-2xl font-bold leading-tight text-white">
                {isComingSoon ? `${activeDefinition?.name} está chegando` : `${activeDefinition?.name} é do plano ${requiredPlan?.name}`}
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-white/82">
                {isComingSoon
                  ? 'Essa funcionalidade já está no roadmap do PopSystem, mas ainda não está liberada para uso em produção.'
                  : `Para usar ${activeDefinition?.name}, seu restaurante precisa estar no plano ${requiredPlan?.name} ou superior.`}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div className="rounded-2xl border border-[#FF6400]/15 bg-[#FFF8F2] px-4 py-4">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-5 w-5 text-[#FF6400]" />
                <div>
                  <div className="text-sm font-semibold text-[#003223]">
                    {activeDefinition?.description}
                  </div>
                  {requiredPlan && (
                    <div className="mt-1 text-xs leading-5 text-slate-600">
                      {isMultiPlan
                        ? `Liberado no plano Multi. O valor base é ${formatBRL(requiredPlan.monthlyPrice)} e cada loja adicional soma ${formatBRL(requiredPlan.extraStorePrice || 189)}.`
                        : `Incluído no plano ${requiredPlan.name}, com mensalidade de ${formatBRL(requiredPlan.monthlyPrice)}.`}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!isComingSoon && requiredPlan && (
              <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Crown className="h-4 w-4 text-[#FF6400]" />
                  Plano recomendado: {requiredPlan.name}
                </div>
                <div className="text-xs leading-5 text-slate-600">
                  A contratação é feita na tela de planos e o pagamento será processado pelo Asaas.
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 border-t bg-slate-50 px-6 py-4 sm:justify-between sm:space-x-0">
            <Button variant="outline" onClick={() => setFeature(null)} className="rounded-xl">
              {isComingSoon ? 'Entendi' : 'Agora não'}
            </Button>
            {!isComingSoon && (
              <Button onClick={goToPlan} className="rounded-xl bg-[#FF6400] text-white hover:bg-[#e55a00]">
                Ver planos
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FeatureGateContext.Provider>
  );
};

export const useFeatureGate = () => {
  const context = useContext(FeatureGateContext);
  if (!context) {
    throw new Error('useFeatureGate must be used within FeatureGateProvider');
  }
  return context;
};
