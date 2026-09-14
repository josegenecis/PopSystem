import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  DollarSign,
  LogOut,
  MapPin,
  MessageCircle,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import ClientOperationsWorkspace from '@/components/admin/ClientOperationsWorkspace';

type MetricMap = Record<string, number>;

export interface AdminClientRow {
  id: string;
  restaurantName: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
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
  };
  members?: Array<{ id: string; email: string; display_name: string; role: string }>;
  analytics?: {
    cityHeatmap: ChartPoint[];
    stateHeatmap: ChartPoint[];
    statusBreakdown: ChartPoint[];
    activityBreakdown: ChartPoint[];
    signupTrend: ChartPoint[];
    accessTrend: ChartPoint[];
    orderTrend: ChartPoint[];
  };
}

const SESSION_KEY = 'popsystem-internal-admin-token';

const formatCurrency = (value?: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const formatNumber = (value?: number) =>
  new Intl.NumberFormat('pt-BR').format(Number(value || 0));

const formatPercent = (value?: number, total?: number) => {
  if (!total) return '0%';
  return `${Math.round((Number(value || 0) / Number(total || 1)) * 100)}%`;
};

const POP_COLORS = ['#004b36', '#85c441', '#ff5b00', '#0ea5e9', '#ef4444', '#64748b'];

const normalizePhoneForWhatsApp = (phone?: string) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length >= 10) return `55${digits}`;
  return digits;
};

