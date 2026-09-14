
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { CurrencyTextInput } from '@/components/ui/currency-text-input';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Users, Clock, ArrowRightLeft, Printer, WalletCards, ReceiptText, Plus, Trash2, UserRoundCheck } from 'lucide-react';
import CheckoutModal, { CheckoutPaymentAmounts, CheckoutPaymentMethod } from '@/components/checkout/CheckoutModal';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { updateOrderStatus as updateOrderStatusRemote } from '@/utils/updateOrderStatus';
import { getOpenCashRegisterSession } from '@/utils/cashSession';
import { PrinterService } from '@/utils/printerService';
import { formatBRL, parseBRL } from '@/lib/currency';
import { emitNfceForOrder, isFiscalEmissionActiveForUser } from '@/utils/nfceClient';
import { useCheckoutSettings } from '@/hooks/useCheckoutSettings';
import AdminPinDialog from '@/components/security/AdminPinDialog';
import { verifyAdminPin } from '@/services/adminPin';
import { getLocalOperatorSession, isAdminOperator } from '@/services/operatorAuth';

interface Table {
  id: string;
  table_number: number;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved';
  location?: string;
  current_order_id?: string;
}

interface OrderItem {
  id?: string;
  product_id: string;
  product_name: string;
  price: number;
  quantity: number;
  subtotal: number;
  options?: string[];
  notes?: string;
}

interface TableOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone?: string;
  items: OrderItem[];
  total: number;
  status: string;
  created_at: string;
  payment_method?: string;
  session_id?: string | null;
  account_id?: string | null;
  name?: string | null;
  source?: 'orders' | 'table_accounts';
}

const generateOrderNumber = () => {
  const now = new Date();
  const formattedDate = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomNumber = Math.floor(Math.random() * 1000);
  return `${formattedDate}-${randomNumber.toString().padStart(3, '0')}`;
};

interface PaymentLine {
  id: string;
  method: CheckoutPaymentMethod;
  amount: string;
  received?: string;
}

const PAYMENT_METHOD_LABELS: Record<CheckoutPaymentMethod, string> = {
  pix: 'PIX',
  cartao_credito: 'Cartao Credito',
  cartao_debito: 'Cartao Debito',
  cartao_voucher: 'Voucher',
  cartao_outros: 'Cartao Outros',
  dinheiro: 'Dinheiro',
};

const formatPaymentAmount = (value: number) => {
  const numericValue = Number(value) || 0;
  return numericValue > 0.009 ? formatBRL(numericValue) : '';
};

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

const parseCheckoutAmount = (value?: string) => {
  const raw = String(value || '').trim();
  const parsed = parseBRL(raw);
  return /^\d{3,}$/.test(raw) ? parsed / 100 : parsed;
};

const createPaymentLine = (method: CheckoutPaymentMethod, amount = 0): PaymentLine => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  method,
  amount: formatPaymentAmount(amount),
  received: method === 'dinheiro' ? formatPaymentAmount(amount) : '',
});

const normalizeCheckoutPaymentMethod = (value?: string | null): CheckoutPaymentMethod => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('pix')) return 'pix';
  if (['cartao_debito', 'debito', 'debit'].includes(normalized)) return 'cartao_debito';
  if (['cartao_voucher', 'voucher'].includes(normalized)) return 'cartao_voucher';
  if (['cartao_outros', 'outros'].includes(normalized)) return 'cartao_outros';
  if (['cartao', 'cartao_credito', 'card', 'credito', 'credit'].includes(normalized)) return 'cartao_credito';
  if (['dinheiro', 'cash'].includes(normalized)) return 'dinheiro';
  return 'pix';
};

const mapPaymentMethodToWaiterPayment = (value: CheckoutPaymentMethod) => {
  if (String(value).startsWith('cartao')) return 'card';
  if (value === 'dinheiro') return 'cash';
  return 'pix';
};

const isMissingColumnError = (error: any) =>
  String(error?.message || '').toLowerCase().includes('column');

interface TableDetailsModalProps {
  table: Table | null;
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
  availableTables: Table[];
}

