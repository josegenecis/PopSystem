/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Banknote,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  FileArchive,
  FileCheck2,
  FileClock,
  FileSpreadsheet,
  FileText,
  Landmark,
  Loader2,
  Mail,
  MessageSquareText,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRoundCheck,
  UsersRound,
  WalletCards,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

type DataRow = Record<string, any>;

type PortalData = {
  orders: DataRow[];
  expenses: DataRow[];
  fiscalDocuments: DataRow[];
  products: DataRow[];
  employees: DataRow[];
  timeEvents: DataRow[];
  cashSessions: DataRow[];
  purchaseImports: DataRow[];
  receivables: DataRow[];
};

type AccountingRequest = {
  id: string;
  title: string;
  detail: string;
  priority: 'normal' | 'alta';
  status: 'aberta' | 'resolvida';
  createdAt: string;
};

type PendingItem = {
  id: string;
  title: string;
  detail: string;
  count: number;
  level: 'critical' | 'warning' | 'info';
  tab: string;
};

const EMPTY_DATA: PortalData = {
  orders: [],
  expenses: [],
  fiscalDocuments: [],
  products: [],
  employees: [],
  timeEvents: [],
  cashSessions: [],
  purchaseImports: [],
  receivables: [],
};

const COMPLETED_ORDER_STATUSES = new Set(['accepted', 'confirmed', 'preparing', 'ready', 'in_delivery', 'delivered', 'completed', 'finished']);
const CANCELLED_ORDER_STATUSES = new Set(['cancelled', 'canceled', 'rejected', 'refused']);
const AUTHORIZED_FISCAL_STATUSES = new Set(['authorized', 'autorizada', 'autorizado', 'approved', 'emitida']);
const CANCELLED_FISCAL_STATUSES = new Set(['cancelled', 'canceled', 'cancelada', 'cancelado']);
const CHECKLIST = [
  { id: 'sales', label: 'Conferir vendas, cancelamentos e meios de pagamento', icon: CircleDollarSign },
  { id: 'fiscal', label: 'Revisar documentos fiscais rejeitados ou pendentes', icon: FileCheck2 },
  { id: 'expenses', label: 'Conferir despesas, contas e comprovantes', icon: WalletCards },
  { id: 'products', label: 'Validar cadastro fiscal dos produtos', icon: PackageCheck },
  { id: 'team', label: 'Conferir ponto e ocorrências da equipe', icon: UsersRound },
  { id: 'export', label: 'Gerar e arquivar o pacote contábil mensal', icon: FileArchive },
] as const;

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR');
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalize = (value: unknown) => String(value || '').trim().toLowerCase();

const getMonthPeriod = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startDate: `${monthKey}-01`,
    endDate: new Date(year, month, 0).toISOString().slice(0, 10),
  };
};

const currentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (monthKey: string) => {
  const { start } = getMonthPeriod(monthKey);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(start);
};

const getFiscalDate = (row: DataRow) => row.data_hora_emissao || row.created_at || row.updated_at;
const getExpenseDate = (row: DataRow) => row.date || row.due_date || row.created_at;

const downloadFile = (filename: string, content: string, type = 'text/csv;charset=utf-8') => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

const formatPaymentMethod = (value: unknown) => {
  const methods: Record<string, string> = {
    cash: 'Dinheiro', dinheiro: 'Dinheiro', pix: 'PIX', credit: 'Crédito', credito: 'Crédito',
    debit: 'Débito', debito: 'Débito', card: 'Cartão', voucher: 'Voucher', receivable: 'Contas a receber',
  };
  const normalized = normalize(value);
  return methods[normalized] || String(value || 'Não informado');
};

