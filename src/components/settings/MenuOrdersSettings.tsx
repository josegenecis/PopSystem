import React, { Suspense, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, CreditCard, Lock, Palette, Printer, QrCode, Truck, UtensilsCrossed } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useFeatureGate } from '@/components/subscription/FeatureGateProvider';
import type { FeatureKey } from '@/lib/featureAccess';
import { lazyWithChunkRecovery } from '@/utils/lazyWithChunkRecovery';

const AppearanceSettings = lazyWithChunkRecovery(() => import('@/components/settings/AppearanceSettings'));
const DeliverySettings = lazyWithChunkRecovery(() => import('@/components/settings/DeliverySettings'));
const NotificationSettings = lazyWithChunkRecovery(() => import('@/components/settings/NotificationSettings'));
const PaymentMethodsSettings = lazyWithChunkRecovery(() => import('@/components/settings/PaymentMethodsSettings'));
const TableOrderFlowSettings = lazyWithChunkRecovery(() => import('@/components/settings/TableOrderFlowSettings'));
const ProductPreparationRoutingSettings = lazyWithChunkRecovery(() => import('@/components/settings/ProductPreparationRoutingSettings'));
const QRCodeGenerator = lazyWithChunkRecovery(() => import('@/components/products/QRCodeGenerator'));
const MenuLinkGenerator = lazyWithChunkRecovery(() => import('@/components/menu/MenuLinkGenerator'));
const DeviceManager = lazyWithChunkRecovery(() => import('@/components/devices/DeviceManager'));
const HardwareSettings = lazyWithChunkRecovery(() => import('@/components/settings/HardwareSettings'));
const PixSetup = lazyWithChunkRecovery(() => import('@/pages/PixSetup'));

const sections = [
  { id: 'digital', label: 'Cardápio digital', icon: Palette },
  { id: 'orders', label: 'Pedidos e alertas', icon: Bell },
  { id: 'tables', label: 'Mesas e QR', icon: QrCode },
  { id: 'delivery', label: 'Entrega', icon: Truck },
  { id: 'printing', label: 'Preparo e impressão', icon: Printer },
  { id: 'payments', label: 'Pagamentos', icon: CreditCard },
] as const;

type SectionId = typeof sections[number]['id'];

const sectionFeatures: Record<SectionId, FeatureKey> = {
  digital: 'menu',
  orders: 'orders',
  tables: 'tables',
  delivery: 'delivery',
  printing: 'hardware',
  payments: 'pix',
};

export default function MenuOrdersSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { ensureSubscribed } = usePushNotifications();
  const { canAccessFeature, isFeatureAccessLoading, openFeatureDialog } = useFeatureGate();
  const requested = searchParams.get('section') as SectionId | null;
  const section = useMemo<SectionId>(() => sections.some((item) => item.id === requested) ? requested! : 'digital', [requested]);
  const isDesktopApp = typeof window !== 'undefined' && Boolean((window as Window & { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron);

  useEffect(() => {
    if (requested === section) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', 'menu-orders');
      next.set('section', section);
      return next;
    }, { replace: true });
  }, [requested, section, setSearchParams]);

  const changeSection = (nextSection: string) => {
    const next = nextSection as SectionId;
    const feature = sectionFeatures[next];
    if (!isFeatureAccessLoading && !canAccessFeature(feature)) {
      openFeatureDialog(feature);
      return;
    }
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set('tab', 'menu-orders');
      params.set('section', nextSection);
      return params;
    });
  };

  const renderProtected = (sectionId: SectionId, content: React.ReactNode) => {
    const feature = sectionFeatures[sectionId];
    if (isFeatureAccessLoading || canAccessFeature(feature)) return content;

    return (
      <div className="flex min-h-56 flex-col items-center justify-center rounded-3xl border bg-white p-8 text-center shadow-sm">
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><Lock className="h-6 w-6" /></div>
        <h3 className="mt-4 text-lg font-bold text-emerald-950">Esta configuração não está disponível no plano atual</h3>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">Consulte o plano necessário antes de alterar esta parte da operação.</p>
        <Button className="mt-5" onClick={() => openFeatureDialog(feature)}>Ver plano necessário</Button>
      </div>
    );
  };

  const sendTestPush = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: 'Usuário não logado', variant: 'destructive' });
        return;
      }
      const { data, error } = await supabase.functions.invoke('send-push', { body: { test: true } });
      if (error || !data?.ok) {
        toast({ title: 'Não foi possível enviar o teste', variant: 'destructive' });
      } else if (Number(data.delivered || 0) === 0) {
        toast({ title: 'Nenhum dispositivo inscrito', description: 'Ative as notificações primeiro.' });
      } else {
        toast({ title: 'Notificação enviada', description: 'Verifique as notificações deste dispositivo.' });
      }
    } catch (error) {
      console.error('Erro no teste de push:', error);
      toast({ title: 'Erro inesperado no teste de push', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-[28px] bg-gradient-to-r from-[#003223] via-[#075c42] to-[#0b8a58] p-6 text-white shadow-xl">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-white/15 p-3"><UtensilsCrossed className="h-7 w-7" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-200">Central operacional</p>
            <h2 className="mt-1 text-2xl font-black">Cardápio e pedidos</h2>
            <p className="mt-2 max-w-3xl text-sm text-white/75">Configure como o cliente compra, como o pedido entra, para onde ele é enviado e como será pago.</p>
          </div>
        </div>
      </div>

      <Tabs value={section} onValueChange={changeSection}>
        <TabsList className="grid h-auto grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 md:grid-cols-3 xl:grid-cols-6">
          {sections.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className="h-11 gap-2 rounded-xl px-2 text-xs sm:text-sm">
              <Icon className="h-4 w-4" />{label}
            </TabsTrigger>
          ))}
        </TabsList>

        <Suspense fallback={<div className="mt-5 min-h-48 animate-pulse rounded-3xl bg-slate-100" />}>
          <TabsContent value="digital" className="mt-5 space-y-5">
            {renderProtected('digital', <><MenuLinkGenerator /><AppearanceSettings /></>)}
          </TabsContent>
          <TabsContent value="orders" className="mt-5">
            {renderProtected('orders', (
              <div className="space-y-4">
                <NotificationSettings />
                {!isDesktopApp && (
                  <div className="rounded-xl border bg-white p-4">
                    <p className="text-sm text-muted-foreground">Ative notificações push para receber alertas mesmo com o app fechado.</p>
                    <div className="mt-3 flex justify-end"><Button variant="outline" onClick={() => void ensureSubscribed()}>Ativar push</Button></div>
                  </div>
                )}
                <div className="rounded-xl border bg-white p-4">
                  <p className="text-sm font-medium">Teste rápido de notificação</p>
                  <div className="mt-3 flex justify-end"><Button variant="outline" onClick={() => void sendTestPush()}>Enviar teste</Button></div>
                </div>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="tables" className="mt-5 space-y-5">
            {renderProtected('tables', <><TableOrderFlowSettings /><QRCodeGenerator /></>)}
          </TabsContent>
          <TabsContent value="delivery" className="mt-5">
            {renderProtected('delivery', <DeliverySettings />)}
          </TabsContent>
          <TabsContent value="printing" className="mt-5 space-y-5">
            {renderProtected('printing', <><ProductPreparationRoutingSettings />{isDesktopApp ? <HardwareSettings /> : <DeviceManager />}</>)}
          </TabsContent>
          <TabsContent value="payments" className="mt-5 space-y-5">
            {renderProtected('payments', <><PaymentMethodsSettings /><PixSetup /></>)}
          </TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
