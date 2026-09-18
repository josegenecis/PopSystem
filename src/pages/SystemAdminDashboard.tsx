import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Command,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageCircle,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
  Waypoints,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import ClientOperationsWorkspace from '@/components/admin/ClientOperationsWorkspace';
import RepresentativeManagement from '@/components/admin/RepresentativeManagement';

type MetricMap = Record<string, number>;
type WorkspaceView = 'overview' | 'clients' | 'commercial';

export interface AdminClientRow {
  id: string;
  restaurantName: string;
  email?: string;
  phone?: string;
  ownerPhone?: string;
  restaurantPhone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  locationVerifiedByPostalCode?: boolean;
  createdAt?: string;
  updatedAt?: string | null;
  lastSignInAt?: string | null;
  lastAccessAt?: string | null;
  subscriptionStatus?: string;
  planName?: string;
  planPrice?: number;
  trialEnd?: string | null;
  currentPeriodEnd?: string | null;
  accessOverrideUntil?: string | null;
  accessAllowed?: boolean;
  ordersMonth?: number;
  lastOrderAt?: string | null;
  productsCount?: number;
  customersCount?: number;
  whatsappEnabled?: boolean;
  nfceAuthorizedMonth?: number;
  nfceRejectedMonth?: number;
  reasons?: string[];
  accessStatus?: string;
  financialStatus?: string;
  billingAmount?: number;
  paymentMethod?: string | null;
  overdueDays?: number;
  healthScore?: number;
  healthClassification?: string;
  healthReasons?: string[];
  ownerName?: string | null;
  ownerEmail?: string | null;
  commercialStage?: string;
  onboardingStage?: string;
  priority?: string;
  nextAction?: string | null;
  nextActionAt?: string | null;
  openTickets?: number;
  latestInvoice?: { status?: string; amount?: number; due_date?: string; invoice_url?: string } | null;
}

export interface AdminMember {
  id: string;
  email: string;
  display_name: string;
  role: string;
  active?: boolean;
}

export interface CommercialLead {
  id: string;
  representative_member_id: string;
  restaurant_name: string;
  owner_name: string;
  owner_phone: string;
  email?: string | null;
  postal_code: string;
  city: string;
  state: string;
  interest_level: string;
  commercial_stage: string;
  marketing_consent: boolean;
  last_visit_at: string;
  internal_admin_members?: { display_name?: string; email?: string } | null;
}

interface ChartPoint {
  label?: string;
  value?: number;
  date?: string;
  cadastros?: number;
  acessos?: number;
  pedidos?: number;
}

interface AdminDashboardData {
  generatedAt: string;
  metrics: MetricMap;
  lists: {
    newToday: AdminClientRow[];
    recentSignups: AdminClientRow[];
    delinquent: AdminClientRow[];
    trialExpiring: AdminClientRow[];
    attention: AdminClientRow[];
    activeByAccess: AdminClientRow[];
    inactiveByAccess: AdminClientRow[];
    neverAccessed: AdminClientRow[];
    paidThisMonth: AdminClientRow[];
    portfolio: AdminClientRow[];
    commercialLeads: CommercialLead[];
  };
  members?: AdminMember[];
  analytics?: {
    cityHeatmap: ChartPoint[];
    stateHeatmap: ChartPoint[];
    statusBreakdown: ChartPoint[];
    activityBreakdown: ChartPoint[];
    signupTrend: ChartPoint[];
    accessTrend: ChartPoint[];
    orderTrend: ChartPoint[];
    representativeLeadStages: ChartPoint[];
  };
}

const SESSION_KEY = 'popsystem-internal-admin-token';
const CHART_COLORS = ['#059669', '#0f172a', '#f59e0b', '#64748b', '#ef4444', '#0ea5e9'];

