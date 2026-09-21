
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  ShoppingBag, 
  FileText, 
  Settings, 
  Users, 
  MapPin, 
  CreditCard,
  ChefHat,
  Utensils,
  Crown,
  Download,
  Tag,
  QrCode,
  Bot,
  Bug,
  Megaphone,
  Package
} from 'lucide-react';

const SidebarLinks = () => {
  const location = useLocation();

  const links = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/pedidos', icon: FileText, label: 'Pedidos' },
    { to: '/pdv', icon: CreditCard, label: 'PDV (Ponto de Venda)' },
    { to: '/mesas', icon: Utensils, label: 'Mesas' },
    { to: '/produtos', icon: ShoppingBag, label: 'Produtos' },
    { to: '/cardapio', icon: QrCode, label: 'Cardápio Digital' },
    { to: '/estoque', icon: Package, label: 'Estoque' },
    { to: '/compras', icon: ShoppingBag, label: 'Compras e Fornecedores' },
    { to: '/cozinha', icon: ChefHat, label: 'Cozinha (KDS)' },
    { to: '/marketing?tab=whatsapp', icon: Megaphone, label: 'Envio em massa' },
    { to: '/financeiro', icon: CreditCard, label: 'Financeiro' },
    { to: '/pix', icon: CreditCard, label: 'PIX / Mercado Pago' },
    { to: '/agente', icon: Bot, label: 'Pop Agente' },
    { to: '/downloads', icon: Download, label: 'App Desktop' },
    { to: '/configuracoes', icon: Settings, label: 'Configurações' },
    { to: '/subscription', icon: Crown, label: 'Planos' },
    ...(import.meta.env.DEV ? [{ to: '/debug-pix', icon: Bug, label: 'Debug Pix' }] : []),
  ];

  return (
    <nav className="mt-8 px-4">
      <ul className="space-y-2">
        {links.map((link) => {
          const Icon = link.icon;
          const linkPath = link.to.split('?')[0];
          const isActive = location.pathname === linkPath;
          
          return (
            <li key={link.to}>
              <Link
                to={link.to}
                className={`flex items-center px-4 py-2 text-sm rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon size={18} className="mr-3" />
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default SidebarLinks;
