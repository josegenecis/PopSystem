import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, ClipboardList, CreditCard, Wallet, Ellipsis } from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import { FeatureKey } from '@/lib/featureAccess';
import { useFeatureGate } from '@/components/subscription/FeatureGateProvider';
import { canAccessOperatorArea, getLocalOperatorSession, OperatorArea } from '@/services/operatorAuth';

const MobileBottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toggleSidebar } = useSidebar();
  const { canAccessFeature, isFeatureAccessLoading, openFeatureDialog } = useFeatureGate();
  const operatorSession = getLocalOperatorSession();

  const goToFeature = (path: string, feature: FeatureKey) => {
    if (!isFeatureAccessLoading && !canAccessFeature(feature)) {
      openFeatureDialog(feature);
      return;
    }
    navigate(path);
  };

  const items = [
    { key: 'home', label: 'Início', icon: Home, onClick: () => goToFeature('/dashboard', 'dashboard'), active: location.pathname === '/dashboard', area: 'dashboard' as OperatorArea },
    { key: 'orders', label: 'Pedidos', icon: ClipboardList, onClick: () => goToFeature('/pedidos', 'orders'), active: location.pathname === '/pedidos', area: 'orders' as OperatorArea },
    { key: 'pdv', label: 'PDV', icon: CreditCard, onClick: () => goToFeature('/pdv', 'pdv'), active: location.pathname === '/pdv', area: 'pdv' as OperatorArea },
    { key: 'cash', label: 'Caixa', icon: Wallet, onClick: () => goToFeature('/caixa', 'finance'), active: location.pathname === '/caixa' || location.pathname === '/financeiro', area: 'cash' as OperatorArea },
    { key: 'more', label: 'Mais', icon: Ellipsis, onClick: () => toggleSidebar(), active: false, area: undefined },
  ].filter((item) => canAccessOperatorArea(operatorSession, item.area));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[#FF6400]/10 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.35rem)] pt-1.5 shadow-[0_-16px_40px_-24px_rgba(0,50,35,0.28)] backdrop-blur-xl md:hidden">
      <div className="mx-auto flex max-w-md items-center justify-between rounded-[22px] border border-[#FF6400]/10 bg-gradient-to-r from-[#FFF8F2] via-white to-[#F5EBE1]/85 px-1 py-1 shadow-[0_14px_30px_-22px_rgba(0,50,35,0.24)]">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[16px] px-1 py-1.5 transition-all ${
                item.active
                  ? 'bg-[#003223] text-white shadow-[0_12px_24px_-16px_rgba(0,50,35,0.7)]'
                  : 'text-[#003223]/68 hover:bg-[#F5EBE1] hover:text-[#003223]'
              }`}
            >
              <Icon className="h-[15px] w-[15px]" />
              <span className="text-[9px] font-semibold tracking-wide">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