const VIEW_META: Record<WorkspaceView, { label: string; eyebrow: string; description: string; icon: React.ElementType }> = {
  overview: {
    label: 'Visão geral',
    eyebrow: 'Central de comando',
    description: 'Indicadores, prioridades e saúde da operação em um único lugar.',
    icon: LayoutDashboard,
  },
  clients: {
    label: 'Clientes',
    eyebrow: 'Operação da carteira',
    description: 'Gestão completa de clientes, acessos, cobrança e acompanhamento.',
    icon: Building2,
  },
  commercial: {
    label: 'Comercial',
    eyebrow: 'Crescimento e cobertura',
    description: 'Representantes, leads, funil e distribuição geográfica da base.',
    icon: Waypoints,
  },
};

const formatCurrency = (value?: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const formatNumber = (value?: number) => new Intl.NumberFormat('pt-BR').format(Number(value || 0));

const formatPercent = (value?: number, total?: number) => {
  if (!total) return '0%';
  return `${Math.round((Number(value || 0) / Number(total)) * 100)}%`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Sem registro';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem registro';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const normalizePhoneForWhatsApp = (phone?: string) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
};

const whatsappLink = (client: AdminClientRow) => {
  const phone = normalizePhoneForWhatsApp(client.ownerPhone || client.phone || client.restaurantPhone);
  if (!phone || phone.length < 12) return '';
  const message = encodeURIComponent(
    `Olá, tudo bem? Aqui é da PopSystem. Quero ajudar o ${client.restaurantName} a aproveitar melhor o sistema.`,
  );
  return `https://wa.me/${phone}?text=${message}`;
};

const normalizeStatusLabel = (status?: string) => {
  const value = String(status || '').toLowerCase();
  if (['active', 'paid', 'current'].includes(value)) return 'Ativo';
  if (value.includes('trial') || value === 'teste') return 'Teste';
  if (['past_due', 'unpaid', 'overdue', 'inadimplente'].includes(value)) return 'Inadimplente';
  if (['blocked', 'suspended'].includes(value)) return 'Bloqueado';
  if (!value || value === 'sem_assinatura') return 'Sem assinatura';
  return value.replaceAll('_', ' ');
};

const statusClassName = (status?: string) => {
  const value = String(status || '').toLowerCase();
  if (['active', 'paid', 'current'].includes(value)) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (value.includes('trial') || value === 'teste') return 'border-sky-200 bg-sky-50 text-sky-700';
  if (['past_due', 'unpaid', 'overdue', 'inadimplente', 'blocked', 'suspended'].includes(value)) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
};

const lastAccessLabel = (value?: string | null) => {
  if (!value) return 'Nunca acessou';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Nunca acessou';
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return `Há ${days} dias`;
};

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  alert = false,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ElementType;
  alert?: boolean;
}) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <span className={`rounded-lg p-2 ${alert ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">{title}</CardTitle>
        <p className="text-xs leading-5 text-slate-500">{description}</p>
      </CardHeader>
      <CardContent className="h-[260px] p-4 pt-2">{children}</CardContent>
    </Card>
  );
}

function HealthCard({ metrics }: { metrics: MetricMap }) {
  const items = [
    { label: 'Assinaturas ativas', value: metrics.activeClients, tone: 'bg-emerald-500' },
    { label: 'Uso nos últimos 7 dias', value: metrics.accessed7Days, tone: 'bg-sky-500' },
    { label: 'WhatsApp configurado', value: metrics.whatsappConfigured, tone: 'bg-violet-500' },
    { label: 'Inadimplência', value: metrics.delinquentClients, tone: 'bg-rose-500' },
  ];

  return (
    <Card className="overflow-hidden border-0 bg-slate-950 text-white shadow-xl shadow-slate-950/10">
      <CardHeader className="p-6 pb-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">Pulso da base</p>
            <CardTitle className="mt-2 text-xl text-white">Saúde operacional</CardTitle>
          </div>
          <Activity className="h-5 w-5 text-emerald-400" />
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-6 pt-3">
        {items.map((item) => {
          const percent = metrics.totalClients
            ? Math.round((Number(item.value || 0) / Number(metrics.totalClients)) * 100)
            : 0;
          return (
            <div key={item.label}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-slate-300">{item.label}</span>
                <span className="font-semibold text-white">{percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full ${item.tone}`} style={{ width: `${Math.min(percent, 100)}%` }} />
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-5">
          <div>
            <p className="text-xs text-slate-400">Ativos em 30 dias</p>
            <p className="mt-1 text-2xl font-semibold">{formatNumber(metrics.accessed30Days)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Clientes críticos</p>
            <p className="mt-1 text-2xl font-semibold text-rose-300">{formatNumber(metrics.criticalClients)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionQueue({
  clients,
  onOpenClients,
  onRelease24h,
  releasingClientId,
}: {
  clients: AdminClientRow[];
  onOpenClients: () => void;
  onRelease24h: (client: AdminClientRow) => void;
  releasingClientId: string;
}) {
  const visibleClients = clients.slice(0, 6);

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="flex-row items-center justify-between space-y-0 p-5 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">Prioridades de hoje</p>
          <CardTitle className="mt-1 text-lg text-slate-950">Fila de ação</CardTitle>
          <p className="mt-1 text-sm text-slate-500">Os casos mais urgentes para financeiro, suporte e sucesso.</p>
        </div>
        <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
          {formatNumber(clients.length)} pendências
        </Badge>
      </CardHeader>
      <CardContent className="p-5 pt-1">
        {visibleClients.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
            <ShieldCheck className="mx-auto h-6 w-6 text-emerald-600" />
            <p className="mt-3 text-sm font-medium text-slate-700">Nenhuma prioridade crítica agora.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleClients.map((client) => {
              const link = whatsappLink(client);
              return (
                <div key={client.id} className="flex flex-col gap-3 py-4 first:pt-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-slate-900">{client.restaurantName}</p>
                      <Badge variant="outline" className={statusClassName(client.subscriptionStatus)}>
                        {normalizeStatusLabel(client.subscriptionStatus)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {client.reasons?.slice(0, 2).join(' • ') || `${lastAccessLabel(client.lastAccessAt)} sem atividade relevante`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {client.accessAllowed === false && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={releasingClientId === client.id}
                        onClick={() => onRelease24h(client)}
                        className="h-8"
                      >
                        <CalendarClock className={`mr-1.5 h-3.5 w-3.5 ${releasingClientId === client.id ? 'animate-spin' : ''}`} />
                        Liberar 24h
                      </Button>
                    )}
                    {link && (
                      <Button asChild size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700">
                        <a href={link} target="_blank" rel="noreferrer">
                          <PhoneCall className="mr-1.5 h-3.5 w-3.5" />
                          Contatar
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Button variant="ghost" onClick={onOpenClients} className="mt-2 w-full justify-between text-slate-600 hover:text-slate-950">
          Abrir carteira completa
          <ArrowUpRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function ClientList({
  clients,
  emptyText,
  onRelease24h,
  releasingClientId,
}: {
  clients: AdminClientRow[];
  emptyText: string;
  onRelease24h?: (client: AdminClientRow) => void;
  releasingClientId?: string;
}) {
  if (clients.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">{emptyText}</div>;
  }

  return (
    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-4">
      {clients.slice(0, 10).map((client) => {
        const link = whatsappLink(client);
        return (
          <div key={client.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-semibold text-slate-900">{client.restaurantName}</p>
                <Badge variant="outline" className={statusClassName(client.subscriptionStatus)}>
                  {normalizeStatusLabel(client.subscriptionStatus)}
                </Badge>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                {client.email || 'Sem e-mail'} · {client.city || 'Cidade não informada'}/{client.state || 'NI'} · {lastAccessLabel(client.lastAccessAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden text-xs text-slate-500 sm:inline">{formatNumber(client.ordersMonth)} pedidos/mês</span>
              {onRelease24h && client.accessAllowed === false && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={releasingClientId === client.id}
                  onClick={() => onRelease24h(client)}
                  className="h-8"
                >
                  <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                  Liberar 24h
                </Button>
              )}
              {link && (
                <Button asChild size="sm" variant="outline" className="h-8">
                  <a href={link} target="_blank" rel="noreferrer">
                    <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                    WhatsApp
                  </a>
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {clients.length > 10 && (
        <p className="py-3 text-center text-xs font-medium text-slate-500">Exibindo 10 de {formatNumber(clients.length)} clientes</p>
      )}
    </div>
  );
}

function HeatmapList({ title, description, items }: { title: string; description: string; items: ChartPoint[] }) {
  const maximum = Math.max(...items.map((item) => Number(item.value || 0)), 1);
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-slate-900">
          <MapPin className="h-4 w-4 text-emerald-600" />
          {title}
        </CardTitle>
        <p className="text-xs leading-5 text-slate-500">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4 p-5 pt-1">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-500">Sem dados de localização.</p>
        ) : (
          items.slice(0, 8).map((item, index) => (
            <div key={`${item.label}-${index}`}>
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium text-slate-700">{item.label || 'Não informado'}</span>
                <span className="font-semibold text-slate-950">{formatNumber(item.value)}</span>
              </div>
              <Progress value={(Number(item.value || 0) / maximum) * 100} className="h-1.5" />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function SystemAdminDashboard() {
  const [email, setEmail] = useState('admin@popsystem.com.br');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(() => sessionStorage.getItem(SESSION_KEY) || '');
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>('overview');
  const [loading, setLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [releasingClientId, setReleasingClientId] = useState('');

  const metrics = data?.metrics || {};
  const lists = data?.lists;
  const analytics = data?.analytics;
  const accessHealth = useMemo(
    () => formatPercent(metrics.accessed7Days, metrics.totalClients),
    [metrics.accessed7Days, metrics.totalClients],
  );
  const currentView = VIEW_META[activeView];
  const CurrentViewIcon = currentView.icon;

  const loadDashboard = useCallback(
    async (sessionToken = token) => {
      if (!sessionToken) return;
      setLoading(true);
      try {
        const { data: response, error } = await supabase.functions.invoke('admin-dashboard', {
          body: { token: sessionToken },
        });
        if (error) throw error;
        if (!response?.ok) throw new Error(response?.error || 'Não foi possível carregar o painel.');
        setData(response as AdminDashboardData);
      } catch (error: unknown) {
        sessionStorage.removeItem(SESSION_KEY);
        setToken('');
        setData(null);
        toast.error(getErrorMessage(error, 'Sessão interna expirada. Entre novamente.'));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (token) void loadDashboard(token);
  }, [loadDashboard, token]);

  useEffect(() => {
    if (token) return;
    void supabase.functions.invoke('admin-dashboard', { body: { action: 'session_login' } }).then(({ data: response }) => {
      if (!response?.ok || !response?.token) return;
      sessionStorage.setItem(SESSION_KEY, response.token);
      setToken(response.token);
    });
  }, [token]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginLoading(true);
    try {
      const { data: response, error } = await supabase.functions.invoke('admin-dashboard', {
        body: { action: 'login', email, password },
      });
      if (error) throw error;
      if (!response?.ok || !response?.token) throw new Error(response?.error || 'Login interno inválido.');
      sessionStorage.setItem(SESSION_KEY, response.token);
      setToken(response.token);
      setPassword('');
      toast.success('Painel interno liberado');
      await loadDashboard(response.token);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Não foi possível entrar no painel interno.'));
    } finally {
      setLoginLoading(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setToken('');
    setData(null);
  };

  const releaseClientFor24Hours = async (client: AdminClientRow) => {
    const confirmed = window.confirm(
      `Liberar ${client.restaurantName} por 24 horas? Esta cortesia só poderá ser usada uma vez neste vencimento.`,
    );
    if (!confirmed) return;

    setReleasingClientId(client.id);
    try {
      const { data: response, error } = await supabase.functions.invoke('admin-dashboard', {
        body: { action: 'grant_subscription_access_24h', token, restaurantId: client.id },
      });
      if (error) throw error;
      if (!response?.ok) throw new Error(response?.error || 'Não foi possível liberar a conta.');
      toast.success(`${response.restaurant} liberado até ${formatDateTime(response.accessUntil)}.`);
      await loadDashboard(token);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Não foi possível liberar a conta por 24 horas.'));
    } finally {
      setReleasingClientId('');
    }
  };

  if (!token) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden lg:block">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5">
              <Command className="h-6 w-6 text-emerald-400" />
            </div>
            <p className="mt-10 text-sm font-semibold uppercase tracking-[0.22em] text-emerald-400">PopSystem Command</p>
            <h1 className="mt-4 max-w-xl text-5xl font-semibold leading-[1.08] tracking-tight">
              A operação inteira, com clareza para decidir.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-slate-400">
              Clientes, receita, saúde da base e desempenho comercial em uma central de gestão privada.
            </p>
            <div className="mt-12 flex gap-8 border-t border-white/10 pt-6 text-sm text-slate-400">
              <span>Operação</span>
              <span>Financeiro</span>
              <span>Comercial</span>
            </div>
          </section>

          <Card className="mx-auto w-full max-w-md border-white/10 bg-white shadow-2xl shadow-black/30">
            <CardHeader className="p-7 pb-4">
              <div className="mb-8 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white lg:hidden">
                <Command className="h-5 w-5" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Área restrita</p>
              <CardTitle className="mt-2 text-2xl tracking-tight text-slate-950">Acesse a central interna</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Autenticação exclusiva para a equipe PopSystem.</p>
            </CardHeader>
            <CardContent className="p-7 pt-3">
              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="admin-email">E-mail corporativo</Label>
                  <Input
                    id="admin-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    required
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-password">Senha</Label>
                  <Input
                    id="admin-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                    className="h-11"
                  />
                </div>
                <Button type="submit" className="h-11 w-full bg-emerald-600 font-semibold hover:bg-emerald-700" disabled={loginLoading}>
                  {loginLoading ? 'Autenticando...' : 'Entrar no painel'}
                </Button>
              </form>
              <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                Sessão protegida e acesso monitorado
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const navItems = Object.entries(VIEW_META) as [WorkspaceView, (typeof VIEW_META)[WorkspaceView]][];

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-slate-950 text-white lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-slate-950">
            <Command className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold tracking-tight">PopSystem</p>
            <p className="text-xs text-slate-400">Command Center</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-4" aria-label="Navegação do painel">
          <p className="px-3 pb-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Workspace</p>
          {navItems.map(([key, item]) => {
            const Icon = item.icon;
            const selected = activeView === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveView(key)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  selected ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className={`h-4 w-4 ${selected ? 'text-emerald-600' : ''}`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 rounded-lg bg-white/5 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]" />
              Operação online
            </div>
            <p className="mt-2 text-xs text-slate-500">Atualizado {formatDateTime(data?.generatedAt)}</p>
          </div>
          <Button variant="ghost" onClick={logout} className="w-full justify-start text-slate-400 hover:bg-white/5 hover:text-white">
            <LogOut className="mr-2 h-4 w-4" />
            Encerrar sessão
          </Button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex min-h-20 items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                <CurrentViewIcon className="h-3.5 w-3.5" />
                {currentView.eyebrow}
              </div>
              <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{currentView.label}</h1>
              <p className="mt-1 hidden text-sm text-slate-500 sm:block">{currentView.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => loadDashboard()} disabled={loading} className="bg-white">
                <RefreshCw className={`h-4 w-4 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Atualizar</span>
              </Button>
              <Button variant="outline" size="sm" onClick={logout} className="bg-white lg:hidden">
                <LogOut className="h-4 w-4" />
                <span className="sr-only">Sair</span>
              </Button>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2 lg:hidden" aria-label="Navegação móvel">
            {navItems.map(([key, item]) => {
              const Icon = item.icon;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveView(key)}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${
                    activeView === key ? 'bg-slate-950 text-white' : 'text-slate-500'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </header>

        <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6 lg:p-8">
          {activeView === 'overview' && (
            <>
              <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-3 sm:border-b-0 sm:border-r sm:pb-0">
                  <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Activity className="h-4 w-4" /></div>
                  <div><p className="text-xs text-slate-500">Uso em 7 dias</p><p className="font-semibold text-slate-950">{accessHealth} da base</p></div>
                </div>
                <div className="flex items-center gap-3 border-b border-slate-100 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pl-4">
                  <div className="rounded-lg bg-amber-50 p-2 text-amber-700"><CalendarClock className="h-4 w-4" /></div>
                  <div><p className="text-xs text-slate-500">Testes vencendo</p><p className="font-semibold text-slate-950">{formatNumber(metrics.trialExpiring)} nesta semana</p></div>
                </div>
                <div className="flex items-center gap-3 sm:pl-4">
                  <div className="rounded-lg bg-rose-50 p-2 text-rose-700"><AlertTriangle className="h-4 w-4" /></div>
                  <div><p className="text-xs text-slate-500">Ação necessária</p><p className="font-semibold text-slate-950">{formatNumber(lists?.attention.length)} clientes</p></div>
                </div>
              </section>

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard title="Base total" value={formatNumber(metrics.totalClients)} detail={`${formatNumber(metrics.newMonth)} novos clientes neste mês`} icon={Users} />
                <MetricCard title="MRR previsto" value={formatCurrency(metrics.mrr)} detail={`${formatNumber(metrics.paidThisMonth)} pagamentos ou renovações no mês`} icon={CircleDollarSign} />
                <MetricCard title="Clientes ativos" value={formatNumber(metrics.activeClients)} detail={`${formatNumber(metrics.accessedToday)} acessaram o sistema hoje`} icon={UserCheck} />
                <MetricCard title="Risco financeiro" value={formatCurrency(metrics.overdueAmount)} detail={`${formatNumber(metrics.delinquentClients)} clientes inadimplentes`} icon={AlertTriangle} alert />
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.6fr_0.8fr]">
                <ActionQueue
                  clients={lists?.attention || []}
                  onOpenClients={() => setActiveView('clients')}
                  onRelease24h={releaseClientFor24Hours}
                  releasingClientId={releasingClientId}
                />
                <HealthCard metrics={metrics} />
              </section>

              <section className="grid gap-6 xl:grid-cols-3">
                <ChartCard title="Aquisição de clientes" description="Novos restaurantes cadastrados nos últimos 14 dias.">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analytics?.signupTrend || []} margin={{ left: -20, right: 8, top: 14, bottom: 0 }}>
                      <defs><linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#059669" stopOpacity={0.3} /><stop offset="95%" stopColor="#059669" stopOpacity={0.02} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="#94a3b8" axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Area type="monotone" dataKey="cadastros" stroke="#059669" strokeWidth={2.5} fill="url(#signupFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Engajamento diário" description="Volume de acessos registrados por dia.">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics?.accessTrend || []} margin={{ left: -20, right: 8, top: 14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="#94a3b8" axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Bar dataKey="acessos" radius={[4, 4, 0, 0]} fill="#0f172a" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Composição da carteira" description="Distribuição dos clientes por status de assinatura.">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={analytics?.statusBreakdown || []} dataKey="value" nameKey="label" innerRadius={58} outerRadius={88} paddingAngle={3}>
                        {(analytics?.statusBreakdown || []).map((entry, index) => <Cell key={`status-${entry.label}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              </section>
            </>
          )}

          {activeView === 'clients' && (
            <>
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard title="Clientes na carteira" value={formatNumber(metrics.totalClients)} detail={`${formatNumber(metrics.newToday)} novos cadastros hoje`} icon={Building2} />
                <MetricCard title="Em teste" value={formatNumber(metrics.trialClients)} detail={`${formatNumber(metrics.trialExpiring)} vencem nos próximos 7 dias`} icon={CalendarClock} />
                <MetricCard title="Sem acesso recente" value={formatNumber(metrics.noAccess7Days)} detail={`${formatNumber(metrics.noAccess30Days)} há mais de 30 dias`} icon={Activity} alert />
                <MetricCard title="Chamados abertos" value={formatNumber(metrics.openTickets)} detail={`${formatNumber(metrics.openTasks)} tarefas internas pendentes`} icon={MessageCircle} />
              </section>

              <ClientOperationsWorkspace
                token={token}
                clients={lists?.portfolio || []}
                members={(data?.members || []).filter((member) => member.role !== 'representative')}
                onRefresh={() => loadDashboard(token)}
                onRelease24h={releaseClientFor24Hours}
              />

              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="p-5 pb-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Segmentos inteligentes</p>
                  <CardTitle className="mt-1 text-lg text-slate-950">Recortes da carteira</CardTitle>
                  <p className="text-sm text-slate-500">Troque de segmento sem duplicar toda a base na tela.</p>
                </CardHeader>
                <CardContent className="p-5 pt-3">
                  <Tabs defaultValue="attention">
                    <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-slate-100 p-1">
                      <TabsTrigger value="attention">Atenção ({formatNumber(lists?.attention.length)})</TabsTrigger>
                      <TabsTrigger value="delinquent">Inadimplentes ({formatNumber(lists?.delinquent.length)})</TabsTrigger>
                      <TabsTrigger value="trial">Testes vencendo ({formatNumber(lists?.trialExpiring.length)})</TabsTrigger>
                      <TabsTrigger value="recent">Novos ({formatNumber(lists?.recentSignups.length)})</TabsTrigger>
                      <TabsTrigger value="inactive">Inativos ({formatNumber(lists?.inactiveByAccess.length)})</TabsTrigger>
                      <TabsTrigger value="never">Nunca acessaram ({formatNumber(lists?.neverAccessed.length)})</TabsTrigger>
                    </TabsList>
                    <TabsContent value="attention" className="mt-4"><ClientList clients={lists?.attention || []} emptyText="Nenhum alerta crítico agora." onRelease24h={releaseClientFor24Hours} releasingClientId={releasingClientId} /></TabsContent>
                    <TabsContent value="delinquent" className="mt-4"><ClientList clients={lists?.delinquent || []} emptyText="Nenhum cliente inadimplente." onRelease24h={releaseClientFor24Hours} releasingClientId={releasingClientId} /></TabsContent>
                    <TabsContent value="trial" className="mt-4"><ClientList clients={lists?.trialExpiring || []} emptyText="Nenhum teste vencendo nesta semana." /></TabsContent>
                    <TabsContent value="recent" className="mt-4"><ClientList clients={lists?.recentSignups || []} emptyText="Nenhum cadastro recente." /></TabsContent>
                    <TabsContent value="inactive" className="mt-4"><ClientList clients={lists?.inactiveByAccess || []} emptyText="Todos os clientes acessaram recentemente." /></TabsContent>
                    <TabsContent value="never" className="mt-4"><ClientList clients={lists?.neverAccessed || []} emptyText="Nenhum cliente sem primeiro acesso." /></TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </>
          )}

          {activeView === 'commercial' && (
            <>
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard title="Leads comerciais" value={formatNumber(lists?.commercialLeads.length)} detail="Oportunidades cadastradas pelos representantes" icon={Waypoints} />
                <MetricCard title="Novos no mês" value={formatNumber(metrics.newMonth)} detail={`${formatNumber(metrics.newToday)} novos cadastros hoje`} icon={Users} />
                <MetricCard title="Conversões ativas" value={formatNumber(metrics.activeClients)} detail={`${formatNumber(metrics.trialClients)} clientes ainda em teste`} icon={UserCheck} />
                <MetricCard title="CEP confirmado" value={formatNumber(metrics.clientsWithVerifiedPostalCode)} detail={`${formatNumber(metrics.clientsWithoutVerifiedPostalCode)} ainda sem localização fiscal`} icon={MapPin} />
              </section>

              <RepresentativeManagement
                token={token}
                members={data?.members || []}
                leads={lists?.commercialLeads || []}
                onRefresh={() => loadDashboard(token)}
              />

              <section>
                <div className="mb-4 flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-emerald-700" />
                  <div><h2 className="font-semibold text-slate-950">Cobertura geográfica</h2><p className="text-sm text-slate-500">Concentração da carteira com base no CEP fiscal confirmado.</p></div>
                </div>
                <div className="grid gap-6 xl:grid-cols-2">
                  <HeatmapList title="Clientes por estado" description="Estados com maior presença ativa da PopSystem." items={analytics?.stateHeatmap || []} />
                  <HeatmapList title="Clientes por cidade" description="Cidades com maior concentração de restaurantes." items={analytics?.cityHeatmap || []} />
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
