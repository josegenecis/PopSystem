import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Filter, Eye, Check, Clock, Truck, Phone, MapPin, Copy, ExternalLink, QrCode, Printer, GripVertical, CalendarClock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useKitchenIntegration } from '@/hooks/useKitchenIntegration';
import OrderDetailsModal from '@/components/orders/OrderDetailsModal';
import OrdersBulkActionButton from '@/components/orders/OrdersBulkActionButton';
import PixPaymentModal from '@/components/payment/PixPaymentModal';
import WhatsAppOrderChat, { WhatsAppOrderButtonContent } from '@/components/orders/WhatsAppOrderChat';
import { useWhatsAppUnreadCounts } from '@/hooks/useWhatsAppUnreadCounts';
import { PrinterService } from '@/utils/printerService';
import { updateOrderStatus as updateOrderStatusRemote } from '@/utils/updateOrderStatus';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';
import AdminPinDialog from '@/components/security/AdminPinDialog';
import { canCancelOrder, getLocalOperatorSession } from '@/services/operatorAuth';
import { verifyAdminPin } from '@/services/adminPin';
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { formatPaymentMethodLabel } from '@/lib/orderDetails';
import { IfoodLogo } from '@/components/icons/IfoodLogo';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import PageContentSkeleton from '@/components/ui/page-content-skeleton';
import { isScheduledOrderReady } from '@/lib/orderScheduling';

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  customer_latitude?: number;
  customer_longitude?: number;
  customer_location_accuracy?: number;
  google_maps_link?: string;
  order_type: string;
  status: string;
  acceptance_status?: string;
  total: number;
  delivery_fee?: number;
  discount?: number;
  coupon_code?: string | null;
  payment_method: string;
  items: any[];
  created_at: string;
  estimated_time?: string;
  user_id?: string;
  source?: string;
  external_order_id?: string | null;
  customer_document?: string | null;
  pickup_code?: string | null;
  scheduled_at?: string | null;
  integration_payload?: any;
  variations?: any;
}

const isIfoodOrder = (order: Order) => {
  const providers = [
    order.source,
    order.integration_payload?.provider,
    order.integration_payload?.ifood?.provider,
    order.variations?.provider,
    order.variations?.source,
    order.variations?.ifood?.provider,
  ];

  return providers.some((provider) => String(provider || '').toLowerCase() === 'ifood');
};

const getOrderCardClass = (order: Order, baseClass: string) => (
  isIfoodOrder(order)
    ? `${baseClass} border-t-4 border-t-[#EA1D2C] border-l-[#EA1D2C] bg-gradient-to-br from-white via-white to-[#FFF1F2] ring-1 ring-[#EA1D2C]/15 shadow-[0_16px_32px_-24px_rgba(234,29,44,0.65)]`
    : baseClass
);

const IfoodOrderBadge = ({ order }: { order: Order }) => {
  if (!isIfoodOrder(order)) return null;

  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-[#EA1D2C] px-2.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white shadow-sm">
      <span>Pedido</span>
      <IfoodLogo className="h-4 w-auto" classNamePath="fill-white" />
    </span>
  );
};

