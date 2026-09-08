
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSidebar } from '@/contexts/SidebarContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { IfoodLogo } from '@/components/icons/IfoodLogo';
import { FeatureKey, getFeatureDefinition } from '@/lib/featureAccess';
import { useFeatureGate } from '@/components/subscription/FeatureGateProvider';
import { canAccessOperatorArea, getLocalOperatorSession, OperatorArea } from '@/services/operatorAuth';

import { useNavigate } from 'react-router-dom';
import { 
  ShoppingBag, 
  FileText, 
  Settings, 
  MapPin, 
  CreditCard,
  BarChart3,
  DollarSign,
  MessageCircle,
  ChefHat,
  Utensils,
  Crown,
  Lock,
  LockOpen,
  ChevronLeft,
  ChevronRight,
  Bot,
  User,
  LogOut,
  Package,
  Network,
  Download,
  Megaphone,
  BookOpenCheck,
  X
} from 'lucide-react';

const CollapsibleSidebar = () => {
  const { isOpen, isMobile, isPinned, setPinned, toggleSidebar, closeSidebar, openSidebar } = useSidebar();
  const { profile, subscription, user, signOut } = useAuth();
  const { canAccessFeature, openFeatureDialog } = useFeatureGate();
  const [ifoodStatus, setIfoodStatus] = useState<'online' | 'offline' | 'paused' | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const location = useLocation();

  useEffect(() => {
    if (user) {
      const checkIfoodStatus = async () => {
        const { data } = await supabase
          .from('ifood_settings')
          .select('status')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (data) {
          setIfoodStatus(data.status as any);
        }
      };
      
      checkIfoodStatus();

      // Subscribe to changes
      const channel = supabase
        .channel('sidebar-ifood-status')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'ifood_settings', filter: `user_id=eq.${user.id}` },
          (payload: any) => {
            if (payload.new) {
              setIfoodStatus(payload.new.status);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  type SidebarLink = {
    to: string;
    icon?: React.ComponentType<{ size?: number; className?: string }>;
    label: React.ReactNode;
    title?: string;
    detail?: string;
    accent?: boolean;
    feature?: FeatureKey;
    area?: OperatorArea;
  };

  const mainLinks: SidebarLink[] = [];

  const groups = [
    {
      id: 'caixa',
      icon: CreditCard,
      label: 'Caixa & PDV',
      items: [
        { to: '/caixa', label: 'Caixa Geral', feature: 'finance', area: 'finance' },
        { to: '/pdv', label: 'PDV / Frente de Caixa', feature: 'pdv', area: 'pdv' },
        { to: '/mesas', label: 'Gestão de Mesas', feature: 'tables', area: 'tables' },
        { to: '/mesas/regras', label: 'Regras de Mesa/Comanda', feature: 'tables', area: 'tables' },
      ]
    },
    {
      id: 'financeiro',
      icon: DollarSign,
      label: 'Financeiro',
      items: [
        { to: '/financeiro', label: 'Visão Geral', feature: 'finance', area: 'finance' },
        { to: '/financeiro?section=receivables', label: 'Contas a Receber', feature: 'finance', area: 'finance' },
        { to: '/despesas', label: 'Contas a Pagar', feature: 'finance', area: 'finance' },
        { to: '/pagamentos', label: 'Formas de Pagamento', feature: 'pix', area: 'pix' },
        { to: '/pix', label: 'PIX / Mercado Pago', feature: 'pix', area: 'pix' },
      ]
    },
    {
      id: 'contabilidade',
      icon: BookOpenCheck,
      label: 'Contabilidade',
      items: [
        { to: '/contador', label: 'Central do Contador', feature: 'finance', area: 'finance' },
      ]
    },
    {
      id: 'estoque',
      icon: Package,
      label: 'Estoque',
      items: [
        { to: '/estoque', label: 'Produtos e Estoque', feature: 'stock', area: 'stock' },
      ]
    },
    {
      id: 'gerencial',
      icon: BarChart3,
      label: 'Gerencial',
      items: [
        { to: '/dashboard', label: 'Visão geral', feature: 'dashboard', area: 'dashboard' },
        { to: '/relatorios', label: 'Relatórios de vendas', feature: 'reports', area: 'reports' },
        { to: '/inteligencia/cmv', label: 'CMV e rentabilidade', feature: 'cmv', area: 'stock' },
        { to: '/configuracoes?tab=users', label: 'Usuários e permissões', feature: 'team', area: 'team' },
        { to: '/garcons', label: 'Equipe operacional', feature: 'team', area: 'team' },
        { to: '/ponto', label: 'Controle de ponto', feature: 'team', area: 'team' },
      ]
    },
    {
      id: 'pedidos',
      icon: FileText,
      label: 'Pedidos',
      items: [
        { to: '/pedidos', label: 'Gestor de pedidos', feature: 'orders', area: 'orders' },
        { to: '/cozinha', label: 'Cozinha (KDS)', feature: 'kds', area: 'kds' },
      ]
    },
    {
      id: 'cardapio',
      icon: ShoppingBag,
      label: 'Cardápio',
      items: [
        { to: '/produtos', label: 'Produtos', feature: 'products', area: 'products' },
        { to: '/produtos?tab=categories', label: 'Categorias', feature: 'products', area: 'products' },
        { to: '/produtos?tab=global-variations', label: 'Adicionais', feature: 'products', area: 'products' },
        { to: '/cardapio', label: 'Acessar cardápio', feature: 'menu', area: 'products' },
        { to: '/configuracoes?tab=appearance', label: 'Cores do Cardápio', feature: 'settings', area: 'settings' },
      ]
    },
    {
      id: 'marketing',
      icon: Megaphone,
      label: 'Propaganda',
      items: [
        { to: '/marketing?tab=banners', label: 'Artes e Banners', feature: 'marketing', area: 'marketing' },
        { to: '/marketing?tab=coupons', label: 'Cupons de Desconto', feature: 'marketing', area: 'marketing' },
        { to: '/marketing?tab=highlights', label: 'Produtos em Destaque', feature: 'marketing', area: 'marketing' },
        { to: '/marketing?tab=upsells', label: 'Venda Mais', feature: 'marketing', area: 'marketing' },
        { to: '/marketing?tab=loyalty', label: 'Clientes Fiéis', feature: 'marketing', area: 'marketing' },
        { to: '/marketing?tab=pixels', label: 'Facebook e Instagram', feature: 'marketing', area: 'marketing' },
        { to: '/marketing?tab=whatsapp', label: 'Envio em massa', feature: 'whatsapp', area: 'marketing' },
        { to: '/whatsapp-bot', label: 'Robô do WhatsApp', feature: 'whatsapp', area: 'marketing' },
      ]
    },
    {
      id: 'config',
      icon: Settings,
      label: 'Configurações',
      items: [
        { to: '/configuracoes?tab=profile', label: 'Perfil', feature: 'settings', area: 'settings' },
        { to: '/configuracoes?tab=appearance', label: 'Aparência', feature: 'settings', area: 'settings' },
        { to: '/configuracoes?tab=notifications', label: 'Notificações', feature: 'settings', area: 'settings' },
        { to: '/configuracoes?tab=hardware', label: 'Impressoras e Balanças', feature: 'hardware', area: 'settings' },
        { to: '/configuracoes?tab=whatsapp', label: 'Conectar WhatsApp', feature: 'whatsapp', area: 'settings' },
        { to: '/configuracoes?tab=delivery', label: 'Delivery', feature: 'delivery', area: 'delivery' },
        { to: '/entregadores', label: 'Motoboys & Entregas', feature: 'deliveryTeam', area: 'delivery' },
        { to: '/fiscal', label: 'Configurações fiscais', feature: 'fiscal', area: 'fiscal' },
        { to: '/configuracoes?tab=ifood', label: <div className="flex items-center"><IfoodLogo className="h-4 w-auto" /></div>, title: 'iFood', feature: 'ifood', area: 'settings' },
        { to: '/configuracoes?tab=support', label: 'Suporte', feature: 'settings', area: 'settings' },
      ]
    },
  ];

  const currentPlanLabel = useMemo(() => {
    const status = String(subscription?.status || '').toLowerCase();
    if (status.includes('trial')) return 'Teste';
    if ((subscription?.plan_id || 0) >= 3) return 'Multi';
    if ((subscription?.plan_id || 0) >= 2) return 'Pro';
    return 'Plano';
  }, [subscription]);

  const trialDaysLeft = useMemo(() => {
    const status = String(subscription?.status || '').toLowerCase();
    if (!status.includes('trial') || !subscription?.trial_end) return null;

    const diff = new Date(subscription.trial_end).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [subscription]);

  const standaloneLinks: SidebarLink[] = [
    { to: '/lojas', icon: Network, label: 'Minha Rede', detail: 'Multi', feature: 'multiStore', area: 'dashboard' },
    { to: '/agente', icon: Bot, label: 'Pop Agente', feature: 'agent', area: 'agent' },
    { to: '/downloads', icon: Download, label: 'App Desktop', feature: 'desktop', area: 'desktop' },
    { to: '/subscription', icon: Crown, label: 'Planos', detail: currentPlanLabel, accent: true },
  ];

  const operatorSession = getLocalOperatorSession();
  const canSeeLink = (link: SidebarLink) => canAccessOperatorArea(operatorSession, link.area);
  const visibleMainLinks = mainLinks.filter(canSeeLink);
  const visibleStandaloneLinks = standaloneLinks.filter(canSeeLink);
  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => canSeeLink(item as SidebarLink)) }))
    .filter((group) => group.items.length > 0);


  const handleLinkClick = () => {
    if (isMobile) {
      closeSidebar();
    }
  };

  const handleFeatureLinkClick = (event: React.MouseEvent, feature?: FeatureKey) => {
    if (feature && !canAccessFeature(feature)) {
      event.preventDefault();
      openFeatureDialog(feature);
      return;
    }
    handleLinkClick();
  };

  const renderLabel = (link: SidebarLink) => {
    const definition = link.feature ? getFeatureDefinition(link.feature) : null;
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate flex items-center">{link.label}</span>
        {definition?.comingSoon && (
          <Badge className="shrink-0 border-[#FF6400]/25 bg-[#FFF1E8] px-1.5 py-0 text-[9px] text-[#C14E00] hover:bg-[#FFF1E8]">
            Em breve
          </Badge>
        )}
        {link.feature && !definition?.comingSoon && !canAccessFeature(link.feature) && (
          <Lock size={12} className="shrink-0 text-[#F5EBE1]/70" />
        )}
      </span>
    );
  };

  const isActivePath = (to: string) => {
    const [path, search] = to.split('?');
    if (location.pathname !== path) return false;

    const currentParams = new URLSearchParams(location.search);

    if (!search) {
      if (path === '/produtos') {
        const t = currentParams.get('tab');
        return !t || t === 'products';
      }
      if (path === '/configuracoes') {
        const t = currentParams.get('tab');
        return !t || t === 'general';
      }
      return true;
    }

    const targetParams = new URLSearchParams(search);
    for (const [key, value] of targetParams.entries()) {
      if (currentParams.get(key) !== value) return false;
    }
    return true;
  };

  const groupForCurrentPath = visibleGroups.find(group =>
    group.items.some(item => isActivePath(item.to))
  )?.id || '';

  const [openGroup, setOpenGroup] = useState<string>(groupForCurrentPath);

  useEffect(() => {
    if (!groupForCurrentPath) return;
    setOpenGroup(groupForCurrentPath);
  }, [location.pathname, groupForCurrentPath]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleMouseEnter = () => {
    if (isMobile || isPinned) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    openSidebar();
  };

  const handleMouseLeave = () => {
    if (isMobile || isPinned) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeSidebar();
    }, 1000);
  };

  return (
    <aside className={`
      fixed left-0 top-0 bottom-0 z-40 border-r border-[#FF6400]/25 bg-gradient-to-b from-[#003223] via-[#003223] to-[#0B5137] shadow-[8px_0_30px_-24px_rgba(0,50,35,0.45)] transition-all duration-300
      ${isMobile 
        ? `${isOpen ? 'translate-x-0' : '-translate-x-full'} w-64` 
        : `${isOpen ? 'w-64' : 'w-16'}`
      }
    `}
    onMouseEnter={handleMouseEnter}
    onMouseLeave={handleMouseLeave}
    >
      <nav className="flex h-full flex-col justify-between overflow-y-auto overscroll-contain touch-pan-y px-2 pb-20 pt-20 scrollbar-hide">
        <div className="flex-1">
        {!isOpen && !isMobile ? (
          <ul className="space-y-1">
            {[...visibleMainLinks, ...visibleGroups.flatMap(g => g.items.slice(0, 1).map(i => ({ ...i, icon: g.icon, label: g.label }))), ...visibleStandaloneLinks].map((link) => {
              const Icon = (link as any).icon;
              const isActive = isActivePath(link.to);
              return (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    onClick={(event) => handleFeatureLinkClick(event, link.feature)}
                    className={`flex items-center justify-center px-3 py-2 text-sm rounded-xl transition-colors ${
                      isActive
                        ? 'bg-[#FF6400] text-white shadow-[0_12px_24px_-18px_rgba(255,100,0,0.7)]'
                        : `${(link as any).accent ? 'text-[#8CC850]' : 'text-[#F5EBE1]'} hover:bg-[#8CC850] hover:text-[#003223]`
                    }`}
                    title={typeof link.label === 'string' ? `${link.label}${link.detail ? ` - ${link.detail}` : ''}` : link.title || ''}
                  >
                    <Icon size={18} className="flex-shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="space-y-2">
            <ul className="space-y-1 pb-2">
              {visibleMainLinks.map((link) => {
                const Icon = link.icon;
                const isActive = isActivePath(link.to);
                return (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      onClick={(event) => handleFeatureLinkClick(event, link.feature)}
                      className={`flex items-center px-3 py-2 text-sm rounded-xl transition-colors ${
                        isActive
                          ? 'bg-[#FF6400] font-medium text-white shadow-[0_12px_24px_-18px_rgba(255,100,0,0.7)]'
                          : 'text-[#F5EBE1] hover:bg-[#8CC850] hover:text-[#003223]'
                      }`}
                    >
                      <Icon size={18} className="mr-3 flex-shrink-0" />
                      {renderLabel(link)}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <Accordion type="single" collapsible value={openGroup} onValueChange={(v) => setOpenGroup(v)} className="w-full space-y-1">
              {visibleGroups.map((group) => {
                const Icon = group.icon;
                return (
                  <AccordionItem key={group.id} value={group.id} className="border-none">
                    <AccordionTrigger
                      className="rounded-xl px-3 py-2 text-sm text-[#F5EBE1] hover:bg-[#8CC850] hover:text-[#003223] hover:no-underline data-[state=open]:bg-[#8CC850] data-[state=open]:text-[#003223] data-[state=open]:shadow-[0_12px_24px_-18px_rgba(140,200,80,0.8)]"
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={18} className="flex-shrink-0" />
                        <span className="truncate">{group.label}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-0" style={{ animationDuration: '0.35s' }}>
                      <div className="mt-1 space-y-1 rounded-xl border border-[#8CC850]/30 bg-[#8CC850]/12 p-2 backdrop-blur-sm">
                        {group.items.map((item) => {
                          const isActive = isActivePath(item.to);
                          return (
                            <Link
                              key={item.to}
                              to={item.to}
                              onClick={(event) => handleFeatureLinkClick(event, item.feature as FeatureKey | undefined)}
                              className={`flex items-center px-3 py-2 text-sm rounded-lg transition-colors ${
                                isActive
                                  ? 'bg-[#FF6400] font-medium text-white shadow-[0_10px_20px_-18px_rgba(255,100,0,0.65)]'
                                  : 'text-[#F5EBE1]/95 hover:bg-[#8CC850] hover:text-[#003223]'
                              }`}
                            >
                              {renderLabel(item as SidebarLink)}
                            </Link>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>

            <ul className="space-y-1 pt-2">
              {visibleStandaloneLinks.map((link) => {
                const Icon = link.icon;
                const isActive = isActivePath(link.to);
                return (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      onClick={(event) => handleFeatureLinkClick(event, link.feature)}
                      className={`flex items-center px-3 py-2 text-sm rounded-xl transition-colors ${
                        isActive
                          ? 'bg-[#FF6400] font-medium text-white shadow-[0_12px_24px_-18px_rgba(255,100,0,0.7)]'
                          : `${link.accent ? 'text-[#8CC850]' : 'text-[#F5EBE1]'} hover:bg-[#8CC850] hover:text-[#003223]`
                      }`}
                    >
                      <Icon size={18} className="mr-3 flex-shrink-0" />
                      <div className="min-w-0">
                        <span className="block truncate">{renderLabel(link)}</span>
                        {link.detail && (
                          <span className={`block truncate text-[10px] font-semibold ${isActive ? 'text-white/85' : 'text-[#F5EBE1]/70'}`}>
                            {link.detail}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        </div>

        <div className={`mt-auto border-t border-white/10 pt-4 pb-4 ${isOpen ? 'px-2' : 'px-0'}`}>
          {isOpen ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-xl border border-[#8CC850]/60 bg-white/8 px-3 py-2 shadow-[0_0_0_1px_rgba(140,200,80,0.08),0_0_24px_-14px_rgba(140,200,80,0.8)]">
                <Avatar className="h-8 w-8 border-2 border-boracume-orange/20 flex-shrink-0">
                  <AvatarImage src={profile?.logo_url} />
                  <AvatarFallback className="bg-boracume-orange/10 text-boracume-orange font-bold text-xs">
                    {profile?.restaurant_name?.substring(0, 2).toUpperCase() || 'BC'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-white" title={profile?.restaurant_name}>
                    {profile?.restaurant_name || 'Seu Restaurante'}
                  </p>
                  <p className="truncate text-xs text-[#F5EBE1]/70" title={user?.email}>
                    {user?.email}
                  </p>
                  {trialDaysLeft !== null && (
                    <span className="mt-1 inline-flex rounded-full border border-amber-300/50 bg-amber-100/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 shadow-sm">
                      TESTE {trialDaysLeft} {trialDaysLeft === 1 ? 'Dia' : 'Dias'}
                    </span>
                  )}
                  {ifoodStatus && canAccessFeature('ifood') && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10px] leading-tight text-[#F5EBE1]/75">
                      <span className="relative flex h-2 w-2">
                         <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${ifoodStatus === 'online' ? 'bg-green-400' : 'bg-red-400'}`}></span>
                         <span className={`relative inline-flex rounded-full h-2 w-2 ${ifoodStatus === 'online' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                       </span>
                      <IfoodLogo className="h-3 w-auto" />
                      {ifoodStatus === 'online' ? 'ON' : 'OFF'}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                className="w-full justify-start text-[#8CC850] hover:bg-[#8CC850] hover:text-[#003223]"
                onClick={() => setPinned(!isPinned)}
              >
                {isPinned ? <Lock size={18} className="mr-2" /> : <LockOpen size={18} className="mr-2" />}
                {isPinned ? 'Sidebar fixa' : 'Fixar sidebar'}
              </Button>
              <Button 
                variant="ghost" 
                className="w-full justify-start text-[#F5EBE1] hover:bg-[#8CC850] hover:text-[#003223]"
                onClick={handleSignOut}
              >
                <LogOut size={18} className="mr-2" />
                Sair do sistema
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-full rounded-none p-0 text-[#8CC850] hover:bg-[#8CC850] hover:text-[#003223]"
                onClick={() => setPinned(!isPinned)}
                title={isPinned ? 'Destravar sidebar' : 'Fixar sidebar'}
              >
                {isPinned ? <Lock size={18} /> : <LockOpen size={18} />}
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-10 w-full rounded-none p-0 text-[#F5EBE1]/80 hover:bg-[#8CC850] hover:text-[#003223]"
                onClick={() => {
                  if (isMobile) {
                    closeSidebar();
                  }
                  navigate('/configuracoes?tab=profile');
                }}
                title={user?.email}
              >
                <User size={18} />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-10 w-full rounded-none p-0 text-[#F5EBE1]/80 hover:bg-[#8CC850] hover:text-[#003223]"
                onClick={handleSignOut}
                title="Sair"
              >
                <LogOut size={18} />
              </Button>
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
};

export default CollapsibleSidebar;