const StatusBadge = ({ status }: { status: string }) => {
  const normalized = normalize(status);
  const good = AUTHORIZED_FISCAL_STATUSES.has(normalized) || ['paid', 'pago', 'closed', 'fechado', 'approved'].includes(normalized);
  const bad = CANCELLED_FISCAL_STATUSES.has(normalized) || normalized.includes('reject') || normalized.includes('erro');
  return (
    <Badge className={good
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
      : bad
        ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-50'
        : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50'}>
      {status || 'Pendente'}
    </Badge>
  );
};

const MetricCard = ({ label, value, detail, icon: Icon, tone = 'green' }: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Landmark;
  tone?: 'green' | 'orange' | 'blue' | 'purple';
}) => {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700',
    orange: 'bg-orange-50 text-orange-700',
    blue: 'bg-sky-50 text-sky-700',
    purple: 'bg-violet-50 text-violet-700',
  };
  return (
    <Card className="border-black/[0.06] shadow-sm">
      <CardContent className="flex items-start gap-4 p-5">
        <div className={`rounded-2xl p-3 ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
          <p className="mt-1 truncate text-2xl font-black tracking-tight text-[#073d2c]">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default function AccountantPortal() {
  const { user, profile, stores } = useAuth();
  const [month, setMonth] = useState(currentMonthKey);
  const [activeTab, setActiveTab] = useState('overview');
  const [data, setData] = useState<PortalData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [requests, setRequests] = useState<AccountingRequest[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [requestTitle, setRequestTitle] = useState('');
  const [requestDetail, setRequestDetail] = useState('');
  const [requestPriority, setRequestPriority] = useState<'normal' | 'alta'>('normal');
  const [inviteEmail, setInviteEmail] = useState('');
  const [search, setSearch] = useState('');

  const period = useMemo(() => getMonthPeriod(month), [month]);
  const storeName = profile?.restaurant_name || stores.find((store) => store.store_user_id === user?.id)?.store_name || 'Meu restaurante';
  const storagePrefix = user?.id ? `popsystem.accounting.v1.${user.id}.${month}` : '';

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const queries = await Promise.allSettled([
        (supabase as any).from('orders').select('*').eq('user_id', user.id).gte('created_at', period.startIso).lt('created_at', period.endIso).order('created_at', { ascending: false }),
        (supabase as any).from('expenses').select('*').eq('user_id', user.id).gte('date', period.startDate).lte('date', period.endDate).order('date', { ascending: false }),
        (supabase as any).from('nfce_cupons').select('*').eq('user_id', user.id).gte('data_hora_emissao', period.startIso).lt('data_hora_emissao', period.endIso).order('data_hora_emissao', { ascending: false }),
        (supabase as any).from('products').select('*').eq('user_id', user.id).order('name'),
        (supabase as any).from('waiters').select('*').eq('user_id', user.id).order('name'),
        (supabase as any).from('employee_time_clock_events').select('*').eq('user_id', user.id).gte('occurred_at', period.startIso).lt('occurred_at', period.endIso).order('occurred_at', { ascending: false }),
        (supabase as any).from('cash_register_sessions').select('*').eq('user_id', user.id).gte('opened_at', period.startIso).lt('opened_at', period.endIso).order('opened_at', { ascending: false }),
        (supabase as any).from('smart_invoice_imports').select('*').eq('user_id', user.id).gte('created_at', period.startIso).lt('created_at', period.endIso).order('created_at', { ascending: false }),
        (supabase as any).from('staff_consumptions').select('*').eq('user_id', user.id).gte('created_at', period.startIso).lt('created_at', period.endIso).order('created_at', { ascending: false }),
      ]);

      const rows = queries.map((result) => {
        if (result.status !== 'fulfilled' || result.value.error) return [];
        return Array.isArray(result.value.data) ? result.value.data : [];
      });
      setData({
        orders: rows[0], expenses: rows[1], fiscalDocuments: rows[2], products: rows[3], employees: rows[4],
        timeEvents: rows[5], cashSessions: rows[6], purchaseImports: rows[7], receivables: rows[8],
      });
      setRefreshedAt(new Date());
    } catch (error) {
      console.error('[CONTADOR] Falha ao carregar dados:', error);
      toast.error('Não foi possível atualizar a Central do Contador.');
    } finally {
      setLoading(false);
    }
  }, [period.endIso, period.startDate, period.startIso, period.endDate, user?.id]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    if (!storagePrefix) return;
    try {
      setChecklist(JSON.parse(localStorage.getItem(`${storagePrefix}.checklist`) || '[]'));
      setRequests(JSON.parse(localStorage.getItem(`${storagePrefix}.requests`) || '[]'));
    } catch {
      setChecklist([]);
      setRequests([]);
    }
  }, [storagePrefix]);

  const metrics = useMemo(() => {
    let grossSales = 0;
    let cancelledSales = 0;
    const paymentMap = new Map<string, number>();
    for (const order of data.orders) {
      const status = normalize(order.status);
      const total = asNumber(order.total);
      if (CANCELLED_ORDER_STATUSES.has(status)) {
        cancelledSales += total;
        continue;
      }
      if (COMPLETED_ORDER_STATUSES.has(status)) {
        grossSales += total;
        const method = formatPaymentMethod(order.payment_method);
        paymentMap.set(method, (paymentMap.get(method) || 0) + total);
      }
    }

    let expenseTotal = 0;
    let openExpenseTotal = 0;
    for (const expense of data.expenses) {
      if (expense.reversed_at || normalize(expense.status) === 'cancelled') continue;
      const amount = asNumber(expense.amount);
      expenseTotal += amount;
      if (!expense.paid_at && !['paid', 'paga', 'pago'].includes(normalize(expense.status))) openExpenseTotal += amount;
    }

    const authorizedDocuments = data.fiscalDocuments.filter((row) => AUTHORIZED_FISCAL_STATUSES.has(normalize(row.status)));
    const cancelledDocuments = data.fiscalDocuments.filter((row) => CANCELLED_FISCAL_STATUSES.has(normalize(row.status)));
    const pendingDocuments = data.fiscalDocuments.filter((row) => !AUTHORIZED_FISCAL_STATUSES.has(normalize(row.status)) && !CANCELLED_FISCAL_STATUSES.has(normalize(row.status)));
    const fiscalTotal = authorizedDocuments.reduce((sum, row) => sum + asNumber(row.valor_total), 0);
    const activeProducts = data.products.filter((row) => row.active !== false);
    const productsWithoutNcm = activeProducts.filter((row) => !String(row.ncm || row.fiscal_ncm || '').trim());
    const productsWithoutOperation = activeProducts.filter((row) => !row.default_fiscal_operation_id && !String(row.cfop || row.fiscal_cfop || '').trim());
    const pendingTimeEvents = data.timeEvents.filter((row) => normalize(row.status) === 'pending_review');
    const openReceivables = data.receivables.filter((row) => !['paid', 'pago', 'settled', 'cancelled'].includes(normalize(row.status)));
    const receivableTotal = openReceivables.reduce((sum, row) => sum + Math.max(0, asNumber(row.amount) - asNumber(row.paid_amount)), 0);

    return {
      grossSales, cancelledSales, expenseTotal, openExpenseTotal, fiscalTotal,
      authorizedDocuments, cancelledDocuments, pendingDocuments, activeProducts,
      productsWithoutNcm, productsWithoutOperation, pendingTimeEvents, openReceivables, receivableTotal,
      paymentMethods: Array.from(paymentMap, ([method, value]) => ({ method, value })).sort((a, b) => b.value - a.value),
    };
  }, [data]);

  const pendingItems = useMemo<PendingItem[]>(() => {
    const items: PendingItem[] = [];
    if (metrics.pendingDocuments.length) items.push({ id: 'fiscal', title: 'Documentos fiscais precisam de atenção', detail: 'Rejeitados, com erro ou ainda sem autorização.', count: metrics.pendingDocuments.length, level: 'critical', tab: 'documents' });
    if (metrics.productsWithoutNcm.length) items.push({ id: 'ncm', title: 'Produtos sem NCM', detail: 'Complete o cadastro fiscal antes da próxima emissão.', count: metrics.productsWithoutNcm.length, level: 'warning', tab: 'documents' });
    if (metrics.productsWithoutOperation.length) items.push({ id: 'operation', title: 'Produtos sem operação fiscal padrão', detail: 'A operação padrão reduz erros no PDV.', count: metrics.productsWithoutOperation.length, level: 'warning', tab: 'documents' });
    if (metrics.pendingTimeEvents.length) items.push({ id: 'time', title: 'Marcações de ponto para revisar', detail: 'Ocorrências pendentes podem afetar o fechamento da equipe.', count: metrics.pendingTimeEvents.length, level: 'info', tab: 'team' });
    if (metrics.openExpenseTotal > 0) items.push({ id: 'payables', title: 'Contas a pagar em aberto', detail: money.format(metrics.openExpenseTotal), count: data.expenses.filter((row) => !row.paid_at && !['paid', 'paga', 'pago'].includes(normalize(row.status))).length, level: 'info', tab: 'finance' });
    return items;
  }, [data.expenses, metrics]);

  const complianceScore = Math.max(0, Math.round(100 - Math.min(60, pendingItems.reduce((sum, item) => sum + (item.level === 'critical' ? 12 : item.level === 'warning' ? 6 : 3) * Math.min(item.count, 3), 0))));
  const checklistProgress = Math.round((checklist.length / CHECKLIST.length) * 100);

  const updateChecklist = (id: string, checked: boolean) => {
    setChecklist((current) => {
      const next = checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id);
      if (storagePrefix) localStorage.setItem(`${storagePrefix}.checklist`, JSON.stringify(next));
      return next;
    });
  };

  const exportMonthlyPackage = () => {
    const rows = [
      ['COMPETENCIA', month], ['LOJA', storeName], ['FATURAMENTO', metrics.grossSales], ['DESPESAS', metrics.expenseTotal],
      ['SALDO_OPERACIONAL', metrics.grossSales - metrics.expenseTotal], ['DOCUMENTOS_AUTORIZADOS', metrics.authorizedDocuments.length],
      ['VALOR_FISCAL', metrics.fiscalTotal], ['CANCELAMENTOS', metrics.cancelledSales], ['CONTAS_A_RECEBER', metrics.receivableTotal],
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\n')}`;
    downloadFile(`PopSystem-fechamento-${month}.csv`, csv);
    updateChecklist('export', true);
    toast.success('Pacote mensal gerado com sucesso.');
  };

  const exportDocuments = () => {
    const header = ['numero', 'serie', 'emissao', 'status', 'chave', 'valor'];
    const rows = data.fiscalDocuments.map((row) => [row.numero, row.serie, getFiscalDate(row), row.status, row.chave_acesso, row.valor_total]);
    downloadFile(`PopSystem-documentos-fiscais-${month}.csv`, `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n')}`);
  };

  const downloadXml = (document: DataRow) => {
    const xml = document.xml_autorizado || document.xml_content;
    if (!xml) {
      toast.error('Este documento ainda não possui XML disponível.');
      return;
    }
    downloadFile(`NFCe-${document.numero || document.id}.xml`, String(xml), 'application/xml;charset=utf-8');
  };

  const createRequest = () => {
    if (!requestTitle.trim()) return;
    const next: AccountingRequest[] = [{
      id: crypto.randomUUID(), title: requestTitle.trim(), detail: requestDetail.trim(), priority: requestPriority,
      status: 'aberta', createdAt: new Date().toISOString(),
    }, ...requests];
    setRequests(next);
    if (storagePrefix) localStorage.setItem(`${storagePrefix}.requests`, JSON.stringify(next));
    setRequestTitle(''); setRequestDetail(''); setRequestPriority('normal'); setRequestOpen(false);
    toast.success('Solicitação registrada nesta homologação.');
  };

  const toggleRequest = (id: string) => {
    const next = requests.map((request) => request.id === id ? { ...request, status: request.status === 'aberta' ? 'resolvida' : 'aberta' } as AccountingRequest : request);
    setRequests(next);
    if (storagePrefix) localStorage.setItem(`${storagePrefix}.requests`, JSON.stringify(next));
  };

  const sendPilotInvite = async () => {
    if (!inviteEmail.trim()) return;
    const subject = encodeURIComponent(`Acesso contábil PopSystem — ${storeName}`);
    const body = encodeURIComponent(`Olá! Estamos preparando seu acesso à Central do Contador da ${storeName}. Esta é uma validação no ambiente de homologação do PopSystem.`);
    window.location.href = `mailto:${inviteEmail.trim()}?subject=${subject}&body=${body}`;
    await navigator.clipboard?.writeText(inviteEmail.trim());
    setInviteOpen(false);
    toast.success('Convite piloto preparado no seu e-mail.');
  };

  const filteredDocuments = data.fiscalDocuments.filter((row) => {
    const haystack = `${row.numero || ''} ${row.serie || ''} ${row.chave_acesso || ''} ${row.status || ''}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  const auditEvents = useMemo(() => {
    const events = [
      ...data.fiscalDocuments.map((row) => ({ id: `f-${row.id}`, date: getFiscalDate(row), icon: FileText, title: `Documento fiscal ${row.numero || ''}`, detail: `Status: ${row.status || 'pendente'}` })),
      ...data.cashSessions.map((row) => ({ id: `c-${row.id}`, date: row.closed_at || row.opened_at, icon: Landmark, title: row.closed_at ? 'Caixa fechado' : 'Caixa aberto', detail: row.closed_at ? `Valor informado: ${money.format(asNumber(row.final_amount))}` : 'Sessão em andamento' })),
      ...data.purchaseImports.map((row) => ({ id: `p-${row.id}`, date: row.created_at, icon: FileSpreadsheet, title: `Entrada por ${row.source_type || 'documento'}`, detail: `${row.supplier_name || 'Fornecedor não informado'} · ${money.format(asNumber(row.total_amount))}` })),
    ];
    return events.filter((event) => event.date).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 30);
  }, [data.cashSessions, data.fiscalDocuments, data.purchaseImports]);

  return (
    <div className="h-full overflow-y-auto overscroll-contain pb-24 pr-1">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <section className="relative overflow-hidden rounded-[28px] bg-[#043d2d] p-6 text-white shadow-[0_22px_55px_-30px_rgba(0,50,35,0.7)] sm:p-8">
          <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[#8cc850]/20 blur-2xl" />
          <div className="absolute bottom-0 right-1/4 h-36 w-64 rotate-[-8deg] rounded-full bg-[#ff6400]/20 blur-2xl" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="border-white/20 bg-white/10 text-white hover:bg-white/10"><Sparkles className="mr-1.5 h-3.5 w-3.5 text-[#b9ef75]" />NOVO EM HOMOLOGAÇÃO</Badge>
                <Badge className="border-[#ff8b3d]/30 bg-[#ff6400]/15 text-[#ffd4b7] hover:bg-[#ff6400]/15">PopContábil</Badge>
              </div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Central do Contador</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">Fiscal, financeiro, documentos, equipe e fechamento mensal reunidos em uma visão segura da {storeName}.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(190px,1fr)_auto_auto]">
              <div className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-white/60">Competência</Label>
                <Input type="month" value={month} onChange={(event) => setMonth(event.target.value || currentMonthKey())} className="mt-1 h-9 border-white/15 bg-white text-[#043d2d]" />
              </div>
              <Button onClick={() => setInviteOpen(true)} variant="outline" className="h-full min-h-14 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"><Mail className="mr-2 h-4 w-4" />Convidar contador</Button>
              <Button onClick={exportMonthlyPackage} className="h-full min-h-14 bg-[#ff6400] font-bold text-white shadow-lg hover:bg-[#e85b00]"><Download className="mr-2 h-4 w-4" />Gerar fechamento</Button>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Building2 className="h-5 w-5" /></div>
            <div><p className="text-sm font-bold text-[#073d2c]">{storeName}</p><p className="text-xs text-slate-500">{stores.length > 1 ? `${stores.length} empresas disponíveis na carteira` : 'Empresa atual da carteira'}</p></div>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {refreshedAt ? <span>Atualizado {refreshedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span> : null}
            <Button variant="ghost" size="sm" onClick={() => void loadData()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Atualizar</Button>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-3xl border bg-white"><Loader2 className="h-8 w-8 animate-spin text-[#0b7a53]" /><span className="ml-3 font-semibold text-[#073d2c]">Organizando os dados contábeis…</span></div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
            <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white p-1.5 shadow-sm">
              <TabsList className="h-auto min-w-max justify-start bg-transparent">
                {[
                  ['overview', 'Visão geral'], ['closing', 'Fechamento'], ['documents', 'Documentos fiscais'],
                  ['finance', 'Financeiro'], ['team', 'Equipe'], ['requests', 'Solicitações'], ['audit', 'Auditoria'],
                ].map(([value, label]) => <TabsTrigger key={value} value={value} className="rounded-xl px-4 py-2.5 data-[state=active]:bg-[#073d2c] data-[state=active]:text-white">{label}</TabsTrigger>)}
              </TabsList>
            </div>

            <TabsContent value="overview" className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Faturamento" value={money.format(metrics.grossSales)} detail={`${number.format(data.orders.length)} pedidos no período`} icon={CircleDollarSign} />
                <MetricCard label="Fiscal autorizado" value={money.format(metrics.fiscalTotal)} detail={`${number.format(metrics.authorizedDocuments.length)} documentos autorizados`} icon={FileCheck2} tone="blue" />
                <MetricCard label="Despesas" value={money.format(metrics.expenseTotal)} detail={`${money.format(metrics.openExpenseTotal)} ainda em aberto`} icon={Banknote} tone="orange" />
                <MetricCard label="Saldo operacional" value={money.format(metrics.grossSales - metrics.expenseTotal)} detail="Faturamento menos despesas lançadas" icon={Landmark} tone="purple" />
              </div>

              <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
                <Card className="border-black/[0.06] shadow-sm">
                  <CardHeader className="flex-row items-start justify-between gap-4">
                    <div><CardTitle className="text-[#073d2c]">Pendências inteligentes</CardTitle><CardDescription>O PopSystem aponta o que merece revisão antes do fechamento.</CardDescription></div>
                    <Badge className={pendingItems.length ? 'bg-amber-100 text-amber-800 hover:bg-amber-100' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'}>{pendingItems.length} pontos</Badge>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {pendingItems.length === 0 ? <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><CheckCircle2 className="h-6 w-6" /><div><p className="font-bold">Nenhuma pendência crítica encontrada</p><p className="text-sm">A competência está pronta para a conferência final.</p></div></div> : pendingItems.map((item) => {
                      const colors = item.level === 'critical' ? 'border-red-200 bg-red-50 text-red-700' : item.level === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-sky-200 bg-sky-50 text-sky-800';
                      const Icon = item.level === 'critical' ? XCircle : item.level === 'warning' ? TriangleAlert : AlertCircle;
                      return <button key={item.id} type="button" onClick={() => setActiveTab(item.tab)} className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${colors}`}><Icon className="h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><p className="font-bold">{item.title}</p><p className="text-sm opacity-80">{item.detail}</p></div><Badge className="bg-white/80 text-current hover:bg-white/80">{item.count}</Badge><ChevronRight className="h-4 w-4" /></button>;
                    })}
                  </CardContent>
                </Card>

                <Card className="overflow-hidden border-black/[0.06] shadow-sm">
                  <div className="bg-gradient-to-br from-[#eaf7ef] to-white p-6">
                    <div className="flex items-center justify-between"><div className="rounded-2xl bg-[#073d2c] p-3 text-white"><ShieldCheck className="h-6 w-6" /></div><Badge className="bg-white text-[#073d2c] hover:bg-white">Saúde contábil</Badge></div>
                    <p className="mt-6 text-5xl font-black tracking-tight text-[#073d2c]">{complianceScore}%</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-800">Índice de prontidão da competência</p>
                    <Progress value={complianceScore} className="mt-5 h-2 bg-emerald-100 [&>div]:bg-[#79b934]" />
                    <p className="mt-4 text-xs leading-5 text-slate-500">Calculado com base nos cadastros fiscais, documentos, financeiro e ocorrências disponíveis.</p>
                  </div>
                </Card>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <Card><CardHeader><CardTitle className="text-[#073d2c]">Meios de pagamento</CardTitle><CardDescription>Distribuição do faturamento confirmado.</CardDescription></CardHeader><CardContent className="space-y-4">{metrics.paymentMethods.length ? metrics.paymentMethods.slice(0, 6).map((row) => <div key={row.method}><div className="mb-1.5 flex justify-between text-sm"><span className="font-semibold text-slate-700">{row.method}</span><span className="font-bold text-[#073d2c]">{money.format(row.value)}</span></div><Progress value={metrics.grossSales ? row.value / metrics.grossSales * 100 : 0} className="h-2 bg-slate-100 [&>div]:bg-[#8cc850]" /></div>) : <p className="py-8 text-center text-sm text-slate-500">Sem vendas confirmadas na competência.</p>}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-[#073d2c]">Carteira de empresas</CardTitle><CardDescription>Acesse as lojas vinculadas à sua conta PopSystem.</CardDescription></CardHeader><CardContent className="space-y-3">{stores.length ? stores.map((store) => <div key={store.store_user_id} className={`flex items-center gap-3 rounded-2xl border p-4 ${store.store_user_id === user?.id ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200'}`}><div className="rounded-xl bg-white p-2 shadow-sm"><Building2 className="h-5 w-5 text-[#0b7a53]" /></div><div className="min-w-0 flex-1"><p className="truncate font-bold text-[#073d2c]">{store.store_name}</p><p className="truncate text-xs text-slate-500">{store.store_email || 'E-mail não informado'}</p></div>{store.store_user_id === user?.id ? <Badge className="bg-[#073d2c] text-white">Atual</Badge> : <Badge variant="outline">Disponível</Badge>}</div>) : <p className="py-8 text-center text-sm text-slate-500">A loja atual será exibida após a sincronização.</p>}</CardContent></Card>
              </div>
            </TabsContent>

            <TabsContent value="closing" className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
                <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-[#073d2c]">Fechamento de {monthLabel(month)}</CardTitle><CardDescription>Checklist guiado para preparar a entrega mensal ao contador.</CardDescription></div><Badge className="bg-[#eaf7ef] px-3 py-1.5 text-[#0b7a53] hover:bg-[#eaf7ef]">{checklist.length}/{CHECKLIST.length} concluídos</Badge></div></CardHeader><CardContent className="space-y-3">{CHECKLIST.map((item) => { const Icon = item.icon; const checked = checklist.includes(item.id); return <label key={item.id} className={`flex cursor-pointer items-center gap-4 rounded-2xl border p-4 transition ${checked ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 hover:border-emerald-200'}`}><Checkbox checked={checked} onCheckedChange={(value) => updateChecklist(item.id, Boolean(value))} /><div className={`rounded-xl p-2 ${checked ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon className="h-5 w-5" /></div><span className={`flex-1 font-semibold ${checked ? 'text-emerald-800 line-through decoration-emerald-300' : 'text-slate-700'}`}>{item.label}</span>{checked ? <Check className="h-5 w-5 text-emerald-600" /> : null}</label>; })}</CardContent></Card>
                <div className="space-y-5"><Card className="border-[#d8edcb] bg-gradient-to-br from-[#f2faec] to-white"><CardHeader><CardTitle className="text-[#073d2c]">Pacote contábil</CardTitle><CardDescription>Resumo consolidado da competência.</CardDescription></CardHeader><CardContent><div className="mb-3 flex items-end justify-between"><span className="text-4xl font-black text-[#073d2c]">{checklistProgress}%</span><span className="text-xs font-bold text-slate-500">PREPARADO</span></div><Progress value={checklistProgress} className="h-2.5 bg-white [&>div]:bg-[#79b934]" /><Button className="mt-6 w-full bg-[#ff6400] font-bold hover:bg-[#e85b00]" onClick={exportMonthlyPackage}><FileArchive className="mr-2 h-4 w-4" />Gerar pacote mensal</Button></CardContent></Card><Card><CardHeader><CardTitle className="text-base text-[#073d2c]">O pacote inclui</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">{['Resumo de faturamento', 'Despesas e contas em aberto', 'Conferência de documentos fiscais', 'Cancelamentos e recebíveis', 'Indicadores da equipe'].map((label) => <div key={label} className="flex items-center gap-2 text-slate-600"><BadgeCheck className="h-4 w-4 text-emerald-600" />{label}</div>)}</CardContent></Card></div>
              </div>
            </TabsContent>

            <TabsContent value="documents" className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Autorizados" value={number.format(metrics.authorizedDocuments.length)} detail={money.format(metrics.fiscalTotal)} icon={FileCheck2} /><MetricCard label="Pendentes/Rejeitados" value={number.format(metrics.pendingDocuments.length)} detail="Exigem conferência" icon={FileClock} tone="orange" /><MetricCard label="Cancelados" value={number.format(metrics.cancelledDocuments.length)} detail="Documentos cancelados" icon={XCircle} tone="purple" /><MetricCard label="Cadastro fiscal" value={`${metrics.activeProducts.length - metrics.productsWithoutNcm.length}/${metrics.activeProducts.length}`} detail="Produtos com NCM" icon={PackageCheck} tone="blue" /></div>
              <Card><CardHeader><div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center"><div><CardTitle className="text-[#073d2c]">Documentos fiscais</CardTitle><CardDescription>Consulta e exportação de XML por competência.</CardDescription></div><div className="flex gap-2"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Número, chave ou status" className="pl-9" /></div><Button variant="outline" onClick={exportDocuments}><Download className="mr-2 h-4 w-4" />Exportar</Button></div></div></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wider text-slate-500"><th className="px-3 py-3">Documento</th><th className="px-3 py-3">Emissão</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Chave de acesso</th><th className="px-3 py-3 text-right">Valor</th><th className="px-3 py-3 text-right">XML</th></tr></thead><tbody>{filteredDocuments.length ? filteredDocuments.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="px-3 py-4 font-bold text-[#073d2c]">NFC-e {row.numero || '—'}<span className="ml-2 text-xs font-normal text-slate-400">Série {row.serie || '—'}</span></td><td className="px-3 py-4 text-slate-600">{getFiscalDate(row) ? dateTime.format(new Date(getFiscalDate(row))) : '—'}</td><td className="px-3 py-4"><StatusBadge status={row.status} /></td><td className="max-w-[260px] truncate px-3 py-4 font-mono text-xs text-slate-500">{row.chave_acesso || 'Não disponível'}</td><td className="px-3 py-4 text-right font-bold">{money.format(asNumber(row.valor_total))}</td><td className="px-3 py-4 text-right"><Button variant="ghost" size="sm" onClick={() => downloadXml(row)} disabled={!row.xml_autorizado && !row.xml_content}><Download className="h-4 w-4" /></Button></td></tr>) : <tr><td colSpan={6} className="py-12 text-center text-slate-500">Nenhum documento encontrado nesta competência.</td></tr>}</tbody></table></div></CardContent></Card>
            </TabsContent>

            <TabsContent value="finance" className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Receitas" value={money.format(metrics.grossSales)} detail="Vendas confirmadas" icon={CircleDollarSign} /><MetricCard label="Contas a pagar" value={money.format(metrics.openExpenseTotal)} detail="Saldo ainda em aberto" icon={Banknote} tone="orange" /><MetricCard label="Contas a receber" value={money.format(metrics.receivableTotal)} detail={`${metrics.openReceivables.length} lançamentos`} icon={WalletCards} tone="blue" /><MetricCard label="Cancelamentos" value={money.format(metrics.cancelledSales)} detail="Vendas canceladas" icon={XCircle} tone="purple" /></div>
              <div className="grid gap-5 xl:grid-cols-2"><Card><CardHeader><CardTitle className="text-[#073d2c]">Contas e despesas</CardTitle><CardDescription>Lançamentos da competência selecionada.</CardDescription></CardHeader><CardContent className="space-y-2">{data.expenses.slice(0, 12).map((row) => <div key={row.id} className="flex items-center gap-3 rounded-xl border p-3"><div className="rounded-lg bg-orange-50 p-2 text-orange-700"><Banknote className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-700">{row.description || 'Despesa'}</p><p className="text-xs text-slate-500">{getExpenseDate(row) ? new Date(`${String(getExpenseDate(row)).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem data'} · {row.category || 'Sem categoria'}</p></div><div className="text-right"><p className="font-bold text-slate-800">{money.format(asNumber(row.amount))}</p><StatusBadge status={row.status || (row.paid_at ? 'Pago' : 'Em aberto')} /></div></div>)}{data.expenses.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">Nenhuma despesa lançada.</p> : null}</CardContent></Card><Card><CardHeader><CardTitle className="text-[#073d2c]">Conciliação por pagamento</CardTitle><CardDescription>Receitas registradas por meio de pagamento.</CardDescription></CardHeader><CardContent className="space-y-4">{metrics.paymentMethods.map((row) => <div key={row.method} className="rounded-2xl border p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><WalletCards className="h-4 w-4" /></div><span className="font-bold text-slate-700">{row.method}</span></div><span className="text-lg font-black text-[#073d2c]">{money.format(row.value)}</span></div></div>)}{metrics.paymentMethods.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">Nenhuma receita para conciliar.</p> : null}</CardContent></Card></div>
            </TabsContent>

            <TabsContent value="team" className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Colaboradores" value={number.format(data.employees.filter((row) => row.active !== false).length)} detail="Cadastros ativos" icon={UsersRound} /><MetricCard label="Marcações" value={number.format(data.timeEvents.length)} detail={`Em ${monthLabel(month)}`} icon={Clock3} tone="blue" /><MetricCard label="Para revisar" value={number.format(metrics.pendingTimeEvents.length)} detail="Ocorrências pendentes" icon={TriangleAlert} tone="orange" /><MetricCard label="Folha preparada" value={checklist.includes('team') ? 'Sim' : 'Não'} detail="Checklist do fechamento" icon={UserRoundCheck} tone="purple" /></div>
              <Card><CardHeader><CardTitle className="text-[#073d2c]">Resumo da equipe</CardTitle><CardDescription>Base para conferência de ponto e folha.</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.employees.map((employee) => { const events = data.timeEvents.filter((event) => event.waiter_id === employee.id); const pending = events.filter((event) => normalize(event.status) === 'pending_review').length; return <div key={employee.id} className="rounded-2xl border p-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eaf7ef] font-black text-[#0b7a53]">{String(employee.name || '?').slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate font-bold text-[#073d2c]">{employee.name || 'Colaborador'}</p><p className="text-xs text-slate-500">{employee.role || employee.job_title || 'Equipe operacional'}</p></div>{employee.active === false ? <Badge variant="secondary">Inativo</Badge> : <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Ativo</Badge>}</div><div className="mt-4 grid grid-cols-2 gap-2 text-center"><div className="rounded-xl bg-slate-50 p-2"><p className="text-lg font-black text-[#073d2c]">{events.length}</p><p className="text-[11px] text-slate-500">marcações</p></div><div className="rounded-xl bg-amber-50 p-2"><p className="text-lg font-black text-amber-700">{pending}</p><p className="text-[11px] text-amber-700">pendências</p></div></div></div>; })}</div>{data.employees.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">Nenhum colaborador cadastrado.</p> : null}</CardContent></Card>
            </TabsContent>

            <TabsContent value="requests" className="space-y-5">
              <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-[#073d2c]">Solicitações entre loja e contador</CardTitle><CardDescription>Organize documentos, dúvidas e ajustes sem depender de mensagens soltas.</CardDescription></div><Button className="bg-[#ff6400] hover:bg-[#e85b00]" onClick={() => setRequestOpen(true)}><Plus className="mr-2 h-4 w-4" />Nova solicitação</Button></div></CardHeader><CardContent className="space-y-3">{requests.map((request) => <div key={request.id} className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${request.status === 'resolvida' ? 'bg-slate-50 opacity-75' : 'bg-white'}`}><div className={`rounded-xl p-2.5 ${request.priority === 'alta' ? 'bg-red-50 text-red-700' : 'bg-sky-50 text-sky-700'}`}><MessageSquareText className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[#073d2c]">{request.title}</p><Badge variant="outline">{request.priority === 'alta' ? 'Alta prioridade' : 'Normal'}</Badge></div><p className="mt-1 text-sm text-slate-500">{request.detail || 'Sem observação'} · {dateTime.format(new Date(request.createdAt))}</p></div><Button variant="outline" size="sm" onClick={() => toggleRequest(request.id)}>{request.status === 'aberta' ? <><Check className="mr-2 h-4 w-4" />Resolver</> : 'Reabrir'}</Button></div>)}{requests.length === 0 ? <div className="rounded-2xl border border-dashed py-14 text-center"><MessageSquareText className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 font-semibold text-slate-600">Nenhuma solicitação nesta competência</p><p className="mt-1 text-sm text-slate-400">Crie a primeira para testar o fluxo da Central.</p></div> : null}</CardContent></Card>
            </TabsContent>

            <TabsContent value="audit" className="space-y-5">
              <Card><CardHeader><CardTitle className="flex items-center gap-2 text-[#073d2c]"><ShieldCheck className="h-5 w-5 text-emerald-600" />Trilha de auditoria</CardTitle><CardDescription>Eventos relevantes da competência, ordenados do mais recente para o mais antigo.</CardDescription></CardHeader><CardContent><div className="relative space-y-0 before:absolute before:bottom-4 before:left-[19px] before:top-4 before:w-px before:bg-slate-200">{auditEvents.map((event) => { const Icon = event.icon; return <div key={event.id} className="relative flex gap-4 py-3"><div className="z-10 rounded-xl border bg-white p-2 text-[#0b7a53] shadow-sm"><Icon className="h-5 w-5" /></div><div className="min-w-0 pt-1"><p className="font-bold text-slate-700">{event.title}</p><p className="text-sm text-slate-500">{event.detail}</p><p className="mt-1 text-xs text-slate-400">{dateTime.format(new Date(event.date))}</p></div></div>; })}{auditEvents.length === 0 ? <p className="py-12 text-center text-sm text-slate-500">Nenhum evento auditável no período.</p> : null}</div></CardContent></Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent><DialogHeader><DialogTitle>Nova solicitação contábil</DialogTitle><DialogDescription>Registre o que precisa ser revisado nesta competência.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="request-title">Assunto</Label><Input id="request-title" value={requestTitle} onChange={(event) => setRequestTitle(event.target.value)} placeholder="Ex.: Comprovante da conta de energia" /></div><div className="space-y-2"><Label htmlFor="request-detail">Descrição</Label><Textarea id="request-detail" value={requestDetail} onChange={(event) => setRequestDetail(event.target.value)} placeholder="Inclua as informações necessárias…" /></div><div className="space-y-2"><Label>Prioridade</Label><Select value={requestPriority} onValueChange={(value) => setRequestPriority(value as 'normal' | 'alta')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">Normal</SelectItem><SelectItem value="alta">Alta</SelectItem></SelectContent></Select></div></div><DialogFooter><Button variant="outline" onClick={() => setRequestOpen(false)}>Cancelar</Button><Button className="bg-[#073d2c] hover:bg-[#0b5a42]" onClick={createRequest} disabled={!requestTitle.trim()}>Criar solicitação</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-[#ff6400]" />Convidar contador</DialogTitle><DialogDescription>O convite externo está em modo piloto na homologação. Nenhuma permissão será aberta automaticamente no banco de produção.</DialogDescription></DialogHeader><div className="space-y-4"><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">Proteção de dados ativa</p><p className="mt-1">Nesta etapa o sistema prepara o convite por e-mail. O acesso dedicado e as permissões por empresa serão ativados após a validação do fluxo.</p></div><div className="space-y-2"><Label htmlFor="accountant-email">E-mail do contador</Label><Input id="accountant-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="contador@escritorio.com.br" /></div></div><DialogFooter><Button variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button><Button className="bg-[#ff6400] hover:bg-[#e85b00]" onClick={() => void sendPilotInvite()} disabled={!inviteEmail.trim()}><Mail className="mr-2 h-4 w-4" />Preparar convite</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