const ScheduledOrderBadge = ({ order }: { order: Order }) => {
  if (!order.scheduled_at) return null;
  const scheduled = new Date(order.scheduled_at);
  if (!Number.isFinite(scheduled.getTime())) return null;
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-violet-100 px-2.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-violet-800">
      <CalendarClock className="h-3.5 w-3.5" />
      {scheduled.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} {scheduled.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
};

const isTableServiceOrder = (order: any) => {
  const orderType = String(order?.order_type || '').toLowerCase();
  const source = String(order?.variations?.source || order?.source || '').toLowerCase();
  return orderType === 'dine_in' && (Boolean(order?.table_id) || source.includes('table'));
};

const isPdvCounterOrder = (order: any) => {
  const source = String(order?.variations?.source || order?.source || '').toUpperCase();
  return order?.order_type === 'counter' && source === 'PDV';
};

const isHiddenTableServiceOrder = (order: any) => {
  const orderType = String(order?.order_type || '').toLowerCase();
  const flow = String(order?.variations?.table_order_flow || '').toLowerCase();
  const showInManager = order?.variations?.show_in_manager;
  return orderType === 'dine_in' && (flow === 'account_only' || showInManager === false);
};

const getAutoAcceptKey = (userId?: string) => `orders_auto_accept:${userId || 'local'}`;

const Orders = () => {
  const confirm = useConfirmDialog();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [whatsAppOrder, setWhatsAppOrder] = useState<Order | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [adminPinOpen, setAdminPinOpen] = useState(false);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [ifoodCancelDialogOpen, setIfoodCancelDialogOpen] = useState(false);
  const [ifoodCancelOrder, setIfoodCancelOrder] = useState<Order | null>(null);
  const [ifoodCancelReasons, setIfoodCancelReasons] = useState<Array<{ cancelCodeId: string; description: string }>>([]);
  const [selectedIfoodCancelCode, setSelectedIfoodCancelCode] = useState('');
  const [loadingIfoodCancelReasons, setLoadingIfoodCancelReasons] = useState(false);
  const [pixCancelOrder, setPixCancelOrder] = useState<Order | null>(null);
  const [pixCancelLoading, setPixCancelLoading] = useState(false);
  const [updatingOrderIds, setUpdatingOrderIds] = useState<Set<string>>(new Set());
  const [ordersView, setOrdersView] = useState<'list' | 'kanban'>('list');
  const [mobileStatusTab, setMobileStatusTab] = useState<'novos' | 'preparo' | 'entrega' | 'finalizados'>('novos');
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
  const [deliveryDialogTab, setDeliveryDialogTab] = useState<'in_delivery' | 'delivered'>('in_delivery');
  const [bulkFinalizing, setBulkFinalizing] = useState(false);
  const [requireDriver, setRequireDriver] = useState(false);
  const [payoutMode, setPayoutMode] = useState<'delivery_fee' | 'fixed'>('delivery_fee');
  const [fixedPayout, setFixedPayout] = useState(0);
  const [deliveryPersonnel, setDeliveryPersonnel] = useState<Array<{ id: string; name: string; status?: string; app_enabled?: boolean }>>([]);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignOrderIds, setAssignOrderIds] = useState<string[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [assigningDriver, setAssigningDriver] = useState(false);
  const [autoAcceptEnabled, setAutoAcceptEnabled] = useState(false);

  // PIX Modal State
  const [isPixModalOpen, setIsPixModalOpen] = useState(false);
  const [pixOrder, setPixOrder] = useState<Order | null>(null);

  const { user } = useAuth();
  const { toast } = useToast();
  const { sendToKitchen } = useKitchenIntegration();
  const { getUnread, refreshUnread } = useWhatsAppUnreadCounts(user?.id);
  const realtimeOkRef = useRef(false);
  const hasLoadedOrdersRef = useRef(false);

  const normalizeItems = (value: any) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const enrichOrder = (order: any): Order => {
    const variations = order?.variations && typeof order.variations === 'object' ? order.variations : {};
    const ifood = variations?.ifood && typeof variations.ifood === 'object' ? variations.ifood : {};
    const storedIntegration = order?.integration_payload && typeof order.integration_payload === 'object'
      ? order.integration_payload
      : {};
    const integrationPayload = {
      ...storedIntegration,
      ...variations,
      ifood: {
        ...(storedIntegration?.ifood || {}),
        ...ifood,
      },
    };

    return {
      ...order,
      items: normalizeItems(order?.items),
      source: order?.source || variations?.provider || null,
      external_order_id: order?.external_order_id || variations?.externalOrderId || ifood?.id || null,
      customer_document: order?.customer_document || variations?.customerDocument || null,
      pickup_code: order?.pickup_code || variations?.pickupCode || ifood?.pickupCode || null,
      scheduled_at: order?.scheduled_at || variations?.scheduledAt || ifood?.deliveryDateTimeStart || null,
      integration_payload: integrationPayload,
    } as Order;
  };

  useEffect(() => {
    if (user) {
      fetchOrders();

      let pollTimer: number | null = null;
      const startPolling = () => {
        if (pollTimer) return;
        pollTimer = window.setInterval(() => {
          if (document.visibilityState !== 'visible') return;
          if (realtimeOkRef.current) return;
          fetchOrders({ background: true });
        }, 3000);
      };

      const stopPolling = () => {
        if (!pollTimer) return;
        window.clearInterval(pollTimer);
        pollTimer = null;
      };

      const channel = supabase
        .channel(`orders-changes-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'orders',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            console.log('🔔 Novo pedido em tempo real:', payload);

            if (isPdvCounterOrder((payload as any)?.new) || isHiddenTableServiceOrder((payload as any)?.new)) return;

            // Add new order to the list
            const newOrder = enrichOrder((payload as any)?.new);

            setOrders(prev => (prev.some(o => o.id === newOrder.id) ? prev : [newOrder, ...prev]));

            // Play notification sound (handled by useOrderNotifications)
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'orders',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            console.log('🔄 Pedido atualizado em tempo real:', payload);

            if (isPdvCounterOrder((payload as any)?.new) || isHiddenTableServiceOrder((payload as any)?.new)) {
              setOrders(prev => prev.filter(order => order.id !== (payload as any)?.new?.id));
              return;
            }

            // Update order in the list
            setOrders(prev => prev.map(order =>
              order.id === payload.new.id
                ? enrichOrder((payload as any)?.new)
                : order
            ));
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            realtimeOkRef.current = true;
            stopPolling();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            realtimeOkRef.current = false;
            startPolling();
          }
        });

      startPolling();

      return () => {
        stopPolling();
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;
    setAutoAcceptEnabled(localStorage.getItem(getAutoAcceptKey(user.id)) === 'true');
  }, [user?.id]);

  const toggleAutoAccept = async () => {
    const next = !autoAcceptEnabled;
    if (!user?.id) return;

    if (next) {
      const { error } = await (supabase as any)
        .from('printer_settings')
        .upsert({
          user_id: user.id,
          auto_print: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) {
        console.error('Nao foi possivel ativar a impressao automatica:', error);
        toast({
          title: 'Não foi possível ligar o aceite automático',
          description: 'A impressão automática não pôde ser ativada. Tente novamente.',
          variant: 'destructive',
        });
        return;
      }
    }

    setAutoAcceptEnabled(next);
    localStorage.setItem(getAutoAcceptKey(user.id), String(next));
    window.dispatchEvent(new CustomEvent('orders-auto-accept-changed', { detail: { enabled: next } }));
    toast({
      title: next ? 'Aceite automático ligado' : 'Aceite automático desligado',
      description: next
        ? 'Novos pedidos serão aceitos, impressos e avisados automaticamente em qualquer tela.'
        : 'Novos pedidos voltarão a aguardar confirmação manual.',
    });
  };

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const settingsRes = await supabase
          .from('delivery_settlement_settings' as any)
          .select('require_driver,payout_mode,fixed_payout')
          .eq('user_id', user.id)
          .maybeSingle();

        const settings = (settingsRes as any)?.data;
        const err = (settingsRes as any)?.error;
        if (err) throw err;

        if (!settings) {
          await supabase.from('delivery_settlement_settings' as any).insert({
            user_id: user.id,
            require_driver: false,
            payout_mode: 'delivery_fee',
            fixed_payout: 0
          });
          setRequireDriver(false);
          setPayoutMode('delivery_fee');
          setFixedPayout(0);
        } else {
          setRequireDriver(Boolean(settings.require_driver));
          setPayoutMode(settings.payout_mode === 'fixed' ? 'fixed' : 'delivery_fee');
          setFixedPayout(Math.max(0, Number(settings.fixed_payout) || 0));
        }
      } catch {
        const fromStorage = (() => {
          try {
            return JSON.parse(localStorage.getItem('boracume_delivery_settings') || '{}');
          } catch {
            return {};
          }
        })();
        setRequireDriver(Boolean(fromStorage?.require_driver));
        setPayoutMode(fromStorage?.payout_mode === 'fixed' ? 'fixed' : 'delivery_fee');
        setFixedPayout(Math.max(0, Number(fromStorage?.fixed_payout) || 0));
      }

      try {
        const { data } = await supabase
          .from('delivery_personnel')
          .select('id,name,status,app_enabled')
          .eq('user_id', user.id)
          .order('name');
        setDeliveryPersonnel(((data as any[]) || []).map(d => ({ id: String(d.id), name: String(d.name), status: d.status, app_enabled: Boolean(d.app_enabled) })));
      } catch {
        setDeliveryPersonnel([]);
      }
    })();
  }, [user?.id]);

  useEffect(() => {
    filterOrders();
  }, [orders, searchQuery, statusFilter, typeFilter]);

  const fetchOrders = async (options: { background?: boolean } = {}) => {
    const showInitialLoading = !hasLoadedOrdersRef.current && !options.background;
    try {
      if (showInitialLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Transform the data to ensure items is always an array
      const transformedData = (data || [])
        .filter((order) => !isPdvCounterOrder(order) && !isHiddenTableServiceOrder(order))
        .map((order) => enrichOrder(order));

      setOrders(transformedData);
      hasLoadedOrdersRef.current = true;
    } catch (error) {
      console.error('Erro ao carregar pedidos:', error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os pedidos.",
        variant: "destructive"
      });
    } finally {
      if (showInitialLoading) setLoading(false);
      setRefreshing(false);
    }
  };


  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copiado!",
        description: "Localização copiada para a área de transferência",
      });
    } catch (err) {
      console.error('Erro ao copiar:', err);
    }
  };

  const copyLocation = async (order: Order) => {
    if (order.customer_latitude && order.customer_longitude) {
      const coordinates = `${order.customer_latitude},${order.customer_longitude}`;
      await copyToClipboard(coordinates);
    } else if (order.customer_address) {
      await copyToClipboard(order.customer_address);
    }
  };

  const openOrderDetails = (order: Order) => {

    console.log('🔍 ORDERS - Abrindo detalhes do pedido:', {
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: order.customer_name,
      status: order.status,
      items: order.items?.length || 0,
      timestamp: new Date().toISOString()
    });

    try {
      console.log('🔍 ORDERS - Dados completos do pedido:', JSON.stringify(order, null, 2));

      setSelectedOrder(order);
      setIsDetailsModalOpen(true);

      console.log('✅ ORDERS - Modal configurado para abrir:', {
        selectedOrderSet: !!order,
        modalOpen: true
      });
    } catch (error) {
      console.error('❌ ORDERS - Erro ao abrir detalhes do pedido:', error);
      toast({
        title: "Erro",
        description: "Erro ao abrir detalhes do pedido. Tente novamente.",
        variant: "destructive"
      });
    }

  };

  const filterOrders = () => {
    let filtered = orders;

    if (searchQuery) {
      filtered = filtered.filter(order =>
        order.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (order.customer_phone && order.customer_phone.includes(searchQuery))
      );
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'delivered') {
        filtered = filtered.filter(order => order.status === 'delivered' || order.status === 'completed');
      } else {
        filtered = filtered.filter(order => order.status === statusFilter);
      }
    }

    if (typeFilter !== 'all') {
      filtered = filtered.filter(order => order.order_type === typeFilter);
    }

    setFilteredOrders(filtered);
  };

  const updateOrderStatus = async (
    orderId: string,
    newStatus: string,
    options?: {
      ifoodCancellationCode?: string;
      ifoodCancellationReason?: string;
      silent?: boolean;
    }
  ) => {
    let optimisticOrderSnapshot: Order | null = null;
    setUpdatingOrderIds(prev => new Set([...prev, orderId]));
    try {

      console.log('🔄 Iniciando atualização do status do pedido:', { orderId, newStatus });

      // Validações iniciais
      if (!orderId || typeof orderId !== 'string') {
        throw new Error('ID do pedido é obrigatório e deve ser uma string válida');
      }

      if (!newStatus || typeof newStatus !== 'string') {
        throw new Error('Novo status é obrigatório e deve ser uma string válida');
      }

      // Verificar se o usuário está logado
      if (!user?.id) {
        console.error('❌ Usuário não está logado');
        throw new Error('Usuário não está logado. Faça login novamente.');
      }

      console.log('✅ Usuário autenticado:', { userId: user.id, email: user.email });

      // Verificar se o pedido existe no estado local
      const existingOrder = orders.find(o => o.id === orderId);
      if (!existingOrder) {
        console.error('❌ Pedido não encontrado no estado local:', orderId);
        throw new Error(`Pedido com ID ${orderId} não encontrado`);
      }

      console.log('📋 Pedido encontrado:', {
        id: existingOrder.id,
        order_number: existingOrder.order_number,
        current_status: existingOrder.status,
        current_acceptance_status: existingOrder.acceptance_status
      });

      // Verificar se a mudança de status é válida
      const validStatuses = ['pending', 'preparing', 'ready', 'in_delivery', 'delivered', 'cancelled', 'completed'];
      if (!validStatuses.includes(newStatus)) {
        throw new Error(`Status '${newStatus}' não é válido. Status válidos: ${validStatuses.join(', ')}`);
      }


      // Atualizar tanto status quanto acceptance_status
      const updateData = newStatus === 'preparing'
        ? { status: newStatus, acceptance_status: 'accepted' }
        : newStatus === 'cancelled'
          ? { status: newStatus, acceptance_status: 'rejected' }
          : { status: newStatus };

      optimisticOrderSnapshot = existingOrder;
      setOrders(prev => prev.map(order =>
        order.id === orderId
          ? { ...order, ...updateData }
          : order
      ));

      console.log('📝 Dados para update:', updateData);


      console.log('🔄 Executando update no Supabase...');

      let data: any = null;
      let error: any = null;

      try {
        data = await updateOrderStatusRemote(orderId, newStatus, options);
      } catch (e: any) {
        error = e;
      }

      if (error) {
        console.error('❌ Erro detalhado do Supabase:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          orderId,
          userId: user?.id,
          updateData
        });

        // Mensagens de erro mais específicas
        let errorMessage = 'Erro desconhecido ao atualizar pedido';

        if (error.code === 'PGRST116') {
          errorMessage = 'Pedido não encontrado ou você não tem permissão para atualizá-lo';
        } else if (error.code === '42501') {
          errorMessage = 'Permissão negada. Verifique suas credenciais.';
        } else if (error.message.includes('connection') || error.message.includes('network')) {
          errorMessage = 'Erro de conexão com o banco de dados. Verifique sua internet e tente novamente.';
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Timeout na operação. Tente novamente em alguns segundos.';
        } else {
          errorMessage = `Erro do banco: ${error.message}`;
        }

        throw new Error(errorMessage);
      }

      if (!data) {
        console.error('❌ Nenhum dado retornado do update');
        throw new Error('Pedido não foi atualizado. Verifique se você tem permissão.');
      }

      console.log('✅ Status atualizado no banco de dados:', data);

      const operation = (data as any)?.__operation;
      if (operation?.deliveryOffer?.created) {
        toast({
          title: 'Entrega ofertada automaticamente',
          description: 'Os motoboys online já receberam o pedido no aplicativo.',
        });
      }
      if (operation?.whatsapp && !operation.whatsapp.ok && !operation.whatsapp.skipped) {
        const providerError = String(operation.whatsapp.error || '');
        toast({
          title: 'Status atualizado, mas o WhatsApp não foi entregue',
          description: providerError.includes('463')
            ? 'O provedor recusou o telefone do cliente. Confira se o número está correto e possui WhatsApp.'
            : 'Confira a conexão do WhatsApp e o telefone informado no pedido.',
          variant: 'destructive',
        });
      }

      setOrders(prev => prev.map(order =>
        order.id === orderId
          ? { ...order, ...updateData }
          : order
      ));

      // Buscar o pedido para enviar para KDS quando aceito
      const order = orders.find(o => o.id === orderId);

      // Se status mudou para 'preparing', enviar para KDS
      if (newStatus === 'preparing' && order) {
        if (!options?.silent) {
          toast({
            title: "Pedido aceito!",
            description: "Status atualizado com sucesso.",
          });
        }

        const orderData = {
          user_id: order.user_id || user?.id || '',
          order_number: order.order_number,
          customer_name: order.customer_name || 'Cliente não informado',
          customer_phone: order.customer_phone || '',
          items: order.items,
          total: order.total,
          payment_method: order.payment_method,
          order_type: order.order_type
        };

        sendToKitchen(orderData).catch(() => {
          toast({
            title: "Aviso",
            description: "Pedido aceito, mas não foi possível enviar para a cozinha.",
            variant: "destructive"
          });
        });

        try {
          const printResult = await PrinterService.printOrderOnAccept({
            ...order,
            ...data,
            user_id: order.user_id || user.id,
            items: normalizeItems((data as any)?.items ?? order.items),
          });
          if (!printResult?.success) {
            toast({
              title: 'Pedido aceito; impressão pendente',
              description: 'O PopSystem tentará imprimir novamente assim que o Pop Connect estiver disponível.',
              variant: 'destructive',
            });
          }
        } catch (printError) {
          console.error('Pedido aceito, mas a impressão ficou pendente:', printError);
          toast({
            title: 'Pedido aceito; impressão pendente',
            description: 'O PopSystem continuará tentando sem duplicar o pedido.',
            variant: 'destructive',
          });
        }

      } else {
        if (!options?.silent) {
          toast({
            title: "Status atualizado",
            description: `Status do pedido atualizado com sucesso.`,
          });
        }
      }

    } catch (error: any) {
      if (optimisticOrderSnapshot) {
        setOrders(prev => prev.map(order =>
          order.id === orderId ? optimisticOrderSnapshot as Order : order
        ));
      }

      console.error('❌ Erro completo ao atualizar status:', {
        error,
        message: error?.message,
        stack: error?.stack,
        orderId,
        newStatus
      });

      const errorMessage = error?.message || 'Erro desconhecido';

      toast({
        title: "Erro ao atualizar pedido",
        description: `Não foi possível atualizar o status: ${errorMessage}`,

        variant: "destructive"
      });

      if (
        String(errorMessage).includes('Permissão') ||
        String(errorMessage).includes('Pedido não encontrado') ||
        String(errorMessage).includes('RLS')
      ) {
        alert(
          `Não foi possível aceitar o pedido por permissão no banco.\n\n` +
            `A correção é aplicar as policies de UPDATE/SELECT na tabela orders.\n` +
            `Rode a migration: supabase/migrations/20260210152000_orders_rls_authenticated_policies.sql`
        );
      }
    } finally {
      setUpdatingOrderIds(prev => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  const requestCancelOrder = async (orderId: string) => {
    const order = orders.find((item) => item.id === orderId);
    if (!order) {
      toast({
        title: 'Pedido não encontrado',
        description: 'Não foi possível localizar o pedido para cancelamento.',
        variant: 'destructive'
      });
      return;
    }

    const confirmed = await confirm({
      title: 'Confirmar cancelamento do pedido',
      description: `Tem certeza de que deseja cancelar o pedido #${order.order_number || order.id}? Se houver documento fiscal autorizado, ele será cancelado primeiro e a venda só será alterada após a confirmação da SEFAZ.`,
      confirmText: 'Sim, cancelar pedido',
      cancelText: 'Voltar',
      variant: 'destructive',
    });
    if (!confirmed) return;

    const session = getLocalOperatorSession();
    if (canCancelOrder(session)) {
      await continueCancelOrder(order);
      return;
    }
    setPendingCancelId(orderId);
    setAdminPinOpen(true);
  };

  const continueCancelOrder = async (order: Order) => {
    if (order.source !== 'ifood' || !order.external_order_id) {
      if (String(order.payment_method || '').toLowerCase() === 'pix_online') {
        setPixCancelOrder(order);
        return;
      }
      await updateOrderStatus(order.id, 'cancelled');
      return;
    }

    try {
      setLoadingIfoodCancelReasons(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'cancellation_reasons',
        orderId: order.external_order_id,
      });

      if (status >= 400 || !data?.ok) {
        throw new Error(String(data?.message || data?.error || 'Falha ao consultar motivos do iFood'));
      }

      const reasons = (Array.isArray(data?.reasons) ? data.reasons : [])
        .map((reason: any) => ({
          cancelCodeId: String(reason?.cancelCodeId || reason?.cancellationCode || reason?.code || '').trim(),
          description: String(reason?.description || reason?.reason || reason?.label || '').trim(),
        }))
        .filter((reason: { cancelCodeId: string; description: string }) => reason.cancelCodeId);
      if (reasons.length === 0) {
        throw new Error('Este pedido não retornou motivos válidos de cancelamento no iFood.');
      }

      setIfoodCancelOrder(order);
      setIfoodCancelReasons(reasons);
      setSelectedIfoodCancelCode(String(reasons[0]?.cancelCodeId || ''));
      setIfoodCancelDialogOpen(true);
    } catch (error: any) {
      toast({
        title: 'Não foi possível cancelar',
        description: String(error?.message || error),
        variant: 'destructive',
      });
    } finally {
      setLoadingIfoodCancelReasons(false);
    }
  };

  const confirmPixCancellation = async (refundPix: boolean) => {
    if (!pixCancelOrder) return;
    const order = pixCancelOrder;
    setPixCancelLoading(true);
    try {
      let refundMessage = '';
      await updateOrderStatus(order.id, 'cancelled');
      if (refundPix) {
        const { data, status } = await invokeEdgeFunction('poppay-refund', {
          orderId: order.id,
          reason: 'Pedido cancelado pelo restaurante',
        }, { timeoutMs: 60000 });
        if (status >= 400 || !data?.ok) {
          throw new Error(String(data?.message || data?.error || 'O Mercado Pago não confirmou a devolução.'));
        }
        refundMessage = data?.status === 'in_process'
          ? ' O reembolso PIX está em processamento no Mercado Pago.'
          : ' O PIX foi devolvido para a conta pagadora.';
      }
      setPixCancelOrder(null);
      if (refundPix) {
        toast({ title: 'Pedido cancelado com devolução', description: `Venda ${order.order_number} cancelada.${refundMessage}` });
      }
    } catch (error: any) {
      toast({ title: 'Cancelamento não concluído', description: String(error?.message || error), variant: 'destructive' });
    } finally {
      setPixCancelLoading(false);
    }
  };

  const handleOrderStatusChange = async (orderId: string, newStatus: string) => {
    if (newStatus === 'cancelled') {
      await requestCancelOrder(orderId);
      return;
    }
    await updateOrderStatus(orderId, newStatus);
  };

  const updateOrderInDeliveryWithDriver = async (orderId: string, driverId: string) => {
    if (!user?.id) return;
    const order = orders.find(o => o.id === orderId);
    const payoutAmount =
      payoutMode === 'fixed'
        ? Math.max(0, Number(fixedPayout) || 0)
        : Math.max(0, Number((order as any)?.delivery_fee) || 0);
    try {
      await updateOrderStatus(orderId, 'in_delivery');

      const payload = {
        delivery_personnel_id: driverId,
        delivery_assigned_at: new Date().toISOString(),
        delivery_payout_amount: payoutAmount
      };
      const { data, error } = await supabase
        .from('orders' as any)
        .update(payload as any)
        .eq('id', orderId)
        .eq('user_id', user.id);
      if (error) throw error;
      if (data) {
        setOrders(prev => prev.map(o => (o.id === orderId ? { ...o, ...(payload as any) } : o)));
      }
    } catch (e: any) {
      const code = String(e?.code || '');
      const msg = String(e?.message || '');
      const isMissingColumn =
        code === '42703' ||
        code === 'PGRST204' ||
        msg.toLowerCase().includes('schema cache') ||
        msg.toLowerCase().includes('could not find the') ||
        msg.toLowerCase().includes('column') && msg.toLowerCase().includes('does not exist');

      if (isMissingColumn) {
        toast({
          title: 'Banco ainda não reconheceu as colunas',
          description: 'No Supabase, recarregue o Schema Cache (Database → API → Reload schema cache) e tente novamente.',
          variant: 'destructive'
        });
        throw e;
      }

      toast({
        title: 'Erro ao atribuir motoboy',
        description: msg || 'Não foi possível atualizar o pedido.',
        variant: 'destructive'
      });
      throw e;
    }
  };

  const requestInDelivery = async (orderIds: string[]) => {
    const deliveryOrderIds = orderIds.filter(id => {
      const o = orders.find(x => x.id === id);
      return String((o as any)?.order_type || '') === 'delivery';
    });
    const otherIds = orderIds.filter(id => !deliveryOrderIds.includes(id));

    if (otherIds.length > 0) {
      await Promise.all(otherIds.map(id => updateOrderStatus(id, 'in_delivery')));
    }

    if (deliveryOrderIds.length === 0) return;

    if (deliveryPersonnel.length === 0) {
      if (!requireDriver) {
        await Promise.all(deliveryOrderIds.map(id => updateOrderStatus(id, 'in_delivery')));
        return;
      }
      toast({
        title: 'Cadastre um motoboy',
        description: 'Para enviar para rota, cadastre pelo menos 1 entregador em Entregadores.',
        variant: 'destructive'
      });
      return;
    }

    setAssignOrderIds(deliveryOrderIds);
    setSelectedDriverId('');
    setAssignDialogOpen(true);
  };

  const offerOrdersToDriverApp = async () => {
    if (!user?.id || assignOrderIds.length === 0) return;
    const appDrivers = deliveryPersonnel.filter((driver) => driver.app_enabled);
    if (appDrivers.length === 0) {
      toast({ title: 'Nenhum motoboy com acesso ao app', description: 'Libere o aplicativo no cadastro do motoboy.', variant: 'destructive' });
      return;
    }
    setAssigningDriver(true);
    try {
      for (const orderId of assignOrderIds) {
        const order = orders.find((item) => item.id === orderId);
        const payoutAmount = payoutMode === 'fixed'
          ? Math.max(0, Number(fixedPayout) || 0)
          : Math.max(0, Number((order as any)?.delivery_fee) || 0);
        const { error } = await (supabase.from('delivery_offers' as any) as any).insert({
          restaurant_id: user.id,
          order_id: orderId,
          target_driver_id: selectedDriverId && appDrivers.some((driver) => driver.id === selectedDriverId) ? selectedDriverId : null,
          payout_amount: payoutAmount,
          status: 'open',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        });
        if (error) {
          if (String(error.code) === '23505') throw new Error('Este pedido já está sendo oferecido aos motoboys.');
          throw error;
        }
      }
      setAssignDialogOpen(false);
      setAssignOrderIds([]);
      setSelectedDriverId('');
      toast({ title: 'Oferta enviada', description: 'Os motoboys online receberão o card para aceitar a entrega.' });
    } catch (error: any) {
      toast({ title: 'Não foi possível ofertar', description: error?.message, variant: 'destructive' });
    } finally { setAssigningDriver(false); }
  };

  const onKanbanDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const orderId = result.draggableId;
    const dest = result.destination.droppableId;
    if (dest === result.source.droppableId) return;
    if (dest === 'pending') return;
    if (dest === 'cancelled') {
      await requestCancelOrder(orderId);
      return;
    }
    if (dest === 'in_delivery') {
      await requestInDelivery([orderId]);
      return;
    }
    await updateOrderStatus(orderId, dest);
  };

  const handleBulkAction = async (orderIds: string[], action: string) => {
    try {
      console.log(`🔄 Executando ação em massa: ${action} para ${orderIds.length} pedidos`);

      let updatePromises = [];

      switch (action) {
        case 'accept_all':
          // Aceitar todos os pedidos e enviar para KDS
          updatePromises = orderIds.map(async (orderId) => {
            await updateOrderStatus(orderId, 'preparing');
          });
          break;

        case 'ready_all':
          // Marcar todos como prontos
          updatePromises = orderIds.map(async (orderId) => {
            await updateOrderStatus(orderId, 'ready');
          });
          break;

        case 'deliver_all':
          // Saiu para entrega (todos os prontos)
          await requestInDelivery(orderIds);
          updatePromises = [];
          break;
      }

      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
      }
      console.log(`✅ Ação em massa ${action} concluída com sucesso`);

    } catch (error) {
      console.error('❌ Erro na ação em massa:', error);
      throw error;
    }
  };

  const finalizeAllInDelivery = async () => {
    if (inDeliveryOrders.length === 0) return;
    try {
      setBulkFinalizing(true);
      await Promise.all(inDeliveryOrders.map((o) => updateOrderStatus(o.id, 'delivered')));
      setDeliveryDialogTab('delivered');
      toast({ title: 'Finalizado', description: 'Todos os pedidos em entrega foram finalizados.' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || 'Não foi possível finalizar todos.', variant: 'destructive' });
    } finally {
      setBulkFinalizing(false);
    }
  };

  const handlePixPayment = (order: Order) => {
    setPixOrder(order);
    setIsPixModalOpen(true);
  };

  const handleWhatsAppShare = (order: Order) => {
    if (!order.customer_phone) {
      toast({ title: 'Cliente sem WhatsApp', description: 'Este pedido não possui telefone para iniciar a conversa.', variant: 'destructive' });
      return;
    }
    setWhatsAppOrder(order);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { label: 'Pendente', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
      accepted: { label: 'Preparando', className: 'bg-blue-100 text-blue-800 border-blue-200' },
      preparing: { label: 'Preparando', className: 'bg-blue-100 text-blue-800 border-blue-200' },
      ready: { label: 'Pronto', className: 'bg-green-100 text-green-800 border-green-200' },
      in_delivery: { label: 'Saiu para entrega', className: 'bg-purple-100 text-purple-800 border-purple-200' },
      delivered: { label: 'Finalizado', className: 'bg-gray-100 text-gray-800 border-gray-200' },
      completed: { label: 'Finalizado', className: 'bg-gray-100 text-gray-800 border-gray-200' },
      cancelled: { label: 'Cancelado', className: 'bg-red-100 text-red-800 border-red-200' }
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;

    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const getOrderStatusBadge = (order: Order) => {
    if (isTableServiceOrder(order)) {
      if (order.status === 'in_delivery') {
        return <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200">Levou para mesa</Badge>;
      }
      if (order.status === 'delivered' || order.status === 'completed') {
        return <Badge variant="outline" className="bg-gray-100 text-gray-800 border-gray-200">Mesa atendida</Badge>;
      }
    }
    return getStatusBadge(order.status);
  };

  const getOrderTypeIcon = (type: string) => {
    switch (type) {
      case 'delivery':
        return <Truck size={16} className="text-blue-600" />;
      case 'pickup':
        return <Clock size={16} className="text-green-600" />;
      case 'dine_in':
        return <div className="w-4 h-4 bg-orange-600 rounded-sm" />;
      default:
        return null;
    }
  };

  const getOrderTypeLabel = (type: string) => {
    switch (type) {
      case 'delivery':
        return 'Entrega';
      case 'pickup':
        return 'Retirada';
      case 'dine_in':
        return 'No Local';
      default:
        return type;
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('pt-BR');
  };

  const getMobilePrimaryAction = (order: Order) => {
    if (order.status === 'pending') return { label: 'Aceitar', status: 'preparing', className: 'bg-[#8CC850] text-[#003223] hover:bg-[#79b541]' };
    if (order.status === 'accepted' || order.status === 'preparing') return { label: 'Marcar pronto', status: 'ready', className: 'bg-[#003223] text-white hover:bg-[#0a4a34]' };
    if (order.status === 'ready') {
      if (order.order_type === 'delivery') return { label: 'Saiu para entrega', status: 'in_delivery', className: 'bg-[#FF6400] text-white hover:bg-[#E85C00]' };
      if (isTableServiceOrder(order)) return { label: 'Levou para mesa', status: 'delivered', className: 'bg-[#003223] text-white hover:bg-[#0a4a34]' };
      return { label: 'Finalizar', status: 'delivered', className: 'bg-[#003223] text-white hover:bg-[#0a4a34]' };
    }
    if (order.status === 'in_delivery') return { label: 'Finalizar', status: 'delivered', className: 'bg-[#003223] text-white hover:bg-[#0a4a34]' };
    return null;
  };

  const renderMobileOrderCard = (order: Order) => {
    const primaryAction = getMobilePrimaryAction(order);

    return (
      <Card key={order.id} className={getOrderCardClass(order, 'overflow-hidden rounded-[18px] border border-[#FF6400]/12 bg-white/95 shadow-[0_18px_30px_-30px_rgba(0,50,35,0.18)]')}>
        <CardContent className="p-2.5">
          <div className="space-y-2">
            <button type="button" className="w-full text-left" onClick={() => openOrderDetails(order)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[14px] font-bold text-slate-900">Pedido {order.order_number}</div>
                    <IfoodOrderBadge order={order} />
                    <ScheduledOrderBadge order={order} />
                  </div>
                  <div className="mt-0.5 text-[12px] font-medium text-slate-700">{order.customer_name}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      {getOrderTypeIcon(order.order_type)}
                      {getOrderTypeLabel(order.order_type)}
                    </span>
                    <span>•</span>
                    <span>{new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {getOrderStatusBadge(order)}
                  <div className="text-[12px] font-bold text-slate-900">{formatCurrency(order.total)}</div>
                </div>
              </div>
            </button>

            <div className="grid grid-cols-3 gap-1 rounded-[16px] border border-[#FF6400]/10 bg-[#FFF8F2]/75 p-1.5">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Itens</div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-900">{order.items.length} item(s)</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Pagamento</div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-900">{formatPaymentMethodLabel(order.payment_method, order.acceptance_status)}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tipo</div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-900">{getOrderTypeLabel(order.order_type)}</div>
              </div>
            </div>

            {order.customer_address && (
              <div className="rounded-[18px] border border-[#003223]/8 bg-white p-2.5">
                <div className="flex items-start gap-2 text-[13px] text-slate-600">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6400]" />
                  <span>{order.customer_address}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    className="h-8 flex-1 rounded-2xl border-[#003223]/10 bg-white text-[11px] text-[#003223] hover:bg-[#F5EBE1]"
                    onClick={() => copyLocation(order)}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copiar
                  </Button>
                  {order.google_maps_link && (
                    <Button
                      variant="outline"
                      className="h-8 flex-1 rounded-2xl border-[#003223]/10 bg-white text-[11px] text-[#003223] hover:bg-[#F5EBE1]"
                      onClick={() => window.open(order.google_maps_link, '_blank')}
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Maps
                    </Button>
                  )}
                </div>
              </div>
            )}

            {primaryAction && (
              <Button
                className={`h-10 rounded-2xl text-[12px] font-semibold ${primaryAction.className}`}
                onClick={() => updateOrderStatus(order.id, primaryAction.status)}
                disabled={updatingOrderIds.has(order.id)}
              >
                {updatingOrderIds.has(order.id) ? 'Atualizando...' : primaryAction.label}
              </Button>
            )}

            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" className="h-9 rounded-2xl border-[#003223]/10 bg-white px-2 text-[11px] text-[#003223] hover:bg-[#F5EBE1]" onClick={() => openOrderDetails(order)}>
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Ver
              </Button>
              <Button variant="outline" className="h-9 rounded-2xl border-[#25d366]/35 bg-[#effcf3] px-2 text-[11px] font-semibold text-[#075e54] hover:bg-[#dcf8e5]" onClick={() => handleWhatsAppShare(order)}>
                <WhatsAppOrderButtonContent unread={getUnread(order.customer_phone)} compact />
              </Button>
              <Button variant="outline" className="h-9 rounded-2xl border-[#003223]/10 bg-white px-2 text-[11px] text-[#003223] hover:bg-[#F5EBE1]" onClick={() => PrinterService.printOrder(order)}>
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                Imprimir
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {!['cancelled', 'delivered', 'completed'].includes(order.status) && (
                <Button variant="outline" className="h-9 rounded-2xl border-red-200 bg-white text-[11px] text-red-500 hover:bg-red-50" onClick={() => requestCancelOrder(order.id)}>
                  Cancelar pedido
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const pendingOrders = filteredOrders.filter(order => order.acceptance_status === 'pending_acceptance' || order.status === 'pending');
  const actionablePendingOrders = pendingOrders.filter((order) => isScheduledOrderReady(order));
  const activeOrders = filteredOrders.filter(order => order.status === 'accepted' || order.status === 'preparing');
  const completedOrders = filteredOrders.filter(order => order.status === 'ready' || order.status === 'in_delivery');
  const inDeliveryOrders = filteredOrders.filter(order => order.status === 'in_delivery');
  const deliveredOrders = filteredOrders.filter(order => order.status === 'delivered' || order.status === 'completed');
  const cancelledOrders = filteredOrders.filter(order => order.status === 'cancelled');
  const mobileTypeFilters = [
    { value: 'all', label: 'Todos' },
    { value: 'delivery', label: 'Entrega' },
    { value: 'pickup', label: 'Retirada' },
    { value: 'dine_in', label: 'Salão' },
  ];
  const mobileBulkActionConfig =
    mobileStatusTab === 'novos'
      ? { action: 'accept_all' as const, orderIds: actionablePendingOrders.map((order) => order.id), label: 'Aceitar fila' }
      : mobileStatusTab === 'preparo'
        ? { action: 'ready_all' as const, orderIds: activeOrders.map((order) => order.id), label: 'Marcar prontos' }
        : mobileStatusTab === 'entrega'
          ? { action: 'deliver_all' as const, orderIds: completedOrders.map((order) => order.id), label: 'Enviar para entrega' }
          : null;

  if (loading) {
    return <PageContentSkeleton />;
  }

  return (
    <div className="h-full overflow-y-auto pb-6">
      <div className="space-y-6">
        <AdminPinDialog
          open={adminPinOpen}
          title="Cancelar pedido"
          description="Somente administrador pode cancelar. Digite o PIN do administrador."
          confirmLabel="Cancelar"
          onCancel={() => { setAdminPinOpen(false); setPendingCancelId(null); }}
          onConfirm={async (pin) => {
            const restaurantUserId = user?.id || '';
            if (!restaurantUserId) {
              toast({ title: 'Erro', description: 'Usuário não autenticado', variant: 'destructive' });
              return;
            }
            const res = await verifyAdminPin({ restaurantUserId, pin });
            if (!res.ok) {
              toast({ title: 'Sem permissão', description: 'PIN inválido ou não é administrador', variant: 'destructive' });
              return;
            }
            if (pendingCancelId) {
              const order = orders.find((item) => item.id === pendingCancelId);
              if (order) {
                void continueCancelOrder(order);
              }
            }
            setAdminPinOpen(false);
            setPendingCancelId(null);
          }}
        />
        <Dialog open={Boolean(pixCancelOrder)} onOpenChange={(open) => { if (!open && !pixCancelLoading) setPixCancelOrder(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar pedido pago via PIX</DialogTitle>
              <DialogDescription>
                O pedido {pixCancelOrder?.order_number ? `#${pixCancelOrder.order_number}` : ''} já foi pago. Escolha se deseja apenas cancelar a operação ou também devolver {Number(pixCancelOrder?.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para a conta pagadora.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              A devolução será solicitada ao Mercado Pago e poderá ficar em processamento bancário.
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="outline" onClick={() => void confirmPixCancellation(false)} disabled={pixCancelLoading}>Cancelar sem devolver</Button>
              <Button variant="destructive" onClick={() => void confirmPixCancellation(true)} disabled={pixCancelLoading}>
                {pixCancelLoading ? 'Processando...' : 'Cancelar e devolver PIX'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={ifoodCancelDialogOpen} onOpenChange={(open) => {
          if (!loadingIfoodCancelReasons) {
            setIfoodCancelDialogOpen(open);
            if (!open) {
              setIfoodCancelOrder(null);
              setIfoodCancelReasons([]);
              setSelectedIfoodCancelCode('');
            }
          }
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar pedido iFood</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                O iFood exige que o operador escolha um motivo válido de cancelamento para este pedido.
              </p>
              <div className="space-y-2">
                <div className="text-sm font-medium">Motivo disponível agora</div>
                <Select value={selectedIfoodCancelCode} onValueChange={setSelectedIfoodCancelCode}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    {ifoodCancelReasons.map((reason) => (
                      <SelectItem key={reason.cancelCodeId} value={String(reason.cancelCodeId)}>
                        {reason.cancelCodeId} · {reason.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIfoodCancelDialogOpen(false);
                    setIfoodCancelOrder(null);
                    setIfoodCancelReasons([]);
                    setSelectedIfoodCancelCode('');
                  }}
                >
                  Fechar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!ifoodCancelOrder || !selectedIfoodCancelCode}
                  onClick={async () => {
                    const selectedReason = ifoodCancelReasons.find(
                      (reason) => String(reason.cancelCodeId) === String(selectedIfoodCancelCode)
                    );
                    if (!ifoodCancelOrder || !selectedReason) return;

                    await updateOrderStatus(ifoodCancelOrder.id, 'cancelled', {
                      ifoodCancellationCode: String(selectedReason.cancelCodeId),
                      ifoodCancellationReason: String(selectedReason.description || ''),
                    });

                    setIfoodCancelDialogOpen(false);
                    setIfoodCancelOrder(null);
                    setIfoodCancelReasons([]);
                    setSelectedIfoodCancelCode('');
                  }}
                >
                  Cancelar no iFood
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={deliveryDialogOpen} onOpenChange={setDeliveryDialogOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Entregas e Despachados</DialogTitle>
            </DialogHeader>
            <Tabs value={deliveryDialogTab} onValueChange={(v) => setDeliveryDialogTab(v as any)}>
              <TabsList>
                <TabsTrigger value="in_delivery">Saiu para entrega ({inDeliveryOrders.length})</TabsTrigger>
                <TabsTrigger value="delivered">Despachados ({deliveredOrders.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="in_delivery" className="mt-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="text-sm text-muted-foreground">Pedidos que saíram para entrega</div>
                  <Button onClick={finalizeAllInDelivery} disabled={bulkFinalizing || inDeliveryOrders.length === 0}>
                    Finalizar todos
                  </Button>
                </div>
                <div className="max-h-[65vh] overflow-y-auto space-y-3 pr-1">
                  {inDeliveryOrders.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-8 text-center">Nenhum pedido em entrega</div>
                  ) : (
                    inDeliveryOrders.map((order) => (
                      <Card key={order.id} className={getOrderCardClass(order, 'overflow-hidden border-l-4 border-l-purple-500')}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-semibold">Pedido {order.order_number}</div>
                                <IfoodOrderBadge order={order} />
                                <ScheduledOrderBadge order={order} />
                              </div>
                              <div className="text-sm text-muted-foreground truncate">{order.customer_name}</div>
                              <div className="text-sm text-muted-foreground">{formatCurrency(order.total)}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => updateOrderStatus(order.id, 'preparing')}
                              >
                                Voltar produção
                              </Button>
                              <Button size="sm" onClick={() => updateOrderStatus(order.id, 'delivered')}>
                                Finalizar
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="delivered" className="mt-4">
                <div className="max-h-[70vh] overflow-y-auto space-y-3 pr-1">
                  {deliveredOrders.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-8 text-center">Nenhum pedido despachado</div>
                  ) : (
                    deliveredOrders.map((order) => (
                      <Card key={order.id} className={getOrderCardClass(order, 'overflow-hidden border-l-4 border-l-gray-400 cursor-pointer')} onClick={() => openOrderDetails(order)}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-semibold">Pedido {order.order_number}</div>
                                <IfoodOrderBadge order={order} />
                                <ScheduledOrderBadge order={order} />
                              </div>
                              <div className="text-sm text-muted-foreground truncate">{order.customer_name}</div>
                              <div className="text-sm text-muted-foreground">{formatCurrency(order.total)}</div>
                            </div>
                            {getOrderStatusBadge(order)}
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="hidden md:block">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Pedidos</h1>
            <p className="mt-1 text-sm text-slate-500 md:hidden">Acompanhe pedidos por status e aja rápido com uma mão.</p>
          </div>
        </div>

        <Card className="hidden rounded-[28px] border border-[#FF6400]/12 bg-white/95 shadow-[0_18px_40px_-28px_rgba(0,50,35,0.18)] md:block">
          <CardContent className="p-4">
            <div className="hidden md:flex md:flex-wrap md:items-center md:gap-3">
              <Tabs value={ordersView} onValueChange={(v) => setOrdersView(v as any)}>
                <TabsList>
                  <TabsTrigger value="list">Lista</TabsTrigger>
                  <TabsTrigger value="kanban">Kanban</TabsTrigger>
                </TabsList>
              </Tabs>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os pedidos</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="preparing">Preparando</SelectItem>
                  <SelectItem value="ready">Pronto</SelectItem>
                  <SelectItem value="in_delivery">Saiu para Entrega</SelectItem>
                  <SelectItem value="delivered">Finalizado</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="delivery">Entrega</SelectItem>
                  <SelectItem value="pickup">Retirada</SelectItem>
                  <SelectItem value="dine_in">No Local</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative min-w-[260px] flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Buscar pedido, cliente ou telefone"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              <Button
                variant="outline"
                onClick={() => {
                  setDeliveryDialogOpen(true);
                  setDeliveryDialogTab('in_delivery');
                }}
              >
                Entregas/Despachados
              </Button>
              <Button
                variant={autoAcceptEnabled ? 'default' : 'outline'}
                className={autoAcceptEnabled ? 'bg-[#8CC850] text-[#003223] hover:bg-[#79b541]' : ''}
                onClick={toggleAutoAccept}
              >
                {autoAcceptEnabled ? 'Aceitar pedidos automático' : 'Aceitar pedidos automático'}
              </Button>
              <Button onClick={() => fetchOrders({ background: true })} variant="outline">
                {refreshing ? 'Atualizando...' : 'Atualizar'}
              </Button>
            </div>

            <div className="flex flex-col gap-2.5 md:hidden">
              <div className="hidden flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Buscar pedido, cliente ou telefone"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="scrollbar-hide flex gap-2 overflow-x-auto">
                {mobileTypeFilters.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setTypeFilter(filter.value)}
                    className={`shrink-0 rounded-[18px] border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                      typeFilter === filter.value
                        ? 'border-[#003223] bg-[#003223] text-white'
                        : 'border-[#DCE6DF] bg-white text-[#003223]'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-2 md:hidden">
          <Tabs value={mobileStatusTab} onValueChange={(value) => setMobileStatusTab(value as typeof mobileStatusTab)} className="w-full">
            <TabsList className="grid h-auto grid-cols-4 rounded-[18px] border border-[#FF6400]/10 bg-white p-1">
              <TabsTrigger value="novos" className="rounded-[14px] px-1 py-1.5 text-[10px]">Novos ({pendingOrders.length})</TabsTrigger>
              <TabsTrigger value="preparo" className="rounded-[14px] px-1 py-1.5 text-[10px]">Preparo ({activeOrders.length})</TabsTrigger>
              <TabsTrigger value="entrega" className="rounded-[14px] px-1 py-1.5 text-[10px]">Entrega ({completedOrders.length})</TabsTrigger>
              <TabsTrigger value="finalizados" className="rounded-[14px] px-1 py-1.5 text-[10px]">Finalizados ({deliveredOrders.length})</TabsTrigger>
            </TabsList>

            {mobileBulkActionConfig && mobileBulkActionConfig.orderIds.length > 0 && (
              <div className="mt-3">
                <OrdersBulkActionButton
                  orderIds={mobileBulkActionConfig.orderIds}
                  action={mobileBulkActionConfig.action}
                  onBulkAction={handleBulkAction}
                />
              </div>
            )}
            <Button
              variant={autoAcceptEnabled ? 'default' : 'outline'}
              className={`mt-3 h-10 rounded-2xl text-xs ${autoAcceptEnabled ? 'bg-[#8CC850] text-[#003223] hover:bg-[#79b541]' : 'bg-white'}`}
              onClick={toggleAutoAccept}
            >
              {autoAcceptEnabled ? 'Aceitar pedidos automático' : 'Ligar aceite automático'}
            </Button>

            <TabsContent value="novos" className="mt-4 space-y-3">
              {pendingOrders.length === 0 ? <Card className="rounded-[22px] border border-dashed border-slate-200 bg-white/90"><CardContent className="py-8 text-center text-sm text-slate-500">Nenhum pedido novo.</CardContent></Card> : pendingOrders.map(renderMobileOrderCard)}
            </TabsContent>
            <TabsContent value="preparo" className="mt-4 space-y-3">
              {activeOrders.length === 0 ? <Card className="rounded-[22px] border border-dashed border-slate-200 bg-white/90"><CardContent className="py-8 text-center text-sm text-slate-500">Nenhum pedido em preparo.</CardContent></Card> : activeOrders.map(renderMobileOrderCard)}
            </TabsContent>
            <TabsContent value="entrega" className="mt-4 space-y-3">
              {completedOrders.length === 0 ? <Card className="rounded-[22px] border border-dashed border-slate-200 bg-white/90"><CardContent className="py-8 text-center text-sm text-slate-500">Nenhum pedido aguardando entrega.</CardContent></Card> : completedOrders.map(renderMobileOrderCard)}
            </TabsContent>
            <TabsContent value="finalizados" className="mt-4 space-y-3">
              {deliveredOrders.length === 0 ? <Card className="rounded-[22px] border border-dashed border-slate-200 bg-white/90"><CardContent className="py-8 text-center text-sm text-slate-500">Nenhum pedido finalizado.</CardContent></Card> : deliveredOrders.map(renderMobileOrderCard)}
            </TabsContent>
          </Tabs>
        </div>

        <div className="hidden md:block">
        {ordersView === 'kanban' ? (
          <DragDropContext onDragEnd={(r) => { void onKanbanDragEnd(r); }}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { id: 'pending', title: 'Aguardando', items: pendingOrders, headerClass: 'bg-yellow-50 border-yellow-500 text-yellow-800' },
                { id: 'preparing', title: 'Preparando', items: activeOrders, headerClass: 'bg-blue-50 border-blue-500 text-blue-800' },
                { id: 'in_delivery', title: 'Saiu para entrega', items: completedOrders, headerClass: 'bg-purple-50 border-purple-500 text-purple-800' },
              ].map((col) => (
                <div key={col.id} className="space-y-3">
                  <div className={`p-3 rounded-lg border-l-4 ${col.headerClass}`}>
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold">{col.title}</h2>
                      <span className="text-sm font-semibold">{col.items.length}</span>
                    </div>
                  </div>
                  <Droppable droppableId={col.id}>
                    {(droppableProvided) => (
                      <div
                        ref={droppableProvided.innerRef}
                        {...droppableProvided.droppableProps}
                        className="min-h-[180px] space-y-3"
                      >
                        {col.items.map((order, index) => (
                          <Draggable key={order.id} draggableId={order.id} index={index}>
                            {(draggableProvided) => (
                              <div ref={draggableProvided.innerRef} {...draggableProvided.draggableProps}>
                                <Card className={getOrderCardClass(order, 'overflow-hidden hover:shadow-sm transition-shadow')}>
                                  <CardContent className="p-3" onClick={() => openOrderDetails(order)}>
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <div className="font-semibold text-sm truncate">Pedido {order.order_number}</div>
                                          <IfoodOrderBadge order={order} />
                                          <ScheduledOrderBadge order={order} />
                                        </div>
                                        <div className="text-xs text-muted-foreground truncate">{order.customer_name}</div>
                                      </div>
                                      <div className="flex flex-col items-end gap-1">
                                        <button
                                          type="button"
                                          {...draggableProvided.dragHandleProps}
                                          onClick={(e) => e.stopPropagation()}
                                          className="inline-flex items-center justify-center w-7 h-7 rounded border text-muted-foreground cursor-grab active:cursor-grabbing"
                                          title="Arraste para mudar status"
                                        >
                                          <GripVertical className="h-4 w-4" />
                                        </button>
                                        {getOrderStatusBadge(order)}
                                        <div className="text-xs font-semibold">{formatCurrency(order.total)}</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                                      <div className="flex items-center gap-1">
                                        {getOrderTypeIcon(order.order_type)}
                                        <span>{getOrderTypeLabel(order.order_type)}</span>
                                      </div>
                                      <span>{new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                  </CardContent>
                                </Card>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {droppableProvided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              ))}
            </div>
          </DragDropContext>
        ) : (
        <>
        {/* Orders Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Aguardando */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-500">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <h2 className="text-lg font-semibold text-yellow-800">Aguardando ({pendingOrders.length})</h2>
              </div>
              <div className="w-full sm:w-auto">
                <OrdersBulkActionButton
                  orderIds={actionablePendingOrders.map(o => o.id)}
                  action="accept_all"
                  onBulkAction={handleBulkAction}
                />
              </div>
            </div>

            {pendingOrders.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">Nenhum pedido pendente</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingOrders.map((order) => (
                  <Card key={order.id} className={getOrderCardClass(order, 'overflow-hidden border-l-4 border-l-yellow-500 cursor-pointer hover:shadow-md transition-shadow')}>
                    <CardContent className="p-4" onClick={() => openOrderDetails(order)}>
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-semibold min-w-0 break-words">Pedido {order.order_number}</h3>
                          <IfoodOrderBadge order={order} />
                          <ScheduledOrderBadge order={order} />
                          {getOrderStatusBadge(order)}
                          <div className="flex items-center gap-1 min-w-0">
                            {getOrderTypeIcon(order.order_type)}
                            <span className="text-sm text-gray-600">
                              {getOrderTypeLabel(order.order_type)}
                            </span>
                          </div>
                        </div>

                        <div className="text-sm text-gray-600">
                          <div className="font-medium">{order.customer_name}</div>
                          {order.customer_phone && (
                            <div className="flex items-center gap-1">
                              <Phone size={14} />
                              {order.customer_phone}
                            </div>
                          )}
                          <div>{formatDate(order.created_at)}</div>
                        </div>

                        {order.customer_address && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <MapPin className="h-4 w-4" />
                              <span>{order.customer_address}</span>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyLocation(order);
                                }}
                                className="h-7 text-xs w-full sm:flex-1"
                              >
                                <Copy className="h-3 w-3 mr-1" />
                                Copiar
                              </Button>

                              {order.google_maps_link && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(order.google_maps_link, '_blank');
                                  }}
                                  className="h-7 text-xs w-full sm:flex-1"
                                >
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  Maps
                                </Button>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="text-sm text-gray-600">
                          {order.items.length} item(s) • {formatCurrency(order.total)} •
                          <span className="font-medium"> {formatPaymentMethodLabel(order.payment_method, order.acceptance_status)}</span>
                        </div>

                        <div className="flex gap-2 mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 h-8 text-xs px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              PrinterService.printOrder(order);
                            }}
                          >
                            <Printer className="h-3 w-3 mr-1" />
                            Imprimir
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 h-8 text-xs border-[#25d366]/35 bg-[#effcf3] font-semibold text-[#075e54] hover:bg-[#dcf8e5]"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleWhatsAppShare(order);
                            }}
                          >
                            <WhatsAppOrderButtonContent unread={getUnread(order.customer_phone)} />
                          </Button>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateOrderStatus(order.id, 'preparing');
                            }}
                            className="w-full sm:flex-1 bg-green-600 hover:bg-green-700"
                            disabled={updatingOrderIds.has(order.id)}
                          >
                            {updatingOrderIds.has(order.id) ? 'Aceitando...' : 'Aceitar'}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              requestCancelOrder(order.id);
                            }}
                            className="w-full sm:flex-1"
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Preparando */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4 bg-blue-50 rounded-lg border-l-4 border-blue-500">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <h2 className="text-lg font-semibold text-blue-800">Preparando ({activeOrders.length})</h2>
              </div>
              <div className="w-full sm:w-auto">
                <OrdersBulkActionButton
                  orderIds={activeOrders.map(o => o.id)}
                  action="ready_all"
                  onBulkAction={handleBulkAction}
                />
              </div>
            </div>

            {activeOrders.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">Nenhum pedido em preparo</p>
              </div>
            ) : (
              <div className="space-y-4">
                {activeOrders.map((order) => (
                  <Card key={order.id} className={getOrderCardClass(order, 'overflow-hidden border-l-4 border-l-blue-500 cursor-pointer hover:shadow-md transition-shadow')}>
                    <CardContent className="p-4" onClick={() => openOrderDetails(order)}>
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-semibold min-w-0 break-words">Pedido {order.order_number}</h3>
                          <IfoodOrderBadge order={order} />
                          <ScheduledOrderBadge order={order} />
                          {getOrderStatusBadge(order)}
                          <div className="flex items-center gap-1 min-w-0">
                            {getOrderTypeIcon(order.order_type)}
                            <span className="text-sm text-gray-600">
                              {getOrderTypeLabel(order.order_type)}
                            </span>
                          </div>
                        </div>

                        <div className="text-sm text-gray-600">
                          <div className="font-medium">{order.customer_name}</div>
                          {order.customer_phone && (
                            <div className="flex items-center gap-1">
                              <Phone size={14} />
                              {order.customer_phone}
                            </div>
                          )}
                          <div>{formatDate(order.created_at)}</div>
                        </div>

                        {order.customer_address && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <MapPin className="h-4 w-4" />
                              <span>{order.customer_address}</span>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyLocation(order);
                                }}
                                className="h-7 text-xs w-full sm:flex-1"
                              >
                                <Copy className="h-3 w-3 mr-1" />
                                Copiar
                              </Button>

                              {order.google_maps_link && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(order.google_maps_link, '_blank');
                                  }}
                                  className="h-7 text-xs w-full sm:flex-1"
                                >
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  Maps
                                </Button>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="text-sm text-gray-600">
                          {order.items.length} item(s) • {formatCurrency(order.total)} •
                          <span className="font-medium"> {formatPaymentMethodLabel(order.payment_method, order.acceptance_status)}</span>
                        </div>

                        <div className="flex gap-2 mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 h-8 text-xs px-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              PrinterService.printOrder(order);
                            }}
                          >
                            <Printer className="h-3 w-3 mr-1" />
                            Imprimir
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 h-8 text-xs border-[#25d366]/35 bg-[#effcf3] font-semibold text-[#075e54] hover:bg-[#dcf8e5]"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleWhatsAppShare(order);
                            }}
                          >
                            <WhatsAppOrderButtonContent unread={getUnread(order.customer_phone)} />
                          </Button>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateOrderStatus(order.id, 'ready');
                            }}
                            className="w-full sm:flex-1"
                          >
                            Marcar Pronto
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              requestCancelOrder(order.id);
                            }}
                            className="w-full sm:flex-1"
                          >
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateOrderStatus(order.id, 'delivered');
                            }}
                            className="w-full sm:flex-1"
                          >
                            Finalizar
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Saiu para entrega */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4 bg-purple-50 rounded-lg border-l-4 border-purple-500">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                <h2 className="text-lg font-semibold text-purple-800">Saiu para entrega ({completedOrders.length})</h2>
              </div>
              <div className="w-full sm:w-auto">
                <OrdersBulkActionButton
                  orderIds={completedOrders.map(o => o.id)}
                  action="deliver_all"
                  onBulkAction={handleBulkAction}
                />
              </div>
            </div>

            {completedOrders.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">Nenhum pedido para entrega</p>
              </div>
            ) : (
              <div className="space-y-4">
                {completedOrders.map((order) => (
                  <Card key={order.id} className={getOrderCardClass(order, 'overflow-hidden border-l-4 border-l-purple-500 cursor-pointer hover:shadow-md transition-shadow')}>
                    <CardContent className="p-4" onClick={() => openOrderDetails(order)}>
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-semibold min-w-0 break-words">Pedido {order.order_number}</h3>
                          <IfoodOrderBadge order={order} />
                          <ScheduledOrderBadge order={order} />
                          {getOrderStatusBadge(order)}
                          <div className="flex items-center gap-1 min-w-0">
                            {getOrderTypeIcon(order.order_type)}
                            <span className="text-sm text-gray-600">
                              {getOrderTypeLabel(order.order_type)}
                            </span>
                          </div>
                        </div>

                        <div className="text-sm text-gray-600">
                          <div className="font-medium">{order.customer_name}</div>
                          {order.customer_phone && (
                            <div className="flex items-center gap-1">
                              <Phone size={14} />
                              {order.customer_phone}
                            </div>
                          )}
                          <div>{formatDate(order.created_at)}</div>
                        </div>

                        <div className="text-sm text-gray-600">
                          {order.items.length} item(s) • {formatCurrency(order.total)} •
                          <span className="font-medium"> {formatPaymentMethodLabel(order.payment_method, order.acceptance_status)}</span>
                        </div>

                        <div className="flex flex-wrap gap-2 mt-3">
                          {order.status !== 'in_delivery' ? (
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isTableServiceOrder(order)) {
                                  updateOrderStatus(order.id, 'delivered');
                                } else {
                                  requestInDelivery([order.id]);
                                }
                              }}
                              className="w-full sm:flex-1 bg-blue-600 hover:bg-blue-700"
                            >
                              {isTableServiceOrder(order) ? 'Levou para mesa' : 'Saiu para entrega'}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateOrderStatus(order.id, 'delivered');
                              }}
                              className="w-full sm:flex-1 bg-green-600 hover:bg-green-700"
                            >
                              Finalizar
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              requestCancelOrder(order.id);
                            }}
                            className="w-full sm:flex-1"
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
        </>
        )}
        </div>

        <Dialog open={assignDialogOpen} onOpenChange={(open) => { if (!assigningDriver) setAssignDialogOpen(open); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Selecionar motoboy</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {assignOrderIds.length} pedido(s). Você pode atribuir agora ou enviar uma oferta pelo app.
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Entregador</div>
                <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o motoboy" />
                  </SelectTrigger>
                  <SelectContent>
                    {deliveryPersonnel.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={assigningDriver}
                  onClick={() => {
                    setAssignDialogOpen(false);
                    setAssignOrderIds([]);
                    setSelectedDriverId('');
                  }}
                >
                  Cancelar
                </Button>
                {!requireDriver && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={assigningDriver}
                    onClick={async () => {
                      try {
                        setAssigningDriver(true);
                        await Promise.all(assignOrderIds.map((id) => updateOrderStatus(id, 'in_delivery')));
                        setAssignDialogOpen(false);
                        setAssignOrderIds([]);
                        setSelectedDriverId('');
                      } finally {
                        setAssigningDriver(false);
                      }
                    }}
                  >
                    Continuar sem motoboy
                  </Button>
                )}
                {deliveryPersonnel.some((driver) => driver.app_enabled) && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={assigningDriver}
                    onClick={offerOrdersToDriverApp}
                  >
                    Ofertar no app
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={assigningDriver}
                  onClick={async () => {
                    if (!selectedDriverId) {
                      toast({ title: 'Selecione um motoboy', description: 'Escolha um entregador para continuar.', variant: 'destructive' });
                      return;
                    }
                    try {
                      setAssigningDriver(true);
                      await Promise.all(assignOrderIds.map((id) => updateOrderInDeliveryWithDriver(id, selectedDriverId)));
                      setAssignDialogOpen(false);
                      setAssignOrderIds([]);
                      setSelectedDriverId('');
                      toast({ title: 'Saiu para entrega', description: 'Motoboy atribuído com sucesso.' });
                    } finally {
                      setAssigningDriver(false);
                    }
                  }}
                  className="bg-boracume-orange hover:bg-boracume-orange/90"
                >
                  Confirmar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Modal de Detalhes */}
        <OrderDetailsModal
          order={selectedOrder}
          isOpen={isDetailsModalOpen}
          onClose={() => {
            setIsDetailsModalOpen(false);
            setSelectedOrder(null);
          }}
          onStatusChange={handleOrderStatusChange}
        />
        <WhatsAppOrderChat
          order={whatsAppOrder}
          open={Boolean(whatsAppOrder)}
          onOpenChange={(open) => { if (!open) setWhatsAppOrder(null); }}
          onRead={() => { void refreshUnread(); }}
        />
      </div>
    </div>
  );
};

export default Orders;
