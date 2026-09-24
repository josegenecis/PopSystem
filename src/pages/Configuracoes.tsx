
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ProfileSettings from '@/components/settings/ProfileSettings';
import WhatsAppSettings from '@/components/settings/WhatsAppSettings';
import MenuOrdersSettings from '@/components/settings/MenuOrdersSettings';
import { ErrorBoundary } from '@/components/utils/ErrorBoundary';
import WhatsAppIntegration from '@/components/whatsapp/WhatsAppIntegration';
import { useAuth } from '@/contexts/AuthContext';

import IfoodSettings from '@/components/settings/IfoodSettings';
import SupportSettings from '@/components/settings/SupportSettings';
import TotemSettings from '@/components/settings/TotemSettings';
import { UsersRound } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';


import { IfoodLogo } from '@/components/icons/IfoodLogo';
import { FeatureKey, getFeatureDefinition } from '@/lib/featureAccess';
import { useFeatureGate } from '@/components/subscription/FeatureGateProvider';
import { canAccessOperatorArea, getLocalOperatorSession, OperatorArea } from '@/services/operatorAuth';

const SETTINGS_TAB_ORDER = [
  'profile',
  'menu-orders',
  'whatsapp',
  'whatsapp-api',
  'ifood',
  'users',
  'support',
  'totem',
] as const;

const SETTINGS_TAB_FEATURES: Record<string, FeatureKey> = {
  profile: 'settings',
  'menu-orders': 'settings',
  whatsapp: 'whatsapp',
  'whatsapp-api': 'whatsapp',
  ifood: 'ifood',
  users: 'team',
  support: 'settings',
  totem: 'settings',
};

const SETTINGS_TAB_AREAS: Record<string, OperatorArea> = {
  profile: 'settings',
  'menu-orders': 'settings',
  whatsapp: 'whatsapp',
  'whatsapp-api': 'whatsapp',
  ifood: 'integrations',
  users: 'team',
  support: 'settings',
  totem: 'settings',
};

