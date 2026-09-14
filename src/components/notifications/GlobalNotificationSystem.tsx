import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { X, Bell, Truck, Package, Clock, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { POPSYSTEM_ORDER_SOUND_TYPE, soundNotifications } from '@/utils/soundUtils';
import { updateOrderStatus as updateOrderStatusRemote } from '@/utils/updateOrderStatus';
import { PrinterService } from '@/utils/printerService';

interface PendingOrder {
  id: string;
  order_number: string;
  customer_name?: string;
  order_type: string;
  total: number;
  created_at: string;
  acceptance_status?: string;
}

// Um pedido antigo pode permanecer pendente por falha operacional ou de
// sincronizacao. Ele continua visivel para ser tratado, mas nao deve deixar o
// terminal tocando indefinidamente dias depois. O alerta sonoro fica restrito
// a pedidos realmente recentes.
const MAX_AUDIBLE_ORDER_AGE_MS = 30 * 60 * 1000;

const isRecentEnoughToRing = (order: PendingOrder) => {
  const createdAt = new Date(order.created_at).getTime();
  return Number.isFinite(createdAt) && Date.now() - createdAt <= MAX_AUDIBLE_ORDER_AGE_MS;
};

const isPdvCounterOrder = (order: any) => {
  const source = String(order?.variations?.source || order?.source || '').toUpperCase();
  return order?.order_type === 'counter' && source === 'PDV';
};

const getAutoAcceptKey = (userId?: string) => `orders_auto_accept:${userId || 'local'}`;

const isTableServiceOrder = (order: any) => {
  const orderType = String(order?.order_type || '').toLowerCase();
  const source = String(order?.variations?.source || order?.source || '').toLowerCase();
  return orderType === 'dine_in' && (Boolean(order?.table_id) || source.includes('table'));
};

const shouldAutoPrintTableServiceOrder = (order: any) => {
  if (!isTableServiceOrder(order)) return false;
  const showInManager = order?.variations?.show_in_manager;
  const flow = String(order?.variations?.table_order_flow || '').toLowerCase();
  if (showInManager === false || flow === 'account_only') return false;
  const status = String(order?.status || '').toLowerCase();
  const acceptanceStatus = String(order?.acceptance_status || '').toLowerCase();
  return status === 'preparing' || status === 'accepted' || acceptanceStatus === 'accepted';
};

const GlobalNotificationSystem: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  const [dismissedOrders, setDismissedOrders] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('dismissedOrders');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Verifica se esta na pagina de pedidos para nao mostrar notificacao.
  // Adicionado '/track' para evitar notificacoes na tela do cliente.
  const isOnOrdersPage =
    ['/orders', '/pedidos', '/kitchen', '/cozinha', '/kds-view', '/customer-view', '/menu-digital', '/totem'].some((path) =>
      location.pathname.startsWith(path),
    ) || location.pathname.includes('/track');
  const isStandaloneOrderingScreen = location.pathname.includes('/menu') || location.pathname.startsWith('/totem');

  const isOnOrdersPageRef = useRef(isOnOrdersPage);
  const soundEnabledRef = useRef(soundEnabled);
  const pendingOrdersRef = useRef<PendingOrder[]>([]);
  const pollingRef = useRef<number | null>(null);
  const realtimeHealthyRef = useRef(false);
  const visibleOrders = pendingOrders.filter((order) => !dismissedOrders.has(order.id));
  const audibleOrders = visibleOrders.filter(isRecentEnoughToRing);
  const isAutoAcceptEnabled = () => Boolean(user?.id && localStorage.getItem(getAutoAcceptKey(user.id)) === 'true');

  useEffect(() => {
    isOnOrdersPageRef.current = isOnOrdersPage;
  }, [isOnOrdersPage]);

  useEffect(() => {
    pendingOrdersRef.current = pendingOrders;
  }, [pendingOrders]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    soundNotifications.setEnabled(soundEnabled);
    soundNotifications.setVolume(volume);
  }, [soundEnabled, volume]);

  useEffect(() => {
    // Pedidos dispensados permanecem no estado para auditoria, mas não podem
    // manter um alerta sonoro invisível tocando indefinidamente.
    const shouldLoopAlert = !isStandaloneOrderingScreen && soundEnabled && audibleOrders.length > 0;
    if (shouldLoopAlert) {
      soundNotifications.startPersistentAlert(POPSYSTEM_ORDER_SOUND_TYPE);
      return;
    }
    soundNotifications.stopPersistentAlert();
    soundNotifications.stopAllSounds();
  }, [audibleOrders.length, soundEnabled, isStandaloneOrderingScreen]);

  useEffect(() => {
    if (!isStandaloneOrderingScreen) return;
    setPendingOrders([]);
    setIsVisible(false);
    soundNotifications.stopPersistentAlert();
    soundNotifications.stopAllSounds();
  }, [isStandaloneOrderingScreen]);

  const showBackgroundOrderNotification = async (order: PendingOrder) => {
    const title = 'Novo pedido recebido';
    const body = `Pedido ${order.order_number} - ${order.customer_name || 'Cliente'}`;

    try {
      if ((document.visibilityState !== 'visible' || !document.hasFocus()) && window.electronAPI?.showNotification) {
        await window.electronAPI.showNotification(title, body);
        return;
      }
    } catch {}

    try {
      if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, silent: true });
      }
    } catch {}
  };

  const handleIncomingOrderAlert = async (order: PendingOrder) => {
    if (isAutoAcceptEnabled()) return;
    if (soundEnabledRef.current && isRecentEnoughToRing(order)) {
      soundNotifications.startPersistentAlert(POPSYSTEM_ORDER_SOUND_TYPE);
    }
    await showBackgroundOrderNotification(order);
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
    if (isOnOrdersPageRef.current) return;
    setIsAnimatingOut(false);
    setIsVisible(true);
    toast({
      title: 'Novo Pedido Recebido!',
      description: `Pedido ${order.order_number} - ${order.customer_name || 'Cliente'}`,
      duration: 5000,
    });
  };

  useEffect(() => {
    if (!user) return;
    if (isStandaloneOrderingScreen) return;

    const loadSettings = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('notification_settings')
          .select('sound_enabled, volume')
          .eq('user_id', user.id)
          .maybeSingle();
        if (error || !data) return;

        const enabled = !!data.sound_enabled;
        const vol = Math.max(0, Math.min(1, parseFloat(String(data.volume || '80')) / 100));
        setSoundEnabled(enabled);
        setVolume(vol);
      } catch {}
    };

    const loadPendingOrders = async (): Promise<PendingOrder[]> => {
      if (isAutoAcceptEnabled()) {
        setPendingOrders([]);
        setIsVisible(false);
        soundNotifications.stopAllSounds();
        return [];
      }

      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, customer_name, order_type, total, created_at, acceptance_status, status, variations')
        .eq('user_id', user.id)
        .or('acceptance_status.in.(pending_acceptance,awaiting_pix_payment),status.eq.pending')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('GlobalNotification - Erro ao carregar pedidos pendentes:', error);
        return [];
      }

      const list = ((data || []) as PendingOrder[]).filter((order) => !isPdvCounterOrder(order) && !isTableServiceOrder(order));
      setPendingOrders(list);
      if (list.length > 0 && !isOnOrdersPageRef.current) {
        setIsAnimatingOut(false);
        setIsVisible(true);
      }
      return list;
    };

    loadSettings();
    loadPendingOrders();

    const channel = supabase
      .channel(`global-notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          const newOrder = payload.new as PendingOrder;
          if (isAutoAcceptEnabled()) return;
          if (isPdvCounterOrder(newOrder)) return;
          if (isTableServiceOrder(newOrder)) {
            if (shouldAutoPrintTableServiceOrder(newOrder)) {
              try {
                const { data: fullOrder } = await supabase.from('orders').select('*').eq('id', newOrder.id).maybeSingle();
                if (fullOrder) {
                  PrinterService.printOrderOnAccept({
                    ...fullOrder,
                    items: Array.isArray((fullOrder as any).items) ? (fullOrder as any).items : [],
                  });
                }
              } catch (error) {
                console.warn('Falha ao imprimir pedido de mesa autoaceito:', error);
              }
            }
            return;
          }

          const showForInsert =
            newOrder.acceptance_status === 'pending_acceptance' ||
            newOrder.acceptance_status === 'awaiting_pix_payment' ||
            (newOrder as any).status === 'pending';

          if (!showForInsert) return;
          setPendingOrders((prev) => [newOrder, ...prev.filter((order) => order.id !== newOrder.id)]);
          await handleIncomingOrderAlert(newOrder);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          const updatedOrder = payload.new as PendingOrder;
          if (isAutoAcceptEnabled()) {
            setPendingOrders((prev) => prev.filter((order) => order.id !== updatedOrder.id));
            return;
          }
          if (isPdvCounterOrder(updatedOrder)) {
            setPendingOrders((prev) => prev.filter((order) => order.id !== updatedOrder.id));
            return;
          }
          if (isTableServiceOrder(updatedOrder)) {
            setPendingOrders((prev) => prev.filter((order) => order.id !== updatedOrder.id));
            if (shouldAutoPrintTableServiceOrder(updatedOrder)) {
              try {
                const { data: fullOrder } = await supabase.from('orders').select('*').eq('id', updatedOrder.id).maybeSingle();
                if (fullOrder) {
                  PrinterService.printOrderOnAccept({
                    ...fullOrder,
                    items: Array.isArray((fullOrder as any).items) ? (fullOrder as any).items : [],
                  });
                }
              } catch (error) {
                console.warn('Falha ao imprimir pedido de mesa aceito:', error);
              }
            }
            return;
          }

          const isPendingLike =
            updatedOrder.acceptance_status === 'pending_acceptance' ||
            updatedOrder.acceptance_status === 'awaiting_pix_payment' ||
            (updatedOrder as any).status === 'pending';

          if (isPendingLike) {
            setPendingOrders((prev) => [updatedOrder, ...prev.filter((order) => order.id !== updatedOrder.id)]);
            await handleIncomingOrderAlert(updatedOrder);
          } else {
            setPendingOrders((prev) => prev.filter((order) => order.id !== updatedOrder.id));
            setDismissedOrders((prev) => {
              const nextDismissed = new Set([...prev, updatedOrder.id]);
              localStorage.setItem('dismissedOrders', JSON.stringify([...nextDismissed]));
              return nextDismissed;
            });
            setTimeout(() => {
              setPendingOrders((current) => {
                if (current.length === 0) {
                  setIsVisible(false);
                }
                return current;
              });
            }, 100);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notification_settings', filter: `user_id=eq.${user.id}` },
        () => {
          loadSettings();
        },
      )
      .subscribe((status) => {
        realtimeHealthyRef.current = status === 'SUBSCRIBED';
        if (status === 'SUBSCRIBED') {
          loadPendingOrders();
        }
      });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadPendingOrders();
      }
    };
    const handleAutoAcceptChanged = () => {
      if (isAutoAcceptEnabled()) {
        setPendingOrders([]);
        setIsVisible(false);
        soundNotifications.stopAllSounds();
      } else {
        loadPendingOrders();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('orders-auto-accept-changed', handleAutoAcceptChanged);

    if (pollingRef.current) window.clearInterval(pollingRef.current);
    pollingRef.current = window.setInterval(async () => {
      if (!user?.id) return;
      if (document.visibilityState !== 'visible' || realtimeHealthyRef.current) return;
      const next = await loadPendingOrders();
      const prev = pendingOrdersRef.current || [];
      const prevIds = new Set(prev.map((order) => order.id));
      const newOnes = next.filter((order) => !prevIds.has(order.id));
      if (newOnes.length === 0) return;
      await handleIncomingOrderAlert(newOnes[0]);
    }, 8000);

    return () => {
      realtimeHealthyRef.current = false;
      supabase.removeChannel(channel);
      soundNotifications.stopAllSounds();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('orders-auto-accept-changed', handleAutoAcceptChanged);
      if (pollingRef.current) window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
  }, [user, isStandaloneOrderingScreen, toast]);

  useEffect(() => {
    if (isOnOrdersPage) {
      setIsVisible(false);
    } else if (visibleOrders.length > 0) {
      setIsVisible(true);
    }
  }, [isOnOrdersPage, visibleOrders.length]);

  const handleGoToOrders = () => {
    setIsAnimatingOut(true);
    window.setTimeout(() => {
      setIsVisible(false);
      navigate('/pedidos');
    }, 220);
  };

  const handleDismiss = () => {
    soundNotifications.stopPersistentAlert();
    soundNotifications.stopAllSounds();
    setDismissedOrders((previous) => {
      const next = new Set(previous);
      visibleOrders.forEach((order) => next.add(order.id));
      localStorage.setItem('dismissedOrders', JSON.stringify([...next]));
      return next;
    });
    setIsAnimatingOut(true);
    window.setTimeout(() => {
      setIsVisible(false);
    }, 220);
  };

  const handleAcceptFirst = async () => {
    const order = visibleOrders[0];
    if (!order || acceptingOrderId) return;

    setAcceptingOrderId(order.id);
    soundNotifications.stopAllSounds();
    setDismissedOrders((prev) => {
      const nextDismissed = new Set([...prev, order.id]);
      localStorage.setItem('dismissedOrders', JSON.stringify([...nextDismissed]));
      return nextDismissed;
    });
    setPendingOrders((prev) => prev.filter((current) => current.id !== order.id));

    const remainingVisibleOrders = visibleOrders.filter((candidate) => candidate.id !== order.id);
    if (remainingVisibleOrders.length === 0) {
      setIsAnimatingOut(false);
      setIsVisible(false);
    } else {
      setIsAnimatingOut(false);
      setIsVisible(true);
    }

    try {
      let accepted = false;
      try {
        await updateOrderStatusRemote(order.id, 'preparing');
        accepted = true;
      } catch (requestError) {
        // Se a resposta se perder depois da gravação, confirme diretamente no
        // banco antes de dizer ao restaurante que o aceite falhou.
        const { data: confirmedOrder } = await supabase
          .from('orders')
          .select('id, status, acceptance_status')
          .eq('id', order.id)
          .maybeSingle();
        accepted =
          confirmedOrder?.status === 'preparing' &&
          confirmedOrder?.acceptance_status === 'accepted';
        if (!accepted) throw requestError;
      }

      void (async () => {
        try {
          const { data: fullOrder } = await supabase.from('orders').select('*').eq('id', order.id).maybeSingle();
          if (fullOrder) {
            const normalized = {
              ...fullOrder,
              items: Array.isArray((fullOrder as any).items) ? (fullOrder as any).items : [],
            };
            PrinterService.printOrderOnAccept(normalized);
          }
        } catch {}
      })();

      toast({
        title: 'Pedido aceito',
        description: `O pedido ${order.order_number} já está em preparação.`,
      });
    } catch (error: any) {
      setDismissedOrders((prev) => {
        const nextDismissed = new Set(prev);
        nextDismissed.delete(order.id);
        localStorage.setItem('dismissedOrders', JSON.stringify([...nextDismissed]));
        return nextDismissed;
      });
      setPendingOrders((prev) => prev.some((current) => current.id === order.id) ? prev : [order, ...prev]);
      setIsAnimatingOut(false);
      setIsVisible(true);
      toast({
        title: 'Pedido não foi aceito',
        description:
          error?.message === 'Sua sessão expirou. Entre novamente para continuar.'
            ? error.message
            : 'Não houve confirmação do servidor. O pedido continua pendente e pode ser tentado novamente.',
        variant: 'destructive',
      });
    } finally {
      setAcceptingOrderId(null);
    }
  };

  const getOrderTypeIcon = (type: string) => {
    switch (type) {
      case 'delivery':
        return <Truck className="h-4 w-4 text-blue-600" />;
      case 'pickup':
        return <Package className="h-4 w-4 text-green-600" />;
      case 'dine_in':
        return <div className="h-4 w-4 rounded-sm bg-orange-600" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isVisible || visibleOrders.length === 0 || isOnOrdersPage || isStandaloneOrderingScreen) {
    return null;
  }

  return (
    <div
      className={`fixed left-1/2 top-3 z-50 w-[calc(100vw-1.25rem)] max-w-[22rem] -translate-x-1/2 transition-all duration-300 sm:left-auto sm:right-4 sm:top-4 sm:w-full sm:translate-x-0 ${isAnimatingOut ? '-translate-y-6 opacity-0' : 'translate-y-0 opacity-100'}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Card
        className="border border-gray-200/90 bg-white/95 shadow-[0_22px_42px_-28px_rgba(15,23,42,0.55)] backdrop-blur"
        role="status"
      >
        <CardContent className="p-3 sm:p-4">
          <div className="mb-2.5 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-orange-600 sm:h-5 sm:w-5" />
              <span className="text-sm font-semibold text-orange-800 sm:text-[15px]">
                {visibleOrders.length} Novo{visibleOrders.length > 1 ? 's' : ''} Pedido{visibleOrders.length > 1 ? 's' : ''}!
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="h-7 w-7 rounded-full p-0 text-gray-600 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="mb-3 max-h-56 space-y-2 overflow-y-auto sm:max-h-64">
            {visibleOrders.slice(0, 3).map((order) => (
              <div
                key={order.id}
                className="pointer-events-none flex items-center justify-between rounded-xl border bg-white px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  {getOrderTypeIcon(order.order_type)}
                  <div>
                    <div className="text-[13px] font-medium sm:text-sm">Pedido {order.order_number}</div>
                    <div className="text-xs text-muted-foreground">
                      {order.customer_name || 'Cliente'} • {formatTime(order.created_at)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-semibold sm:text-sm">{formatCurrency(order.total)}</div>
                  <Badge variant="outline" className="text-[10px]">
                    Pendente
                  </Badge>
                </div>
              </div>
            ))}

            {visibleOrders.length > 3 && (
              <div className="text-center text-xs text-muted-foreground sm:text-sm">
                +{visibleOrders.length - 3} pedido{visibleOrders.length - 3 > 1 ? 's' : ''} adicional
                {visibleOrders.length - 3 > 1 ? 'is' : ''}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={handleGoToOrders}
              className="h-8 rounded-xl bg-boracume-orange px-2 text-[11px] hover:bg-boracume-orange/90 sm:h-9 sm:text-xs"
              size="sm"
            >
              Ver Pedidos
            </Button>
            <Button
              onClick={handleAcceptFirst}
              disabled={Boolean(acceptingOrderId)}
              className="h-8 rounded-xl bg-green-600 px-2 text-[11px] hover:bg-green-700 sm:h-9 sm:text-xs"
              size="sm"
            >
              {acceptingOrderId ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Aceitando
                </>
              ) : (
                'Aceitar'
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleDismiss}
              className="h-8 rounded-xl px-2 text-[11px] sm:h-9 sm:text-xs"
              size="sm"
            >
              Dispensar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GlobalNotificationSystem;
