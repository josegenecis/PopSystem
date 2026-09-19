import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Truck, Clock, CheckCircle, AlertTriangle, QrCode, Package, MessageCircle, MapPin, Navigation } from 'lucide-react';
import PixPaymentModal from '@/components/payment/PixPaymentModal';
import { DeliveryGoogleMap } from '@/components/delivery/DeliveryGoogleMap';

interface Order {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone?: string | null;
  order_type: string | null;
  status: string;
  acceptance_status?: string | null;
  total: number;
  payment_method: string;
  created_at: string;
  estimated_time?: string | null;
  user_id?: string;
}

const OrderTracking: React.FC = () => {
  const { orderId } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pixOpen, setPixOpen] = useState(false);
  const [deliveryTracking, setDeliveryTracking] = useState<any>(null);

  const statusSteps = useMemo(() => (
    [
      { key: 'pending', label: 'Recebido', icon: Clock },
      { key: 'preparing', label: 'Preparando', icon: Package },
      { key: 'ready', label: 'Pronto', icon: CheckCircle },
      { key: 'in_delivery', label: 'Saiu para Entrega', icon: Truck },
      { key: 'delivered', label: 'Finalizado', icon: CheckCircle },
      { key: 'completed', label: 'Finalizado', icon: CheckCircle },
    ]
  ), []);

  const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  const formatDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR');

  useEffect(() => {
    let mounted = true;
    const fetchOrder = async () => {
      if (!orderId) return;
      try {
        const { data, error } = await supabase.functions.invoke('public-order-tracking', { body: { orderId } });
        if (error || !data?.ok || !data?.order) {
          throw new Error(data?.error === 'not_found' ? 'Pedido não encontrado.' : 'Não foi possível carregar o pedido.');
        }
        if (!mounted) return;
        setOrder(data.order as Order);
        setLoadError('');
      } catch (error) {
        if (!mounted) return;
        setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar o pedido.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void fetchOrder();
    const timer = window.setInterval(() => void fetchOrder(), 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [orderId]);

  useEffect(() => {
    if (!orderId || order?.status !== 'in_delivery') {
      if (order?.status === 'delivered' || order?.status === 'completed') setDeliveryTracking((current: any) => current ? { ...current, active: false } : current);
      return;
    }
    let mounted = true;
    const fetchLocation = async () => {
      const { data } = await supabase.functions.invoke('motoboy-tracking', { body: { orderId } });
      if (mounted && data) setDeliveryTracking(data);
    };
    fetchLocation();
    const timer = window.setInterval(fetchLocation, 8000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [orderId, order?.status]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-lg">Carregando pedido...</p>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h1 className="text-2xl font-bold mb-2">Pedido não encontrado</h1>
          <p className="text-muted-foreground">{loadError || 'Verifique o link e tente novamente.'}</p>
          <div className="mt-4">
            <Link to="/menu-digital">
              <Button variant="outline">Voltar ao Cardápio</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentIndex = statusSteps.findIndex(s => s.key === order.status);
  const sanitizedPhone = order.customer_phone ? order.customer_phone.replace(/\D/g, '') : '';
  const waNumber = sanitizedPhone ? (sanitizedPhone.startsWith('55') ? sanitizedPhone : `55${sanitizedPhone}`) : '';
  const waMessage = `Olá! Aqui está o link para acompanhar seu pedido ${order.order_number || ''}: ${window.location.href}`;
  const paymentLabel = (() => {
    const method = String(order.payment_method || '').toLowerCase();
    if (method === 'pix_online') return 'PIX online';
    if (method === 'pix_entrega') return 'PIX na entrega';
    if (method === 'pix') {
      return order.acceptance_status === 'awaiting_pix_payment' ? 'PIX online' : 'PIX na entrega';
    }
    return method ? method.toUpperCase() : 'NÃO INFORMADO';
  })();
  const acceptanceLabel = order.acceptance_status === 'awaiting_pix_payment'
    ? 'Aguardando pagamento PIX'
    : order.acceptance_status === 'pending_acceptance'
      ? 'Aguardando aceite do restaurante'
      : order.acceptance_status === 'accepted'
        ? 'Pedido aceito'
        : order.acceptance_status === 'rejected'
          ? 'Pedido rejeitado'
          : undefined;

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Acompanhar Pedido</h1>
          <Badge variant="outline">{order.order_number || order.id.slice(0, 8).toUpperCase()}</Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{order.customer_name || 'Cliente'}</span>
              <span className="text-sm text-muted-foreground">{formatDateTime(order.created_at)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-2">
              <Badge>{order.order_type === 'delivery' ? 'Entrega' : order.order_type === 'pickup' ? 'Retirada' : 'No Local'}</Badge>
              <Badge variant="secondary">{paymentLabel}</Badge>
              {acceptanceLabel && <Badge variant="outline">{acceptanceLabel}</Badge>}
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                {statusSteps.map((step, idx) => {
                  const Icon = step.icon as any;
                  const isDone = currentIndex > idx;
                  const isCurrent = currentIndex === idx;
                  return (
                    <div key={step.key} className={`p-3 rounded-lg border ${isCurrent ? 'border-primary' : 'border-border'} ${isDone ? 'bg-green-50' : isCurrent ? 'bg-primary/5' : 'bg-muted/50'}`}>
                      <div className="flex items-center gap-2">
                        <Icon className={`w-4 h-4 ${isDone ? 'text-green-600' : isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className="text-sm font-medium">{step.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {order.estimated_time && (
                <div className="text-sm text-muted-foreground">
                  Previsão: {order.estimated_time}
                </div>
              )}
            </div>

            {order.status === 'in_delivery' && deliveryTracking?.location && (
              <div className="overflow-hidden rounded-2xl border bg-slate-50">
                <div className="flex items-center justify-between gap-3 p-4">
                  <div><p className="flex items-center gap-2 font-bold text-emerald-800"><MapPin className="h-5 w-5" /> Motoboy a caminho</p><p className="mt-1 text-xs text-muted-foreground">{deliveryTracking?.driver?.name || deliveryTracking?.driver?.[0]?.name || 'Sua entrega'} • atualização em tempo real</p></div>
                  <Badge className="bg-emerald-600">Ao vivo</Badge>
                </div>
                <DeliveryGoogleMap
                  driver={{
                    latitude: Number(deliveryTracking.location.latitude),
                    longitude: Number(deliveryTracking.location.longitude),
                  }}
                  destination={deliveryTracking.destination || null}
                />
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-500"><Navigation className="h-4 w-4" /> Última posição: {new Date(deliveryTracking.location.recorded_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-lg font-bold">{formatCurrency(order.total)}</span>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => navigator.clipboard.writeText(window.location.href)}>
                Copiar link
              </Button>
              {waNumber && (
                <Button variant="outline" onClick={() => window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(waMessage)}`, '_blank')}>
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Enviar WhatsApp
                </Button>
              )}
              {(order.payment_method === 'pix' || order.payment_method === 'pix_online') && order.acceptance_status === 'awaiting_pix_payment' && (
                <Button className="bg-green-600 hover:bg-green-700" onClick={() => setPixOpen(true)}>
                  <QrCode className="w-4 h-4 mr-2" />
                  Pagar PIX
                </Button>
              )}
              <div className="ml-auto"></div>
              <Link to={order.user_id ? `/menu/${order.user_id}` : `/menu-digital?userId=${order.user_id || ''}` }>
                <Button variant="ghost" className="w-full sm:w-auto">Voltar ao Cardápio</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
        <PixPaymentModal
          isOpen={pixOpen}
          onClose={() => setPixOpen(false)}
          amount={order.total}
          orderId={order.id}
          onPaymentConfirmed={async () => {
            const { error } = await supabase
              .from('orders')
              .update({ acceptance_status: 'pending_acceptance' })
              .eq('id', order.id);
            if (!error) {
              setOrder(prev => prev ? { ...prev, acceptance_status: 'pending_acceptance' } : prev);
            }
          }}
        />
      </div>
    </div>
  );
};

export default OrderTracking;