const Configuracoes: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { subscription } = useAuth();
  const { canAccessFeature, isFeatureAccessLoading, openFeatureDialog } = useFeatureGate();
  const operatorSession = useMemo(() => getLocalOperatorSession(), []);

  const canAccessOperatorTab = useCallback((nextTab: string) => {
    return canAccessOperatorArea(operatorSession, SETTINGS_TAB_AREAS[nextTab]);
  }, [operatorSession]);

  const canOpenTab = useCallback((nextTab: string) => {
    const feature = SETTINGS_TAB_FEATURES[nextTab];
    return canAccessOperatorTab(nextTab) && (!feature || canAccessFeature(feature));
  }, [canAccessFeature, canAccessOperatorTab]);

  const tabLabel = (label: React.ReactNode, feature?: FeatureKey) => {
    const definition = feature ? getFeatureDefinition(feature) : null;
    return (
      <span className="flex items-center gap-2">
        <span className="flex items-center">{label}</span>
        {definition?.comingSoon && (
          <Badge className="border-[#FF6400]/25 bg-[#FFF1E8] px-1.5 py-0 text-[9px] text-[#C14E00] hover:bg-[#FFF1E8]">
            Em breve
          </Badge>
        )}
      </span>
    );
  };

  const getInitialTab = useCallback(() => {
    const legacySections: Record<string, string> = {
      appearance: 'digital',
      'table-qr': 'tables',
      delivery: 'delivery',
      'payment-methods': 'payments',
      pix: 'payments',
      notifications: 'orders',
      hardware: 'printing',
    };
    const rawRequested = searchParams.get('tab') || 'profile';
    const requested = legacySections[rawRequested] ? 'menu-orders' : rawRequested;
    if (SETTINGS_TAB_ORDER.includes(requested as typeof SETTINGS_TAB_ORDER[number]) && canOpenTab(requested)) {
      return requested;
    }

    return SETTINGS_TAB_ORDER.find((candidate) => canOpenTab(candidate)) || 'profile';
  }, [canOpenTab, searchParams]);

  const [tab, setTab] = useState(getInitialTab);

  useEffect(() => {
    const legacySections: Record<string, string> = {
      appearance: 'digital',
      'table-qr': 'tables',
      delivery: 'delivery',
      'payment-methods': 'payments',
      pix: 'payments',
      notifications: 'orders',
      hardware: 'printing',
    };
    const legacyTab = searchParams.get('tab') || '';
    const section = legacySections[legacyTab];
    if (!section) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', 'menu-orders');
      next.set('section', section);
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get('tab') === 'fiscal') navigate('/fiscal?tab=issuer', { replace: true });
  }, [navigate, searchParams]);

  const setTabAndUrl = (nextTab: string) => {
    if (!canAccessOperatorTab(nextTab)) return;

    const feature = SETTINGS_TAB_FEATURES[nextTab];
    if (feature && !canAccessFeature(feature)) {
      openFeatureDialog(feature);
      return;
    }

    setTab(nextTab);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', nextTab);
      return next;
    });
  };

  useEffect(() => {
    if (isFeatureAccessLoading) return;
    const requested = searchParams.get('tab');
    if (!requested) return;
    const requestedFeature = SETTINGS_TAB_FEATURES[requested];
    if (canAccessOperatorTab(requested) && requestedFeature && !canAccessFeature(requestedFeature)) {
      openFeatureDialog(requestedFeature);
    }
    const next = getInitialTab();
    if (next !== tab) setTab(next);
  }, [canAccessFeature, canAccessOperatorTab, getInitialTab, isFeatureAccessLoading, openFeatureDialog, searchParams, tab]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
      
      {/* Seletor mobile */}
      <div className="sm:hidden">
        <Tabs value={tab} onValueChange={setTabAndUrl} className="w-full">
          <div className="mb-3">
            <select
              className="w-full h-10 rounded-md border border-input bg-white px-3 text-sm"
              value={tab}
              onChange={(e) => setTabAndUrl(e.target.value)}
            >
              {canAccessOperatorTab('profile') && <option value="profile">Perfil</option>}
              {canAccessOperatorTab('menu-orders') && <option value="menu-orders">Cardápio e pedidos</option>}
              {canAccessOperatorTab('whatsapp') && <option value="whatsapp">WhatsApp Mensagens</option>}
              {canAccessOperatorTab('whatsapp-api') && subscription?.plan_id === 2 && <option value="whatsapp-api">WhatsApp Global (Admin)</option>}
              {canAccessOperatorTab('totem') && <option value="totem">Totem</option>}
              {canAccessOperatorTab('ifood') && <option value="ifood">iFood</option>}
              {canAccessOperatorTab('users') && <option value="users">Usuários e Equipe</option>}
              {canAccessOperatorTab('support') && <option value="support">Suporte</option>}
            </select>
          </div>
        </Tabs>
      </div>

      <Tabs value={tab} onValueChange={setTabAndUrl} className="w-full">
        <TabsList className="mb-4 hidden sm:flex flex-wrap justify-start overflow-x-auto scrollbar-hide">
          {canAccessOperatorTab('profile') && <TabsTrigger value="profile">{tabLabel('Perfil', 'settings')}</TabsTrigger>}
          {canAccessOperatorTab('menu-orders') && <TabsTrigger value="menu-orders">{tabLabel('Cardápio e pedidos', 'settings')}</TabsTrigger>}
          {canAccessOperatorTab('whatsapp') && <TabsTrigger value="whatsapp">{tabLabel('WhatsApp Mensagens', 'whatsapp')}</TabsTrigger>}
          {canAccessOperatorTab('whatsapp-api') && subscription?.plan_id === 2 && <TabsTrigger value="whatsapp-api">WhatsApp Global (Admin)</TabsTrigger>}
          {canAccessOperatorTab('totem') && <TabsTrigger value="totem">{tabLabel('Totem', 'settings')}</TabsTrigger>}
          {canAccessOperatorTab('ifood') && <TabsTrigger value="ifood">
            {tabLabel(<IfoodLogo className="h-4 w-auto" />, 'ifood')}
          </TabsTrigger>}
          {canAccessOperatorTab('users') && <TabsTrigger value="users">{tabLabel('Usuários e Equipe', 'team')}</TabsTrigger>}
          {canAccessOperatorTab('support') && <TabsTrigger value="support">{tabLabel('Suporte', 'settings')}</TabsTrigger>}
        </TabsList>
        
        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>
        
        <TabsContent value="menu-orders">
          <MenuOrdersSettings />
        </TabsContent>
        
        <TabsContent value="whatsapp">
          <WhatsAppIntegration />
        </TabsContent>

        <TabsContent value="whatsapp-api">
          <WhatsAppSettings />
        </TabsContent>

        <TabsContent value="totem">
          <TotemSettings />
        </TabsContent>

        <TabsContent value="ifood">
          <IfoodSettings />
        </TabsContent>

        <TabsContent value="users">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6">
            <UsersRound className="h-7 w-7 text-emerald-700" />
            <h2 className="mt-3 text-xl font-bold text-emerald-950">Cadastros centralizados na Equipe</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Usuários, garçons, motoboys, acessos, permissões, ponto e remuneração agora pertencem ao mesmo cadastro de colaborador.</p>
            <Button className="mt-5 bg-emerald-700 hover:bg-emerald-800" onClick={() => navigate('/equipe?tab=collaborators')}>Abrir Central da Equipe</Button>
          </div>
        </TabsContent>

        <TabsContent value="support">
          <SupportSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Configuracoes;