const TableDetailsModal: React.FC<TableDetailsModalProps> = ({
  table,
  isOpen,
  onClose,
  onRefresh,
  availableTables
}) => {
  const [currentOrder, setCurrentOrder] = useState<TableOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTransferTable, setSelectedTransferTable] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>('pix');
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [paymentSplitTouched, setPaymentSplitTouched] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutDiscount, setCheckoutDiscount] = useState('');
  const [checkoutSurcharge, setCheckoutSurcharge] = useState('');
  const [serviceChargeEnabled, setServiceChargeEnabled] = useState(false);
  const [serviceChargeAutoApply, setServiceChargeAutoApply] = useState(false);
  const [serviceChargeAccepted, setServiceChargeAccepted] = useState(false);
  const [serviceChargePercentage, setServiceChargePercentage] = useState(10);
  const [serviceChargeTaxWithhold, setServiceChargeTaxWithhold] = useState(0);
  const [staffConsumptionOpen, setStaffConsumptionOpen] = useState(false);
  const [staffEmployeeName, setStaffEmployeeName] = useState('');
  const [staffDueDate, setStaffDueDate] = useState('');
  const [staffNotes, setStaffNotes] = useState('');
  const [adminAction, setAdminAction] = useState<'defer-staff' | 'cancel-item' | null>(null);
  const [itemToCancel, setItemToCancel] = useState<number | null>(null);
  const [cancelItemOpen, setCancelItemOpen] = useState(false);
  const [cancelItemReason, setCancelItemReason] = useState('');
  const { toast } = useToast();
  const { user } = useAuth();
  const { settings: checkoutSettings } = useCheckoutSettings();

  useEffect(() => {
    if (table && isOpen) {
      fetchTableOrder();
    }
  }, [table, isOpen]);

  const fetchTableOrder = async () => {
    if (!table || !user) return;

    try {
      setLoading(true);
      setCheckoutDiscount('');
      setCheckoutSurcharge('');
      setPaymentLines([]);
      setPaymentSplitTouched(false);
      setCheckoutOpen(false);
      await loadServiceChargeSettings();

      const { data: activeSession, error: sessionError } = await (supabase
        .from('table_sessions') as any)
        .select('id, opened_at, status')
        .eq('table_id', table.id)
        .eq('user_id', user.id)
        .in('status', ['open', 'serving', 'payment_pending'])
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sessionError && sessionError.code !== 'PGRST116') throw sessionError;

      let accountQuery = (supabase
        .from('table_accounts') as any)
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['open', 'payment_pending'])
        .order('updated_at', { ascending: false })
        .limit(1);

      accountQuery = activeSession?.id
        ? accountQuery.eq('session_id', activeSession.id)
        : accountQuery.eq('table_id', table.id);

      const { data: accountData, error: accountError } = await accountQuery.maybeSingle();

      if (accountError && accountError.code !== 'PGRST116') throw accountError;

      if (accountData) {
        let parsedItems: OrderItem[] = [];
        const sessionId = String(accountData.session_id || activeSession?.id || '');

        if (sessionId) {
          const { data: relationalItems, error: itemError } = await (supabase
            .from('order_items') as any)
            .select('id, product_id, product_name, quantity, unit_price, notes, status')
            .eq('account_id', accountData.id)
            .neq('status', 'cancelled')
            .order('created_at', { ascending: true });

          if (itemError) throw itemError;

          const itemIds = (relationalItems || []).map((item: any) => item.id);
          const { data: optionRows, error: optionError } = itemIds.length
            ? await (supabase.from('order_item_options') as any)
                .select('order_item_id, option_name, price, quantity')
                .in('order_item_id', itemIds)
            : { data: [], error: null };

          if (optionError) throw optionError;

          const optionsByItem = new Map<string, any[]>();
          (optionRows || []).forEach((option: any) => {
            const current = optionsByItem.get(option.order_item_id) || [];
            current.push(option);
            optionsByItem.set(option.order_item_id, current);
          });

          parsedItems = (relationalItems || []).map((item: any) => {
            const options = optionsByItem.get(item.id) || [];
            const quantity = Math.max(1, Number(item.quantity || 1));
            const unitPrice = Number(item.unit_price || 0);
            const optionTotal = options.reduce(
              (sum: number, option: any) => sum + Number(option.price || 0) * Math.max(1, Number(option.quantity || 1)),
              0,
            );

            return {
              id: item.id,
              product_id: item.product_id,
              product_name: item.product_name,
              price: unitPrice,
              quantity,
              subtotal: Number(((unitPrice + optionTotal) * quantity).toFixed(2)),
              options: options.map((option: any) => String(option.option_name || '')).filter(Boolean),
              notes: item.notes || '',
            };
          });
        } else {
          try {
            if (typeof accountData.items === 'string') {
              parsedItems = JSON.parse(accountData.items);
            } else if (Array.isArray(accountData.items)) {
              parsedItems = accountData.items as unknown as OrderItem[];
            }
          } catch (e) {
            console.error('Error parsing table account items:', e);
            parsedItems = [];
          }
        }

        setCurrentOrder({
          id: accountData.id,
          account_id: accountData.id,
          session_id: sessionId || null,
          order_number: `MESA-${table.table_number}`,
          customer_name: String((accountData as any).name || '').trim() || `Mesa ${table.table_number}`,
          customer_phone: '',
          items: parsedItems,
          total: parsedItems.length
            ? parsedItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
            : Number(accountData.total || 0),
          status: accountData.status || 'open',
          created_at: accountData.created_at,
          payment_method: 'pix_online',
          name: (accountData as any).name || null,
          source: 'table_accounts'
        });
        setPaymentMethod('pix');
        return;
      }

      const { data: orderData, error } = await supabase
        .from('orders')
        .select('*')
        .eq('table_id', table.id)
        .eq('user_id', user.id)
        .in('status', ['pending', 'preparing', 'ready'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (orderData && orderData.length > 0) {
        const order = orderData[0];

        let parsedItems: OrderItem[] = [];
        try {
          if (typeof order.items === 'string') {
            parsedItems = JSON.parse(order.items);
          } else if (Array.isArray(order.items)) {
            parsedItems = order.items as unknown as OrderItem[];
          }
        } catch (e) {
          console.error('Error parsing order items:', e);
          parsedItems = [];
        }

        setCurrentOrder({
          ...order,
          items: parsedItems,
          source: 'orders'
        });
        setPaymentMethod(normalizeCheckoutPaymentMethod(order.payment_method));
      } else {
        setCurrentOrder(null);
        setPaymentMethod('pix');
      }
    } catch (error) {
      console.error('Erro ao carregar pedido da mesa:', error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os dados da mesa.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadServiceChargeSettings = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await (supabase as any)
        .from('waiter_service_charge_settings')
        .select('enabled, auto_apply, percentage, tax_withhold_percent')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      const enabled = Boolean(data?.enabled);
      const autoApply = Boolean(data?.auto_apply);
      const percentage = Math.min(30, Math.max(0, Number(data?.percentage ?? 10)));
      const taxWithhold = Math.min(100, Math.max(0, Number(data?.tax_withhold_percent ?? 0)));

      setServiceChargeEnabled(enabled && percentage > 0);
      setServiceChargeAutoApply(autoApply);
      setServiceChargeAccepted(enabled && autoApply && percentage > 0);
      setServiceChargePercentage(percentage || 10);
      setServiceChargeTaxWithhold(taxWithhold);
    } catch (error) {
      console.warn('Nao foi possivel carregar taxa de servico da mesa:', error);
      setServiceChargeEnabled(false);
      setServiceChargeAutoApply(false);
      setServiceChargeAccepted(false);
      setServiceChargePercentage(10);
      setServiceChargeTaxWithhold(0);
    }
  };

  const handleTransferTable = async () => {
    if (!table || !currentOrder || !selectedTransferTable) return;

    try {
      setLoading(true);

      const sourceTable = currentOrder.source === 'table_accounts' ? 'table_accounts' : 'orders';

      // Atualizar o pedido/conta para a nova mesa
      const { error: updateError } = await supabase
        .from(sourceTable)
        .update({ table_id: selectedTransferTable })
        .eq('id', currentOrder.id);

      if (updateError) throw updateError;

      // Atualizar status das mesas
      await Promise.all([
        supabase
          .from('tables')
          .update({ status: 'available' })
          .eq('id', table.id),
        supabase
          .from('tables')
          .update({ status: 'occupied' })
          .eq('id', selectedTransferTable)
      ]);

      toast({
        title: "Mesa transferida",
        description: `Pedido transferido da Mesa ${table.table_number} com sucesso.`,
      });

      onRefresh();
      setCheckoutOpen(false);
      onClose();
    } catch (error) {
      console.error('Erro ao transferir mesa:', error);
      toast({
        title: "Erro",
        description: "Não foi possível transferir a mesa.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePrintPartial = () => {
    if (!currentOrder || !table) return;

    // Criar conteúdo para impressão
    const printContent = `
      <div style="font-family: monospace; font-size: 12px; max-width: 300px;">
        <h3 style="text-align: center; margin-bottom: 10px;">COMANDA PARCIAL</h3>
        <p><strong>Mesa:</strong> ${table.table_number}</p>
        <p><strong>Pedido:</strong> ${currentOrder.order_number}</p>
        <p><strong>Cliente:</strong> ${currentOrder.customer_name}</p>
        <p><strong>Data:</strong> ${new Date(currentOrder.created_at).toLocaleString('pt-BR')}</p>
        <hr>
        <h4>ITENS:</h4>
        ${currentOrder.items.map(item => `
          <div style="margin-bottom: 8px;">
            <div><strong>${item.quantity}x ${item.product_name}</strong></div>
            ${item.options ? item.options.map(opt => `<div style="margin-left: 10px;">• ${opt}</div>`).join('') : ''}
            ${item.notes ? `<div style="margin-left: 10px; font-style: italic;">Obs: ${item.notes}</div>` : ''}
            <div style="text-align: right;">${formatBRL(item.subtotal)}</div>
          </div>
        `).join('')}
        <hr>
        <div style="text-align: right; font-weight: bold;">
          <p>TOTAL: ${formatBRL(currentOrder.total)}</p>
        </div>
      </div>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }

    toast({
      title: "Impressão enviada",
      description: "Comanda parcial enviada para impressão.",
    });
  };

  const executeDeferToStaff = async (authorizedWaiterId: string) => {
    if (!table || !currentOrder || !user?.id) return;
    if (!staffEmployeeName.trim()) {
      toast({
        title: 'Informe o funcionário',
        description: 'O nome é obrigatório para manter a cobrança identificada.',
        variant: 'destructive',
      });
      return;
    }
    if (currentOrder.source !== 'table_accounts') {
      toast({
        title: 'Conta antiga não compatível',
        description: 'Esta conta precisa ser fechada pelo fluxo atual. Novos lançamentos já permitem registrar em contas a receber.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const { error } = await (supabase as any).rpc('defer_table_account_to_staff_authorized', {
        p_account_id: currentOrder.account_id || currentOrder.id,
        p_employee_name: staffEmployeeName.trim(),
        p_due_date: staffDueDate || null,
        p_notes: staffNotes.trim() || null,
        p_authorized_waiter_id: authorizedWaiterId,
      });
      if (error) throw error;

      toast({
        title: 'Consumo registrado',
        description: `A mesa ${table.table_number} foi liberada e a dívida ficou vinculada a ${staffEmployeeName.trim()}.`,
      });
      setStaffConsumptionOpen(false);
      setStaffEmployeeName('');
      setStaffDueDate('');
      setStaffNotes('');
      onRefresh();
      onClose();
    } catch (error) {
      console.error('Erro ao lançar consumo do funcionário:', error);
      toast({
        title: 'Não foi possível liberar a mesa',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const requestDeferToStaff = async () => {
    if (!staffEmployeeName.trim()) {
      toast({ title: 'Informe o funcionário', description: 'O nome é obrigatório.', variant: 'destructive' });
      return;
    }
    const operator = getLocalOperatorSession();
    if (operator?.id && isAdminOperator(operator)) {
      await executeDeferToStaff(operator.id);
      return;
    }
    setAdminAction('defer-staff');
  };

  const executeCancelItem = async (itemIndex: number, authorizedWaiterId: string) => {
    if (!currentOrder || currentOrder.source !== 'table_accounts') return;
    try {
      setLoading(true);
      const selectedItem = currentOrder.items[itemIndex];
      const rpcName = selectedItem?.id
        ? 'cancel_table_order_item_authorized'
        : 'cancel_table_account_item_authorized';
      const rpcPayload = selectedItem?.id
        ? {
            p_account_id: currentOrder.account_id || currentOrder.id,
            p_item_id: selectedItem.id,
            p_reason: cancelItemReason.trim(),
            p_authorized_waiter_id: authorizedWaiterId,
          }
        : {
            p_account_id: currentOrder.account_id || currentOrder.id,
            p_item_index: itemIndex,
            p_reason: cancelItemReason.trim(),
            p_authorized_waiter_id: authorizedWaiterId,
          };
      const { data, error } = await (supabase as any).rpc(rpcName, rpcPayload);
      if (error) throw error;
      setCurrentOrder((previous) => previous ? {
        ...previous,
        items: previous.items.filter((_, index) => index !== itemIndex),
        total: Number(data?.total ?? previous.total),
      } : previous);
      setCancelItemOpen(false);
      setItemToCancel(null);
      setCancelItemReason('');
      toast({
        title: 'Item cancelado',
        description: 'O valor foi retirado da mesa e a operação ficou registrada na auditoria.',
      });
      onRefresh();
    } catch (error) {
      toast({
        title: 'Não foi possível cancelar o item',
        description: error instanceof Error ? error.message : 'Atualize a mesa e tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const requestCancelItem = async () => {
    if (itemToCancel === null || !cancelItemReason.trim()) {
      toast({ title: 'Informe o motivo', description: 'O motivo é obrigatório para a auditoria.', variant: 'destructive' });
      return;
    }
    const operator = getLocalOperatorSession();
    if (operator?.id && isAdminOperator(operator)) {
      await executeCancelItem(itemToCancel, operator.id);
      return;
    }
    setAdminAction('cancel-item');
  };

  const finalizeAccountRecord = async (accountRowId: string, nextAccountStatus: 'paid' | 'closed', paymentTimestamp: string) => {
    const fullPayload: Record<string, any> = {
      status: nextAccountStatus,
      table_id: null,
      updated_at: paymentTimestamp,
    };

    if (nextAccountStatus === 'paid') {
      fullPayload.paid_at = paymentTimestamp;
      fullPayload.closed_at = paymentTimestamp;
    } else {
      fullPayload.closed_at = paymentTimestamp;
    }

    let { error } = await supabase
      .from('table_accounts')
      .update(fullPayload as any)
      .eq('id', accountRowId);

    if (!error) return;

    if (isMissingColumnError(error)) {
      const fallbackPayload: Record<string, any> = {
        status: nextAccountStatus,
        table_id: null,
        updated_at: paymentTimestamp,
      };

      const fallbackResult = await supabase
        .from('table_accounts')
        .update(fallbackPayload as any)
        .eq('id', accountRowId);

      error = fallbackResult.error;
      if (!error) return;
    }

    throw error;
  };

  const checkoutDiscountValue = parseBRL(checkoutDiscount);
  const checkoutSurchargeValue = parseBRL(checkoutSurcharge);
  const serviceChargeAmount = currentOrder && serviceChargeEnabled && serviceChargeAccepted
    ? Number(((Math.max(0, Number(currentOrder.total || 0) + checkoutSurchargeValue - checkoutDiscountValue) * serviceChargePercentage) / 100).toFixed(2))
    : 0;
  const serviceChargeTaxAmount = Number(((serviceChargeAmount * serviceChargeTaxWithhold) / 100).toFixed(2));
  const serviceChargeNetAmount = Math.max(0, Number((serviceChargeAmount - serviceChargeTaxAmount).toFixed(2)));
  const checkoutTotal = currentOrder
    ? Math.max(0, Number(currentOrder.total || 0) + checkoutSurchargeValue - checkoutDiscountValue + serviceChargeAmount)
    : 0;
  const normalizedPaymentLines = paymentLines
    .map((line) => ({
      ...line,
      amountValue: parseCheckoutAmount(line.amount),
      receivedValue: parseCheckoutAmount(line.received || line.amount),
    }))
    .filter((line) => line.amountValue > 0.009);
  const paymentPaidTotal = normalizedPaymentLines.reduce((sum, line) => sum + line.amountValue, 0);
  const cashPaymentTotal = normalizedPaymentLines
    .filter((line) => line.method === 'dinheiro')
    .reduce((sum, line) => sum + line.amountValue, 0);
  const cashReceivedTotal = normalizedPaymentLines
    .filter((line) => line.method === 'dinheiro')
    .reduce((sum, line) => sum + line.receivedValue, 0);
  const changeAmount = cashPaymentTotal > 0 ? Math.max(0, cashReceivedTotal - cashPaymentTotal) : 0;
  const paymentRemainingValue = Math.max(0, checkoutTotal - paymentPaidTotal);
  const paymentOverflowValue = Math.max(0, paymentPaidTotal - checkoutTotal);
  const hasSplitPayment = normalizedPaymentLines.length > 1;
  const orderPaymentMethod = hasSplitPayment
    ? 'misto'
    : normalizedPaymentLines[0]?.method || paymentMethod;
  const paymentSummaryLabel = hasSplitPayment
    ? 'multiplas formas'
    : PAYMENT_METHOD_LABELS[(normalizedPaymentLines[0]?.method || paymentMethod) as CheckoutPaymentMethod];
  const checkoutPaymentAmounts: CheckoutPaymentAmounts = paymentLines.reduce((acc, line) => {
    if (line.method) acc[line.method] = line.amount;
    return acc;
  }, {} as CheckoutPaymentAmounts);
  const checkoutCashReceived = paymentLines.find((line) => line.method === 'dinheiro')?.received || '';
  const serviceChargeControl = serviceChargeEnabled ? (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-sm font-semibold text-[#082F23]">
            Cobrar {serviceChargePercentage}% do garçom?
          </Label>
          <p className="mt-0.5 text-xs leading-5 text-amber-800">
            {serviceChargeAutoApply
              ? 'A regra da mesa deixou marcado automaticamente. Desmarque se o cliente não aceitar.'
              : 'Opcional no fechamento. Marque somente se o cliente autorizar.'}
          </p>
        </div>
        <Switch checked={serviceChargeAccepted} onCheckedChange={setServiceChargeAccepted} />
      </div>
      {serviceChargeAccepted && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg bg-white/80 p-2">
            <div className="text-slate-500">Taxa</div>
            <div className="font-bold text-[#082F23]">{formatCurrency(serviceChargeAmount)}</div>
          </div>
          <div className="rounded-lg bg-white/80 p-2">
            <div className="text-slate-500">Retenção</div>
            <div className="font-bold text-red-700">{formatCurrency(serviceChargeTaxAmount)}</div>
          </div>
          <div className="rounded-lg bg-white/80 p-2">
            <div className="text-slate-500">Garçom</div>
            <div className="font-bold text-emerald-700">{formatCurrency(serviceChargeNetAmount)}</div>
          </div>
        </div>
      )}
    </div>
  ) : null;

  useEffect(() => {
    if (!currentOrder) return;
    if (paymentSplitTouched) return;
    setPaymentLines([createPaymentLine(paymentMethod, checkoutTotal)]);
  }, [currentOrder?.id, checkoutTotal, paymentMethod, paymentSplitTouched]);

  const updatePaymentLine = (id: string, patch: Partial<PaymentLine>) => {
    setPaymentSplitTouched(true);
    setPaymentLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        if (patch.method) {
          next.received = patch.method === 'dinheiro' ? next.received || next.amount : '';
          setPaymentMethod(patch.method);
        }
        return next;
      })
    );
  };

  const addPaymentLine = () => {
    setPaymentSplitTouched(true);
    setPaymentLines((prev) => [
      ...prev,
      createPaymentLine('pix', paymentRemainingValue > 0.009 ? paymentRemainingValue : 0),
    ]);
  };

  const removePaymentLine = (id: string) => {
    setPaymentSplitTouched(true);
    setPaymentLines((prev) => {
      const next = prev.filter((line) => line.id !== id);
      return next.length > 0 ? next : [createPaymentLine(paymentMethod, checkoutTotal)];
    });
  };

  const selectCheckoutPaymentMethod = (method: CheckoutPaymentMethod) => {
    setPaymentMethod(method);
    setPaymentSplitTouched(false);
    setPaymentLines([createPaymentLine(method, checkoutTotal)]);
  };

  const updateCheckoutPaymentAmount = (method: CheckoutPaymentMethod, value: string) => {
    setPaymentSplitTouched(true);
    setPaymentLines((prev) => {
      const withoutMethod = prev.filter((line) => line.method !== method);
      if (parseBRL(value) <= 0.009) return withoutMethod.length > 0 ? withoutMethod : [createPaymentLine(method, 0)];
      const current = prev.find((line) => line.method === method);
      return [
        ...withoutMethod,
        {
          ...(current || createPaymentLine(method, 0)),
          method,
          amount: value,
          received: method === 'dinheiro' ? current?.received || value : '',
        },
      ];
    });
    setPaymentMethod(method);
  };

  const updateCheckoutCashReceived = (value: string) => {
    setPaymentSplitTouched(true);
    setPaymentLines((prev) => {
      const existing = prev.find((line) => line.method === 'dinheiro');
      if (existing) {
        return prev.map((line) => line.method === 'dinheiro' ? { ...line, received: value } : line);
      }
      return [...prev, { ...createPaymentLine('dinheiro', checkoutTotal), received: value }];
    });
  };

  const clearCheckoutSplit = () => {
    setPaymentSplitTouched(false);
    setPaymentLines([createPaymentLine(paymentMethod, checkoutTotal)]);
  };

  const buildWaiterPaymentRows = (params: {
    sessionId: string;
    accountId: string;
    remainingAmount: number;
  }) => {
    let remaining = Math.max(0, params.remainingAmount);

    return normalizedPaymentLines
      .map((line, index) => {
        const amount = index === normalizedPaymentLines.length - 1
          ? remaining
          : Math.min(line.amountValue, remaining);
        remaining = Math.max(0, remaining - amount);

        if (amount <= 0.009) return null;
        return {
          user_id: user?.id,
          session_id: params.sessionId,
          account_id: params.accountId,
          method: mapPaymentMethodToWaiterPayment(line.method),
          amount: Number(amount.toFixed(2)),
        };
      })
      .filter(Boolean);
  };

  const handleFinishOrder = async () => {
    if (!table || !currentOrder) return;

    try {
      setLoading(true);

      const openCashSession = await getOpenCashRegisterSession(user?.id);
      if (!openCashSession?.id) {
        toast({
          title: "Caixa fechado",
          description: "Abra o caixa antes de fechar a conta da mesa.",
          variant: "destructive"
        });
        return;
      }

      let printableOrder: any = null;
      const paymentTimestamp = new Date().toISOString();
      const adjustedTotal = checkoutTotal;
      if (normalizedPaymentLines.length === 0) {
        toast({
          title: 'Informe o pagamento',
          description: 'Adicione pelo menos uma forma de pagamento para fechar a mesa.',
          variant: 'destructive'
        });
        return;
      }

      if (paymentPaidTotal + 0.009 < adjustedTotal) {
        toast({
          title: 'Pagamento incompleto',
          description: `Ainda falta ${formatCurrency(adjustedTotal - paymentPaidTotal)} para fechar a mesa.`,
          variant: 'destructive'
        });
        return;
      }

      if (paymentOverflowValue > 0.009 && cashPaymentTotal <= 0) {
        toast({
          title: 'Valor acima do total',
          description: 'Valor acima do total só deve acontecer quando houver dinheiro e troco.',
          variant: 'destructive'
        });
        return;
      }

      if (cashPaymentTotal > 0 && cashReceivedTotal + 0.009 < cashPaymentTotal) {
        toast({
          title: 'Valor insuficiente',
          description: 'O valor recebido em espécie é menor que o total da mesa.',
          variant: 'destructive'
        });
        return;
      }

      const financialAdjustments = {
        subtotal: Number(currentOrder.total || 0),
        discount: checkoutDiscountValue,
        surcharge: checkoutSurchargeValue,
        service_charge: {
          enabled: serviceChargeEnabled && serviceChargeAccepted,
          percentage: serviceChargePercentage,
          amount: serviceChargeAmount,
          tax_withhold_percent: serviceChargeTaxWithhold,
          tax_amount: serviceChargeTaxAmount,
          waiter_net_amount: serviceChargeNetAmount,
          auto_apply: serviceChargeAutoApply,
        },
        total: adjustedTotal,
        cash_received: cashPaymentTotal > 0 ? cashReceivedTotal : null,
        change_amount: cashPaymentTotal > 0 ? changeAmount : null,
      };
      const paymentSplitPayload = {
        enabled: hasSplitPayment,
        total: adjustedTotal,
        paid_total: paymentPaidTotal,
        remaining: Math.max(0, adjustedTotal - paymentPaidTotal),
        cash_received: cashPaymentTotal > 0 ? cashReceivedTotal : null,
        change_amount: cashPaymentTotal > 0 ? changeAmount : null,
        lines: normalizedPaymentLines.map((line) => ({
          method: line.method,
          label: PAYMENT_METHOD_LABELS[line.method],
          amount: Number(line.amountValue.toFixed(2)),
          received: line.method === 'dinheiro' ? Number(line.receivedValue.toFixed(2)) : null,
        })),
      };

      if (currentOrder.source === 'table_accounts') {
        const accountId = currentOrder.account_id || currentOrder.id;
        let finalizedOrders: any[] = [];

        if (accountId && (checkoutDiscountValue > 0 || checkoutSurchargeValue > 0 || serviceChargeAmount > 0)) {
          const { error: accountTotalError } = await supabase
            .from('table_accounts')
            .update({ total: adjustedTotal, updated_at: paymentTimestamp } as any)
            .eq('id', accountId)
            .eq('user_id', user?.id);

          if (accountTotalError) throw accountTotalError;
        }

        if (accountId) {
          const { data: relatedOrders, error: relatedOrdersError } = await supabase
            .from('orders')
            .select('*')
            .eq('account_id', accountId)
            .eq('user_id', user?.id)
            .in('status', ['pending', 'preparing', 'ready']);

          if (relatedOrdersError) throw relatedOrdersError;
          finalizedOrders = Array.isArray(relatedOrders) ? relatedOrders : [];
        }

        if (finalizedOrders.length > 0) {
          const relatedOrderIds = finalizedOrders.map((order) => order.id).filter(Boolean);
          const { error: batchUpdateError } = await supabase
            .from('orders')
            .update({
              payment_method: orderPaymentMethod,
              items: currentOrder.items,
              total: adjustedTotal,
              discount: checkoutDiscountValue,
              change_amount: cashPaymentTotal > 0 ? changeAmount : null,
              cash_register_session_id: openCashSession.id,
              status: 'completed',
              acceptance_status: 'accepted',
              updated_at: paymentTimestamp,
              variations: { financial_adjustments: financialAdjustments, payment_split: paymentSplitPayload },
            } as any)
            .in('id', relatedOrderIds);

          if (batchUpdateError) throw batchUpdateError;
        } else {
          const orderPayload = {
            user_id: user?.id,
            order_number: generateOrderNumber(),
            customer_name: currentOrder.customer_name || `Mesa ${table.table_number}`,
            customer_phone: currentOrder.customer_phone || null,
            table_id: table.id,
            items: currentOrder.items,
            total: adjustedTotal,
            discount: checkoutDiscountValue,
            order_type: 'dine_in',
            status: 'completed',
            acceptance_status: 'accepted',
            payment_method: orderPaymentMethod,
            change_amount: cashPaymentTotal > 0 ? changeAmount : null,
            cash_register_session_id: openCashSession.id,
            estimated_time: '15-20 min',
            session_id: currentOrder.session_id || null,
            account_id: accountId || null,
            variations: {
              source: 'table_account_closure',
              original_account_id: currentOrder.id,
              financial_adjustments: financialAdjustments,
              payment_split: paymentSplitPayload,
            },
          };

          const { data: createdOrder, error: orderInsertError } = await supabase
            .from('orders')
            .insert([orderPayload])
            .select()
            .single();

          if (orderInsertError) throw orderInsertError;
          finalizedOrders = createdOrder ? [createdOrder] : [];
        }

        if (currentOrder.session_id && accountId) {
          const { data: paymentRows, error: paymentRowsError } = await supabase
            .from('payments')
            .select('amount')
            .eq('session_id', currentOrder.session_id)
            .eq('account_id', accountId);

          if (paymentRowsError) throw paymentRowsError;

          const paidAmount = (paymentRows || []).reduce((sum: number, row: any) => sum + Number(row?.amount || 0), 0);
          const remainingAmount = Math.max(adjustedTotal - paidAmount, 0);

          if (remainingAmount > 0.009) {
            const paymentRowsToInsert = buildWaiterPaymentRows({
              sessionId: currentOrder.session_id,
              accountId,
              remainingAmount,
            });
            const { error: paymentInsertError } = await supabase
              .from('payments')
              .insert(paymentRowsToInsert as any);

            if (paymentInsertError) throw paymentInsertError;
          }
        }

        const nextAccountStatus = currentOrder.session_id ? 'paid' : 'closed';
        await finalizeAccountRecord(currentOrder.id, nextAccountStatus, paymentTimestamp);

        printableOrder = {
          ...(finalizedOrders[finalizedOrders.length - 1] || {}),
          id: finalizedOrders[finalizedOrders.length - 1]?.id || accountId,
          order_number: finalizedOrders[finalizedOrders.length - 1]?.order_number || currentOrder.order_number,
          customer_name: currentOrder.customer_name || `Mesa ${table.table_number}`,
          customer_phone: currentOrder.customer_phone || null,
          table_id: table.id,
          items: currentOrder.items,
          total: adjustedTotal,
          discount: checkoutDiscountValue,
          order_type: 'dine_in',
          status: 'completed',
          acceptance_status: 'accepted',
          payment_method: orderPaymentMethod,
          change_amount: cashPaymentTotal > 0 ? changeAmount : null,
          variations: {
            ...((finalizedOrders[finalizedOrders.length - 1] as any)?.variations || {}),
            financial_adjustments: financialAdjustments,
            payment_split: paymentSplitPayload,
          },
          created_at: currentOrder.created_at,
        };
      } else {
        const { data: updatedOrder, error: orderUpdateError } = await supabase
            .from('orders')
            .update({
            payment_method: orderPaymentMethod,
            total: adjustedTotal,
            discount: checkoutDiscountValue,
            change_amount: cashPaymentTotal > 0 ? changeAmount : null,
            cash_register_session_id: openCashSession.id,
            status: 'completed',
            acceptance_status: 'accepted',
            updated_at: paymentTimestamp,
            variations: { financial_adjustments: financialAdjustments, payment_split: paymentSplitPayload },
          } as any)
          .eq('id', currentOrder.id)
          .eq('user_id', user?.id)
          .select()
          .maybeSingle();

        if (orderUpdateError) throw orderUpdateError;
        if (!updatedOrder) throw new Error('Pedido da mesa não encontrado para finalização.');

        if ((updatedOrder as any).session_id && (updatedOrder as any).account_id) {
          const { data: paymentRows, error: paymentRowsError } = await supabase
            .from('payments')
            .select('amount')
            .eq('session_id', (updatedOrder as any).session_id)
            .eq('account_id', (updatedOrder as any).account_id);

          if (paymentRowsError) throw paymentRowsError;

          const paidAmount = (paymentRows || []).reduce((sum: number, row: any) => sum + Number(row?.amount || 0), 0);
          const remainingAmount = Math.max(adjustedTotal - paidAmount, 0);

          if (remainingAmount > 0.009) {
            const paymentRowsToInsert = buildWaiterPaymentRows({
              sessionId: (updatedOrder as any).session_id,
              accountId: (updatedOrder as any).account_id,
              remainingAmount,
            });
            const { error: paymentInsertError } = await supabase
              .from('payments')
              .insert(paymentRowsToInsert as any);

            if (paymentInsertError) throw paymentInsertError;
          }

          await finalizeAccountRecord((updatedOrder as any).account_id, 'paid', paymentTimestamp);
        }

        printableOrder = updatedOrder;

        try {
          await updateOrderStatusRemote(currentOrder.id, 'completed');
        } catch (statusError) {
          console.warn('Falha ao sincronizar status remoto do pedido da mesa:', statusError);
        }
      }

      let shouldFreeTable = true;
      const currentSessionId = currentOrder.session_id || printableOrder?.session_id || null;

      if (currentSessionId) {
        const { data: remainingAccounts, error: remainingAccountsError } = await supabase
          .from('table_accounts')
          .select('id, status')
          .eq('session_id', currentSessionId)
          .neq('id', currentOrder.account_id || currentOrder.id)
          .in('status', ['open', 'payment_pending']);

        if (remainingAccountsError) throw remainingAccountsError;
        shouldFreeTable = (remainingAccounts || []).length === 0;

        if (shouldFreeTable) {
          const { error: sessionCloseError } = await supabase
            .from('table_sessions')
            .update({
              status: 'closed',
              closed_at: paymentTimestamp
            } as any)
            .eq('id', currentSessionId)
            .eq('user_id', user?.id);

          if (sessionCloseError) throw sessionCloseError;
        }
      }

      const { error: tableError } = await supabase
        .from('tables')
        .update({ status: shouldFreeTable ? 'available' : 'occupied' })
        .eq('id', table.id);

      if (tableError) throw tableError;

      if (printableOrder) {
        let orderToPrint = printableOrder;
        const fiscalActive = await isFiscalEmissionActiveForUser(user?.id);

        if (fiscalActive) {
          try {
            toast({
              title: 'Emitindo NFC-e',
              description: 'Fiscal ativo: gerando o cupom fiscal da mesa.',
            });
            const nfceData = await emitNfceForOrder(printableOrder, printableOrder.customer_name ? { nome: printableOrder.customer_name } : null);
            orderToPrint = { ...printableOrder, nfce: nfceData };
          } catch (fiscalError) {
            console.error('Falha ao emitir NFC-e da mesa:', fiscalError);
            toast({
              title: 'Mesa fechada, mas a NFC-e falhou',
              description: fiscalError instanceof Error ? fiscalError.message : 'Nao foi possivel emitir a NFC-e da mesa.',
              variant: 'destructive'
            });
          }
        }

        try {
          await PrinterService.printOrder(orderToPrint);
        } catch (printError) {
          console.warn('Falha ao imprimir cupom da mesa:', printError);
          toast({
            title: 'Conta encerrada',
            description: `Mesa ${table.table_number} fechada, mas o cupom não foi impresso automaticamente.`,
            variant: 'destructive'
          });
        }

        const drawerResult = await PrinterService.openCashDrawer();
        if (!drawerResult?.success) {
          console.warn('Falha ao abrir gaveta no fechamento da mesa:', drawerResult?.error || drawerResult);
        }
      }

      toast({
        title: "Conta encerrada",
        description: `Mesa ${table.table_number} fechada com pagamento em ${paymentSummaryLabel}.`,
      });

      onRefresh();
      setCheckoutOpen(false);
      onClose();
    } catch (error) {
      console.error('Erro ao finalizar pedido:', error);
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Não foi possível finalizar o pedido.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'preparing':
        return 'bg-blue-100 text-blue-800';
      case 'ready':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Pendente';
      case 'preparing':
        return 'Preparando';
      case 'ready':
        return 'Pronto';
      case 'open':
        return 'Aberta';
      default:
        return status;
    }
  };

  if (!table) return null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) {
          setCheckoutOpen(false);
          onClose();
        }
      }}>
      <DialogContent className="max-w-4xl max-h-[calc(100vh-1rem)] overflow-y-auto p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users size={20} />
            Mesa {table.table_number}
            {table.location && ` - ${table.location}`}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-sm text-gray-600">Carregando...</p>
          </div>
        ) : currentOrder ? (
          <div className="space-y-6">
            {/* Informações do Pedido */}
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg">Pedido {currentOrder.order_number}</CardTitle>
                  <Badge className={getStatusColor(currentOrder.status)}>
                    {getStatusLabel(currentOrder.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-600">Cliente</p>
                    <p className="font-medium">{currentOrder.customer_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Telefone</p>
                    <p className="font-medium">{currentOrder.customer_phone || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Horário</p>
                    <p className="font-medium flex items-center gap-1">
                      <Clock size={14} />
                      {new Date(currentOrder.created_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Capacidade da Mesa</p>
                    <p className="font-medium">{table.capacity} pessoas</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Itens do Pedido */}
            <Card>
              <CardHeader>
                <CardTitle>Itens do Pedido</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {currentOrder.items.map((item, index) => (
                    <div key={index} className="border-b pb-3 last:border-b-0">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1">
                          <p className="font-medium">
                            {item.quantity}x {item.product_name}
                          </p>
                          {item.options && item.options.length > 0 && (
                            <div className="mt-1 ml-4">
                              {item.options.map((option, optIndex) => (
                                <p key={optIndex} className="text-sm text-gray-600">
                                  • {option}
                                </p>
                              ))}
                            </div>
                          )}
                          {item.notes && (
                            <p className="text-sm text-gray-600 italic mt-1 ml-4">
                              Obs: {item.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-start gap-2 text-right">
                          <div>
                          <p className="font-medium">{formatCurrency(item.subtotal)}</p>
                          <p className="text-sm text-gray-600">
                            {formatCurrency(item.price)} cada
                          </p>
                          </div>
                          {currentOrder.source === 'table_accounts' && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                              title="Cancelar item com autorização"
                              onClick={() => {
                                setItemToCancel(index);
                                setCancelItemReason('');
                                setCancelItemOpen(true);
                              }}
                            >
                              <Trash2 size={16} />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                <Separator className="my-4" />
                
                <div className="flex justify-between items-center font-bold text-lg">
                  <span>Total:</span>
                  <span>{formatCurrency(checkoutTotal)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Ações */}
            <Card className="border-amber-200 bg-amber-50/70">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-bold text-amber-950">
                    <UserRoundCheck size={18} />
                    Registrar em contas a receber?
                  </div>
                  <p className="mt-1 text-sm text-amber-800">
                    Registre o responsável, preserve os itens e libere a mesa sem apagar a movimentação.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                  onClick={() => setStaffConsumptionOpen(true)}
                >
                  Lançar para funcionário
                </Button>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(340px,1.2fr)]">
              {/* Transferir Mesa */}
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowRightLeft size={16} />
                    Transferir Mesa
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Select value={selectedTransferTable} onValueChange={setSelectedTransferTable}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar mesa" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTables
                          .filter(t => t.id !== table.id && t.status === 'available')
                          .map(t => (
                            <SelectItem key={t.id} value={t.id}>
                              Mesa {t.table_number}
                              {t.location && ` - ${t.location}`}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleTransferTable}
                      disabled={!selectedTransferTable || loading}
                      className="w-full"
                      size="sm"
                    >
                      Transferir
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Imprimir Parcial */}
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Printer size={16} />
                    Imprimir
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={handlePrintPartial}
                    variant="outline"
                    className="w-full"
                    size="sm"
                  >
                    Comanda Parcial
                  </Button>
                </CardContent>
              </Card>

              {/* Fechamento */}
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <WalletCards size={16} />
                    Fechar Conta
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border bg-slate-50 p-4">
                    <div className="flex items-center justify-between text-sm text-slate-500">
                      <span>Total para receber</span>
                      <ReceiptText size={14} />
                    </div>
                    <div className="mt-2 break-words text-2xl font-bold text-slate-900">{formatCurrency(checkoutTotal)}</div>
                    {(checkoutDiscountValue > 0 || checkoutSurchargeValue > 0) && (
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Subtotal</span>
                          <span>{formatCurrency(currentOrder.total)}</span>
                        </div>
                        {checkoutDiscountValue > 0 && (
                          <div className="flex justify-between text-red-600">
                            <span>Desconto</span>
                            <span>-{formatCurrency(checkoutDiscountValue)}</span>
                          </div>
                        )}
                        {checkoutSurchargeValue > 0 && (
                          <div className="flex justify-between text-emerald-700">
                            <span>Acréscimo</span>
                            <span>{formatCurrency(checkoutSurchargeValue)}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {serviceChargeAmount > 0 && (
                      <div className="mt-2 flex justify-between border-t pt-2 text-xs font-semibold text-amber-700">
                        <span>10% do garçom</span>
                        <span>{formatCurrency(serviceChargeAmount)}</span>
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={() => setCheckoutOpen(true)}
                    disabled={loading}
                    className="w-full whitespace-normal break-words px-4 py-3 text-center leading-tight bg-emerald-600 hover:bg-emerald-700"
                    size="default"
                  >
                    Finalizar conta
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">Esta mesa não possui pedidos ativos.</p>
            <Button onClick={onClose} variant="outline">
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
      </Dialog>

      <Dialog open={staffConsumptionOpen} onOpenChange={setStaffConsumptionOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar consumo de funcionário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              A conta de {formatCurrency(currentOrder?.total || 0)} será preservada e a Mesa {table.table_number} ficará livre.
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-employee-name">Funcionário responsável</Label>
              <Input
                id="staff-employee-name"
                value={staffEmployeeName}
                onChange={(event) => setStaffEmployeeName(event.target.value)}
                placeholder="Ex.: João da cozinha"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-due-date">Data combinada para pagamento (opcional)</Label>
              <Input
                id="staff-due-date"
                type="date"
                value={staffDueDate}
                onChange={(event) => setStaffDueDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-notes">Observação (opcional)</Label>
              <Textarea
                id="staff-notes"
                value={staffNotes}
                onChange={(event) => setStaffNotes(event.target.value)}
                placeholder="Ex.: descontar no pagamento do dia 30"
                rows={3}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setStaffConsumptionOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void requestDeferToStaff()} disabled={loading || !staffEmployeeName.trim()}>
                Registrar e liberar mesa
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelItemOpen} onOpenChange={(open) => {
        setCancelItemOpen(open);
        if (!open) {
          setItemToCancel(null);
          setCancelItemReason('');
        }
      }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar item da mesa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              O item deixará de compor o total, mas continuará registrado no histórico de cancelamentos.
            </div>
            <div className="space-y-2">
              <Label htmlFor="cancel-item-reason">Motivo obrigatório</Label>
              <Textarea
                id="cancel-item-reason"
                value={cancelItemReason}
                onChange={(event) => setCancelItemReason(event.target.value)}
                placeholder="Ex.: cliente desistiu antes do preparo"
                rows={3}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCancelItemOpen(false)}>Voltar</Button>
              <Button variant="destructive" disabled={loading || !cancelItemReason.trim()} onClick={() => void requestCancelItem()}>
                Autorizar cancelamento
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AdminPinDialog
        open={adminAction !== null}
        title="Autorização do administrador"
        description={adminAction === 'cancel-item'
          ? 'Digite o PIN master para cancelar o item e registrar a auditoria.'
          : 'Digite o PIN master para transferir a conta ao funcionário e liberar a mesa.'}
        confirmLabel="Autorizar"
        onCancel={() => setAdminAction(null)}
        onConfirm={async (pin) => {
          if (!user?.id) return;
          const authorization = await verifyAdminPin({ restaurantUserId: user.id, pin });
          if (!authorization.ok || !authorization.waiterId) {
            toast({ title: 'Sem permissão', description: 'PIN inválido ou o operador não é administrador.', variant: 'destructive' });
            return;
          }
          const action = adminAction;
          setAdminAction(null);
          if (action === 'defer-staff') await executeDeferToStaff(authorization.waiterId);
          if (action === 'cancel-item' && itemToCancel !== null) await executeCancelItem(itemToCancel, authorization.waiterId);
        }}
      />

      <CheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        title="Fechar mesa"
        subtitle={`Mesa ${table.table_number} • ${currentOrder?.items?.length || 0} item(ns)`}
        total={checkoutTotal}
        subtotal={currentOrder?.total || 0}
        discountValue={checkoutDiscount}
        surchargeValue={checkoutSurcharge}
        onDiscountChange={setCheckoutDiscount}
        onSurchargeChange={setCheckoutSurcharge}
        paymentMethod={paymentMethod}
        paymentAmounts={checkoutPaymentAmounts}
        cashReceived={checkoutCashReceived}
        onPaymentMethodChange={selectCheckoutPaymentMethod}
        onPaymentAmountChange={updateCheckoutPaymentAmount}
        onCashReceivedChange={updateCheckoutCashReceived}
        onClearSplit={clearCheckoutSplit}
        onConfirm={handleFinishOrder}
        processing={loading}
        modeVariant={checkoutSettings.mode}
        inlineContent={serviceChargeControl}
      />
    </>
  );
};

export default TableDetailsModal;
