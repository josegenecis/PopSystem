export type PlanCatalogItem = {
  id: number;
  slug: 'essencial' | 'pro' | 'multi';
  name: string;
  shortName: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  includedStores: number;
  extraStorePrice?: number;
  storeLimit?: number | null;
  featured?: boolean;
  badge?: string;
  accent: 'green' | 'orange' | 'purple';
  audience: string;
  features: string[];
  featureGroups: PlanFeatureGroup[];
  modules: string[];
};

export type PlanFeatureGroup = {
  title: string;
  features: string[];
  status?: 'available' | 'homologation';
};

export type BillingPeriod = 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

export type BillingPeriodConfig = {
  id: BillingPeriod;
  label: string;
  shortLabel: string;
  months: number;
  discountPercent: number;
  asaasCycle: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
};

export const BILLING_PERIODS: Record<BillingPeriod, BillingPeriodConfig> = {
  monthly: { id: 'monthly', label: 'Mensal', shortLabel: '1 mês', months: 1, discountPercent: 0, asaasCycle: 'MONTHLY' },
  quarterly: { id: 'quarterly', label: 'Trimestral', shortLabel: '3 meses', months: 3, discountPercent: 5, asaasCycle: 'QUARTERLY' },
  semiannual: { id: 'semiannual', label: 'Semestral', shortLabel: '6 meses', months: 6, discountPercent: 7, asaasCycle: 'SEMIANNUALLY' },
  yearly: { id: 'yearly', label: 'Anual', shortLabel: '12 meses', months: 12, discountPercent: 10, asaasCycle: 'YEARLY' },
};

export const getBillingPeriodConfig = (period: BillingPeriod) => BILLING_PERIODS[period] || BILLING_PERIODS.monthly;

export const calculatePeriodPrice = (monthlyValue: number, period: BillingPeriod) => {
  const config = getBillingPeriodConfig(period);
  const grossValue = Number(monthlyValue || 0) * config.months;
  const totalValue = grossValue * (1 - config.discountPercent / 100);
  return {
    ...config,
    grossValue: Number(grossValue.toFixed(2)),
    totalValue: Number(totalValue.toFixed(2)),
    monthlyEquivalent: Number((totalValue / config.months).toFixed(2)),
    savings: Number((grossValue - totalValue).toFixed(2)),
  };
};

const ESSENCIAL_FEATURE_GROUPS: PlanFeatureGroup[] = [
  {
    title: 'Vendas e atendimento',
    features: ['PDV completo', 'Pedidos de balcão, retirada e delivery', 'Mesas e comandas básicas'],
  },
  {
    title: 'Cardápio e pagamentos',
    features: ['Cardápio digital com link e QR Code', 'PIX e cadastro de formas de pagamento'],
  },
  {
    title: 'Gestão da operação',
    features: ['Fechamento de caixa', 'Delivery com áreas e taxas', 'Relatórios essenciais'],
  },
  {
    title: 'Acesso e configuração',
    features: ['Configurações gerais da loja', 'Uma loja incluída', 'Suporte PopSystem'],
  },
];

const PRO_FEATURE_GROUPS: PlanFeatureGroup[] = [
  {
    title: 'Tudo do Essencial',
    features: ['Todos os recursos de venda, atendimento, cardápio, caixa e relatórios do plano Essencial'],
  },
  {
    title: 'Atendimento e produção',
    features: [
      'Mesas, comandas, app garçom e gestão de motoboys',
      'KDS, iFood, app desktop, PopConnect, impressão e hardware',
    ],
  },
  {
    title: 'Estoque, financeiro e rentabilidade',
    features: [
      'Estoque por produto e insumo, ficha técnica e baixa automática',
      'Contas a pagar, contas a receber, caixa e despesas',
      'CMV, curva ABC e relatórios gerenciais',
    ],
  },
  {
    title: 'Equipe e produtividade',
    features: [
      'Central da Equipe, perfis, permissões e controle de ponto',
      'Jornadas e acompanhamento da equipe',
      'Assistente inteligente para tarefas e análises',
    ],
  },
  {
    title: 'Marketing e relacionamento',
    features: [
      'Tráfego pago automatizado para Facebook e Instagram',
      'WhatsApp, campanhas, cupons, fidelidade e upsell',
      'Banners, produtos em destaque e pixels de marketing',
    ],
  },
  {
    title: 'Fiscal, contabilidade e segurança',
    features: [
      'Emissão de NFC-e e NF-e com IBS/CBS',
      'XML automático e Central do Contador',
      'Auditoria, segurança e monitoramento da operação',
    ],
  },
  {
    title: 'Pagamentos e integrações',
    features: ['PIX, Mercado Pago e formas de pagamento', 'Integrações operacionais disponíveis no sistema'],
  },
];

