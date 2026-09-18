import React, { useEffect, useState } from 'react';
import {
  Menu,
  Wallet,
  MessageCircle,
  ClipboardList,
  Monitor,
  Table2,
  ArrowDown,
  ArrowUp,
  Lock,
  Unlock,
  ChevronDown,
  ArchiveRestore,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import Logo from '@/components/Logo';
import OperatorSwitcher from '@/components/OperatorSwitcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FeatureKey } from '@/lib/featureAccess';
import { useFeatureGate } from '@/components/subscription/FeatureGateProvider';
import StoreSwitcher from '@/components/multistore/StoreSwitcher';
import { AssistantPopButton } from '@/components/agent/AssistantPopButton';
import { useWhatsAppInbox } from '@/contexts/WhatsAppInboxContext';
import { canAccessOperatorArea, getLocalOperatorSession, OperatorArea } from '@/services/operatorAuth';

const FixedHeader = () => {
  const { user } = useAuth();
  const { isMobile, toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const { canAccessFeature, isFeatureAccessLoading, openFeatureDialog } = useFeatureGate();
  const [cashStatus, setCashStatus] = useState<'open' | 'closed'>('closed');
  const [whatsAppConnected, setWhatsAppConnected] = useState(false);
  const { totalUnread, urgentConversations } = useWhatsAppInbox();
  const operatorSession = getLocalOperatorSession();
  const canAccessCash = canAccessOperatorArea(operatorSession, 'cash');

  useEffect(() => {
    if (!user?.id) return;

    let active = true;

    const loadCashStatus = async () => {
      try {
        const { data, error } = await supabase
          .from('cash_register_sessions' as any)
          .select('id')
          .eq('user_id', user.id)
          .eq('status', 'open')
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!active) return;
        if (error) throw error;
        setCashStatus(data?.id ? 'open' : 'closed');
      } catch {
        if (!active) return;
        setCashStatus('closed');
      }
    };

    void loadCashStatus();

    const handleCashChange = () => {
      void loadCashStatus();
    };

    window.addEventListener('cash-session-changed', handleCashChange);
    return () => {
      active = false;
      window.removeEventListener('cash-session-changed', handleCashChange);
    };
  }, [user?.id]);

  useEffect(() => {
    let active = true;

    const loadWhatsAppStatus = async () => {
      try {
        const { data } = await supabase.functions.invoke('whatsapp-status', { body: { _storeId: user?.id } });
        if (!active) return;
        setWhatsAppConnected(data?.status === 'connected');
      } catch {
        if (!active) return;
        setWhatsAppConnected(false);
      }
    };

    void loadWhatsAppStatus();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadWhatsAppStatus();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadWhatsAppStatus();
    }, 2 * 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [user?.id]);

  const goToFeature = (path: string, feature: FeatureKey) => {
    if (!isFeatureAccessLoading && !canAccessFeature(feature)) {
      openFeatureDialog(feature);
      return;
    }
    navigate(path);
  };

  const cashActionPath = (action: 'open' | 'close' | 'in' | 'out') => `/caixa?cashAction=${action}`;
  const primaryShortcuts = [
    { label: 'PDV', icon: Monitor, path: '/pdv', feature: 'pdv' as FeatureKey, area: 'pdv' as OperatorArea },
    { label: 'Pedidos', icon: ClipboardList, path: '/pedidos', feature: 'orders' as FeatureKey, area: 'orders' as OperatorArea },
    { label: 'Mesas', icon: Table2, path: '/mesas', feature: 'tables' as FeatureKey, area: 'tables' as OperatorArea },
    { label: 'WhatsApp', icon: MessageCircle, path: '/whatsapp-bot', feature: 'whatsapp' as FeatureKey, area: 'whatsapp' as OperatorArea },
  ];

  const openCashDrawer = async () => {
    const result = await PrinterService.openCashDrawer();
    if (result?.success) {
      toast.success('Gaveta aberta');
      return;
    }
    toast.error(result?.error || 'Não foi possível abrir a gaveta');
  };

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-[color:var(--app-primary-border)] bg-white shadow-[0_12px_30px_-24px_rgba(var(--app-primary-rgb),0.2)]">
      <div className={`flex items-center justify-between ${isMobile ? 'mobile-safe-x px-3 py-2' : 'px-3 py-3 sm:px-6'}`}>
        <div className="flex items-center space-x-2 sm:space-x-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className="h-8 w-8 rounded-[16px] border border-[color:var(--app-primary-border)] bg-white p-0 text-[var(--app-primary-deep)] shadow-sm hover:bg-[var(--app-primary-soft)]"
          >
            <Menu size={16} />
          </Button>
          <Logo size="sm" className={isMobile ? 'max-w-[150px]' : ''} />
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          <StoreSwitcher />
          {canAccessCash && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={`h-9 rounded-xl border font-semibold shadow-sm hover:bg-[var(--app-primary-soft)] ${
                  cashStatus === 'open'
                    ? 'border-[var(--app-primary)] bg-[var(--app-primary-soft)] text-[var(--app-primary-deep)]'
                    : 'border-[color:var(--app-primary-border)] bg-white text-[var(--app-primary-deep)]'
                } ${isMobile ? 'h-8 w-8 rounded-[16px] p-0 md:hidden' : 'hidden px-3 md:inline-flex'}`}
              >
                <Wallet size={16} className={isMobile ? '' : 'mr-2'} />
                {!isMobile && 'Caixa'}
                {!isMobile && <ChevronDown size={14} className="ml-2 opacity-70" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Operação de caixa</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => goToFeature(cashActionPath(cashStatus === 'open' ? 'close' : 'open'), 'finance')}>
                {cashStatus === 'open' ? <Unlock className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
                {cashStatus === 'open' ? 'Fechar caixa' : 'Abrir caixa'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => goToFeature(cashActionPath('in'), 'finance')}>
                <ArrowUp className="mr-2 h-4 w-4" />
                Suprimento
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => goToFeature(cashActionPath('out'), 'finance')}>
                <ArrowDown className="mr-2 h-4 w-4" />
                Sangria
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void openCashDrawer()}>
                <ArchiveRestore className="mr-2 h-4 w-4" />
                Abrir gaveta
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => goToFeature('/caixa', 'finance')}>
                <Wallet className="mr-2 h-4 w-4" />
                Ver caixa
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          <div className="lg:hidden">
            <OperatorSwitcher compact />
          </div>
          <div className="hidden lg:block">
            <OperatorSwitcher />
          </div>
          <div className="hidden items-center gap-1.5 lg:flex">
            {primaryShortcuts.filter((shortcut) => canAccessOperatorArea(operatorSession, shortcut.area)).map((shortcut) => {
              const Icon = shortcut.icon;
              const isWhatsApp = shortcut.label === 'WhatsApp';
              return (
                <Button
                  key={shortcut.label}
                  variant="outline"
                  size="sm"
                  className={`relative h-9 rounded-xl border-[color:var(--app-primary-border)] bg-white px-3 font-semibold text-[var(--app-primary-deep)] shadow-sm hover:bg-[var(--app-primary-soft)] ${
                    isWhatsApp && whatsAppConnected ? 'border-[var(--app-primary)] bg-[var(--app-primary-soft)] text-[var(--app-primary-deep)]' : ''
                  }`}
                  onClick={() => goToFeature(shortcut.path, shortcut.feature)}
                >
                  <Icon size={15} className="mr-2" />
                  {shortcut.label}
                  {isWhatsApp && (
                    totalUnread > 0 ? (
                      <span className={`ml-2 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white ${urgentConversations > 0 ? 'animate-pulse' : ''}`} aria-label={`${totalUnread} mensagens não lidas`}>
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    ) : (
                      <span className={`ml-2 h-2.5 w-2.5 rounded-full border border-white ${whatsAppConnected ? 'bg-[#22c55e]' : 'bg-red-500'}`} aria-label={whatsAppConnected ? 'WhatsApp conectado' : 'WhatsApp desconectado'} />
                    )
                  )}
                </Button>
              );
            })}
          </div>
          {canAccessOperatorArea(operatorSession, 'agent') && (
            <AssistantPopButton
              compact={isMobile}
              canOpen={isFeatureAccessLoading || canAccessFeature('agent')}
              onBlocked={() => openFeatureDialog('agent')}
            />
          )}
        </div>
      </div>
    </header>
  );
};

export default FixedHeader;
