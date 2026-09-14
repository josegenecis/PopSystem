
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import ProfileSettings from '@/components/settings/ProfileSettings';
import NotificationSettings from '@/components/settings/NotificationSettings';
import AppearanceSettings from '@/components/settings/AppearanceSettings';
import WhatsAppSettings from '@/components/settings/WhatsAppSettings';
import DeliverySettings from '@/components/settings/DeliverySettings';
import QRCodeGenerator from '@/components/products/QRCodeGenerator';
import MenuLinkGenerator from '@/components/menu/MenuLinkGenerator';
import DeviceManager from '@/components/devices/DeviceManager';
import { ErrorBoundary } from '@/components/utils/ErrorBoundary';
import WhatsAppIntegration from '@/components/whatsapp/WhatsAppIntegration';
import { useAuth } from '@/contexts/AuthContext';

import IfoodSettings from '@/components/settings/IfoodSettings';
import PaymentMethodsSettings from '@/components/settings/PaymentMethodsSettings';
import PixSetup from '@/pages/PixSetup';
import HardwareSettings from '@/components/settings/HardwareSettings';
import SupportSettings from '@/components/settings/SupportSettings';
import TotemSettings from '@/components/settings/TotemSettings';
import Garcons from '@/pages/Garcons';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate, useSearchParams } from 'react-router-dom';


import { IfoodLogo } from '@/components/icons/IfoodLogo';
import { FeatureKey, getFeatureDefinition } from '@/lib/featureAccess';
import { useFeatureGate } from '@/components/subscription/FeatureGateProvider';
import { canAccessOperatorArea, getLocalOperatorSession, OperatorArea } from '@/services/operatorAuth';

const SETTINGS_TAB_ORDER = [
  'profile',
  'appearance',
  'delivery',
  'payment-methods',
  'pix',
  'whatsapp',
  'whatsapp-api',
  'hardware',
  'ifood',
  'users',
  'notifications',
  'support',
  'totem',
] as const;

const SETTINGS_TAB_FEATURES: Record<string, FeatureKey> = {
  profile: 'settings',
  appearance: 'settings',
  delivery: 'delivery',
  'payment-methods': 'pix',
  pix: 'pix',
  whatsapp: 'whatsapp',
  'whatsapp-api': 'whatsapp',
  hardware: 'hardware',
  ifood: 'ifood',
  users: 'team',
  notifications: 'settings',
  support: 'settings',
  totem: 'settings',
};

const SETTINGS_TAB_AREAS: Record<string, OperatorArea> = {
  profile: 'settings',
  appearance: 'settings',
  delivery: 'deliveryAreas',
  'payment-methods': 'pix',
  pix: 'pix',
  whatsapp: 'whatsapp',
  'whatsapp-api': 'whatsapp',
  hardware: 'hardware',
  ifood: 'integrations',
  users: 'team',
  notifications: 'settings',
  support: 'settings',
  totem: 'settings',
};