const whatsappLink = (client: AdminClientRow) => {
  const phone = normalizePhoneForWhatsApp(client.phone);
  if (!phone || phone.length < 12) return '';
  const message = encodeURIComponent(`Olá, tudo bem? Aqui é da PopSystem. Vi que o ${client.restaurantName} está sem usar o sistema e quero te ajudar a deixar tudo rodando certinho.`);
  return `https://wa.me/${phone}?text=${message}`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Sem registro';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem registro';
  return new Intl.DateTimeFormat('pt-BR', {
    year: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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

const lastAccessLabel = (value?: string | null) => {
  if (!value) return 'Nunca acessou';
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return 'Nunca acessou';
  const diffDays = Math.floor((Date.now() - ms) / 86400000);
  if (diffDays <= 0) return 'Acessou hoje';
  if (diffDays === 1) return 'Acessou ontem';
  return `Há ${diffDays} dias`;
};

const statusClassName = (status?: string) => {
  const value = String(status || '').toLowerCase();
  if (['active', 'paid', 'current'].includes(value)) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (value.includes('trial') || value === 'teste') return 'bg-blue-100 text-blue-800 border-blue-200';
  if (['past_due', 'unpaid', 'overdue', 'inadimplente', 'blocked', 'suspended'].includes(value)) {
    return 'bg-red-100 text-red-800 border-red-200';
  }
  return 'bg-slate-100 text-slate-700 border-slate-200';
};

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = 'emerald',
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ElementType;
  tone?: 'emerald' | 'orange' | 'blue' | 'red' | 'slate';
}) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  };

  return (
    <Card className="rounded-lg border-slate-200 shadow-sm">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
          <p className="mt-2 text-sm text-slate-500">{detail}</p>
        </div>
        <div className={`rounded-lg border p-3 ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function ClientList({
  title,
  description,
  clients,
  emptyText,
  showWhatsAppAction = false,
  onRelease24h,
  releasingClientId,
}: {
  title: string;
  description: string;
  clients: AdminClientRow[];
  emptyText: string;
  showWhatsAppAction?: boolean;
  onRelease24h?: (client: AdminClientRow) => void;
  releasingClientId?: string;
}) {
  return (
    <Card className="rounded-lg border-slate-200 shadow-sm">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="text-lg text-slate-950">{title}</CardTitle>
        <p className="text-sm text-slate-500">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-0">
        {clients.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">{emptyText}</div>
        ) : (
          clients.map((client) => (
            <div key={`${title}-${client.id}`} className="rounded-lg border border-slate-100 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-950">{client.restaurantName}</p>
                  <p className="truncate text-sm text-slate-500">{client.email || client.phone || 'Sem contato cadastrado'}</p>
                  {(client.city || client.state) && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                      <MapPin className="h-3.5 w-3.5" />
                      {client.city || 'Cidade não informada'} / {client.state || 'NI'}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {onRelease24h && client.accessAllowed === false && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={releasingClientId === client.id}
                      onClick={() => onRelease24h(client)}
                      className="h-8 rounded-lg border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-900 hover:bg-amber-100"
                    >
                      <CalendarClock className={`mr-1.5 h-3.5 w-3.5 ${releasingClientId === client.id ? 'animate-spin' : ''}`} />
                      Liberar 24h
                    </Button>
                  )}
                  {showWhatsAppAction && whatsappLink(client) && (
                    <a href={whatsappLink(client)} target="_blank" rel="noreferrer">
                      <Button size="sm" className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-bold hover:bg-emerald-700">
                        <PhoneCall className="mr-1.5 h-3.5 w-3.5" />
                        WhatsApp
                      </Button>
                    </a>
                  )}
                  <Badge className={statusClassName(client.subscriptionStatus)} variant="outline">
                    {normalizeStatusLabel(client.subscriptionStatus)}
                  </Badge>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600 sm:grid-cols-4">
                <span>{lastAccessLabel(client.lastAccessAt)}</span>
                <span>{formatNumber(client.ordersMonth)} pedidos</span>
                <span>{formatNumber(client.productsCount)} produtos</span>
                <span>Último pedido: {formatDateTime(client.lastOrderAt)}</span>
              </div>
              {client.accessOverrideUntil && new Date(client.accessOverrideUntil).getTime() > Date.now() && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                  Cortesia ativa até {formatDateTime(client.accessOverrideUntil)}
                </p>
              )}
              {client.reasons && client.reasons.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {client.reasons.map((reason) => (
                    <span key={`${client.id}-${reason}`} className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">
                      {reason}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-lg border-slate-200 shadow-sm">
      <CardHeader className="p-5 pb-2">
        <CardTitle className="text-lg text-slate-950">{title}</CardTitle>
        <p className="text-sm text-slate-500">{description}</p>
      </CardHeader>
      <CardContent className="h-[290px] p-5 pt-2">{children}</CardContent>
    </Card>
  );
}

function HeatmapList({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: ChartPoint[];
}) {
  const max = Math.max(...items.map((item) => Number(item.value || 0)), 1);
  return (
    <Card className="rounded-lg border-slate-200 shadow-sm">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg text-slate-950">
          <MapPin className="h-5 w-5 text-orange-600" />
          {title}
        </CardTitle>
        <p className="text-sm text-slate-500">{description}</p>
      </CardHeader>
      <CardContent className="grid gap-3 p-5 pt-0 sm:grid-cols-2">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500 sm:col-span-2">
            Sem dados de localização ainda.
          </div>
        ) : (
          items.map((item, index) => {
            const intensity = Math.max(0.16, Number(item.value || 0) / max);
            return (
              <div
                key={`${title}-${item.label}-${index}`}
                className="rounded-lg border border-emerald-100 p-4"
                style={{ backgroundColor: `rgba(0, 75, 54, ${0.06 + intensity * 0.18})` }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-bold text-slate-950">{item.label}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-emerald-800 shadow-sm">
                    {formatNumber(item.value)}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.round((Number(item.value || 0) / max) * 100)}%` }} />
                </div>
              </div>
            );
          })
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
  const [loading, setLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [popPayRestaurantEmail, setPopPayRestaurantEmail] = useState('');
  const [popPayCreditFee, setPopPayCreditFee] = useState('0.50');
  const [popPayFeeSaving, setPopPayFeeSaving] = useState(false);
  const [releasingClientId, setReleasingClientId] = useState('');

  const metrics = data?.metrics || {};
  const lists = data?.lists;
  const analytics = data?.analytics;

  const accessHealth = useMemo(() => formatPercent(metrics.accessed7Days, metrics.totalClients), [metrics.accessed7Days, metrics.totalClients]);

  const loadDashboard = useCallback(async (sessionToken = token) => {
    if (!sessionToken) return;
    setLoading(true);
    try {
      const { data: response, error } = await supabase.functions.invoke('admin-dashboard', {
        body: { token: sessionToken },
      });
      if (error) throw error;
      if (!response?.ok) throw new Error(response?.error || 'Não foi possível carregar o painel.');
      setData(response as AdminDashboardData);
    } catch (error: any) {
      sessionStorage.removeItem(SESSION_KEY);
      setToken('');
      setData(null);
      toast.error(error?.message || 'Sessão interna expirada. Entre novamente.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) loadDashboard(token);
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
    } catch (error: any) {
      toast.error(error?.message || 'Não foi possível entrar no painel interno.');
    } finally {
      setLoginLoading(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setToken('');
    setData(null);
  };

  const savePopPayCreditFee = async (event: React.FormEvent) => {
    event.preventDefault();
    setPopPayFeeSaving(true);
    try {
      const { data: response, error } = await supabase.functions.invoke('admin-dashboard', {
        body: {
          action: 'set_poppay_credit_fee',
          token,
          restaurantEmail: popPayRestaurantEmail,
          feePercent: Number(popPayCreditFee.replace(',', '.')),
        },
      });
      if (error) throw error;
      if (!response?.ok) throw new Error(response?.error || 'Não foi possível atualizar a tarifa.');
      toast.success(`Tarifa de ${Number(response.creditFeePercent || 0).toLocaleString('pt-BR')}% aplicada a ${response.restaurant}. O crédito online foi desativado até um novo aceite.`);
    } catch (error: any) {
      toast.error(error?.message || 'Não foi possível atualizar a tarifa.');
    } finally {
      setPopPayFeeSaving(false);
    }
  };

  const releaseClientFor24Hours = async (client: AdminClientRow) => {
    const confirmed = window.confirm(
      `Liberar ${client.restaurantName} por 24 horas? Esta cortesia só poderá ser usada uma vez neste vencimento.`,
    );
    if (!confirmed) return;

    setReleasingClientId(client.id);
    try {
      const { data: response, error } = await supabase.functions.invoke('admin-dashboard', {
        body: {
          action: 'grant_subscription_access_24h',
          token,
          restaurantId: client.id,
        },
      });
      if (error) throw error;
      if (!response?.ok) throw new Error(response?.error || 'Não foi possível liberar a conta.');
      toast.success(`${response.restaurant} liberado até ${formatDateTime(response.accessUntil)}.`);
      await loadDashboard(token);
    } catch (error: any) {
      toast.error(error?.message || 'Não foi possível liberar a conta por 24 horas.');
    } finally {
      setReleasingClientId('');
    }
  };

  if (!token) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center justify-center">
          <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="flex flex-col justify-center">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200">
                <ShieldCheck className="h-4 w-4" />
                Acesso interno PopSystem
              </div>
              <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-tight md:text-5xl">
                Painel de comando para acompanhar clientes, acessos e riscos da operação.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-slate-300">
                Veja cadastros do dia, último acesso, restaurantes em teste, inadimplentes,
                clientes pagos no mês e quem precisa de contato da equipe.
              </p>
              <div className="mt-8 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
                <span className="rounded-lg border border-white/10 bg-white/5 p-4">Comercial</span>
                <span className="rounded-lg border border-white/10 bg-white/5 p-4">Financeiro</span>
                <span className="rounded-lg border border-white/10 bg-white/5 p-4">Sucesso do cliente</span>
              </div>
            </section>

            <Card className="rounded-lg border-white/10 bg-white text-slate-950 shadow-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Sparkles className="h-5 w-5 text-orange-500" />
                  Entrar no painel
                </CardTitle>
                <p className="text-sm text-slate-500">Use o login interno da equipe PopSystem.</p>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="admin-email">E-mail</Label>
                    <Input
                      id="admin-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="username"
                      required
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
                    />
                  </div>
                  <Button type="submit" className="h-12 w-full bg-orange-600 text-base font-bold hover:bg-orange-700" disabled={loginLoading}>
                    {loginLoading ? 'Entrando...' : 'Acessar painel interno'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f7f3]">
      <header className="sticky top-0 z-20 border-b border-emerald-950/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Painel interno</p>
            <h1 className="text-2xl font-bold text-slate-950">Monitoramento PopSystem</h1>
            <p className="text-sm text-slate-500">Atualizado em {formatDateTime(data?.generatedAt)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => loadDashboard()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Button variant="outline" onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 lg:px-8">
        <Card className="rounded-lg border-emerald-200 bg-white shadow-sm">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-slate-950">
              <DollarSign className="h-5 w-5 text-emerald-600" />
              Tarifa do crédito online PopPay
            </CardTitle>
            <p className="text-sm text-slate-500">Controle interno por restaurante. O padrão é 0,5%; qualquer alteração exige novo aceite da loja.</p>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <form onSubmit={savePopPayCreditFee} className="grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="poppay-restaurant-email">E-mail do restaurante</Label>
                <Input
                  id="poppay-restaurant-email"
                  type="email"
                  value={popPayRestaurantEmail}
                  onChange={(event) => setPopPayRestaurantEmail(event.target.value)}
                  placeholder="restaurante@email.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="poppay-credit-fee">Tarifa PopPay (%)</Label>
                <Input
                  id="poppay-credit-fee"
                  type="number"
                  min="0"
                  max="10"
                  step="0.01"
                  value={popPayCreditFee}
                  onChange={(event) => setPopPayCreditFee(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" disabled={popPayFeeSaving}>
                {popPayFeeSaving ? 'Salvando...' : 'Aplicar tarifa'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <section className="rounded-lg bg-[#003d2e] p-6 text-white shadow-sm">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-emerald-100">
                <Activity className="h-4 w-4" />
                Visão executiva
              </div>
              <h2 className="mt-4 text-3xl font-bold">Base, uso e risco em tempo real</h2>
              <p className="mt-3 max-w-2xl text-emerald-50/85">
                Acompanhe onde a PopSystem está crescendo, quais clientes estão ativos, quem precisa de contato e quais regiões concentram mais uso.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-white/10 p-4">
                <p className="text-xs font-semibold uppercase text-emerald-100">Uso em 7 dias</p>
                <p className="mt-2 text-3xl font-bold">{accessHealth}</p>
              </div>
              <div className="rounded-lg bg-white/10 p-4">
                <p className="text-xs font-semibold uppercase text-emerald-100">Sem acesso</p>
                <p className="mt-2 text-3xl font-bold">{formatNumber(metrics.noAccess7Days)}</p>
              </div>
              <div className="rounded-lg bg-orange-500 p-4 text-white">
                <p className="text-xs font-semibold uppercase text-orange-50">Ação hoje</p>
                <p className="mt-2 text-3xl font-bold">{formatNumber((lists?.attention || []).length)}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Clientes cadastrados" value={formatNumber(metrics.totalClients)} detail={`${formatNumber(metrics.newToday)} hoje, ${formatNumber(metrics.newMonth)} no mês`} icon={Users} tone="blue" />
          <MetricCard title="Acessaram hoje" value={formatNumber(metrics.accessedToday)} detail={`${accessHealth} acessaram nos últimos 7 dias`} icon={Activity} tone="emerald" />
          <MetricCard title="Ativos por assinatura" value={formatNumber(metrics.activeClients)} detail={`${formatNumber(metrics.paidThisMonth)} pagaram ou renovaram no mês`} icon={UserCheck} tone="emerald" />
          <MetricCard title="Inadimplentes" value={formatNumber(metrics.delinquentClients)} detail="Precisam de contato ou bloqueio acompanhado" icon={AlertTriangle} tone="red" />
          <MetricCard title="Em teste" value={formatNumber(metrics.trialClients)} detail={`${formatNumber(metrics.trialExpiring)} vencem nos próximos 7 dias`} icon={CalendarClock} tone="orange" />
          <MetricCard title="Sem acesso há 7 dias" value={formatNumber(metrics.noAccess7Days)} detail={`${formatNumber(metrics.noAccess30Days)} estão sem acesso há 30 dias`} icon={AlertTriangle} tone="red" />
          <MetricCard title="Nunca acessaram" value={formatNumber(metrics.neverAccessed)} detail="Cadastros que precisam de onboarding" icon={ShieldCheck} tone="orange" />
          <MetricCard title="MRR previsto" value={formatCurrency(metrics.mrr)} detail="Receita recorrente estimada da PopSystem" icon={DollarSign} tone="emerald" />
          <MetricCard title="Pedidos no mês" value={formatNumber(metrics.ordersMonth)} detail={`${formatNumber(metrics.noOrders7Days)} restaurantes sem pedido há 7 dias`} icon={TrendingUp} tone="slate" />
          <MetricCard title="WhatsApp conectado" value={formatNumber(metrics.whatsappConfigured)} detail={`${formatNumber(metrics.nfceRejectedMonth)} NFC-e rejeitadas no mês`} icon={MessageCircle} tone="blue" />
          <MetricCard title="Valor vencido" value={formatCurrency(metrics.overdueAmount)} detail="Cobranças vencidas identificadas nos webhooks" icon={DollarSign} tone="red" />
          <MetricCard title="Chamados abertos" value={formatNumber(metrics.openTickets)} detail={`${formatNumber(metrics.openTasks)} tarefas internas pendentes`} icon={MessageCircle} tone="orange" />
          <MetricCard title="Clientes críticos" value={formatNumber(metrics.criticalClients)} detail="Acesso, cobrança, uso e suporte combinados" icon={AlertTriangle} tone="red" />
        </section>

        <ClientOperationsWorkspace
          token={token}
          clients={lists?.portfolio || []}
          members={data?.members || []}
          onRefresh={() => loadDashboard(token)}
          onRelease24h={releaseClientFor24Hours}
        />

        <section className="grid gap-6 xl:grid-cols-3">
          <ChartCard title="Cadastros recentes" description="Novos restaurantes entrando na base nos últimos 14 dias.">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics?.signupTrend || []} margin={{ left: -20, right: 8, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="cadastrosGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#85c441" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#85c441" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#64748b" />
                <Tooltip />
                <Area type="monotone" dataKey="cadastros" stroke="#004b36" strokeWidth={3} fill="url(#cadastrosGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Atividade no sistema" description="Últimos acessos registrados por dia.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics?.accessTrend || []} margin={{ left: -20, right: 8, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#64748b" />
                <Tooltip />
                <Bar dataKey="acessos" radius={[6, 6, 0, 0]} fill="#ff5b00" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Status da carteira" description="Distribuição dos clientes por situação comercial.">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={analytics?.statusBreakdown || []}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={58}
                  outerRadius={92}
                  paddingAngle={3}
                >
                  {(analytics?.statusBreakdown || []).map((entry, index) => (
                    <Cell key={`status-${entry.label}`} fill={POP_COLORS[index % POP_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <HeatmapList
            title="Mapa de calor por estado"
            description="Onde a PopSystem tem mais restaurantes cadastrados."
            items={analytics?.stateHeatmap || []}
          />
          <HeatmapList
            title="Mapa de calor por cidade"
            description="Cidades com maior concentração de clientes na base."
            items={analytics?.cityHeatmap || []}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <ClientList
            title="Clientes que precisam de ação"
            description="Prioridade para suporte, financeiro e sucesso do cliente."
            clients={lists?.attention || []}
            emptyText="Nenhum alerta crítico agora."
            showWhatsAppAction
            onRelease24h={releaseClientFor24Hours}
            releasingClientId={releasingClientId}
          />

          <Card className="rounded-lg border-slate-200 shadow-sm">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="flex items-center gap-2 text-lg text-slate-950">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
                Saúde da base
              </CardTitle>
              <p className="text-sm text-slate-500">Leitura rápida para saber onde atuar hoje.</p>
            </CardHeader>
            <CardContent className="space-y-5 p-5 pt-0">
              {[
                { label: 'Ativos', value: metrics.activeClients, total: metrics.totalClients, color: 'bg-emerald-500' },
                { label: 'Acessaram em 7 dias', value: metrics.accessed7Days, total: metrics.totalClients, color: 'bg-emerald-500' },
                { label: 'WhatsApp configurado', value: metrics.whatsappConfigured, total: metrics.totalClients, color: 'bg-blue-500' },
                { label: 'Inadimplentes', value: metrics.delinquentClients, total: metrics.totalClients, color: 'bg-red-500' },
                { label: 'Em teste', value: metrics.trialClients, total: metrics.totalClients, color: 'bg-orange-500' },
              ].map((item) => {
                const percent = item.total ? Math.round((Number(item.value || 0) / Number(item.total || 1)) * 100) : 0;
                return (
                  <div key={item.label}>
                    <div className="mb-2 flex justify-between text-sm font-semibold text-slate-700">
                      <span>{item.label}</span>
                      <span>{percent}%</span>
                    </div>
                    <Progress value={percent} className="h-2" />
                  </div>
                );
              })}

              <div className="rounded-lg bg-slate-950 p-5 text-white">
                <p className="text-sm text-slate-300">Acessaram nos últimos 30 dias</p>
                <p className="mt-1 text-3xl font-bold">{formatNumber(metrics.accessed30Days)}</p>
                <p className="mt-2 text-sm text-slate-300">Esse número mostra a base realmente usando o sistema.</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <ClientList
            title="Novos cadastros"
            description="Restaurantes que entraram recentemente na plataforma."
            clients={lists?.recentSignups || []}
            emptyText="Nenhum cadastro recente."
          />
          <ClientList
            title="Clientes inadimplentes"
            description="Base para cobrança e acompanhamento financeiro."
            clients={lists?.delinquent || []}
            emptyText="Nenhum cliente inadimplente encontrado."
            onRelease24h={releaseClientFor24Hours}
            releasingClientId={releasingClientId}
          />
          <ClientList
            title="Testes vencendo"
            description="Oportunidade de conversão antes do fim do teste."
            clients={lists?.trialExpiring || []}
            emptyText="Nenhum teste vencendo nos próximos 7 dias."
          />
          <ClientList
            title="Pagaram no mês"
            description="Clientes que estão ativos ou renovados no período atual."
            clients={lists?.paidThisMonth || []}
            emptyText="Nenhum pagamento/renovação identificado no mês."
          />
          <ClientList
            title="Sem acesso recente"
            description="Clientes que podem estar travados, desmotivados ou precisando de suporte."
            clients={lists?.inactiveByAccess || []}
            emptyText="Todos acessaram recentemente."
            showWhatsAppAction
          />
          <ClientList
            title="Nunca acessaram"
            description="Cadastros que precisam de ativação ou primeiro contato."
            clients={lists?.neverAccessed || []}
            emptyText="Nenhum cliente sem primeiro acesso."
            showWhatsAppAction
          />
        </section>

        <Card className="rounded-lg border-slate-200 shadow-sm">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-slate-950">
              <Building2 className="h-5 w-5 text-orange-600" />
              Últimos acessos ao sistema
            </CardTitle>
            <p className="text-sm text-slate-500">Clientes ordenados por atividade real no sistema.</p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-5 pt-0">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-3">Restaurante</th>
                  <th className="py-3">Status</th>
                  <th className="py-3">Último acesso</th>
                  <th className="py-3">Pedidos</th>
                  <th className="py-3">Clientes</th>
                  <th className="py-3">WhatsApp</th>
                  <th className="py-3">Último pedido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(lists?.activeByAccess || []).map((client) => (
                  <tr key={`rank-${client.id}`} className="text-slate-700">
                    <td className="py-4">
                      <div className="font-semibold text-slate-950">{client.restaurantName}</div>
                      <div className="text-xs text-slate-500">{client.email || client.phone || 'Sem contato'}</div>
                    </td>
                    <td className="py-4">
                      <Badge className={statusClassName(client.subscriptionStatus)} variant="outline">
                        {normalizeStatusLabel(client.subscriptionStatus)}
                      </Badge>
                    </td>
                    <td className="py-4">
                      <div className="font-semibold text-slate-950">{lastAccessLabel(client.lastAccessAt)}</div>
                      <div className="text-xs text-slate-500">{formatDateTime(client.lastAccessAt)}</div>
                    </td>
                    <td className="py-4">{formatNumber(client.ordersMonth)}</td>
                    <td className="py-4">{formatNumber(client.customersCount)}</td>
                    <td className="py-4">
                      {client.whatsappEnabled ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Sim</span>
                      ) : (
                        <span className="text-slate-400">Não</span>
                      )}
                    </td>
                    <td className="py-4">{formatDateTime(client.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
