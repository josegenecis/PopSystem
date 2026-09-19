import { useRef, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { loadPrinterConfig } from '@/services/printerConfig';
import { enqueuePrintJob } from '@/services/printRelay';
import { soundNotifications } from '@/utils/soundUtils';
import { updateOrderStatus as updateOrderStatusRemote } from '@/utils/updateOrderStatus';

export interface KitchenOrder {
  id: string;
  order_number: string;
  customer_name: string;
  items: any[];
  status: 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
  created_at: string;
  updated_at: string;
  notes?: string;
  order_type: 'delivery' | 'pickup' | 'dine_in';
  table_number?: string;
}

const isPdvCounterOrder = (order: any) => {
  const source = String(order?.variations?.source || order?.source || '').toUpperCase();
  return order?.order_type === 'counter' && source === 'PDV';
};

export const useKDS = () => {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const hasLoadedOrdersRef = useRef(false);
  const printedIds = (globalThis as any).__boracumePrintedKdsOrders || new Set<string>();
  (globalThis as any).__boracumePrintedKdsOrders = printedIds;

  const tryAutoPrint = async (order: KitchenOrder) => {
    try {
      const cfg = loadPrinterConfig();
      if (!cfg.autoPrintKds) return;
      if (!order?.id) return;
      if (printedIds.has(order.id)) return;
      printedIds.add(order.id);

      const userId = user?.id || ''
      if (!userId) return

      const cfgPrinter = loadPrinterConfig().relay?.selectedPrinter
      await enqueuePrintJob({
        restaurantUserId: userId,
        jobType: 'kds_receipt',
        idempotencyKey: `kds:${order.id}`,
        payload: {
          order_id: order.id,
          order_number: order.order_number,
          customer_name: order.customer_name,
          items: order.items || [],
          total: (order as any).total ?? 0,
          payment_method: (order as any).payment_method ?? undefined,
          date: order.created_at,
          printer: cfgPrinter ? {
            printer_id: cfgPrinter.printerId,
            name: cfgPrinter.name,
            transport: cfgPrinter.transport,
            address: cfgPrinter.address || undefined,
          } : undefined,
        }
      })
    } catch {
      printedIds.delete(order.id);
    }
  };

  useEffect(() => {
    if (user) {
      fetchOrders();
      subscribeToOrders();
    }
  }, [user]);

  const fetchOrders = async (options: { background?: boolean } = {}) => {
    const showInitialLoading = !hasLoadedOrdersRef.current && !options.background;
    try {
      if (showInitialLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      // Fetch orders relevant to the kitchen: pending, accepted, preparing, ready
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', user?.id)
        .in('status', ['pending', 'accepted', 'preparing', 'ready']) 
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      setOrders(((data || []) as any[]).filter((order) => !isPdvCounterOrder(order)) as any);
      hasLoadedOrdersRef.current = true;
    } catch (error) {
      console.error('Error fetching KDS orders:', error);
      toast({
        title: "Erro ao carregar pedidos",
        description: "Não foi possível sincronizar com a cozinha.",
        variant: "destructive"
      });
    } finally {
      if (showInitialLoading) setLoading(false);
      setRefreshing(false);
    }
  };

  const subscribeToOrders = () => {
    const channel = supabase
      .channel('kds-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `user_id=eq.${user?.id}`
        },
        (payload) => {
          console.log('KDS Real-time update:', payload);
          
          if (payload.eventType === 'INSERT') {
            const newOrder = payload.new as KitchenOrder;
            if (isPdvCounterOrder(newOrder)) return;

            if (['pending', 'accepted', 'preparing', 'ready'].includes(newOrder.status)) {
              setOrders(prev => {
                // Verificar se já existe para evitar duplicação
                if (prev.some(o => o.id === newOrder.id)) return prev;
                return [...prev, newOrder];
              });
              
              // Som diferenciado por tipo
              if (newOrder.order_type === 'dine_in') {
                  soundNotifications.playKitchenBell();
              } else {
                  soundNotifications.playDeliverySound();
              }
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedOrder = payload.new as KitchenOrder;
            if (isPdvCounterOrder(updatedOrder)) {
              setOrders(prev => prev.filter(o => o.id !== updatedOrder.id));
              return;
            }
            
            // If status changed to something not in KDS (e.g. delivered/cancelled), remove it
            if (!['pending', 'preparing', 'ready'].includes(updatedOrder.status)) {
              setOrders(prev => prev.filter(o => o.id !== updatedOrder.id));
            } else {
              // Update existing or add if it wasn't there (e.g. moved from pending -> preparing)
              setOrders(prev => {
                const exists = prev.find(o => o.id === updatedOrder.id);
                if (exists) {
                  return prev.map(o => o.id === updatedOrder.id ? updatedOrder : o);
                } else {
                  // Se não existe, adiciona, mas toca som e imprime se necessário
                  playNotificationSound();
                  if (updatedOrder.status === 'preparing') {
                    tryAutoPrint(updatedOrder);
                  }
                  return [...prev, updatedOrder];
                }
              });
            }
          } else if (payload.eventType === 'DELETE') {
            setOrders(prev => prev.filter(o => o.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      await updateOrderStatusRemote(orderId, newStatus);

      // Optimistic update
      if (!['preparing', 'ready'].includes(newStatus)) {
        setOrders(prev => prev.filter(o => o.id !== orderId));
      } else {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus as any } : o));
      }

      toast({
        title: "Status atualizado",
        description: `Pedido movido para ${newStatus === 'ready' ? 'Pronto' : newStatus}.`
      });

    } catch (error) {
      console.error('Error updating order status:', error);
      toast({
        title: "Erro",
        description: "Não foi possível atualizar o status do pedido.",
        variant: "destructive"
      });
    }
  };

  const recallOrder = async (orderId: string) => {
     try {
      // Bring back a completed/delivered order to 'ready' or 'preparing'
      // For simplicity, let's bring it back to 'preparing'
      await updateOrderStatusRemote(orderId, 'preparing');

      toast({
        title: "Pedido recuperado",
        description: "O pedido voltou para a tela de preparação."
      });
      
      // We don't need to manually update state here because the subscription will catch the UPDATE event
      // and add it back to the list.
    } catch (error) {
      console.error('Error recalling order:', error);
       toast({
        title: "Erro",
        description: "Não foi possível recuperar o pedido.",
        variant: "destructive"
      });
    }
  };

  const playNotificationSound = () => {
    void soundNotifications.playSound();
  };

  return {
    orders,
    loading,
    refreshing,
    updateOrderStatus,
    recallOrder,
    refresh: () => fetchOrders({ background: true })
  };
};
