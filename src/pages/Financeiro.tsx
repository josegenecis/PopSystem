import { useState, useEffect, useRef } from 'react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle
} from '@/components/ui/card';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  CreditCard, 
  DollarSign, 
  ArrowUp, 
  ArrowDown, 
  Download, 
  Filter,
  Percent,
  Lock,
  Unlock,
  RefreshCw,
  ReceiptText,
  ChevronRight,
  XCircle,
  CalendarDays,
  ShoppingBag,
  Ban,
  WalletCards,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Printer,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { PrinterService } from '@/utils/printerService';
import { canCancelOrder, canCloseCash, canMoveCash, canOpenCash, getLocalOperatorSession } from '@/services/operatorAuth';
import { updateOrderStatus } from '@/utils/updateOrderStatus';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend, BarChart, Bar } from 'recharts';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CurrencyTextInput } from '@/components/ui/currency-text-input';
import { formatBRL, parseBRL } from '@/lib/currency';
import { CancelSaleDialog } from '@/components/finance/CancelSaleDialog';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import { Checkbox } from '@/components/ui/checkbox';
import { getOpenTableCount } from '@/services/openTables';
import { cn } from '@/lib/utils';

type PaymentMethod = 'pix' | 'pix_online' | 'pix_entrega' | 'dinheiro' | 'cartao' | 'cartao_online';
type PaymentMethodFilter = '' | 'all' | PaymentMethod;
type TxTypeFilter = '' | 'all' | 'entrada' | 'saida';
type PeriodPreset = 'today' | '7d' | '30d' | 'month';
type SupabaseQuery = {
  select: (columns: string) => SupabaseQuery;
  eq: (column: string, value: unknown) => SupabaseQuery;
  order: (column: string, options?: { ascending?: boolean }) => SupabaseQuery;
  limit: (count: number) => SupabaseQuery;
  maybeSingle: () => Promise<{ data: unknown; error?: unknown }>;
};
type SupabaseUntyped = {
  from: (table: string) => SupabaseQuery;
};

interface Transaction {
  id: string;
  date: Date;
  description: string;
  amount: number;
  type: 'entrada' | 'saida';
  category: string;
  paymentMethod?: PaymentMethod;
  status?: string;
  acceptanceStatus?: string;
  order?: Record<string, any>;
}

interface CashSession {
  id: string;
  opened_at: string;
  closed_at: string | null;
  initial_amount: number;
  final_amount: number | null;
  status: 'open' | 'closed';
  notes?: string | null;
}

interface CashCloseOverview {
  total: number;
  pix: number;
  cash: number;
  credit: number;
  debit: number;
  genericCard: number;
  receivable: number;
  inAmount: number;
  outAmount: number;
  expectedCash: number;
}

const FINANCE_PAGE_SIZE = 1000;

const getPeriodRange = (preset: PeriodPreset = '30d') => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);

  if (preset === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - (preset === '7d' ? 6 : 29));
    start.setHours(0, 0, 0, 0);
  }

  return { start, end };
};

const isConfirmedIncome = (transaction: Transaction) => {
  const status = String(transaction.status || '').toLowerCase();
  const acceptanceStatus = String(transaction.acceptanceStatus || '').toLowerCase();
  return status !== 'cancelled' && acceptanceStatus !== 'awaiting_pix_payment';
};