const MULTI_FEATURE_GROUPS: PlanFeatureGroup[] = [
  {
    title: 'Tudo do Pro',
    features: ['Todos os recursos disponíveis no plano Pro'],
  },
  {
    title: 'Gestão de unidades',
    features: ['Cadastro e operação de múltiplas lojas', 'Troca rápida entre unidades', 'Operação e estoque separados por loja'],
  },
  {
    title: 'Visão da rede',
    features: ['Painel consolidado e por unidade', 'Relatórios financeiros por loja ou rede', 'Usuários e permissões por unidade'],
  },
  {
    title: 'Contratação',
    features: ['Uma loja incluída no valor base', 'R$ 189/mês por loja adicional', 'Estrutura preparada para expansão da rede'],
  },
];

export const PLAN_CATALOG: PlanCatalogItem[] = [
  {
    id: 1,
    slug: 'essencial',
    name: 'Essencial',
    shortName: 'Essencial',
    description: 'O básico profissional para vender no balcão, no delivery e organizar a operação do dia a dia.',
    monthlyPrice: 189,
    annualPrice: 2041.20,
    includedStores: 1,
    storeLimit: 1,
    badge: 'Comece organizado',
    accent: 'green',
    audience: 'Ideal para restaurantes pequenos, lanchonetes, cafeterias e operações que precisam sair do papel.',
    features: ESSENCIAL_FEATURE_GROUPS.flatMap((group) => group.features),
    featureGroups: ESSENCIAL_FEATURE_GROUPS,
    modules: [
      'PDV',
      'Cardápio Digital',
      'Pedidos',
      'Mesas',
      'Delivery',
      'PIX',
      'Relatórios'
    ]
  },
  {
    id: 2,
    slug: 'pro',
    name: 'Pro',
    shortName: 'Pro',
    description: 'Sistema completo para uma loja com automações, WhatsApp, fiscal, cozinha e inteligência operacional.',
    monthlyPrice: 289,
    annualPrice: 3121.20,
    includedStores: 1,
    storeLimit: 1,
    featured: true,
    badge: 'Completo para uma loja',
    accent: 'orange',
    audience: 'Ideal para restaurantes, lanchonetes, açaís, pizzarias e mercados que operam uma unidade.',
    features: PRO_FEATURE_GROUPS.flatMap((group) => group.features),
    featureGroups: PRO_FEATURE_GROUPS,
    modules: [
      'PDV',
      'Mesas',
      'Cardápio Digital',
      'Pedidos',
      'KDS / Cozinha',
      'Estoque',
      'Financeiro',
      'Fiscal',
      'Central do Contador',
      'Central da Equipe',
      'Marketing',
      'WhatsApp',
      'iFood',
      'App Desktop'
    ]
  },
  {
    id: 3,
    slug: 'multi',
    name: 'Multi',
    shortName: 'Multi',
    description: 'Tudo do Pro com gestão multilojas, visão consolidada e cobrança por loja adicional.',
    monthlyPrice: 389,
    annualPrice: 4201.20,
    includedStores: 1,
    extraStorePrice: 189,
    storeLimit: null,
    badge: '+ R$189 por loja extra',
    accent: 'purple',
    audience: 'Ideal para redes, grupos, franquias e donos que querem enxergar todas as lojas juntas ou separadas.',
    features: MULTI_FEATURE_GROUPS.flatMap((group) => group.features),
    featureGroups: MULTI_FEATURE_GROUPS,
    modules: [
      'Multilojas',
      'Painel consolidado',
      'Financeiro por loja',
      'Relatórios da rede',
      'Permissões por unidade',
      'Expansão'
    ]
  }
];

export const getPlanCatalogItem = (planId?: number | null, planName?: string | null) => {
  const normalizedName = String(planName || '').trim().toLowerCase();
  const normalizedId = Number(planId || 0);

  return PLAN_CATALOG.find((plan) => {
    if (normalizedId && plan.id === normalizedId) return true;
    if (!normalizedName) return false;
    if (plan.name.toLowerCase() === normalizedName) return true;
    if (plan.slug === normalizedName) return true;
    if (['essencial', 'basic', 'basico', 'básico'].includes(normalizedName)) return plan.slug === 'essencial';
    if (['profissional', 'professional', 'pro'].includes(normalizedName)) return plan.slug === 'pro';
    if (['elite', 'premium', 'multi', 'multilojas'].includes(normalizedName)) return plan.slug === 'multi';
    return false;
  });
};