const Configuracoes: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { subscription } = useAuth();
  const { canAccessFeature, isFeatureAccessLoading, openFeatureDialog } = useFeatureGate();
  const { ensureSubscribed } = usePushNotifications();
  const isDesktopApp = typeof window !== 'undefined' && !!(window as typeof window & { electronAPI?: unknown }).electronAPI;
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
    const requested = searchParams.get('tab') || 'profile';
    if (SETTINGS_TAB_ORDER.includes(requested as typeof SETTINGS_TAB_ORDER[number]) && canOpenTab(requested)) {
      return requested;
    }

    return SETTINGS_TAB_ORDER.find((candidate) => canOpenTab(candidate)) || 'profile';
  }, [canOpenTab, searchParams]);

  const [tab, setTab] = useState(getInitialTab);

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
              {canAccessOperatorTab('appearance') && <option value="appearance">Cores do Cardápio</option>}
              {canAccessOperatorTab('delivery') && <option value="delivery">Delivery</option>}
              {canAccessOperatorTab('payment-methods') && <option value="payment-methods">Formas de Pagamento</option>}
              {canAccessOperatorTab('pix') && <option value="pix">PIX</option>}
              {canAccessOperatorTab('whatsapp') && <option value="whatsapp">WhatsApp Mensagens</option>}
              {canAccessOperatorTab('whatsapp-api') && subscription?.plan_id === 2 && <option value="whatsapp-api">WhatsApp Global (Admin)</option>}
              {canAccessOperatorTab('hardware') && <option value="hardware">Impressão, Balança e Leitor</option>}
              {canAccessOperatorTab('totem') && <option value="totem">Totem</option>}
              {canAccessOperatorTab('ifood') && <option value="ifood">iFood</option>}
              {canAccessOperatorTab('users') && <option value="users">Usuários e Equipe</option>}
              {canAccessOperatorTab('notifications') && <option value="notifications">Notificações</option>}
              {canAccessOperatorTab('support') && <option value="support">Suporte</option>}
            </select>
          </div>
        </Tabs>
      </div>

      <Tabs value={tab} onValueChange={setTabAndUrl} className="w-full">
        <TabsList className="mb-4 hidden sm:flex flex-wrap justify-start overflow-x-auto scrollbar-hide">
          {canAccessOperatorTab('profile') && <TabsTrigger value="profile">{tabLabel('Perfil', 'settings')}</TabsTrigger>}
          {canAccessOperatorTab('appearance') && <TabsTrigger value="appearance">{tabLabel('Cores do Cardápio', 'settings')}</TabsTrigger>}
          {canAccessOperatorTab('delivery') && <TabsTrigger value="delivery">{tabLabel('Delivery', 'delivery')}</TabsTrigger>}
          {canAccessOperatorTab('payment-methods') && <TabsTrigger value="payment-methods">{tabLabel('Formas de Pagamento', 'pix')}</TabsTrigger>}
          {canAccessOperatorTab('pix') && <TabsTrigger value="pix">{tabLabel('PIX', 'pix')}</TabsTrigger>}
          {canAccessOperatorTab('whatsapp') && <TabsTrigger value="whatsapp">{tabLabel('WhatsApp Mensagens', 'whatsapp')}</TabsTrigger>}
          {canAccessOperatorTab('whatsapp-api') && subscription?.plan_id === 2 && <TabsTrigger value="whatsapp-api">WhatsApp Global (Admin)</TabsTrigger>}
          {canAccessOperatorTab('hardware') && <TabsTrigger value="hardware">{tabLabel('Dispositivos', 'hardware')}</TabsTrigger>}
          {canAccessOperatorTab('totem') && <TabsTrigger value="totem">{tabLabel('Totem', 'settings')}</TabsTrigger>}
          {canAccessOperatorTab('ifood') && <TabsTrigger value="ifood">
            {tabLabel(<IfoodLogo className="h-4 w-auto" />, 'ifood')}
          </TabsTrigger>}
          {canAccessOperatorTab('users') && <TabsTrigger value="users">{tabLabel('Usuários e Equipe', 'team')}</TabsTrigger>}
          {canAccessOperatorTab('notifications') && <TabsTrigger value="notifications">{tabLabel('Notificações', 'settings')}</TabsTrigger>}
          {canAccessOperatorTab('support') && <TabsTrigger value="support">{tabLabel('Suporte', 'settings')}</TabsTrigger>}
        </TabsList>
        
        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>
        
        <TabsContent value="appearance">
          <AppearanceSettings />
        </TabsContent>

        <TabsContent value="notifications">
          <div className="space-y-4">
            <NotificationSettings />
            {!isDesktopApp ? (
              <div className="p-3 border rounded-lg">
                <p className="text-sm text-muted-foreground">Ative notificações push para receber alertas mesmo com o app fechado.</p>
                <div className="flex justify-end mt-2">
                  <button className="h-9 px-3 rounded-md border" onClick={() => ensureSubscribed()}>Ativar Push</button>
                </div>
              </div>
            ) : null}
            <div className="p-3 border rounded-lg">
              <p className="text-sm">Teste rápido de push</p>
              <div className="flex justify-end mt-2">
                <button
                  className="h-9 px-3 rounded-md border hover:bg-gray-100"
                  onClick={async () => {
                    try {
                      const { data: { user } } = await supabase.auth.getUser()
                      if (!user) {
                         alert('Usuário não logado');
                         return;
                      }
                      
                      const { data, error } = await supabase.functions.invoke('send-push', {
                        body: { test: true }
                      });
                      
                      if (error || !data?.ok) {
                        alert('Não foi possível enviar o teste de notificação.');
                      } else if (Number(data.delivered || 0) === 0) {
                        alert('Nenhum dispositivo inscrito. Ative as notificações primeiro.');
                      } else {
                        alert('Push enviado! Verifique as notificações.');
                      }
                    } catch (error) {
                      console.error('Erro no teste de push:', error);
                      alert('Erro inesperado no teste de push.');
                    }
                  }}
                >Enviar teste</button>
              </div>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="delivery">
          <DeliverySettings />
        </TabsContent>
        
        <TabsContent value="payment-methods">
          <PaymentMethodsSettings />
        </TabsContent>

        <TabsContent value="pix">
          <PixSetup />
        </TabsContent>
        
        <TabsContent value="whatsapp">
          <WhatsAppIntegration />
        </TabsContent>

        <TabsContent value="whatsapp-api">
          <WhatsAppSettings />
        </TabsContent>

        <TabsContent value="hardware">
          {(window as any)?.electronAPI?.isElectron ? <HardwareSettings /> : <DeviceManager />}
        </TabsContent>

        <TabsContent value="totem">
          <TotemSettings />
        </TabsContent>

        <TabsContent value="ifood">
          <IfoodSettings />
        </TabsContent>

        <TabsContent value="users">
          <Garcons />
        </TabsContent>

        <TabsContent value="support">
          <SupportSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Configuracoes;
