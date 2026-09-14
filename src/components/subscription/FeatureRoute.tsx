import React, { useEffect } from 'react';
import { ArrowRight, Clock, Loader2, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FeatureKey, getFeatureDefinition, getRequiredPlan } from '@/lib/featureAccess';
import { useFeatureGate } from './FeatureGateProvider';

type FeatureRouteProps = {
  feature: FeatureKey;
  children: React.ReactNode;
};

export const FeatureRoute: React.FC<FeatureRouteProps> = ({ feature, children }) => {
  const { canAccessFeature, isFeatureAccessLoading, openFeatureDialog } = useFeatureGate();
  const navigate = useNavigate();
  const definition = getFeatureDefinition(feature);
  const requiredPlan = getRequiredPlan(feature);
  const canAccess = canAccessFeature(feature);

  useEffect(() => {
    if (!isFeatureAccessLoading && !canAccess) {
      openFeatureDialog(feature);
    }
  }, [canAccess, feature, isFeatureAccessLoading, openFeatureDialog]);

  if (isFeatureAccessLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" aria-busy="true" aria-label="Carregando permissões do plano">
        <Loader2 className="h-7 w-7 animate-spin text-[#0B5137]" />
      </div>
    );
  }

  if (canAccess) {
    return <>{children}</>;
  }

  const isComingSoon = Boolean(definition.comingSoon);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl overflow-hidden rounded-[28px] border border-[#FF6400]/12 bg-white shadow-[0_32px_90px_-48px_rgba(0,50,35,0.45)]">
        <div className="bg-gradient-to-br from-[#003223] via-[#0B5137] to-[#FF6400] px-6 py-7 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
              {isComingSoon ? <Clock className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
            </div>
            <Badge className="border-white/20 bg-white/15 text-white hover:bg-white/15">
              {isComingSoon ? 'Em breve' : `Plano ${requiredPlan.name}`}
            </Badge>
          </div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight">
            {isComingSoon ? `${definition.name} está em breve` : `${definition.name} bloqueado neste plano`}
          </h1>
          <p className="mt-2 text-sm leading-6 text-white/82">
            {isComingSoon
              ? 'Essa área ainda não está liberada para uso em produção.'
              : `Essa funcionalidade está disponível a partir do plano ${requiredPlan.name}.`}
          </p>
        </div>
        <div className="space-y-4 px-6 py-6">
          <p className="text-sm leading-6 text-slate-600">{definition.description}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" className="rounded-xl" onClick={() => navigate('/dashboard')}>
              Voltar ao painel
            </Button>
            {!isComingSoon && (
              <Button className="rounded-xl bg-[#FF6400] text-white hover:bg-[#e55a00]" onClick={() => navigate(`/subscription?plan=${requiredPlan.id}`)}>
                Contratar plano
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