const Financeiro = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [ordersRaw, setOrdersRaw] = useState<any[]>([]);
  const [expensesRaw, setExpensesRaw] = useState<any[]>([]);
  const [currentSession, setCurrentSession] = useState<CashSession | null>(null);
  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [sessionOrders, setSessionOrders] = useState<any[]>([]);
  const [sessionMovements, setSessionMovements] = useState<any[]>([]);
  const [loadingSessionDetails, setLoadingSessionDetails] = useState(false);
  const [reprintingCashReport, setReprintingCashReport] = useState(false);
  const [reprintingOrderIds, setReprintingOrderIds] = useState<Set<string>>(new Set());
  const [cancellingOrderIds, setCancellingOrderIds] = useState<Set<string>>(new Set());
  const [orderToCancel, setOrderToCancel] = useState<any | null>(null);
  const fetchSequenceRef = useRef(0);
  
  // States for Cash Register
  const [cashAmount, setCashAmount] = useState('');
  const [isCashDialogOpen, setIsCashDialogOpen] = useState(false);
  const [cashOperation, setCashOperation] = useState<'open' | 'close' | 'in' | 'out'>('open');
  const [cashDescription, setCashDescription] = useState('');
  const [openTablesCount, setOpenTablesCount] = useState(0);
  const [checkingOpenTables, setCheckingOpenTables] = useState(false);
  const [openTablesConsent, setOpenTablesConsent] = useState(false);
  const [cashCloseOverview, setCashCloseOverview] = useState<CashCloseOverview | null>(null);
  const [loadingCashCloseOverview, setLoadingCashCloseOverview] = useState(false);
  const [mobileFinanceTab, setMobileFinanceTab] = useState<'caixa' | 'movimentos' | 'relatorios'>('caixa');

  const [filters, setFilters] = useState(() => {
    const { start, end } = getPeriodRange('30d');
    return {
      paymentMethod: '' as PaymentMethodFilter,
      type: '' as TxTypeFilter,
      startDate: start as Date | null,
      endDate: end as Date | null,
      searchTerm: ''
    };
  });
  const [activePeriodPreset, setActivePeriodPreset] = useState<PeriodPreset | null>('30d');
  const filterStartTimestamp = filters.startDate?.getTime() ?? null;
  const filterEndTimestamp = filters.endDate?.getTime() ?? null;
  
  // Fetch transactions and session
  useEffect(() => {
    if (user) {
      checkOpenSession();
      fetchCashSessions();
    }
  }, [user]);

  useEffect(() => {
    if (user?.id) void fetchData();
    // fetchData intentionally follows the selected date window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, filterStartTimestamp, filterEndTimestamp]);

  useEffect(() => {
    if (user?.id && selectedSessionId) {
      fetchSessionDetails(selectedSessionId);
    }
  }, [user?.id, selectedSessionId]);

  const fetchData = async () => {
    if (!user) return;
    const requestId = ++fetchSequenceRef.current;
    setIsLoading(true);
    try {
      const rangeStart = filters.startDate ? new Date(filters.startDate) : getPeriodRange('30d').start;
      const rangeEnd = filters.endDate ? new Date(filters.endDate) : getPeriodRange('30d').end;
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setHours(23, 59, 59, 999);

      const fetchAllPages = async (buildQuery: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: any }>) => {
        const rows: any[] = [];
        for (let from = 0; ; from += FINANCE_PAGE_SIZE) {
          const { data, error } = await buildQuery(from, from + FINANCE_PAGE_SIZE - 1);
          if (error) throw error;
          const page = (data as any[]) || [];
          rows.push(...page);
          if (page.length < FINANCE_PAGE_SIZE) break;
        }
        return rows;
      };

      const [ordersList, cancellationAudits, expensesList] = await Promise.all([
        fetchAllPages((from, to) => (supabase as any)
          .from('orders')
          .select('*')
          .eq('user_id', user.id)
          .gte('created_at', rangeStart.toISOString())
          .lte('created_at', rangeEnd.toISOString())
          .order('created_at', { ascending: false })
          .range(from, to)),
        fetchAllPages((from, to) => (supabase as any)
          .from('finance_sale_cancellations')
          .select('order_id, reason, authorized_waiter_name, created_at, refund_requested, refund_status')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .range(from, to)),
        fetchAllPages((from, to) => (supabase as any)
          .from('expenses')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .range(from, to)),
      ]);

      if (requestId !== fetchSequenceRef.current) return;
      setOrdersRaw(ordersList);

      const cancellationByOrder = new Map<string, any>();
      cancellationAudits.forEach((audit) => {
        const orderId = String(audit?.order_id || '');
        if (orderId && !cancellationByOrder.has(orderId)) cancellationByOrder.set(orderId, audit);
      });
      
      const incomeTx = ordersList.map(order => ({
        id: order.id,
        date: new Date(order.created_at),
        description: `Pedido #${order.id.substring(0, 8)}`,
        amount: Number(order.total || 0),
        type: 'entrada' as 'entrada',
        category: 'Vendas',
        paymentMethod: order.payment_method as PaymentMethod,
        status: String(order.status || ''),
        acceptanceStatus: String(order.acceptance_status || ''),
        order: {
          ...order,
          financial_cancellation: cancellationByOrder.get(String(order.id)) || null,
        },
      }));

      setExpensesRaw(expensesList);

      const expenseTx = expensesList.map(exp => ({
        id: exp.id,
        date: new Date(exp.expense_date || exp.date || exp.created_at),
        description: exp.description,
        amount: Number(exp.amount || 0),
        type: 'saida' as 'saida',
        category: exp.category || 'Geral',
        paymentMethod: 'dinheiro' as PaymentMethod // Assuming expenses are paid in cash for simplicity or add field later
      }));

      const all = [...incomeTx, ...expenseTx].sort((a, b) => b.date.getTime() - a.date.getTime());
      setTransactions(all);

    } catch (error: any) {
      if (requestId !== fetchSequenceRef.current) return;
      console.error(error);
      toast({
        title: 'Erro ao carregar o faturamento',
        description: 'Não foi possível consultar todas as vendas do período. Tente novamente.',
        variant: 'destructive'
      });
    } finally {
      if (requestId === fetchSequenceRef.current) setIsLoading(false);
    }
  };

  const findOpenSession = async (): Promise<CashSession | null> => {
    if (!user?.id) return null;

    const { data, error } = await (supabase as any)
      .from('cash_register_sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data as CashSession | null) || null;
  };

  const checkOpenSession = async (): Promise<CashSession | null> => {
    if (!user?.id) return null;
    try {
      const data = await findOpenSession();
      setCurrentSession(data);
      if (data?.id) {
        setSelectedSessionId(data.id);
        setCashSessions((current) => [data, ...current.filter((session) => session.id !== data.id)]);
      }
      return data;
    } catch (err) {
      console.error('Unexpected error checking session:', err);
      return null;
    }
  };

  const fetchCashSessions = async () => {
    if (!user) return;
    try {
      const { data, error } = await (supabase as any)
        .from('cash_register_sessions')
        .select('id, opened_at, closed_at, initial_amount, final_amount, status, notes')
        .eq('user_id', user.id)
        .order('opened_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setCashSessions((data as any) || []);
    } catch (e: any) {
      console.error(e);
      setCashSessions([]);
    }
  };

  const fetchSessionDetails = async (sessionId: string) => {
    if (!user?.id) return;
    if (!sessionId) {
      setSessionOrders([]);
      setSessionMovements([]);
      return;
    }
    try {
      setLoadingSessionDetails(true);
      const selected = cashSessions.find((session) => session.id === sessionId)
        || (currentSession?.id === sessionId ? currentSession : null);
      const sessionReq = selected
        ? Promise.resolve({ data: selected, error: null })
        : (supabase as any)
          .from('cash_register_sessions')
          .select('id, opened_at, closed_at, initial_amount, final_amount, status, notes')
          .eq('user_id', user.id)
          .eq('id', sessionId)
          .maybeSingle();
      const movementsReq = (supabase as any)
        .from('cash_movements')
        .select('id, created_at, type, amount, description')
        .eq('user_id', user.id)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false });

      const ordersReq = (supabase as any)
        .from('orders')
        .select('id, order_number, created_at, total, payment_method, status, cash_register_session_id')
        .eq('user_id', user.id)
        .eq('cash_register_session_id', sessionId)
        .order('created_at', { ascending: false });

      const [{ data: session }, { data: orders, error: ordersError }, { data: movements, error: movementsError }] = await Promise.all([
        sessionReq,
        ordersReq,
        movementsReq,
      ]);

      if (movementsError) throw movementsError;
      setSessionMovements((movements as any) || []);

      if (ordersError && String(ordersError.message || '').includes('cash_register_session_id')) {
        setSessionOrders([]);
      } else if (ordersError) {
        throw ordersError;
      } else {
        const linkedOrders = Array.isArray(orders) ? orders : [];
        let unlinkedOrders: any[] = [];

        // Pedidos antigos ou criados por uma tela que ainda não recebeu a sessão
        // podem ficar sem cash_register_session_id. Eles continuam pertencendo ao
        // intervalo da sessão e precisam aparecer no histórico/cancelamento.
        if (session?.opened_at) {
          let unlinkedReq = (supabase as any)
            .from('orders')
            .select('id, order_number, created_at, total, payment_method, status, cash_register_session_id')
            .eq('user_id', user.id)
            .is('cash_register_session_id', null)
            .gte('created_at', session.opened_at);
          if (session.closed_at) {
            unlinkedReq = unlinkedReq.lte('created_at', session.closed_at);
          }
          const { data: fallbackOrders, error: fallbackError } = await unlinkedReq
            .order('created_at', { ascending: false });
          if (!fallbackError && Array.isArray(fallbackOrders)) {
            unlinkedOrders = fallbackOrders;
          }
        }

        const uniqueOrders = new Map<string, any>();
        [...linkedOrders, ...unlinkedOrders].forEach((order) => {
          if (order?.id) uniqueOrders.set(String(order.id), order);
        });
        setSessionOrders(
          Array.from(uniqueOrders.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        );
      }
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Erro', description: e?.message || 'Erro ao carregar sessão', variant: 'destructive' });
      setSessionOrders([]);
      setSessionMovements([]);
    } finally {
      setLoadingSessionDetails(false);
    }
  };

  const requestFinancialCancellation = (order: any) => {
    if (!order?.id || String(order?.status || '') === 'cancelled') return;
    const operatorSession = getLocalOperatorSession();
    if (operatorSession && !canCancelOrder(operatorSession)) {
      toast({
        title: 'Sem permissão',
        description: 'Este operador não tem permissão para cancelar vendas.',
        variant: 'destructive',
      });
      return;
    }

    if (!canCancelFinancialSale(order)) {
      toast({
        title: 'Cancelamento indisponível',
        description: 'Somente vendas do caixa aberto atual podem ser canceladas pela operação diária.',
        variant: 'destructive',
      });
      return;
    }

    setOrderToCancel(order);
  };

  const handleReprintSessionOrder = async (order: Record<string, unknown>) => {
    const orderId = String(order?.id || '');
    if (!user?.id || !orderId || order?.status === 'cancelled') return;

    setReprintingOrderIds((previous) => new Set(previous).add(orderId));
    try {
      const { data: fullOrder, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      if (!fullOrder) throw new Error('Venda não encontrada.');

      await PrinterService.printOrder(fullOrder, {
        openCashDrawer: false,
        throwOnError: true,
      });
      toast({
        title: 'Reimpressão enviada',
        description: `O cupom da venda #${fullOrder.order_number || orderId.slice(0, 8)} foi enviado à impressora.`,
      });
    } catch (error: unknown) {
      console.error('Erro ao reimprimir venda:', error);
      toast({
        title: 'Erro ao reimprimir',
        description: friendlyErrorMessage(error, 'Não foi possível reimprimir o cupom desta venda.'),
        variant: 'destructive',
      });
    } finally {
      setReprintingOrderIds((previous) => {
        const next = new Set(previous);
        next.delete(orderId);
        return next;
      });
    }
  };

  const handleCancelSessionOrder = async ({
    pin,
    reason,
    refundRequested,
  }: {
    pin: string;
    reason: string;
    refundRequested: boolean;
  }) => {
    const order = orderToCancel;
    if (!order?.id || String(order?.status || '') === 'cancelled') return false;
    const orderLabel = order.order_number ? `#${order.order_number}` : String(order.id).slice(0, 8);
    setCancellingOrderIds((prev) => new Set(prev).add(String(order.id)));
    try {
      await updateOrderStatus(String(order.id), 'cancelled', {
        financialCancellation: {
          reason,
          adminPin: pin,
          refundRequested,
        },
      });

      let refundWarning = '';
      if (refundRequested && String(order.payment_method || '').toLowerCase() === 'pix_online') {
        const { data, status } = await invokeEdgeFunction('poppay-refund', {
          orderId: String(order.id),
          reason: `Venda ${orderLabel} cancelada: ${reason}`,
        }, { timeoutMs: 60000 });
        if (status >= 400 || !data?.ok) {
          refundWarning = String(data?.message || 'A venda foi cancelada, mas a devolução do PIX precisa ser conferida.');
        }
      }

      setSessionOrders((prev) => prev.map((item) => (
        item.id === order.id ? { ...item, status: 'cancelled' } : item
      )));
      await refreshFinanceData();
      setOrderToCancel(null);
      toast({
        title: refundWarning ? 'Venda cancelada — confira a devolução' : 'Venda cancelada',
        description: refundWarning || `A venda ${orderLabel} foi cancelada e preservada no histórico de auditoria.`,
        variant: refundWarning ? 'destructive' : 'default',
      });
      return true;
    } catch (error: any) {
      toast({
        title: 'Não foi possível cancelar',
        description: friendlyErrorMessage(error, 'Não foi possível cancelar esta venda. Tente novamente.'),
        variant: 'destructive',
      });
      return false;
    } finally {
      setCancellingOrderIds((prev) => {
        const next = new Set(prev);
        next.delete(String(order.id));
        return next;
      });
    }
  };

  const canCancelFinancialSale = (order: any) => {
    if (!order?.id || String(order?.status || '') === 'cancelled') return false;
    if (!currentSession?.id || currentSession.status !== 'open') return false;

    const linkedSessionId = String(order.cash_register_session_id || '');
    if (linkedSessionId) return linkedSessionId === String(currentSession.id);

    const orderTime = new Date(order.created_at || 0).getTime();
    const openedAt = new Date(currentSession.opened_at || 0).getTime();
    return Number.isFinite(orderTime) && Number.isFinite(openedAt) && orderTime >= openedAt;
  };

  const getPaymentBucket = (paymentMethod: unknown) => {
    const value = String(paymentMethod || '').trim().toLowerCase();
    if (value.includes('pagar_depois') || value.includes('conta') || value.includes('receiv')) return 'receber';
    if (value.includes('pix')) return 'pix';
    if (value.includes('dinheiro') || value.includes('cash') || value.includes('especie')) return 'dinheiro';
    if (value.includes('credito') || value.includes('credit')) return 'credito';
    if (value.includes('debito') || value.includes('debit')) return 'debito';
    if (value.includes('voucher') || value.includes('refeicao') || value.includes('vale')) return 'voucher';
    if (value.includes('cart') || value.includes('card')) return 'cartao';
    return 'outros';
  };

  const getOrderPaymentLines = (order: Record<string, unknown>) => {
    const variations = (order?.variations && typeof order.variations === 'object' ? order.variations : {}) as Record<string, any>;
    const lines = variations?.payment_split?.lines;
    if (!Array.isArray(lines)) return [];
    return lines
      .map((line: any) => ({
        method: String(line?.method || '').trim().toLowerCase(),
        amount: Number(line?.amount || 0),
      }))
      .filter((line) => line.method && Number.isFinite(line.amount) && line.amount > 0);
  };

  const averageMinutesFromOrders = (orders: Array<Record<string, unknown>>) => {
    const validDurations = (Array.isArray(orders) ? orders : [])
      .map((order) => {
        const createdAt = new Date(String(order?.created_at || '')).getTime();
        const updatedAt = new Date(String(order?.updated_at || '')).getTime();
        if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || updatedAt < createdAt) return null;
        return Math.round((updatedAt - createdAt) / 60000);
      })
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);

    if (validDurations.length === 0) return 0;
    return Math.round(validDurations.reduce((sum, value) => sum + value, 0) / validDurations.length);
  };

  const loadCashCloseOverview = async (session: CashSession): Promise<CashCloseOverview> => {
    if (!user?.id) throw new Error('Usuário não autenticado.');

    const closedAt = session.closed_at || new Date().toISOString();
    const orderSelect = 'id, created_at, total, payment_method, status, cash_register_session_id, variations';
    const [{ data: linkedOrders, error: linkedError }, { data: unlinkedOrders, error: unlinkedError }, { data: movements, error: movementsError }] = await Promise.all([
      (supabase as any)
        .from('orders')
        .select(orderSelect)
        .eq('user_id', user.id)
        .eq('cash_register_session_id', session.id),
      (supabase as any)
        .from('orders')
        .select(orderSelect)
        .eq('user_id', user.id)
        .is('cash_register_session_id', null)
        .gte('created_at', session.opened_at)
        .lte('created_at', closedAt),
      (supabase as any)
        .from('cash_movements')
        .select('type, amount')
        .eq('user_id', user.id)
        .eq('session_id', session.id),
    ]);

    if (linkedError) throw linkedError;
    if (unlinkedError) throw unlinkedError;
    if (movementsError) throw movementsError;

    const uniqueOrders = new Map<string, Record<string, unknown>>();
    for (const order of [
      ...(Array.isArray(linkedOrders) ? linkedOrders : []),
      ...(Array.isArray(unlinkedOrders) ? unlinkedOrders : []),
    ]) {
      if (order?.id) uniqueOrders.set(String(order.id), order);
    }

    const sales = Array.from(uniqueOrders.values())
      .filter((order) => String(order?.status || '').toLowerCase() !== 'cancelled');
    const totals = sales.reduce<Record<string, number>>((acc, order) => {
      const lines = getOrderPaymentLines(order);
      const paymentLines = lines.length > 0
        ? lines
        : [{ method: String(order?.payment_method || ''), amount: Number(order?.total || 0) }];
      for (const line of paymentLines) {
        const bucket = getPaymentBucket(line.method);
        acc[bucket] = (acc[bucket] || 0) + line.amount;
      }
      return acc;
    }, {});

    const movementList = Array.isArray(movements) ? movements : [];
    const inAmount = movementList
      .filter((movement) => movement?.type === 'in')
      .reduce((sum, movement) => sum + Number(movement?.amount || 0), 0);
    const outAmount = movementList
      .filter((movement) => movement?.type === 'out')
      .reduce((sum, movement) => sum + Number(movement?.amount || 0), 0);
    const cash = Number(totals.dinheiro || 0);

    return {
      total: sales.reduce((sum, order) => sum + Number(order?.total || 0), 0),
      pix: Number(totals.pix || 0),
      cash,
      credit: Number(totals.credito || 0),
      debit: Number(totals.debito || 0),
      genericCard: Number(totals.cartao || 0) + Number(totals.voucher || 0),
      receivable: Number(totals.receber || 0),
      inAmount,
      outAmount,
      expectedCash: Number(session.initial_amount || 0) + cash + inAmount - outAmount,
    };
  };

  const classifyOrderChannel = (order: Record<string, unknown>) => {
    const orderType = String(order?.order_type || '').trim().toLowerCase();
    const status = String(order?.status || '').trim().toLowerCase();
    const hasTable = Boolean(order?.table_id) || orderType === 'dine_in';
    if (hasTable) return 'dine_in';

    const hasDeliveryInfo =
      orderType === 'delivery' ||
      status === 'in_delivery' ||
      status === 'delivered' ||
      Boolean(order?.delivery_zone_id) ||
      String(order?.customer_address || '').trim().length > 0 ||
      String(order?.customer_neighborhood || '').trim().length > 0 ||
      Number(order?.delivery_fee || 0) > 0;

    if (hasDeliveryInfo) return 'delivery';
    return 'counter';
  };

  const buildCashCloseReportLines = async (
    session: CashSession,
    informedAmount: number,
    closedAt: string,
    notesOverride?: string | null
  ) => {
    if (!user?.id) return [];

    const db = supabase as unknown as SupabaseUntyped;
    const orderSelect = 'id, created_at, updated_at, total, discount, delivery_fee, payment_method, status, order_type, customer_name, customer_phone, customer_address, customer_neighborhood, delivery_zone_id, table_id, variations';
    const [{ data: orders }, { data: unlinkedOrders }, { data: movements }, { data: profile }, { data: fiscal }] = await Promise.all([
      db
        .from('orders')
        .select(orderSelect)
        .eq('user_id', user.id)
        .eq('cash_register_session_id', session.id),
      db
        .from('orders')
        .select(orderSelect)
        .eq('user_id', user.id)
        .is('cash_register_session_id', null)
        .gte('created_at', session.opened_at)
        .lte('created_at', closedAt),
      db
        .from('cash_movements')
        .select('id, created_at, type, amount, description')
        .eq('user_id', user.id)
        .eq('session_id', session.id),
      supabase
        .from('profiles')
        .select('restaurant_name')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('fiscal_settings')
        .select('cnpj')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    const orderMap = new Map<string, Record<string, unknown>>();
    for (const order of [
      ...(Array.isArray(orders) ? orders as Array<Record<string, unknown>> : []),
      ...(Array.isArray(unlinkedOrders) ? unlinkedOrders as Array<Record<string, unknown>> : []),
    ]) {
      const id = String(order?.id || '').trim();
      if (id) orderMap.set(id, order);
    }
    const orderList = Array.from(orderMap.values());
    const movementList = Array.isArray(movements) ? movements as Array<Record<string, unknown>> : [];
    const profileRow = (profile && typeof profile === 'object' ? profile : {}) as Record<string, unknown>;
    const fiscalRow = (fiscal && typeof fiscal === 'object' ? fiscal : {}) as Record<string, unknown>;
    const sales = orderList.filter((order) => String(order?.status || '').toLowerCase() !== 'cancelled');
    const cancelledCount = orderList.length - sales.length;
    const grossRevenue = sales.reduce((sum, order) => sum + Number(order?.total || 0), 0);
    const discounts = sales.reduce((sum, order) => sum + Number(order?.discount || 0), 0);
    const deliveryFee = sales.reduce((sum, order) => sum + Number(order?.delivery_fee || 0), 0);
    const netRevenue = grossRevenue - discounts + deliveryFee;

    const paymentTotals = sales.reduce<Record<string, number>>((acc, order) => {
      const splitLines = getOrderPaymentLines(order);
      const lines = splitLines.length > 0
        ? splitLines
        : [{ method: String(order?.payment_method || ''), amount: Number(order?.total || 0) }];

      for (const line of lines) {
        const bucket = getPaymentBucket(line.method);
        acc[bucket] = (acc[bucket] || 0) + line.amount;
      }
      return acc;
    }, {});

    const inAmount = movementList
      .filter((movement) => movement?.type === 'in')
      .reduce((sum, movement) => sum + Number(movement?.amount || 0), 0);
    const outAmount = movementList
      .filter((movement) => movement?.type === 'out')
      .reduce((sum, movement) => sum + Number(movement?.amount || 0), 0);
    const initial = Number(session.initial_amount || 0);
    const expectedCash = initial + Number(paymentTotals.dinheiro || 0) + inAmount - outAmount;
    const difference = informedAmount - expectedCash;
    const operatorSession = getLocalOperatorSession();
    const customerKeys = new Set(
      sales
        .map((order) => String(order?.customer_phone || order?.customer_name || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const lineWidth = 48;
    const divider = '='.repeat(lineWidth);
    const centerText = (value: string) => {
      const text = String(value || '').trim();
      const leftPadding = Math.max(0, Math.floor((lineWidth - text.length) / 2));
      return `${' '.repeat(leftPadding)}${text}`;
    };
    const row = (label: string, value: string) => {
      const safeLabel = String(label || '').trim();
      const safeValue = String(value || '').trim();
      const spacing = Math.max(1, lineWidth - safeLabel.length - safeValue.length);
      return `${safeLabel}${' '.repeat(spacing)}${safeValue}`;
    };
    const date = new Date(closedAt);
    const openedAt = new Date(session.opened_at);
    const deliveryOrders = sales.filter((order) => classifyOrderChannel(order) === 'delivery');
    const counterOrders = sales.filter((order) => classifyOrderChannel(order) === 'counter');
    const dineInOrders = sales.filter((order) => classifyOrderChannel(order) === 'dine_in');
    const productionOrders = sales.filter((order) => classifyOrderChannel(order) !== 'delivery');
    const formatMinutes = (value: number) => `${Math.max(0, Math.round(value || 0))} min`;
    const reportNotes = notesOverride ?? cashDescription;

    return [
      divider,
      centerText('POPSYSTEM PDV'),
      centerText('RELATÓRIO DE FECHAMENTO'),
      divider,
      '',
      `Empresa: ${String(profileRow.restaurant_name || 'PopSystem').trim() || 'PopSystem'}`,
      `CNPJ: ${String(fiscalRow.cnpj || '--').trim() || '--'}`,
      `Operador: ${operatorSession?.name || 'Operador'}`,
      'Caixa: CAIXA 01',
      '',
      `Data: ${date.toLocaleDateString('pt-BR')}`,
      `Hora Abertura: ${openedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      `Hora Fechamento: ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      '',
      divider,
      centerText('RESUMO GERAL'),
      divider,
      '',
      row('Pedidos Realizados:', String(sales.length)),
      row('Pedidos Cancelados:', String(cancelledCount)),
      row('Clientes Atendidos:', String(customerKeys.size)),
      '',
      row('Faturamento Bruto:', formatCurrency(grossRevenue)),
      row('Descontos:', formatCurrency(discounts)),
      row('Taxa Entrega:', formatCurrency(deliveryFee)),
      row('FATURAMENTO LÍQUIDO:', formatCurrency(netRevenue)),
      '',
      divider,
      centerText('FORMAS DE PAGAMENTO'),
      divider,
      '',
      row('PIX:', formatCurrency(paymentTotals.pix || 0)),
      row('Dinheiro:', formatCurrency(paymentTotals.dinheiro || 0)),
      row('Crédito:', formatCurrency(paymentTotals.credito || 0)),
      row('Débito:', formatCurrency(paymentTotals.debito || 0)),
      row('Voucher/Refeição:', formatCurrency(paymentTotals.voucher || 0)),
      ...(Number(paymentTotals.cartao || 0) > 0 ? [row('Cartão:', formatCurrency(paymentTotals.cartao || 0))] : []),
      row('Contas a Receber:', formatCurrency(paymentTotals.receber || 0)),
      ...(Number(paymentTotals.outros || 0) > 0 ? [row('Outros:', formatCurrency(paymentTotals.outros || 0))] : []),
      '',
      row('TOTAL RECEBIDO:', formatCurrency(
        Number(paymentTotals.pix || 0)
        + Number(paymentTotals.dinheiro || 0)
        + Number(paymentTotals.credito || 0)
        + Number(paymentTotals.debito || 0)
        + Number(paymentTotals.voucher || 0)
        + Number(paymentTotals.cartao || 0)
        + Number(paymentTotals.outros || 0)
      )),
      '',
      divider,
      centerText('MOVIMENTO CAIXA'),
      divider,
      '',
      row('Valor Inicial:', formatCurrency(initial)),
      '',
      row('Entradas Extras:', formatCurrency(inAmount)),
      row('Sangrias/Saídas:', formatCurrency(outAmount)),
      '',
      row('Valor Esperado:', formatCurrency(expectedCash)),
      row('Valor Informado:', formatCurrency(informedAmount)),
      '',
      row('DIFERENÇA:', `${difference < 0 ? '-' : ''}${formatCurrency(Math.abs(difference))}`),
      '',
      divider,
      centerText('DELIVERY / LOJA'),
      divider,
      '',
      row('Pedidos Delivery:', String(deliveryOrders.length)),
      row('Pedidos Balcão:', String(counterOrders.length)),
      row('Pedidos Mesas:', String(dineInOrders.length)),
      '',
      row('Tempo Médio Produção:', formatMinutes(averageMinutesFromOrders(productionOrders))),
      row('Tempo Médio Entrega:', formatMinutes(averageMinutesFromOrders(deliveryOrders))),
      '',
      divider,
      centerText('OBSERVACOES'),
      divider,
      '',
      'Sistema: PopSystem PDV',
      `Versão: ${import.meta.env.VITE_APP_VERSION || '1.0.107'}`,
      '',
      reportNotes ? `Obs: ${reportNotes}` : '',
      'Fechamento realizado com sucesso.',
      '',
      divider,
      '',
      'Assinatura Operador:',
      '',
      '____________________________________________',
      '',
      divider,
      centerText('POPSYSTEM PDV'),
      divider,
    ];
  };

  const handleReprintCashCloseReport = async () => {
    if (!user?.id || !selectedSession) return;
    if (selectedSession.status !== 'closed') {
      toast({
        title: 'Caixa ainda aberto',
        description: 'Só é possível reimprimir fechamentos de sessões encerradas.',
        variant: 'destructive'
      });
      return;
    }

    try {
      setReprintingCashReport(true);
      const closedAt = selectedSession.closed_at || new Date().toISOString();
      const informedAmount = Number(selectedSession.final_amount ?? selectedSession.initial_amount ?? 0);
      const reportLines = await buildCashCloseReportLines(
        selectedSession,
        informedAmount,
        closedAt,
        selectedSession.notes || ''
      );

      await PrinterService.printCashReport({
        title: '',
        userId: user.id,
        hideStoreHeader: true,
        footerText: '',
        lines: reportLines
      });

      toast({ title: 'Fechamento reimpresso' });
    } catch (e: any) {
      toast({
        title: 'Erro ao reimprimir',
        description: e?.message || 'Não foi possível reimprimir o fechamento.',
        variant: 'destructive'
      });
    } finally {
      setReprintingCashReport(false);
    }
  };

  const handleCashOperation = async () => {
    if (!user) return;
    const operatorSession = getLocalOperatorSession();
    const canRunOperation = cashOperation === 'open'
      ? canOpenCash(operatorSession)
      : cashOperation === 'close'
        ? canCloseCash(operatorSession)
        : canMoveCash(operatorSession);
    if (!canRunOperation) {
      toast({
        title: 'Sem permissão para operar o caixa',
        description: cashOperation === 'open' || cashOperation === 'close'
          ? 'O administrador precisa liberar a permissão "Abrir/Fechar Caixa" em Usuários e Equipe.'
          : 'O administrador precisa liberar a permissão "Sangria/Suprimento" em Usuários e Equipe.',
        variant: 'destructive',
      });
      setIsCashDialogOpen(false);
      return;
    }
    const amount = parseBRL(cashAmount);
    if (isNaN(amount)) return;

    try {
      if (cashOperation === 'open') {
        if (currentSession?.id) {
          toast({ title: 'Caixa já está aberto' });
          setIsCashDialogOpen(false);
          return;
        }
        const { error } = await (supabase as any).from('cash_register_sessions').insert({
          user_id: user.id,
          initial_amount: amount,
          status: 'open',
          opened_at: new Date().toISOString()
        });
        if (error && (error.code === '23505' || String(error.message || '').toLowerCase().includes('cash_register_sessions_one_open_per_user'))) {
          await checkOpenSession();
          toast({ title: 'Caixa já está aberto' });
          setIsCashDialogOpen(false);
          return;
        }
        if (error) throw error;
        toast({ title: 'Caixa aberto com sucesso' });
        await PrinterService.printCashReport({
          title: 'Abertura de Caixa',
          userId: user.id,
          lines: [`Data/Hora: ${new Date().toLocaleString('pt-BR')}`, `Valor inicial: ${formatBRL(amount)}`]
        });
      } else if (cashOperation === 'close') {
        if (!currentSession) return;
        const latestOpenTablesCount = await getOpenTableCount(user.id);
        setOpenTablesCount(latestOpenTablesCount);
        if (latestOpenTablesCount > 0 && !openTablesConsent) {
          toast({
            title: 'Existem mesas abertas',
            description: `Confirme que deseja fechar o caixa mesmo com ${latestOpenTablesCount} mesa(s) aberta(s).`,
            variant: 'destructive',
          });
          return;
        }
        const closedAt = new Date().toISOString();
        const closeAuditNote = latestOpenTablesCount > 0
          ? `Fechamento autorizado com ${latestOpenTablesCount} mesa(s) aberta(s).`
          : '';
        const closeNotes = [cashDescription.trim(), closeAuditNote].filter(Boolean).join(' | ');
        const reportLines = await buildCashCloseReportLines(currentSession, amount, closedAt, closeNotes);
        const { data: closedSession, error } = await (supabase as any).from('cash_register_sessions').update({
          status: 'closed',
          closed_at: closedAt,
          final_amount: amount,
          notes: closeNotes
        })
          .eq('id', currentSession.id)
          .eq('user_id', user.id)
          .eq('status', 'open')
          .select('id,status,closed_at')
          .maybeSingle();
        if (error) throw error;
        if (closedSession?.status !== 'closed') throw new Error('A sessão aberta não foi alterada no banco. Atualize e tente novamente.');
        setCurrentSession(null);
        setCashSessions((current) => current.map((session) => session.id === currentSession.id
          ? { ...session, status: 'closed', closed_at: closedAt }
          : session));
        window.dispatchEvent(new CustomEvent('cash-session-changed'));
        toast({ title: 'Caixa fechado com sucesso' });
        await PrinterService.printCashReport({
          title: '',
          userId: user.id,
          hideStoreHeader: true,
          footerText: '',
          lines: reportLines.length > 0 ? reportLines : [
            `Data/Hora: ${new Date(closedAt).toLocaleString('pt-BR')}`,
            `Valor final: ${formatCurrency(amount)}`,
            cashDescription ? `Obs: ${cashDescription}` : ''
          ].filter(Boolean) as string[]
        });
      } else {
        // Suprimento ou Sangria
        if (!currentSession) {
          toast({ title: 'Caixa fechado', description: 'Abra o caixa primeiro', variant: 'destructive' });
          return;
        }
        const { error } = await (supabase as any).from('cash_movements').insert({
          session_id: currentSession.id,
          user_id: user.id,
          type: cashOperation,
          amount: amount,
          description: cashDescription
        });
        if (error) throw error;
        toast({ title: cashOperation === 'in' ? 'Suprimento registrado' : 'Sangria registrada' });
        await PrinterService.printCashReport({
          title: cashOperation === 'in' ? 'Suprimento' : 'Sangria',
          userId: user.id,
          lines: [
            `Data/Hora: ${new Date().toLocaleString('pt-BR')}`,
            `Valor: ${formatBRL(amount)}`,
            cashDescription ? `Descrição: ${cashDescription}` : ''
          ].filter(Boolean) as string[]
        });
      }
      
      setIsCashDialogOpen(false);
      setCashAmount('');
      setCashDescription('');
      checkOpenSession();
      fetchCashSessions();
      window.dispatchEvent(new CustomEvent('cash-session-changed'));
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };
  
  const reportStart = filters.startDate
    ? new Date(filters.startDate)
    : new Date(new Date().setDate(new Date().getDate() - 30));
  reportStart.setHours(0, 0, 0, 0);
  const reportEnd = filters.endDate ? new Date(filters.endDate) : new Date();
  reportEnd.setHours(23, 59, 59, 999);

  // Calculate financial summaries using the same period displayed in the charts.
  const financialTransactions = filteredTransactions.filter(
    (transaction) =>
      (transaction.type === 'saida' || isConfirmedIncome(transaction))
      && transaction.date >= reportStart
      && transaction.date <= reportEnd
  );

  const totalIncome = financialTransactions
    .filter(t => t.type === 'entrada')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
    
  const totalExpenses = financialTransactions
    .filter(t => t.type === 'saida')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
    
  const balance = totalIncome - totalExpenses;
  
  // Payment method breakdown
  const pixTotal = financialTransactions
    .filter(t => getPaymentBucket(t.paymentMethod) === 'pix' && t.type === 'entrada')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
    
  const cardTotal = financialTransactions
    .filter(t => ['cartao', 'credito', 'debito', 'voucher'].includes(getPaymentBucket(t.paymentMethod)) && t.type === 'entrada')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
    
  const cashTotal = financialTransactions
    .filter(t => getPaymentBucket(t.paymentMethod) === 'dinheiro' && t.type === 'entrada')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  
  // Apply filters
  const applyFilters = () => {
    let result = [...transactions];
    
    if (filters.paymentMethod && filters.paymentMethod !== 'all') {
      result = result.filter(t => t.paymentMethod === filters.paymentMethod);
    }
    
    if (filters.type && filters.type !== 'all') {
      result = result.filter(t => t.type === filters.type);
    }
    
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      start.setHours(0, 0, 0, 0);
      result = result.filter(t => t.date >= start);
    }
    
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      result = result.filter(t => t.date <= end);
    }
    
    if (filters.searchTerm) {
      result = result.filter(t => 
        t.description.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
        t.category.toLowerCase().includes(filters.searchTerm.toLowerCase())
      );
    }
    
    setFilteredTransactions(result);
  };
  
  const generateCSV = () => {
    const rows = [
      ['Data', 'Hora', 'Descrição', 'Categoria', 'Método', 'Valor', 'Tipo', 'Status'],
      ...filteredTransactions.map(t => [
        formatDate(t.date),
        formatTime(t.date),
        t.description,
        t.category,
        getPaymentMethodLabel(t.paymentMethod),
        String(t.amount).replace('.', ','),
        t.type,
        t.category === 'Vendas' ? (t.status === 'cancelled' ? 'Cancelada' : 'Registrada') : '',
      ])
    ];
    const csvContent = rows.map(r => r.map(field => `"${String(field).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const start = filters.startDate ? formatDate(filters.startDate) : 'inicio';
    const end = filters.endDate ? formatDate(filters.endDate) : 'fim';
    a.download = `relatorio_${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const resetFilters = () => {
    const { start, end } = getPeriodRange('30d');
    setFilters({
      paymentMethod: '',
      type: '',
      startDate: start,
      endDate: end,
      searchTerm: ''
    });
    setActivePeriodPreset('30d');
  };
  
  const handleFilterChange = (field: keyof typeof filters, value: any) => {
    if (field === 'startDate' || field === 'endDate') setActivePeriodPreset(null);
    setFilters({
      ...filters,
      [field]: value
    });
  };

  const setPeriodPreset = (preset: PeriodPreset) => {
    const { start, end } = getPeriodRange(preset);
    setActivePeriodPreset(preset);
    setFilters((current) => ({ ...current, startDate: start, endDate: end }));
  };
  
  useEffect(() => {
    applyFilters();
    // Keep the displayed list synchronized after a period refetch or filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, filters.paymentMethod, filters.type, filters.startDate, filters.endDate, filters.searchTerm]);
  
  const formatDate = (date: Date) => {
    if (!date || isNaN(date.getTime())) return '-';
    try {
      return new Intl.DateTimeFormat('pt-BR').format(date);
    } catch (e) {
      return '-';
    }
  };
  
  const formatTime = (date: Date) => {
    if (!date || isNaN(date.getTime())) return '-';
    try {
      return date.toLocaleTimeString('pt-BR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch (e) {
      return '-';
    }
  };
  
  const formatCurrency = (amount: number) => {
    if (amount === undefined || amount === null || isNaN(amount)) return 'R$ 0,00';
    try {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(amount);
    } catch (e) {
      return 'R$ 0,00';
    }
  };

  const enumerateDays = (from: Date, to: Date) => {
    const out: Date[] = [];
    const cur = new Date(from);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(0, 0, 0, 0);
    while (cur <= end) {
      out.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  };

  const dateKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const dailySeries = (() => {
    const days = enumerateDays(reportStart, reportEnd);
    const map: Record<string, { income: number; expenses: number }> = {};
    for (const t of financialTransactions) {
      if (!t?.date) continue;
      if (t.date < reportStart || t.date > reportEnd) continue;
      const k = dateKey(t.date);
      if (!map[k]) map[k] = { income: 0, expenses: 0 };
      if (t.type === 'entrada') map[k].income += Number(t.amount || 0);
      if (t.type === 'saida') map[k].expenses += Number(t.amount || 0);
    }
    return days.map((d) => {
      const k = dateKey(d);
      const v = map[k] || { income: 0, expenses: 0 };
      const profit = v.income - v.expenses;
      const label = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(d);
      return { date: k, label, income: Number(v.income.toFixed(2)), expenses: Number(v.expenses.toFixed(2)), profit: Number(profit.toFixed(2)) };
    });
  })();

  const expenseByCategory = (() => {
    const map: Record<string, number> = {};
    for (const t of financialTransactions) {
      if (t.type !== 'saida') continue;
      if (t.date < reportStart || t.date > reportEnd) continue;
      const key = String(t.category || 'Geral');
      map[key] = (map[key] || 0) + Number(t.amount || 0);
    }
    const rows = Object.entries(map).map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }));
    rows.sort((a, b) => b.value - a.value);
    const top = rows.slice(0, 6);
    const rest = rows.slice(6);
    const restSum = rest.reduce((acc, r) => acc + r.value, 0);
    return restSum > 0 ? [...top, { name: 'Outros', value: Number(restSum.toFixed(2)) }] : top;
  })();

  const COLORS = ['#7c3aed', '#22c55e', '#ef4444', '#0ea5e9', '#f59e0b', '#64748b', '#a855f7'];

  const dre = (() => {
    const ordersInRange = (ordersRaw || []).filter((o: any) => {
      const created = new Date(o?.created_at);
      if (created < reportStart || created > reportEnd) return false;
      if (String(o?.status || '').toLowerCase() === 'cancelled') return false;
      if (String(o?.acceptance_status || '').toLowerCase() === 'awaiting_pix_payment') return false;
      return true;
    });
    const receitaLiquida = ordersInRange.reduce((acc: number, o: any) => acc + Number(o?.total || 0), 0);
    const descontos = ordersInRange.reduce((acc: number, o: any) => acc + Number(o?.discount || 0), 0);
    const receitaBruta = receitaLiquida + descontos;
    const taxaEntrega = ordersInRange.reduce((acc: number, o: any) => acc + Number(o?.delivery_fee || 0), 0);
    const receitaProdutos = Math.max(0, receitaLiquida - taxaEntrega);

    const despesas = (expensesRaw || []).filter((e: any) => {
      const d = new Date(e?.expense_date || e?.date || e?.created_at);
      return d >= reportStart && d <= reportEnd;
    }).reduce((acc: number, e: any) => acc + Number(e?.amount || 0), 0);
    const lucroOperacional = receitaLiquida - despesas;
    return {
      receitaBruta: Number(receitaBruta.toFixed(2)),
      descontos: Number(descontos.toFixed(2)),
      receitaLiquida: Number(receitaLiquida.toFixed(2)),
      receitaProdutos: Number(receitaProdutos.toFixed(2)),
      taxaEntrega: Number(taxaEntrega.toFixed(2)),
      despesas: Number(despesas.toFixed(2)),
      lucroOperacional: Number(lucroOperacional.toFixed(2)),
    };
  })();

  const margemOperacional = dre.receitaLiquida > 0 ? (dre.lucroOperacional / dre.receitaLiquida) * 100 : 0;
  
  const getPaymentMethodLabel = (method?: PaymentMethod | string) => {
    switch (method) {
      case 'pix': return 'PIX';
      case 'pix_online': return 'PIX online';
      case 'pix_entrega': return 'PIX na entrega';
      case 'dinheiro': return 'DINHEIRO';
      case 'cartao': return 'CARTÃO';
      default: return method || '-';
    }
  };

  const getOrderStatusLabel = (status?: string) => {
    const labels: Record<string, string> = {
      pending: 'Pendente',
      preparing: 'Em preparo',
      ready: 'Pronto',
      in_delivery: 'Em entrega',
      delivered: 'Entregue',
      completed: 'Concluída',
      open: 'Aberta',
      cancelled: 'Cancelada',
    };
    const normalized = String(status || '').toLowerCase();
    return labels[normalized] || (normalized ? normalized.replace(/_/g, ' ') : 'Registrada');
  };

  const selectedSession = cashSessions.find(s => s.id === selectedSessionId) || currentSession || null;
  const sessionSales = sessionOrders.filter(o => o?.status !== 'cancelled');
  const sessionCancelledSales = sessionOrders.filter(o => o?.status === 'cancelled');
  const sessionTotal = sessionSales.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const sessionPaymentTotals = sessionSales.reduce<Record<string, number>>((acc, order) => {
    const splitLines = getOrderPaymentLines(order as any);
    const lines = splitLines.length > 0
      ? splitLines
      : [{ method: String(order?.payment_method || ''), amount: Number(order?.total || 0) }];
    for (const line of lines) {
      const bucket = getPaymentBucket(line.method);
      acc[bucket] = (acc[bucket] || 0) + line.amount;
    }
    return acc;
  }, {});
  const sessionPix = Number(sessionPaymentTotals.pix || 0);
  const sessionCard = Number(sessionPaymentTotals.cartao || 0) + Number(sessionPaymentTotals.credito || 0) + Number(sessionPaymentTotals.debito || 0) + Number(sessionPaymentTotals.voucher || 0);
  const sessionCash = Number(sessionPaymentTotals.dinheiro || 0);
  const sessionIn = sessionMovements.filter(m => m.type === 'in').reduce((sum, m) => sum + Number(m.amount || 0), 0);
  const sessionOut = sessionMovements.filter(m => m.type === 'out').reduce((sum, m) => sum + Number(m.amount || 0), 0);
  const sessionExpectedCash = Number(selectedSession?.initial_amount || 0) + sessionCash + sessionIn - sessionOut;
  const periodSales = filteredTransactions.filter(
    (transaction) =>
      transaction.category === 'Vendas'
      && String(transaction.acceptanceStatus || '').toLowerCase() !== 'awaiting_pix_payment'
      && transaction.date >= reportStart
      && transaction.date <= reportEnd
  );
  const validPeriodSales = periodSales.filter((transaction) => transaction.status !== 'cancelled');
  const cancelledPeriodSales = periodSales.filter((transaction) => transaction.status === 'cancelled');
  const averageTicket = validPeriodSales.length > 0
    ? validPeriodSales.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0) / validPeriodSales.length
    : 0;
  const cancelledPeriodValue = cancelledPeriodSales.reduce(
    (sum, transaction) => sum + Number(transaction.amount || 0),
    0
  );
  const paymentMix = [
    { name: 'PIX', value: pixTotal, color: '#8CC850' },
    { name: 'Cartão', value: cardTotal, color: '#FF6400' },
    { name: 'Dinheiro', value: cashTotal, color: '#7C3AED' },
  ];
  const hasPaymentMix = paymentMix.some((item) => item.value > 0);
  const financeInsights = [
    {
      label: 'Vendas no período',
      value: String(validPeriodSales.length),
      helper: validPeriodSales.length === 1 ? 'venda confirmada' : 'vendas confirmadas',
      icon: ShoppingBag,
      tone: 'bg-[#F5FBED] text-[#245B2B] border-[#8CC850]/20',
    },
    {
      label: 'Ticket médio',
      value: formatCurrency(averageTicket),
      helper: 'média por venda',
      icon: TrendingUp,
      tone: 'bg-[#EEF7FF] text-[#0369A1] border-sky-200',
    },
    {
      label: 'Cancelamentos',
      value: String(cancelledPeriodSales.length),
      helper: cancelledPeriodSales.length > 0 ? formatCurrency(cancelledPeriodValue) : 'nenhum no período',
      icon: Ban,
      tone: 'bg-[#FFF1F1] text-[#B42318] border-red-200',
    },
    {
      label: 'Dinheiro esperado',
      value: formatCurrency(sessionExpectedCash),
      helper: selectedSession ? 'na sessão selecionada' : 'selecione uma sessão',
      icon: WalletCards,
      tone: 'bg-[#FFF4EA] text-[#C45E00] border-orange-200',
    },
  ];
  const topExpenseCards = expenseByCategory.slice(0, 4);
  const isCashRoute = location.pathname.startsWith('/caixa');
  const headerTitle = isCashRoute ? 'Caixa geral' : 'Financeiro';
  const headerSubtitle = isCashRoute
    ? 'Abertura, suprimento, sangria e conferência do caixa em uma visão operacional.'
    : 'Acompanhe receitas, despesas, lucro e DRE no período selecionado';

  const openCashActionDialog = async (operation: 'open' | 'close' | 'in' | 'out') => {
    const operatorSession = getLocalOperatorSession();
    const canRunOperation = operation === 'open'
      ? canOpenCash(operatorSession)
      : operation === 'close'
        ? canCloseCash(operatorSession)
        : canMoveCash(operatorSession);
    if (!canRunOperation) {
      toast({
        title: 'Sem permissão para operar o caixa',
        description: operation === 'open' || operation === 'close'
          ? 'O administrador precisa liberar a permissão "Abrir/Fechar Caixa" em Usuários e Equipe.'
          : 'O administrador precisa liberar a permissão "Sangria/Suprimento" em Usuários e Equipe.',
        variant: 'destructive',
      });
      return;
    }
    setCashOperation(operation);
    setCashAmount('');
    setCashDescription('');
    setCashCloseOverview(null);
    setOpenTablesConsent(false);
    setOpenTablesCount(0);
    setIsCashDialogOpen(true);
    if (operation === 'close' && user?.id) {
      setCheckingOpenTables(true);
      setLoadingCashCloseOverview(true);
      try {
        // Always resolve the active session from the database when local React state
        // has not caught up yet (for example when arriving via ?cashAction=close).
        const closingSession = (currentSession?.status === 'open' ? currentSession : null)
          || (selectedSession?.status === 'open' ? selectedSession : null)
          || await findOpenSession();
        if (!closingSession) throw new Error('Nenhuma sessão de caixa aberta.');

        setCurrentSession(closingSession);
        setSelectedSessionId(closingSession.id);
        setCashSessions((current) => [
          closingSession,
          ...current.filter((session) => session.id !== closingSession.id),
        ]);
        const [openCount, overview] = await Promise.all([
          getOpenTableCount(user.id),
          loadCashCloseOverview(closingSession),
        ]);
        setOpenTablesCount(openCount);
        setCashCloseOverview(overview);
        setCashAmount(formatBRL(overview.expectedCash));
      } catch (error) {
        toast({
          title: 'Não foi possível preparar o fechamento',
          description: friendlyErrorMessage(error, 'Tente novamente antes de fechar o caixa.'),
          variant: 'destructive',
        });
      } finally {
        setCheckingOpenTables(false);
        setLoadingCashCloseOverview(false);
      }
    }
  };

  const closeSelectedCashSession = async () => {
    if (!selectedSession || selectedSession.status !== 'open') return;
    setCurrentSession(selectedSession);
    setSelectedSessionId(selectedSession.id);
    await openCashActionDialog('close');
  };

  useEffect(() => {
    if (new URLSearchParams(location.search).get('section') === 'receivables') {
      navigate('/financeiro/receber', { replace: true });
      return;
    }
    const action = new URLSearchParams(location.search).get('cashAction');
    if (!action || !['open', 'close', 'in', 'out'].includes(action)) return;
    void (async () => {
      if (action === 'close') await checkOpenSession();
      await openCashActionDialog(action as 'open' | 'close' | 'in' | 'out');
      navigate(location.pathname, { replace: true });
    })();
  }, [location.pathname, location.search, navigate]);

  const refreshFinanceData = async () => {
    await Promise.all([fetchData(), checkOpenSession(), fetchCashSessions()]);
    if (selectedSessionId) {
      await fetchSessionDetails(selectedSessionId);
    }
  };

  const mobileCashActions = [
    {
      key: currentSession ? 'close' : 'open',
      label: currentSession ? 'Fechar caixa' : 'Abrir caixa',
      icon: currentSession ? Unlock : Lock,
      onClick: () => openCashActionDialog(currentSession ? 'close' : 'open'),
      className: currentSession
        ? 'border-[#003223]/12 bg-[#003223] text-white'
        : 'border-[#8CC850]/25 bg-[#F5FBED] text-[#245B2B]',
    },
    {
      key: 'in',
      label: 'Suprimento',
      icon: ArrowUp,
      onClick: () => openCashActionDialog('in'),
      className: 'border-[#8CC850]/18 bg-white text-[#245B2B]',
    },
    {
      key: 'out',
      label: 'Sangria',
      icon: ArrowDown,
      onClick: () => openCashActionDialog('out'),
      className: 'border-[#FF6400]/18 bg-white text-[#C45E00]',
    },
    {
      key: 'refresh',
      label: 'Atualizar',
      icon: RefreshCw,
      onClick: () => { void refreshFinanceData(); },
      className: 'border-[#003223]/10 bg-white text-[#003223]',
    },
    {
      key: 'report',
      label: 'Relatório',
      icon: Download,
      onClick: generateCSV,
      className: 'border-[#003223]/10 bg-white text-[#003223]',
    },
  ];

  const mobileTypeFilters: Array<{ value: TxTypeFilter; label: string }> = [
    { value: 'all', label: 'Todos' },
    { value: 'entrada', label: 'Contas a Receber' },
    { value: 'saida', label: 'Contas a Pagar' },
  ];

  const mobilePaymentFilters: Array<{ value: PaymentMethodFilter; label: string }> = [
    { value: 'all', label: 'Todos' },
    { value: 'pix', label: 'PIX' },
    { value: 'cartao', label: 'Cartão' },
    { value: 'dinheiro', label: 'Dinheiro' },
  ];
  
  return (
    <div className="space-y-6">
      <Card className="hidden overflow-hidden border-0 bg-gradient-to-br from-boracume-dark-green via-[#0b5137] to-[#003223] text-white shadow-[0_26px_60px_-34px_rgba(0,50,35,0.55)] dark:from-[#091510] dark:via-[#101a16] dark:to-[#151223] md:block">
        <CardContent className="p-5">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="text-2xl font-bold tracking-tight">{headerTitle}</div>
              <div className="text-white/90 text-sm mt-1">
                {headerSubtitle}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!isCashRoute && (
                <Button className="border border-white/20 bg-white/15 text-white hover:bg-white/25" variant="outline" onClick={() => navigate('/financeiro/receber')}>
                  <WalletCards className="mr-2 h-4 w-4" />Contas a receber
                </Button>
              )}
              <Dialog open={isCashDialogOpen} onOpenChange={setIsCashDialogOpen}>
              <Button className="border border-white/20 bg-white/15 text-white hover:bg-white/25" variant="outline" onClick={() => {
                void openCashActionDialog(currentSession ? 'close' : 'open');
              }}>
                {currentSession ? <Unlock className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
                {currentSession ? 'Gerenciar Caixa' : 'Abrir Caixa'}
              </Button>
            <DialogContent className={cashOperation === 'close' ? 'sm:max-w-2xl' : undefined}>
              <DialogHeader>
                <DialogTitle>
                  {cashOperation === 'open' && 'Abertura de Caixa'}
                  {cashOperation === 'close' && 'Fechamento de Caixa'}
                  {cashOperation === 'in' && 'Suprimento (Entrada)'}
                  {cashOperation === 'out' && 'Sangria (Saída)'}
                </DialogTitle>
                <DialogDescription>
                  {currentSession && (
                    <div className="flex gap-2 mb-4">
                      <Button variant={cashOperation === 'close' ? 'default' : 'outline'} size="sm" onClick={() => { void openCashActionDialog('close'); }}>Fechar</Button>
                      <Button variant={cashOperation === 'in' ? 'default' : 'outline'} size="sm" onClick={() => { void openCashActionDialog('in'); }}>Suprimento</Button>
                      <Button variant={cashOperation === 'out' ? 'default' : 'outline'} size="sm" onClick={() => { void openCashActionDialog('out'); }}>Sangria</Button>
                    </div>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {cashOperation === 'close' && (
                  loadingCashCloseOverview ? (
                    <div className="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-600">
                      Carregando resumo do caixa...
                    </div>
                  ) : cashCloseOverview ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border p-3">
                          <div className="text-xs text-muted-foreground">Vendas (total)</div>
                          <div className="text-lg font-bold">{formatBRL(cashCloseOverview.total)}</div>
                        </div>
                        <div className="rounded-xl border p-3">
                          <div className="text-xs text-muted-foreground">Dinheiro</div>
                          <div className="text-lg font-bold">{formatBRL(cashCloseOverview.cash)}</div>
                        </div>
                        <div className="rounded-xl border p-3">
                          <div className="text-xs text-muted-foreground">PIX</div>
                          <div className="text-lg font-bold">{formatBRL(cashCloseOverview.pix)}</div>
                        </div>
                        <div className="rounded-xl border p-3">
                          <div className="text-xs text-muted-foreground">Cartão de débito</div>
                          <div className="text-lg font-bold">{formatBRL(cashCloseOverview.debit)}</div>
                        </div>
                        <div className="rounded-xl border p-3">
                          <div className="text-xs text-muted-foreground">Cartão de crédito</div>
                          <div className="text-lg font-bold">{formatBRL(cashCloseOverview.credit)}</div>
                        </div>
                        {cashCloseOverview.genericCard > 0 && (
                          <div className="rounded-xl border p-3">
                            <div className="text-xs text-muted-foreground">Voucher / outros cartões</div>
                            <div className="text-lg font-bold">{formatBRL(cashCloseOverview.genericCard)}</div>
                          </div>
                        )}
                        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                          <div className="text-xs text-blue-700">Contas a receber</div>
                          <div className="text-lg font-bold text-blue-950">{formatBRL(cashCloseOverview.receivable)}</div>
                          <div className="text-[11px] text-blue-700">Somente para controle</div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <div className="text-xs text-emerald-700">Saldo esperado em dinheiro</div>
                        <div className="text-xl font-bold text-emerald-950">{formatBRL(cashCloseOverview.expectedCash)}</div>
                        <div className="mt-1 text-xs text-emerald-700">
                          Abertura + dinheiro + suprimentos − sangrias
                        </div>
                      </div>
                    </div>
                  ) : null
                )}
                <div>
                  <Label>{cashOperation === 'close' ? 'Valor contado em dinheiro' : 'Valor'}</Label>
                  <CurrencyTextInput 
                    value={cashAmount} 
                    onValueChange={setCashAmount} 
                    placeholder="R$ 0,00"
                  />
                  {cashOperation === 'close' && cashCloseOverview && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Diferença: {formatBRL(parseBRL(cashAmount) - cashCloseOverview.expectedCash)}
                    </div>
                  )}
                </div>
                {cashOperation !== 'open' && (
                   <div>
                   <Label>Observação / Descrição</Label>
                   <Input 
                     value={cashDescription} 
                     onChange={(e) => setCashDescription(e.target.value)} 
                     placeholder="Motivo..."
                   />
                 </div>
                )}
                {cashOperation === 'close' && (
                  <div className={`rounded-2xl border p-4 ${openTablesCount > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                    {checkingOpenTables ? (
                      <p className="text-sm text-slate-600">Conferindo mesas em atendimento...</p>
                    ) : openTablesCount > 0 ? (
                      <div className="space-y-3">
                        <div className="flex gap-3 text-amber-950">
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                          <div>
                            <p className="font-semibold">{openTablesCount} mesa(s) ainda aberta(s)</p>
                            <p className="text-sm">O recomendado é receber ou liberar essas mesas antes do fechamento.</p>
                          </div>
                        </div>
                        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/75 p-3 text-sm text-amber-950">
                          <Checkbox
                            checked={openTablesConsent}
                            onCheckedChange={(checked) => setOpenTablesConsent(checked === true)}
                            aria-label="Confirmar fechamento com mesas abertas"
                          />
                          <span>Estou ciente e autorizo fechar o caixa com essas mesas abertas.</span>
                        </label>
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-emerald-800">Nenhuma mesa aberta. O caixa pode ser fechado com segurança.</p>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCashOperation}
                  disabled={cashOperation === 'close' && (
                    checkingOpenTables
                    || loadingCashCloseOverview
                    || !cashCloseOverview
                    || (openTablesCount > 0 && !openTablesConsent)
                  )}
                >
                  Confirmar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {!isCashRoute && (
            <Button
              type="button"
              variant="outline"
              className="border-white/20 bg-white/15 text-white hover:bg-white/25"
              onClick={() => navigate('/despesas')}
            >
              <ReceiptText className="mr-2 h-4 w-4" />
              Contas a pagar
            </Button>
          )}
            </div>
          </div>
        </CardContent>
      </Card>
      
      <div className="hidden gap-5 md:grid">
        <div className="space-y-5">
          <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-[0_28px_70px_-36px_rgba(0,50,35,0.32)] dark:border-white/10 dark:bg-[#101a16]/96 dark:shadow-[0_26px_60px_-36px_rgba(0,0,0,0.82)]">
            <div className="flex flex-col gap-5">
              <div className="grid w-full grid-cols-2 gap-3 xl:grid-cols-4">
                  <div className="min-w-0 rounded-[22px] border border-[#8CC850]/18 bg-gradient-to-br from-white to-[#F5FBED] p-4 dark:border-[#8CC850]/15 dark:from-[#0c1512] dark:to-[#112017]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Faturamento</div>
                    <div className="mt-2 truncate text-[1.35rem] font-bold text-slate-900 dark:text-white 2xl:text-2xl">{formatCurrency(totalIncome)}</div>
                  </div>
                  <div className="min-w-0 rounded-[22px] border border-[#FF6400]/18 bg-gradient-to-br from-white to-[#FFF3EA] p-4 dark:border-[#FF6400]/15 dark:from-[#0c1512] dark:to-[#1e1510]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Despesas</div>
                    <div className="mt-2 truncate text-[1.35rem] font-bold text-slate-900 dark:text-white 2xl:text-2xl">{formatCurrency(totalExpenses)}</div>
                  </div>
                  <div className="min-w-0 rounded-[22px] border border-[#003223]/10 bg-gradient-to-br from-white to-[#F5F8F7] p-4 dark:border-white/10 dark:from-[#0c1512] dark:to-[#141b18]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Saldo</div>
                    <div className={`mt-2 truncate text-[1.35rem] font-bold 2xl:text-2xl ${balance >= 0 ? 'text-boracume-green' : 'text-boracume-orange'}`}>{formatCurrency(balance)}</div>
                  </div>
                  <div className="min-w-0 rounded-[22px] border border-violet-200 bg-gradient-to-br from-white to-violet-50 p-4 dark:border-violet-500/20 dark:from-[#0c1512] dark:to-[#171325]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Margem</div>
                    <div className="mt-2 truncate text-[1.35rem] font-bold text-slate-900 dark:text-white 2xl:text-2xl">{Number(margemOperacional.toFixed(1)).toString().replace('.', ',')}%</div>
                  </div>
              </div>

              <div className="flex flex-col gap-3 rounded-[24px] border border-[#003223]/8 bg-gradient-to-r from-[#F8FAF8] via-white to-[#FFF5EC] p-3 dark:border-white/10 dark:from-[#0c1512] dark:via-[#101a16] dark:to-[#1e1510] lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#003223] text-white shadow-sm">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">Período analisado</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {new Intl.DateTimeFormat('pt-BR').format(reportStart)} até {new Intl.DateTimeFormat('pt-BR').format(reportEnd)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'today', label: 'Hoje' },
                    { key: '7d', label: '7 dias' },
                    { key: '30d', label: '30 dias' },
                    { key: 'month', label: 'Este mês' },
                  ].map((preset) => (
                    <Button
                      key={preset.key}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={activePeriodPreset === preset.key}
                      disabled={isLoading && activePeriodPreset === preset.key}
                      className={cn(
                        'h-9 rounded-xl px-3 text-xs shadow-sm transition-colors',
                        activePeriodPreset === preset.key
                          ? 'border-[#003223] bg-[#003223] text-white hover:bg-[#0a4a34] hover:text-white dark:border-[#8CC850] dark:bg-[#8CC850] dark:text-[#003223]'
                          : 'border-[#003223]/10 bg-white text-[#003223] hover:bg-[#F5FBED] dark:border-white/10 dark:bg-white/5 dark:text-white'
                      )}
                      onClick={() => setPeriodPreset(preset.key as PeriodPreset)}
                    >
                      {isLoading && activePeriodPreset === preset.key ? (
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : null}
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {financeInsights.map((insight) => {
                  const Icon = insight.icon;
                  return (
                    <div key={insight.label} className={`rounded-[22px] border p-4 ${insight.tone}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">{insight.label}</div>
                          <div className="mt-2 text-xl font-bold tracking-tight">{insight.value}</div>
                          <div className="mt-1 text-xs opacity-70">{insight.helper}</div>
                        </div>
                        <div className="rounded-xl bg-white/75 p-2 shadow-sm dark:bg-black/10">
                          <Icon className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_320px]">
                <div className="rounded-[28px] border border-[#003223]/8 bg-[#F8FAF8] p-4 dark:border-white/10 dark:bg-[#0c1512]">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">Fluxo do período</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {new Intl.DateTimeFormat('pt-BR').format(reportStart)} até {new Intl.DateTimeFormat('pt-BR').format(reportEnd)}
                      </div>
                    </div>
                    <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#003223] dark:bg-[#101a16] dark:text-slate-300">
                      DRE viva
                    </div>
                  </div>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailySeries}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d7e1dc" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} width={44} />
                        <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                        <Legend />
                        <Line type="monotone" dataKey="income" name="Receitas" stroke="#8CC850" strokeWidth={3} dot={false} />
                        <Line type="monotone" dataKey="expenses" name="Despesas" stroke="#FF6400" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="profit" name="Lucro" stroke="#7C3AED" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="rounded-[28px] border border-[#003223]/8 bg-[#F8FAF8] p-4 dark:border-white/10 dark:bg-[#0c1512]">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">Mix de pagamentos</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Como o faturamento está distribuído no período</div>
                    <div className="mt-4 h-[180px]">
                      {hasPaymentMix ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={paymentMix} dataKey="value" nameKey="name" innerRadius={42} outerRadius={72} paddingAngle={3}>
                              {paymentMix.map((item) => (
                                <Cell key={item.name} fill={item.color} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center text-center">
                          <WalletCards className="h-7 w-7 text-slate-300" />
                          <div className="mt-2 text-xs text-slate-500">Sem recebimentos no período</div>
                        </div>
                      )}
                    </div>
                    <div className="grid gap-2">
                      {paymentMix.map((item) => (
                        <div key={item.name} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                            {item.name}
                          </div>
                          <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(item.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[28px] border border-[#003223]/8 bg-gradient-to-br from-[#003223] via-[#07573d] to-[#FF6400] p-4 text-white shadow-[0_20px_40px_-28px_rgba(0,50,35,0.65)]">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="h-4 w-4 text-[#C8F59A]" />
                      Leitura rápida
                    </div>
                    <div className="mt-2 text-xs leading-relaxed text-white/75">
                      {validPeriodSales.length === 0
                        ? 'Assim que houver vendas no período, o PopSystem mostra ticket médio, margem e comportamento dos recebimentos.'
                        : cancelledPeriodSales.length > 0
                          ? `${cancelledPeriodSales.length} cancelamento(s) retirado(s) dos totais. A margem atual do período é de ${Number(margemOperacional.toFixed(1)).toString().replace('.', ',')}%.`
                          : `Sem cancelamentos no período. O ticket médio está em ${formatCurrency(averageTicket)} e a margem em ${Number(margemOperacional.toFixed(1)).toString().replace('.', ',')}%.`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="rounded-[30px] border border-white/70 bg-white/90 p-5 shadow-[0_24px_60px_-36px_rgba(0,50,35,0.28)] dark:border-white/10 dark:bg-[#101a16]/95">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">Pressão por categoria</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Categorias que mais pesam nas despesas</div>
                </div>
              </div>
              <div className="space-y-3">
                {topExpenseCards.length > 0 ? topExpenseCards.map((item, index) => (
                  <div key={item.name} className="rounded-[22px] border border-[#003223]/8 bg-[#F8FAF8] p-4 dark:border-white/10 dark:bg-[#0c1512]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{item.name}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">rank #{index + 1}</div>
                      </div>
                      <div className="text-lg font-bold text-[#003223] dark:text-white">{formatCurrency(item.value)}</div>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[22px] border border-dashed border-[#003223]/12 p-5 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                    Sem despesas suficientes para ranquear categorias.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[30px] border border-white/70 bg-white/90 p-5 shadow-[0_24px_60px_-36px_rgba(0,50,35,0.28)] dark:border-white/10 dark:bg-[#101a16]/95">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">Distribuição de despesas</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Leitura visual do peso de cada categoria</div>
                </div>
                <div className="rounded-full bg-[#F5EBE1] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#003223] dark:bg-[#1b1510] dark:text-slate-300">
                  visão estratégica
                </div>
              </div>
              <div className="h-[240px]">
                {expenseByCategory.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                    Sem despesas no período para plotar o gráfico.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={expenseByCategory}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d7e1dc" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} width={44} />
                      <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                      <Bar dataKey="value" radius={[10, 10, 0, 0]} fill="#FF6400" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      <div className="space-y-3 md:hidden">
        <section className="rounded-[16px] border border-white/70 bg-white/92 p-2 shadow-[0_18px_40px_-34px_rgba(0,50,35,0.24)]">
          <div className="space-y-2">
            <div className="inline-flex items-center rounded-full border border-[#FF6400]/15 bg-[#FFF1E6] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#FF6400]">
              {isCashRoute ? 'Caixa geral' : 'Financeiro mobile'}
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-[1rem] font-bold tracking-tight text-slate-900">
                  {currentSession ? 'Caixa aberto agora' : 'Caixa pronto para abrir'}
                </h1>
                <p className="mt-1 text-[10px] leading-snug text-slate-500">
                  {currentSession
                    ? 'Use suprimento, sangria, conferência e sessão atual com poucos toques.'
                    : 'Abra o caixa e acompanhe vendas, pagamentos e movimentações direto do celular.'}
                </p>
              </div>
              <div className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${currentSession ? 'bg-[#F5FBED] text-[#245B2B]' : 'bg-[#FFF1E6] text-[#C45E00]'}`}>
                {currentSession ? 'Aberto' : 'Fechado'}
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2">
          {mobileCashActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.key}
                type="button"
                onClick={action.onClick}
                className={`rounded-[14px] border p-2 text-left shadow-sm transition-transform active:scale-[0.98] ${action.className}`}
              >
                <div className="flex items-center justify-between">
                  <Icon className="h-3 w-3" />
                  <ChevronRight className="h-2.5 w-2.5 opacity-40" />
                </div>
                <div className="mt-1.5 text-[10px] font-semibold">{action.label}</div>
              </button>
            );
          })}
        </section>

        {!isCashRoute && (
          <section className="[&>button]:h-10 [&>button]:w-full [&>button]:justify-center [&>button]:rounded-[14px] [&>button]:border-[#003223]/10 [&>button]:bg-white [&>button]:text-[#003223] [&>button]:shadow-sm">
            <Button variant="outline" onClick={() => navigate('/financeiro/receber')}>
              <WalletCards className="mr-2 h-4 w-4" />Contas a receber
            </Button>
          </section>
        )}

        <section className="rounded-[18px] border border-slate-200/80 bg-white/95 p-2.5 shadow-sm">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Sessão do caixa</div>
                <div className="text-xs text-slate-500">Escolha a sessão para conferir vendas e movimentações.</div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-[14px] border-[#003223]/10 bg-white px-2.5 text-[10px] text-[#003223] hover:bg-[#F5EBE1]"
                onClick={() => { void refreshFinanceData(); }}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Atualizar
              </Button>
            </div>
            <Select
              value={selectedSessionId}
              onValueChange={(value) => {
                setSelectedSessionId(value);
                void fetchSessionDetails(value);
              }}
            >
              <SelectTrigger className="h-8 rounded-[14px] border-[#003223]/10 bg-white text-[11px]">
                <SelectValue placeholder="Selecione uma sessão" />
              </SelectTrigger>
              <SelectContent>
                {cashSessions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {new Date(session.opened_at).toLocaleString('pt-BR')} - {session.status === 'open' ? 'ABERTO' : 'FECHADO'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between rounded-[16px] border border-[#003223]/8 bg-[#F8FAF8] px-2.5 py-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Status</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {selectedSession?.status === 'open' ? 'Sessão aberta' : 'Sessão fechada'}
                </div>
              </div>
              <Badge variant={selectedSession?.status === 'open' ? 'default' : 'outline'}>
                {selectedSession?.status === 'open' ? 'ABERTO' : 'FECHADO'}
              </Badge>
            </div>
            {selectedSession?.status === 'open' && (
              <Button
                type="button"
                className="h-9 w-full rounded-[14px] bg-[#C93B32] text-xs text-white hover:bg-[#A92F28]"
                onClick={() => { void closeSelectedCashSession(); }}
              >
                <Lock className="mr-1.5 h-3.5 w-3.5" />
                Fechar esta sessão
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-[14px] border-[#003223]/10 bg-white text-xs text-[#003223] hover:bg-[#F5EBE1]"
              onClick={() => { void handleReprintCashCloseReport(); }}
              disabled={!selectedSession || selectedSession.status !== 'closed' || reprintingCashReport}
            >
              <ReceiptText className="mr-1.5 h-3.5 w-3.5" />
              {reprintingCashReport ? 'Reimprimindo...' : 'Reimprimir fechamento'}
            </Button>
          </div>
        </section>

        <Tabs value={mobileFinanceTab} onValueChange={(value) => setMobileFinanceTab(value as typeof mobileFinanceTab)} className="w-full">
          <TabsList className="grid h-auto grid-cols-3 rounded-[16px] border border-[#FF6400]/10 bg-white p-1">
            <TabsTrigger value="caixa" className="rounded-[12px] text-[9px]">Caixa</TabsTrigger>
            <TabsTrigger value="movimentos" className="rounded-[12px] text-[9px]">Movimentos</TabsTrigger>
            <TabsTrigger value="relatorios" className="rounded-[12px] text-[9px]">DRE</TabsTrigger>
          </TabsList>

          <TabsContent value="caixa" className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[18px] border border-[#8CC850]/20 bg-white/95 p-3 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Vendas</div>
                <div className="mt-1.5 text-[1rem] font-bold text-slate-900">{formatCurrency(sessionTotal)}</div>
              </div>
              <div className="rounded-[18px] border border-[#003223]/10 bg-white/95 p-3 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Abertura</div>
                <div className="mt-1.5 text-[1rem] font-bold text-slate-900">{formatCurrency(Number(selectedSession?.initial_amount || 0))}</div>
              </div>
              <div className="rounded-[18px] border border-[#8CC850]/20 bg-white/95 p-3 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">PIX</div>
                <div className="mt-1.5 text-[1rem] font-bold text-slate-900">{formatCurrency(sessionPix)}</div>
              </div>
              <div className="rounded-[18px] border border-[#FF6400]/18 bg-white/95 p-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Cartão</div>
                <div className="mt-1.5 text-[1rem] font-bold text-slate-900">{formatCurrency(sessionCard)}</div>
              </div>
              <div className="rounded-[18px] border border-[#7C3AED]/18 bg-white/95 p-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Dinheiro</div>
                <div className="mt-1.5 text-[1rem] font-bold text-slate-900">{formatCurrency(sessionCash)}</div>
              </div>
              <div className="rounded-[18px] border border-[#003223]/10 bg-white/95 p-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Saldo</div>
                <div className="mt-1.5 text-[1rem] font-bold text-slate-900">{formatCurrency(sessionTotal + sessionIn - sessionOut)}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-[16px] border border-[#003223]/10 bg-white/95 p-2.5 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Abertura</div>
                <div className="mt-1.5 text-[12px] font-bold text-slate-900">{formatCurrency(Number(selectedSession?.initial_amount || 0))}</div>
              </div>
              <div className="rounded-[16px] border border-[#8CC850]/20 bg-white/95 p-2.5 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Suprimentos</div>
                <div className="mt-1.5 text-[12px] font-bold text-slate-900">{formatCurrency(sessionIn)}</div>
              </div>
              <div className="rounded-[16px] border border-[#FF6400]/18 bg-white/95 p-2.5 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Sangrias</div>
                <div className="mt-1.5 text-[12px] font-bold text-slate-900">{formatCurrency(sessionOut)}</div>
              </div>
            </div>

            <section className="rounded-[20px] border border-slate-200/80 bg-white/95 p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">Últimas vendas da sessão</div>
                <div className="text-xs text-slate-500">{sessionSales.length} venda(s)</div>
              </div>
              <div className="mt-2.5 space-y-2">
                {loadingSessionDetails ? (
                  <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Carregando sessão...</div>
                ) : sessionSales.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Sem vendas nessa sessão.</div>
                ) : (
                  sessionSales.slice(0, 5).map((order) => (
                    <div key={order.id} className="rounded-[16px] border border-[#003223]/8 bg-[#F8FAF8] p-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Pedido {order.order_number ? `#${order.order_number}` : order.id?.slice(0, 8)}</div>
                          <div className="mt-1 text-xs text-slate-500">{formatDate(new Date(order.created_at))} às {formatTime(new Date(order.created_at))}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-slate-900">{formatCurrency(Number(order.total || 0))}</div>
                          <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{getPaymentMethodLabel(order.payment_method)}</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200/80 bg-white/95 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">Movimentações do caixa</div>
                <div className="text-xs text-slate-500">{sessionMovements.length} registro(s)</div>
              </div>
              <div className="mt-3 space-y-3">
                {loadingSessionDetails ? (
                  <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Carregando movimentações...</div>
                ) : sessionMovements.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Sem movimentações nesta sessão.</div>
                ) : (
                  sessionMovements.slice(0, 6).map((movement) => (
                    <div key={movement.id} className="rounded-[22px] border border-[#003223]/8 bg-[#F8FAF8] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{movement.type === 'in' ? 'Suprimento' : 'Sangria'}</div>
                          <div className="mt-1 text-xs text-slate-500">{movement.description || 'Sem descrição'}</div>
                          <div className="mt-1 text-xs text-slate-500">{formatDate(new Date(movement.created_at))} às {formatTime(new Date(movement.created_at))}</div>
                        </div>
                        <div className={`text-sm font-bold ${movement.type === 'in' ? 'text-[#245B2B]' : 'text-[#C45E00]'}`}>
                          {formatCurrency(Number(movement.amount || 0))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="movimentos" className="mt-4 space-y-4">
            <section className="rounded-[28px] border border-slate-200/80 bg-white/95 p-4 shadow-sm">
              <div className="space-y-3">
                <Input
                  placeholder="Buscar movimentações, categorias ou pedidos..."
                  value={filters.searchTerm}
                  onChange={(event) => handleFilterChange('searchTerm', event.target.value)}
                  className="h-11 rounded-2xl border-[#003223]/10 bg-white"
                />
                <div className="scrollbar-hide flex gap-2 overflow-x-auto">
                  {mobileTypeFilters.map((filter) => (
                    <button
                      key={filter.value || 'all'}
                      type="button"
                      onClick={() => handleFilterChange('type', filter.value)}
                      className={`shrink-0 rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors ${
                        (filters.type || 'all') === filter.value
                          ? 'border-[#003223] bg-[#003223] text-white'
                          : 'border-[#DCE6DF] bg-white text-[#003223]'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <div className="scrollbar-hide flex gap-2 overflow-x-auto">
                  {mobilePaymentFilters.map((filter) => (
                    <button
                      key={filter.value || 'all'}
                      type="button"
                      onClick={() => handleFilterChange('paymentMethod', filter.value)}
                      className={`shrink-0 rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors ${
                        (filters.paymentMethod || 'all') === filter.value
                          ? 'border-[#003223] bg-[#003223] text-white'
                          : 'border-[#DCE6DF] bg-white text-[#003223]'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 flex-1 rounded-2xl border-[#003223]/10 bg-white text-[#003223] hover:bg-[#F5EBE1]"
                    onClick={resetFilters}
                  >
                    Limpar
                  </Button>
                  <Button
                    type="button"
                    className="h-10 flex-1 rounded-2xl bg-[#003223] text-white hover:bg-[#0a4a34]"
                    onClick={applyFilters}
                  >
                    Aplicar
                  </Button>
                </div>
              </div>
            </section>

            <div className="space-y-3">
              {isLoading ? (
                <div className="rounded-[28px] border border-dashed border-slate-200 bg-white/90 px-4 py-10 text-center text-sm text-slate-500">Carregando transações...</div>
              ) : filteredTransactions.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-200 bg-white/90 px-4 py-10 text-center text-sm text-slate-500">Nenhuma transação encontrada.</div>
              ) : (
                filteredTransactions.slice(0, 12).map((transaction) => (
                  <div key={transaction.id} className="rounded-[24px] border border-slate-200/80 bg-white/95 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{transaction.description}</div>
                        <div className="mt-1 text-xs text-slate-500">{transaction.category}</div>
                        <div className="mt-2 text-xs text-slate-500">{formatDate(transaction.date)} às {formatTime(transaction.date)}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-bold ${transaction.type === 'entrada' ? 'text-[#245B2B]' : 'text-[#C45E00]'}`}>
                          {formatCurrency(transaction.amount)}
                        </div>
                        <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {getPaymentMethodLabel(transaction.paymentMethod)}
                        </div>
                      </div>
                    </div>
                    {transaction.category === 'Vendas' && (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                        <Badge variant={transaction.status === 'cancelled' ? 'destructive' : 'outline'}>
                          {transaction.status === 'cancelled' ? 'Cancelada' : 'Venda registrada'}
                        </Badge>
                        {transaction.status !== 'cancelled' && transaction.order && canCancelFinancialSale(transaction.order) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                            disabled={cancellingOrderIds.has(String(transaction.id))}
                            onClick={() => requestFinancialCancellation(transaction.order)}
                          >
                            <XCircle className="mr-2 h-4 w-4" />
                            {cancellingOrderIds.has(String(transaction.id)) ? 'Cancelando...' : 'Cancelar'}
                          </Button>
                        ) : transaction.status !== 'cancelled' ? (
                          <span className="text-xs font-medium text-slate-500">Histórico protegido</span>
                        ) : null}
                      </div>
                    )}
                    {transaction.status === 'cancelled' && transaction.order?.financial_cancellation ? (
                      <div className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">
                        <strong>Motivo:</strong> {transaction.order.financial_cancellation.reason}
                        <br />
                        <span className="text-red-700/80">
                          Por {transaction.order.financial_cancellation.authorized_waiter_name || 'Administrador'}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="relatorios" className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-[22px] border border-[#8CC850]/20 bg-white/95 p-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Receita</div>
                <div className="mt-2 text-base font-bold text-slate-900">{formatCurrency(dre.receitaLiquida)}</div>
              </div>
              <div className="rounded-[22px] border border-[#FF6400]/18 bg-white/95 p-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Despesas</div>
                <div className="mt-2 text-base font-bold text-slate-900">{formatCurrency(dre.despesas)}</div>
              </div>
              <div className="rounded-[22px] border border-[#003223]/10 bg-white/95 p-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Lucro</div>
                <div className={`mt-2 text-base font-bold ${dre.lucroOperacional >= 0 ? 'text-[#245B2B]' : 'text-[#C45E00]'}`}>
                  {formatCurrency(dre.lucroOperacional)}
                </div>
              </div>
            </div>

            <section className="rounded-[28px] border border-slate-200/80 bg-white/95 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">DRE simplificada</div>
                  <div className="text-xs text-slate-500">
                    {new Intl.DateTimeFormat('pt-BR').format(reportStart)} até {new Intl.DateTimeFormat('pt-BR').format(reportEnd)}
                  </div>
                </div>
                <div className="rounded-full bg-[#F5FBED] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#245B2B]">
                  {Number(margemOperacional.toFixed(1)).toString().replace('.', ',')}%
                </div>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Receita bruta</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(dre.receitaBruta)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Descontos</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(dre.descontos)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Receita líquida</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(dre.receitaLiquida)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Taxa de entrega</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(dre.taxaEntrega)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Despesas</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(dre.despesas)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                  <span className="font-semibold text-slate-900">Lucro operacional</span>
                  <span className={`font-bold ${dre.lucroOperacional >= 0 ? 'text-[#245B2B]' : 'text-[#C45E00]'}`}>
                    {formatCurrency(dre.lucroOperacional)}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                className="mt-4 h-11 w-full rounded-2xl bg-[#003223] text-white hover:bg-[#0a4a34]"
                onClick={generateCSV}
              >
                <Download className="mr-2 h-4 w-4" />
                Exportar relatório
              </Button>
            </section>
          </TabsContent>
        </Tabs>
      </div>

      <div className="hidden">
        <Card className="rounded-[28px] border border-white/70 border-t-4 border-t-boracume-green bg-white/90 shadow-[0_24px_60px_-36px_rgba(0,50,35,0.28)] dark:border-white/10 dark:bg-[#101a16]/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-slate-900 dark:text-white">
              <ArrowUp className="h-5 w-5 text-boracume-green" />
              Receitas
            </CardTitle>
            <CardDescription className="dark:text-slate-400">Total de vendas e entradas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-boracume-dark-green">
              {formatCurrency(totalIncome)}
            </div>
          </CardContent>
        </Card>
        
        <Card className="rounded-[28px] border border-white/70 border-t-4 border-t-boracume-orange bg-white/90 shadow-[0_24px_60px_-36px_rgba(0,50,35,0.28)] dark:border-white/10 dark:bg-[#101a16]/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-slate-900 dark:text-white">
              <ArrowDown className="h-5 w-5 text-boracume-orange" />
              Despesas
            </CardTitle>
            <CardDescription className="dark:text-slate-400">Total de custos e saídas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-boracume-orange">
              {formatCurrency(totalExpenses)}
            </div>
          </CardContent>
        </Card>
        
        <Card className="rounded-[28px] border border-white/70 border-t-4 border-t-boracume-dark-green bg-boracume-green/5 shadow-[0_24px_60px_-36px_rgba(0,50,35,0.28)] dark:border-white/10 dark:bg-[#101a16]/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-slate-900 dark:text-white">
              <DollarSign className="h-5 w-5 text-boracume-dark-green" />
              Saldo
            </CardTitle>
            <CardDescription className="dark:text-slate-400">Balanço atual</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${balance >= 0 ? 'text-boracume-green' : 'text-boracume-orange'}`}>
              {formatCurrency(balance)}
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="hidden">
        <Card className="rounded-[26px] border border-white/70 bg-white/90 shadow-[0_24px_60px_-36px_rgba(0,50,35,0.2)] dark:border-white/10 dark:bg-[#101a16]/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-md flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              PIX
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(pixTotal)}</div>
            <div className="text-sm text-muted-foreground">
              {totalIncome ? Math.round((pixTotal / totalIncome) * 100) : 0}% das receitas
            </div>
          </CardContent>
        </Card>
        
        <Card className="rounded-[26px] border border-white/70 bg-white/90 shadow-[0_24px_60px_-36px_rgba(0,50,35,0.2)] dark:border-white/10 dark:bg-[#101a16]/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-md flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              CARTÃO
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(cardTotal)}</div>
            <div className="text-sm text-muted-foreground">
              {totalIncome ? Math.round((cardTotal / totalIncome) * 100) : 0}% das receitas
            </div>
          </CardContent>
        </Card>
        
        <Card className="rounded-[26px] border border-white/70 bg-white/90 shadow-[0_24px_60px_-36px_rgba(0,50,35,0.2)] dark:border-white/10 dark:bg-[#101a16]/95">
          <CardHeader className="pb-2">
            <CardTitle className="text-md flex items-center gap-2">
              <Percent className="h-4 w-4" />
              DINHEIRO
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(cashTotal)}</div>
            <div className="text-sm text-muted-foreground">
              {totalIncome ? Math.round((cashTotal / totalIncome) * 100) : 0}% do dinheiro recebido
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="hidden md:block">
      <Tabs defaultValue="fluxo-caixa" className="w-full">
        <TabsList className="h-11 rounded-2xl border border-[#003223]/8 bg-white/80 p-1 shadow-sm dark:border-white/10 dark:bg-white/5">
          <TabsTrigger className="rounded-xl px-5 data-[state=active]:bg-[#003223] data-[state=active]:text-white" value="fluxo-caixa">Fluxo de Caixa</TabsTrigger>
          <TabsTrigger className="rounded-xl px-5 data-[state=active]:bg-[#003223] data-[state=active]:text-white" value="relatorios">Relatórios</TabsTrigger>
        </TabsList>
        
        <TabsContent value="fluxo-caixa" className="space-y-4">
          <Card className="overflow-hidden rounded-[30px] border border-white/70 bg-white/90 shadow-[0_24px_60px_-36px_rgba(0,50,35,0.28)] dark:border-white/10 dark:bg-[#101a16]/95">
            <CardHeader className="border-b border-white/10 bg-gradient-to-r from-[#003223] via-[#07573d] to-[#0c6d49] text-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-white">
                    {selectedSession?.status === 'open' ? <Unlock className="h-4 w-4 text-[#C8F59A]" /> : <Lock className="h-4 w-4 text-white/70" />}
                    Sessão de Caixa
                  </CardTitle>
                  <CardDescription className="mt-1 text-white/70">Conferência de vendas, dinheiro esperado e movimentações da operação.</CardDescription>
                </div>
                <div className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] ${
                  selectedSession?.status === 'open'
                    ? 'border-[#C8F59A]/40 bg-[#C8F59A]/15 text-[#E8FFD0]'
                    : 'border-white/20 bg-white/10 text-white/80'
                }`}>
                  {selectedSession?.status === 'open' ? 'Caixa aberto' : 'Caixa fechado'}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 bg-gradient-to-b from-[#F8FBF9] to-white p-5 dark:from-[#0c1512] dark:to-[#101a16]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Sessão</Label>
                  <Select
                    value={selectedSessionId}
                    onValueChange={(v) => {
                      setSelectedSessionId(v);
                      fetchSessionDetails(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma sessão" />
                    </SelectTrigger>
                    <SelectContent>
                      {cashSessions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {new Date(s.opened_at).toLocaleString('pt-BR')} — {s.status === 'open' ? 'ABERTO' : 'FECHADO'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <div className="h-10 flex items-center">
                    <Badge variant={selectedSession?.status === 'open' ? 'default' : 'outline'}>
                      {selectedSession?.status === 'open' ? 'ABERTO' : 'FECHADO'}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-col items-stretch justify-end gap-2 sm:flex-row sm:items-end">
                  {selectedSession?.status === 'open' && (
                    <Button
                      className="bg-[#C93B32] text-white hover:bg-[#A92F28]"
                      onClick={() => { void closeSelectedCashSession(); }}
                    >
                      <Lock className="mr-2 h-4 w-4" />
                      Fechar esta sessão
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => selectedSessionId && fetchSessionDetails(selectedSessionId)} disabled={!selectedSessionId || loadingSessionDetails}>
                    {loadingSessionDetails ? 'Atualizando...' : 'Atualizar sessão'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { void handleReprintCashCloseReport(); }}
                    disabled={!selectedSession || selectedSession.status !== 'closed' || reprintingCashReport}
                  >
                    <ReceiptText className="mr-2 h-4 w-4" />
                    {reprintingCashReport ? 'Reimprimindo...' : 'Reimprimir fechamento'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Card className="rounded-[22px] border border-[#8CC850]/20 bg-gradient-to-br from-white to-[#F5FBED] dark:border-white/10 dark:from-[#0c1512] dark:to-[#112017]">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Total de vendas</span><ShoppingBag className="h-4 w-4 text-[#6FAE35]" /></div>
                    <div className="mt-2 text-xl font-bold">{formatCurrency(sessionTotal)}</div>
                    <div className="mt-1 text-xs text-slate-500">{sessionSales.length} venda(s) válida(s)</div>
                  </CardContent>
                </Card>
                <Card className="rounded-[22px] border border-sky-200 bg-gradient-to-br from-white to-[#EEF7FF] dark:border-white/10 dark:from-[#0c1512] dark:to-[#101b22]">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">PIX</span><Sparkles className="h-4 w-4 text-sky-600" /></div>
                    <div className="mt-2 text-xl font-bold">{formatCurrency(sessionPix)}</div>
                    <div className="mt-1 text-xs text-slate-500">recebimentos instantâneos</div>
                  </CardContent>
                </Card>
                <Card className="rounded-[22px] border border-orange-200 bg-gradient-to-br from-white to-[#FFF4EA] dark:border-white/10 dark:from-[#0c1512] dark:to-[#1e1510]">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Cartão</span><CreditCard className="h-4 w-4 text-[#FF6400]" /></div>
                    <div className="mt-2 text-xl font-bold">{formatCurrency(sessionCard)}</div>
                    <div className="mt-1 text-xs text-slate-500">crédito, débito e voucher</div>
                  </CardContent>
                </Card>
                <Card className="rounded-[22px] border border-violet-200 bg-gradient-to-br from-white to-violet-50 dark:border-white/10 dark:from-[#0c1512] dark:to-[#171325]">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Dinheiro</span><WalletCards className="h-4 w-4 text-violet-600" /></div>
                    <div className="mt-2 text-xl font-bold">{formatCurrency(sessionCash)}</div>
                    <div className="mt-1 text-xs text-slate-500">vendas recebidas em espécie</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <Card className="rounded-[22px] border border-[#003223]/10 bg-white dark:border-white/10 dark:bg-[#0c1512]">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Abertura</CardTitle></CardHeader>
                  <CardContent><div className="text-lg font-semibold">{formatCurrency(Number(selectedSession?.initial_amount || 0))}</div></CardContent>
                </Card>
                <Card className="rounded-[22px] border border-[#8CC850]/15 bg-white dark:border-white/10 dark:bg-[#0c1512]">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Suprimentos</CardTitle></CardHeader>
                  <CardContent><div className="text-lg font-semibold">{formatCurrency(sessionIn)}</div></CardContent>
                </Card>
                <Card className="rounded-[22px] border border-[#FF6400]/15 bg-white dark:border-white/10 dark:bg-[#0c1512]">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Sangrias</CardTitle></CardHeader>
                  <CardContent><div className="text-lg font-semibold">{formatCurrency(sessionOut)}</div></CardContent>
                </Card>
                <Card className="rounded-[22px] border border-[#003223]/15 bg-[#003223] text-white shadow-[0_18px_30px_-22px_rgba(0,50,35,0.8)]">
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-white/75">Dinheiro esperado</CardTitle></CardHeader>
                  <CardContent><div className="text-lg font-bold text-white">{formatCurrency(sessionExpectedCash)}</div></CardContent>
                </Card>
                <Card className="rounded-[22px] border border-red-100 bg-red-50/70 dark:border-red-500/20 dark:bg-red-500/10">
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-red-700 dark:text-red-300">Canceladas</CardTitle></CardHeader>
                  <CardContent><div className="text-lg font-semibold text-red-700 dark:text-red-300">{sessionCancelledSales.length}</div></CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <Card className="overflow-hidden rounded-[24px] border border-white/70 bg-white/95 dark:border-white/10 dark:bg-[#0c1512]">
                  <CardHeader className="border-b border-[#003223]/8 bg-gradient-to-r from-[#F5FBED] to-white py-4 dark:border-white/10 dark:from-[#112017] dark:to-[#0c1512]">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ShoppingBag className="h-4 w-4 text-[#6FAE35]" />
                          Vendas da sessão
                        </CardTitle>
                        <CardDescription className="mt-1">Todas as vendas vinculadas ao caixa selecionado, incluindo cancelamentos.</CardDescription>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-white/5">{sessionOrders.length} registro(s)</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="overflow-x-auto">
                    <Table className="min-w-[860px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Pedido</TableHead>
                          <TableHead>Pagamento</TableHead>
                          <TableHead>Valor</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingSessionDetails ? (
                          <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Carregando...</TableCell></TableRow>
                        ) : sessionOrders.length > 0 ? (
                          sessionOrders.map((o) => (
                            <TableRow key={o.id}>
                              <TableCell>
                                <div>{formatDate(new Date(o.created_at))}</div>
                                <div className="text-xs text-muted-foreground">{formatTime(new Date(o.created_at))}</div>
                              </TableCell>
                              <TableCell>{o.order_number ? `#${o.order_number}` : o.id?.slice(0, 8)}</TableCell>
                              <TableCell><Badge variant="outline">{getPaymentMethodLabel(o.payment_method)}</Badge></TableCell>
                              <TableCell className="font-medium">{formatCurrency(Number(o.total || 0))}</TableCell>
                              <TableCell><Badge variant={o.status === 'cancelled' ? 'destructive' : 'outline'}>{getOrderStatusLabel(o.status)}</Badge></TableCell>
                              <TableCell className="text-right">
                                {o.status === 'cancelled' ? (
                                  <span className="text-xs text-muted-foreground">Cancelada</span>
                                ) : (
                                  <div className="flex items-center justify-end gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={reprintingOrderIds.has(String(o.id))}
                                      onClick={() => void handleReprintSessionOrder(o)}
                                    >
                                      <Printer className="mr-2 h-4 w-4" />
                                      {reprintingOrderIds.has(String(o.id)) ? 'Reimprimindo...' : 'Reimprimir'}
                                    </Button>
                                    {!canCancelFinancialSale(o) ? (
                                      <span className="text-xs font-medium text-muted-foreground">
                                        Caixa encerrado
                                      </span>
                                    ) : (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                                        disabled={cancellingOrderIds.has(String(o.id))}
                                        onClick={() => requestFinancialCancellation(o)}
                                      >
                                        <XCircle className="mr-2 h-4 w-4" />
                                        {cancellingOrderIds.has(String(o.id)) ? 'Cancelando...' : 'Cancelar venda'}
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Sem vendas nessa sessão</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                    </div>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden rounded-[24px] border border-white/70 bg-white/95 dark:border-white/10 dark:bg-[#0c1512]">
                  <CardHeader className="border-b border-[#003223]/8 bg-gradient-to-r from-[#FFF4EA] to-white py-4 dark:border-white/10 dark:from-[#1e1510] dark:to-[#0c1512]">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ArrowUp className="h-4 w-4 text-[#C45E00]" />
                          Suprimentos e sangrias
                        </CardTitle>
                        <CardDescription className="mt-1">Entradas e retiradas manuais realizadas durante esta sessão.</CardDescription>
                      </div>
                      <Badge variant="outline" className="bg-white dark:bg-white/5">{sessionMovements.length} registro(s)</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="overflow-x-auto">
                    <Table className="min-w-[720px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingSessionDetails ? (
                          <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Carregando...</TableCell></TableRow>
                        ) : sessionMovements.length > 0 ? (
                          sessionMovements.map((m) => (
                            <TableRow key={m.id}>
                              <TableCell>
                                <div>{formatDate(new Date(m.created_at))}</div>
                                <div className="text-xs text-muted-foreground">{formatTime(new Date(m.created_at))}</div>
                              </TableCell>
                              <TableCell>
                                <Badge className={m.type === 'in' ? 'bg-green-500' : 'bg-red-500'}>
                                  {m.type === 'in' ? 'SUPRIMENTO' : 'SANGRIA'}
                                </Badge>
                              </TableCell>
                              <TableCell>{m.description || '-'}</TableCell>
                              <TableCell className="font-medium">{formatCurrency(Number(m.amount || 0))}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Sem movimentações</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[30px] border border-white/70 bg-white/90 shadow-[0_24px_60px_-36px_rgba(0,50,35,0.28)] dark:border-white/10 dark:bg-[#101a16]/95">
            <CardHeader className="border-b border-[#003223]/8 bg-gradient-to-r from-[#F5FBED] via-white to-[#FFF4EA] dark:border-white/10 dark:from-[#112017] dark:via-[#101a16] dark:to-[#1e1510]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl text-slate-900 dark:text-white">
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#003223] text-white">
                      <ReceiptText className="h-4 w-4" />
                    </span>
                    Histórico financeiro
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Consulte vendas e despesas, filtre o movimento e cancele vendas com rastreabilidade.
                  </CardDescription>
                </div>
                <Badge className="border-0 bg-white px-3 py-1 text-[#003223] shadow-sm hover:bg-white dark:bg-white/10 dark:text-white">
                  {filteredTransactions.length} registro(s)
                </Badge>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 mt-4">
                <div className="lg:col-span-2">
                  <Input
                    placeholder="Buscar transações..."
                    value={filters.searchTerm}
                    onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
                    className="w-full"
                  />
                </div>
                
                <div>
                  <Select
                    value={filters.paymentMethod}
                    onValueChange={(value) => handleFilterChange('paymentMethod', value as PaymentMethod | '')}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Forma de Pagamento" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="pix">PIX</SelectItem>
                      <SelectItem value="dinheiro">Dinheiro</SelectItem>
                      <SelectItem value="cartao">Cartão</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Select
                    value={filters.type}
                    onValueChange={(value) => handleFilterChange('type', value as 'entrada' | 'saida' | '')}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="entrada">Receitas</SelectItem>
                      <SelectItem value="saida">Despesas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-center gap-2 justify-end lg:col-span-2">
                  <Button variant="outline" onClick={resetFilters}>
                    Limpar
                  </Button>
                  <Button onClick={applyFilters}>
                    <Filter className="mr-2 h-4 w-4" />
                    Aplicar Filtros
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        Carregando transações...
                      </TableCell>
                    </TableRow>
                  ) : filteredTransactions.length > 0 ? (
                    filteredTransactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell>
                          <div>{formatDate(transaction.date)}</div>
                          <div className="text-xs text-muted-foreground">{formatTime(transaction.date)}</div>
                        </TableCell>
                        <TableCell>{transaction.description}</TableCell>
                        <TableCell>{transaction.category}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{getPaymentMethodLabel(transaction.paymentMethod)}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(transaction.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge className={transaction.type === 'entrada' ? 'bg-green-500' : 'bg-red-500'}>
                            {transaction.type === 'entrada' ? 'Receita' : 'Despesa'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {transaction.category === 'Vendas' ? (
                            <div className="space-y-1">
                              <Badge variant={transaction.status === 'cancelled' ? 'destructive' : 'outline'}>
                                {transaction.status === 'cancelled' ? 'Cancelada' : 'Registrada'}
                              </Badge>
                              {transaction.status === 'cancelled' && transaction.order?.financial_cancellation ? (
                                <div className="max-w-[220px] text-xs text-muted-foreground">
                                  {transaction.order.financial_cancellation.reason}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {transaction.category !== 'Vendas' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : transaction.status === 'cancelled' ? (
                            <span className="text-xs font-medium text-red-600">Cancelada</span>
                          ) : transaction.order && canCancelFinancialSale(transaction.order) ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                              disabled={cancellingOrderIds.has(String(transaction.id))}
                              onClick={() => requestFinancialCancellation(transaction.order)}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              {cancellingOrderIds.has(String(transaction.id)) ? 'Cancelando...' : 'Cancelar venda'}
                            </Button>
                          ) : (
                            <span className="text-xs font-medium text-muted-foreground">Histórico protegido</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        Nenhuma transação encontrada
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="relatorios" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="bg-emerald-50/60 border-l-4 border-l-emerald-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Receita Líquida</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold text-emerald-700">{formatCurrency(dre.receitaLiquida)}</div>
              </CardContent>
            </Card>
            <Card className="bg-rose-50/60 border-l-4 border-l-rose-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Despesas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold text-rose-700">{formatCurrency(dre.despesas)}</div>
              </CardContent>
            </Card>
            <Card className="bg-violet-50/60 border-l-4 border-l-violet-600">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Lucro Operacional</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-lg font-bold ${dre.lucroOperacional >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {formatCurrency(dre.lucroOperacional)}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-sky-50/60 border-l-4 border-l-sky-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Margem</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-lg font-bold ${margemOperacional >= 0 ? 'text-sky-700' : 'text-rose-700'}`}>
                  {Number(margemOperacional.toFixed(1)).toString().replace('.', ',')}%
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="bg-white">
              <CardHeader>
                <CardTitle>Receitas vs Despesas</CardTitle>
                <CardDescription>
                  {new Intl.DateTimeFormat('pt-BR').format(reportStart)} até {new Intl.DateTimeFormat('pt-BR').format(reportEnd)}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailySeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Legend />
                    <Line type="monotone" dataKey="income" name="Receitas" stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="expenses" name="Despesas" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="profit" name="Lucro" stroke="#7c3aed" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="bg-white">
              <CardHeader>
                <CardTitle>Despesas por Categoria</CardTitle>
                <CardDescription>
                  Distribuição das saídas no período selecionado
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[320px]">
                {expenseByCategory.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Sem despesas no período
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                      <Legend />
                      <Pie data={expenseByCategory} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                        {expenseByCategory.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-white border-l-4 border-l-violet-600">
            <CardHeader>
              <CardTitle>DRE (simplificada)</CardTitle>
              <CardDescription>
                {new Intl.DateTimeFormat('pt-BR').format(reportStart)} até {new Intl.DateTimeFormat('pt-BR').format(reportEnd)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Receita Bruta</TableCell>
                    <TableCell className="text-right">{formatCurrency(dre.receitaBruta)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">(-) Descontos</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(dre.descontos)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Receita Líquida</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(dre.receitaLiquida)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Receita de Produtos</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(dre.receitaProdutos)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Taxa de Entrega</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(dre.taxaEntrega)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">(-) Despesas</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(dre.despesas)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Lucro Operacional</TableCell>
                    <TableCell className={`text-right font-bold ${dre.lucroOperacional >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(dre.lucroOperacional)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exportar Relatórios</CardTitle>
              <CardDescription>Gere relatórios financeiros personalizados</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Data Inicial</div>
                  <DatePicker
                    date={filters.startDate}
                    setDate={(date) => handleFilterChange('startDate', date)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Data Final</div>
                  <DatePicker
                    date={filters.endDate}
                    setDate={(date) => handleFilterChange('endDate', date)}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="text-sm font-medium">Tipo de Relatório</div>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tipo de relatório" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="completo">Relatório Completo</SelectItem>
                    <SelectItem value="receitas">Somente Receitas</SelectItem>
                    <SelectItem value="despesas">Somente Despesas</SelectItem>
                    <SelectItem value="pagamentos">Por Forma de Pagamento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <Button className="w-full mt-4" onClick={generateCSV}>
                <Download className="mr-2 h-4 w-4" />
                Gerar Relatório
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>

      <CancelSaleDialog
        open={Boolean(orderToCancel)}
        orderLabel={
          orderToCancel
            ? (orderToCancel.order_number ? `#${orderToCancel.order_number}` : `#${String(orderToCancel.id).slice(0, 8)}`)
            : undefined
        }
        amountLabel={orderToCancel ? formatCurrency(Number(orderToCancel.total || 0)) : undefined}
        supportsAutomaticRefund={String(orderToCancel?.payment_method || '').toLowerCase() === 'pix_online'}
        paymentLabel={getPaymentMethodLabel(orderToCancel?.payment_method)}
        onCancel={() => setOrderToCancel(null)}
        onConfirm={handleCancelSessionOrder}
      />
    </div>
  );
};

export default Financeiro;
