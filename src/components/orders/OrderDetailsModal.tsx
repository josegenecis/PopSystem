
import React, { useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 

  Phone, 
  MapPin, 
  Clock, 
  User, 
  CreditCard, 
  Package, 
  ExternalLink, 
  Copy,
  Truck,
  CheckCircle,
  XCircle,
  Check,
  MessageCircle,
  Printer,
  ReceiptText

} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { PrinterService } from '@/utils/printerService';
import AdminPinDialog from '@/components/security/AdminPinDialog';
import { canCancelOrder, getLocalOperatorSession } from '@/services/operatorAuth';
import { verifyAdminPin } from '@/services/adminPin';
import { WhatsAppService } from '@/services/WhatsAppService';
import {
  formatPaymentMethodLabel,
  getOrderItemDetailGroups,
  getOrderMapsLink,
} from '@/lib/orderDetails';
import { emitNfceForOrder, isFiscalEmissionActiveForUser } from '@/utils/nfceClient';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';

interface OrderItem {
  product_name: string;
  quantity: number;
  price: number;

  total_price?: number;
  subtotal?: number;
  total?: number;
  unit_price?: number;
  options?: any[];
  variations?: any[];

  notes?: string;
}

interface IfoodPaymentMethodSummary {
  method?: string;
  brand?: string;
  wallet?: string;
  type?: string;
  change_for?: number | string;
  value?: number | string;
}

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
  subtotal?: number;
  delivery_fee?: number;
  discount?: number;
  coupon_code?: string | null;
  payment_method: string;
  items: OrderItem[];
  created_at: string;
  estimated_time?: number | string;
  delivery_instructions?: string;
  user_id?: string;
  source?: string;
  external_order_id?: string | null;
  customer_document?: string | null;
  pickup_code?: string | null;
  scheduled_at?: string | null;
  integration_payload?: any;
}

interface OrderDetailsModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusChange?: (orderId: string, newStatus: string) => void | Promise<void>;
}


export const OrderDetailsModal: React.FC<OrderDetailsModalProps> = ({ 
  order, 
  isOpen, 
  onClose, 
  onStatusChange 
}) => {
  const { toast } = useToast();
  const [adminPinOpen, setAdminPinOpen] = useState(false);
  const [fiscalActive, setFiscalActive] = useState(false);
  const [nfceLoading, setNfceLoading] = useState(false);
  const [respondingDispute, setRespondingDispute] = useState(false);
  const [answeredDisputeId, setAnsweredDisputeId] = useState('');

  // Log detalhado quando o modal é renderizado
  useEffect(() => {
    if (isOpen && !order) return;
  }, [isOpen, order]);

  useEffect(() => {
    setAnsweredDisputeId('');
  }, [order?.id]);

  useEffect(() => {
    let active = true;

    if (!isOpen || !order?.user_id) {
      setFiscalActive(false);
      return;
    }

    isFiscalEmissionActiveForUser(order.user_id).then((enabled) => {
      if (active) setFiscalActive(enabled);
    });

    return () => {
      active = false;
    };
  }, [isOpen, order?.id, order?.user_id]);

  // Adicionar try-catch para capturar erros de renderização
  try {
    if (!order) {
      return null;
    }

    const toNumber = (v: any) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        let s = v.trim();
        s = s.replace(/[^0-9.,-]/g, '');
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        const decPos = Math.max(lastComma, lastDot);
        if (decPos >= 0) {
          const intPart = s.slice(0, decPos).replace(/[^0-9-]/g, '');
          const frac = s.slice(decPos + 1).replace(/[^0-9]/g, '');
          s = `${intPart}.${frac}`;
        } else {
          s = s.replace(/[^0-9-]/g, '');
        }
        const n = Number(s);
        return Number.isFinite(n) ? n : 0;
      }
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const formatCurrency = (value: any) => {
      const n = toNumber(value);
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
    };

    const formatDateTime = (dateString: string) => {
      try {
        return new Date(dateString).toLocaleString('pt-BR');
      } catch {
        return dateString || 'Data não disponível';
      }
    };

    const itemQuantity = (item: any) => {
      const q = toNumber(item?.quantity);
      return q > 0 ? q : 1;
    };

    const itemUnitPrice = (item: any) => {
      const p = toNumber(item?.unit_price ?? item?.price);
      return p >= 0 ? p : 0;
    };

    const optionsExtra = (item: any) => {
      const opts = Array.isArray(item?.options) ? item.options : [];
      return opts.reduce((acc: number, o: any) => {
        if (!o || typeof o === 'string') return acc;
        const p = toNumber(o?.price ?? o?.additional_price);
        return acc + (p > 0 ? p : 0);
      }, 0);
    };

    const itemTotal = (item: any) => {
      const t = toNumber(item?.total_price ?? item?.subtotal ?? item?.total);
      if (t > 0) return t;
      const q = itemQuantity(item);
      const unit = itemUnitPrice(item);
      const extra = optionsExtra(item);
      return q * unit + q * extra;
    };

    const itemsSubtotal = Array.isArray(order.items)
      ? order.items.reduce((acc, it) => acc + itemTotal(it), 0)
      : 0;

    const deliveryFee = toNumber(order?.delivery_fee);
    const discountValue = Math.max(0, toNumber(order?.discount));
    const orderTotal = toNumber(order?.total);
    const orderSubtotal = toNumber(order?.subtotal);
    const subtotalValue =
      orderSubtotal > 0 ? orderSubtotal : itemsSubtotal > 0 ? itemsSubtotal : Math.max(0, orderTotal - (deliveryFee > 0 ? deliveryFee : 0));
    const totalValue = orderTotal > 0 ? orderTotal : subtotalValue + (deliveryFee > 0 ? deliveryFee : 0);
    const couponCode = String(order?.coupon_code || '').trim();
    const isLoyaltyDiscount = couponCode.startsWith('FID');
    const mapsLink = getOrderMapsLink(order);
    const ifoodData = order?.integration_payload?.ifood || {};
    const paymentBrand = String(ifoodData?.paymentSummary?.brand || '').trim();
    const paymentMethodDetail = String(ifoodData?.paymentSummary?.method || '').trim();
    const paymentMethods = Array.isArray(ifoodData?.paymentSummary?.methods) ? ifoodData.paymentSummary.methods : [];
    const benefitsSummary = Array.isArray(ifoodData?.benefitsSummary) ? ifoodData.benefitsSummary : [];
    const negotiation = ifoodData?.negotiation && typeof ifoodData.negotiation === 'object' ? ifoodData.negotiation : null;
    const disputeId = String(negotiation?.disputeId || negotiation?.id || '').trim();
    const disputeOpen = Boolean(disputeId && negotiation?.status === 'OPEN' && answeredDisputeId !== disputeId);
    const customerDocument = String(order?.customer_document || '').trim();
    const pickupCode = String(order?.pickup_code || ifoodData?.pickupCode || '').trim();
    const scheduledAt = String(order?.scheduled_at || ifoodData?.deliveryDateTimeStart || '').trim();

    const copyLocation = async () => {
      try {
        if (order.customer_latitude && order.customer_longitude) {
          const coordinates = `${order.customer_latitude},${order.customer_longitude}`;
          await navigator.clipboard.writeText(coordinates);
          toast({
            title: "Coordenadas copiadas!",
            description: "As coordenadas foram copiadas para a área de transferência.",
          });
        } else if (order.customer_address) {
          await navigator.clipboard.writeText(order.customer_address);
          toast({
            title: "Endereço copiado!",
            description: "O endereço foi copiado para a área de transferência.",
          });
        }
      } catch (error) {
        console.error('Erro ao copiar localização:', error);
        toast({
          title: "Erro ao copiar",
          description: "Não foi possível copiar a localização.",
          variant: "destructive",
        });
      }
    };

    const chooseReason = (values: unknown, fallback: string) => {
      const reasons = Array.isArray(values) ? values.map((value) => String(value || '').trim()).filter(Boolean) : [];
      if (reasons.length <= 1) return reasons[0] || fallback;
      const selected = window.prompt(
        `Informe o motivo da negociação iFood:\n${reasons.join('\n')}`,
        reasons[0],
      );
      return String(selected || '').trim();
    };

    const handleDisputeResponse = async (response: 'accept' | 'reject' | 'alternative') => {
      if (!disputeId || respondingDispute) return;

      let responseBody: Record<string, unknown> | undefined;
      if (response === 'accept') {
        const acceptReasons = negotiation?.acceptCancellationReasons;
        const reason = chooseReason(acceptReasons, '');
        responseBody = reason ? { reason } : undefined;
      } else if (response === 'reject') {
        const reason = chooseReason(negotiation?.rejectCancellationReasons, 'UNKNOWN_ISSUE');
        if (!reason) return;
        responseBody = { reason };
      } else {
        const alternatives = Array.isArray(negotiation?.alternatives) ? negotiation.alternatives : [];
        const alternative = alternatives[0];
        if (!alternative) {
          toast({ title: 'Contraproposta indisponível', description: 'O iFood não ofereceu alternativa para esta negociação.', variant: 'destructive' });
          return;
        }

        const alternativeType = String(alternative?.type || '').toUpperCase();
        if (alternativeType === 'REFUND' || alternativeType === 'BENEFIT') {
          const maxCents = toNumber(alternative?.metadata?.maxAmount?.value);
          const maxReais = maxCents / 100;
          const rawValue = window.prompt(
            `Valor da contraproposta em reais${maxReais > 0 ? ` (máximo ${formatCurrency(maxReais)})` : ''}:`,
            maxReais > 0 ? String(maxReais.toFixed(2)).replace('.', ',') : '',
          );
          if (!rawValue) return;
          const valueInCents = Math.round(toNumber(rawValue) * 100);
          if (valueInCents <= 0 || (maxCents > 0 && valueInCents > maxCents)) {
            toast({ title: 'Valor inválido', description: 'Informe um valor permitido pelo iFood.', variant: 'destructive' });
            return;
          }
          responseBody = {
            type: alternativeType,
            metadata: { amount: { currency: 'BRL', value: String(valueInCents) } },
          };
        } else if (alternativeType === 'ADDITIONAL_TIME') {
          const allowed = Array.isArray(alternative?.metadata?.allowedsAdditionalTimeInMinutes)
            ? alternative.metadata.allowedsAdditionalTimeInMinutes.map((value: unknown) => Number(value)).filter(Number.isFinite)
            : [];
          const minutes = Number(window.prompt(`Minutos adicionais permitidos: ${allowed.join(', ')}`, String(allowed[0] || 10)));
          if (!Number.isFinite(minutes) || (allowed.length > 0 && !allowed.includes(minutes))) {
            toast({ title: 'Tempo inválido', description: 'Escolha um dos tempos permitidos pelo iFood.', variant: 'destructive' });
            return;
          }
          const reason = chooseReason(alternative?.metadata?.allowedsAdditionalTimeReasons, 'HIGH_STORE_DEMAND');
          if (!reason) return;
          responseBody = { type: alternativeType, metadata: { additionalTimeInMinutes: minutes, reason } };
        } else {
          toast({ title: 'Alternativa não suportada', description: `Tipo recebido: ${alternativeType || 'não informado'}.`, variant: 'destructive' });
          return;
        }
      }

      setRespondingDispute(true);
      try {
        const { data, status } = await invokeEdgeFunction('ifood-manager', {
          action: 'respond_dispute',
          disputeId,
          response,
          responseBody,
        });
        if (status >= 400 || !data?.ok) {
          throw new Error(String(data?.message || data?.error || 'Não foi possível responder à negociação'));
        }
        setAnsweredDisputeId(disputeId);
        toast({ title: 'Negociação respondida', description: 'A resposta foi enviada ao iFood. O resultado será atualizado pelos eventos.' });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        toast({ title: 'Falha ao responder ao iFood', description: message, variant: 'destructive' });
      } finally {
        setRespondingDispute(false);
      }
    };

    const handleStatusUpdate = (newStatus: string) => {
      if (!onStatusChange) return;
      if (newStatus === 'cancelled') {
        const session = getLocalOperatorSession();
        if (canCancelOrder(session)) {
          onStatusChange(order.id, newStatus);
          return;
        }
        setAdminPinOpen(true);
        return;
      }
      onStatusChange(order.id, newStatus);
    };

    const isIfoodMerchantDelivery = String(order?.source || '').toLowerCase() === 'ifood'
      && String(order?.order_type || '').toLowerCase() === 'delivery'
      && String(ifoodData?.deliveredBy || '').toUpperCase() === 'MERCHANT';

    const handleEmitNfce = async () => {
      if (!order) return;

      setNfceLoading(true);
      try {
        const documentDigits = String(order.customer_document || '').replace(/\D/g, '');
        const consumerData = order.customer_name || documentDigits
          ? {
              nome: order.customer_name || null,
              cpf_cnpj: documentDigits || null,
            }
          : null;
        const nfceData = await emitNfceForOrder(order, consumerData);

        toast({
          title: 'NFC-e emitida',
          description: `Cupom fiscal ${nfceData.numero || ''}${nfceData.protocolo ? ` - Protocolo ${nfceData.protocolo}` : ''}`,
        });

        await PrinterService.printOrder({ ...order, nfce: nfceData });
      } catch (error: any) {
        toast({
          title: 'Erro ao emitir NFC-e',
          description: error?.message || 'Não foi possível emitir o cupom fiscal.',
          variant: 'destructive',
        });
      } finally {
        setNfceLoading(false);
      }
    };

    const getStatusIcon = (status: string) => {
      switch (status) {
        case 'pending': return <Clock className="h-3 w-3" />;
        case 'accepted': return <Check className="h-3 w-3" />;
        case 'preparing': return <Package className="h-3 w-3" />;
        case 'ready': return <CheckCircle className="h-3 w-3" />;
        case 'delivered': return <Truck className="h-3 w-3" />;
        case 'cancelled': return <XCircle className="h-3 w-3" />;
        default: return <Clock className="h-3 w-3" />;
      }
    };

    const getStatusLabel = (status: string) => {
      switch (status) {
        case 'pending': return 'Pendente';
        case 'accepted': return 'Aceito (Cozinha)';
        case 'preparing': return 'Preparando';
        case 'ready': return 'Pronto';
        case 'delivered': return 'Entregue';
        case 'cancelled': return 'Cancelado';
        default: return status;
      }
    };

    const getStatusColor = (status: string) => {
      switch (status) {
        case 'pending': return 'bg-yellow-100 text-yellow-800';
        case 'accepted': return 'bg-orange-100 text-orange-800';
        case 'preparing': return 'bg-blue-100 text-blue-800';
        case 'ready': return 'bg-green-100 text-green-800';
        case 'delivered': return 'bg-gray-100 text-gray-800';
        case 'cancelled': return 'bg-red-100 text-red-800';
        default: return 'bg-gray-100 text-gray-800';
      }
    };

    return (
      <>
        <AdminPinDialog
          open={adminPinOpen}
          title="Cancelar pedido"
          description="Somente administrador pode cancelar. Digite o PIN do administrador."
          confirmLabel="Cancelar"
          onCancel={() => setAdminPinOpen(false)}
          onConfirm={async (pin) => {
            const restaurantUserId = order?.user_id || ''
            if (!restaurantUserId) {
              toast({ title: 'Erro', description: 'Restaurante não identificado', variant: 'destructive' })
              return
            }
            const res = await verifyAdminPin({ restaurantUserId, pin })
            if (!res.ok) {
              toast({ title: 'Sem permissão', description: 'PIN inválido ou não é administrador', variant: 'destructive' })
              return
            }
            onStatusChange?.(order.id, 'cancelled')
            setAdminPinOpen(false)
          }}
        />
        <Dialog open={isOpen} onOpenChange={onClose}>
          <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden overflow-x-hidden border-slate-200 bg-white p-0 shadow-2xl sm:h-[92dvh] sm:max-h-[56rem] sm:w-[calc(100vw-2rem)] sm:rounded-3xl">
          <DialogHeader className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 pr-12 sm:px-6 sm:py-5 sm:pr-14">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-wrap items-center gap-3 text-left">
                <DialogTitle className="min-w-0 text-left">
                  <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Detalhes do pedido</span>
                  <span className="mt-1 block truncate text-xl font-bold text-slate-900 sm:text-2xl">
                    #{order?.order_number || 'N/A'}
                  </span>
                </DialogTitle>
                <Badge className={`${getStatusColor(order?.status || 'pending')} inline-flex h-8 items-center gap-1.5 rounded-full border-0 px-3 text-xs font-semibold shadow-sm`}>
                  {getStatusIcon(order?.status || 'pending')}
                  {getStatusLabel(order?.status || 'pending')}
                </Badge>
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 min-w-0 justify-center rounded-xl border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 sm:h-9"
                  onClick={() => PrinterService.printOrder(order)}
                >
                  <Printer className="mr-1.5 h-4 w-4 shrink-0" />
                  Imprimir
                </Button>
                {fiscalActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 min-w-0 justify-center rounded-xl border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 sm:h-9"
                    onClick={handleEmitNfce}
                    disabled={nfceLoading}
                  >
                    <ReceiptText className="mr-1.5 h-4 w-4 shrink-0" />
                    {nfceLoading ? 'Emitindo...' : 'Emitir NFC-e'}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 min-w-0 justify-center rounded-xl border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 sm:h-9"
                  onClick={async () => {
                    try {
                      const link = `${window.location.origin}/track/${order?.id}`;
                      await navigator.clipboard.writeText(link);
                      toast({ title: 'Link copiado', description: 'Link de acompanhamento copiado.' });
                    } catch (e) {
                      toast({ title: 'Erro', description: 'Não foi possível copiar o link.', variant: 'destructive' });
                    }
                  }}
                >
                  <Copy className="mr-1.5 h-4 w-4 shrink-0" />
                  <span className="truncate">Copiar tracking</span>
                </Button>
                {order?.customer_phone && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 min-w-0 justify-center rounded-xl border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50 sm:h-9"
                    onClick={() => WhatsAppService.shareOrder(order)}
                  >
                    <MessageCircle className="mr-1.5 h-4 w-4 shrink-0" />
                    WhatsApp
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          <div
            className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain bg-white [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]"
            data-testid="order-details-scroll"
          >
            <div className="grid min-w-0 grid-cols-1 gap-4 overflow-x-hidden p-4 sm:p-6 lg:grid-cols-2">
              {/* Informações do Cliente */}
              <div className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-2">
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <User className="h-4 w-4 text-emerald-700" />
                  Informações do Cliente
                </h3>
                <div className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2.5">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nome</span>
                    <span className="mt-0.5 block break-words font-medium text-slate-800">{order?.customer_name || 'Nome não informado'}</span>
                  </div>
                  <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <Phone className="h-3 w-3" /> Telefone
                    </span>
                    <span className="mt-0.5 block break-all font-medium text-slate-800">{order?.customer_phone || 'Telefone não informado'}</span>
                  </div>
                  {order?.customer_address && (
                    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-3 sm:col-span-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                        <div className="min-w-0 flex-1">
                          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Endereço de entrega</span>
                          <p className="mt-1 break-words text-sm font-medium text-slate-800">{order.customer_address}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            onClick={copyLocation}
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg border-slate-200 bg-white px-3 text-xs"
                          >
                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                            Copiar
                          </Button>
                          {mapsLink && (
                            <Button
                              onClick={() => {
                                window.open(mapsLink, '_blank');
                              }}
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg border-slate-200 bg-white px-3 text-xs"
                            >
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              Google Maps
                            </Button>
                          )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Itens do Pedido */}
              <div className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-2">
                <h3 className="text-base font-bold text-slate-900">Itens do Pedido</h3>
                <div className="space-y-3">
                  {order?.items && Array.isArray(order.items) && order.items.length > 0 ? (
                    order.items.map((item, index) => {
                      const detailGroups = getOrderItemDetailGroups(item);
                      const itemNotes = String(item?.notes || item?.observations || '').trim();

                      return (
                        <div key={index} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <h4 className="break-words text-sm font-semibold text-slate-900">{item?.product_name || 'Produto não informado'}</h4>
                              <div className="mt-1 text-xs text-slate-600">
                                Quantidade: {itemQuantity(item)} × {formatCurrency(itemUnitPrice(item))}
                              </div>
                            </div>
                            <div className="shrink-0 text-sm font-bold text-emerald-900">
                              {formatCurrency(itemTotal(item))}
                            </div>
                          </div>
                        {detailGroups.length > 0 && (
                          <div className="text-xs">
                            <span className="font-medium text-gray-700">Adicionais e complementos:</span>
                            <div className="mt-1 space-y-2">
                              {detailGroups.map((group) => (
                                <div key={group.key} className="space-y-1">
                                  {group.label ? (
                                    <div className="font-medium text-gray-700">{group.label}:</div>
                                  ) : null}
                                  {group.items.map((detail) => (
                                    <div key={detail.key} className="flex min-w-0 flex-col gap-0.5 text-slate-600 sm:flex-row sm:justify-between sm:gap-3">
                                      <span className="min-w-0 break-words">{detail.text}</span>
                                      {detail.price && detail.price > 0 ? (
                                        <span className="whitespace-nowrap">
                                          {itemQuantity(item) > 1
                                            ? `+${formatCurrency(detail.price)} cada · total +${formatCurrency(detail.price * itemQuantity(item))}`
                                            : `+${formatCurrency(detail.price)}`}
                                        </span>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {itemNotes && (
                          <div className="text-xs">
                            <span className="font-medium text-gray-700">Observações:</span>
                            <p className="text-gray-600 mt-1">{itemNotes}</p>
                          </div>
                        )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center text-gray-500 py-4">
                      Nenhum item encontrado no pedido
                    </div>
                  )}
                </div>
              </div>

              {order?.delivery_instructions && (
                <div className="min-w-0 space-y-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm sm:p-5 lg:col-span-2">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-amber-900">Observações do pedido</h3>
                  <p className="whitespace-pre-wrap break-words text-sm text-amber-950">{order.delivery_instructions}</p>
                </div>
              )}

              {/* Resumo do Pedido */}
              <div className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <h3 className="text-base font-bold text-slate-900">Resumo do Pedido</h3>
                <div className="min-w-0 space-y-2 text-sm text-slate-700">
                  <div className="flex min-w-0 justify-between gap-4">
                    <span>Subtotal:</span>
                    <span className="shrink-0 font-medium">{formatCurrency(subtotalValue)}</span>
                  </div>
                  {deliveryFee > 0 && (
                    <div className="flex min-w-0 justify-between gap-4">
                      <span>Taxa de entrega:</span>
                      <span className="shrink-0 font-medium">{formatCurrency(deliveryFee)}</span>
                    </div>
                  )}
                  {discountValue > 0 && (
                    <div className="flex min-w-0 justify-between gap-4 text-green-700">
                      <span>{isLoyaltyDiscount ? 'Desconto fidelidade:' : 'Desconto:'}</span>
                      <span className="shrink-0 font-medium">- {formatCurrency(discountValue)}</span>
                    </div>
                  )}
                  <div className="my-3 flex min-w-0 items-center justify-between gap-4 rounded-xl bg-emerald-50 px-3 py-3 text-emerald-950">
                    <span>Total:</span>
                    <span className="shrink-0 text-lg font-bold">{formatCurrency(totalValue)}</span>
                  </div>
                  <div className="flex min-w-0 justify-between gap-4 text-xs text-slate-600">
                    <span>Método de pagamento:</span>
                    <span className="min-w-0 break-words text-right font-medium">{formatPaymentMethodLabel(order?.payment_method, order?.acceptance_status)}</span>
                  </div>
                  {paymentBrand && (
                    <div className="flex min-w-0 justify-between gap-4 text-xs text-slate-600">
                      <span>Bandeira:</span>
                      <span className="min-w-0 break-words text-right font-medium">{paymentBrand}</span>
                    </div>
                  )}
                  {paymentMethodDetail && (
                    <div className="flex min-w-0 justify-between gap-4 text-xs text-slate-600">
                      <span>Tipo iFood:</span>
                      <span className="min-w-0 break-words text-right font-medium">{paymentMethodDetail}</span>
                    </div>
                  )}
                  {toNumber(order?.change_amount) > 0 && (
                    <div className="flex min-w-0 justify-between gap-4 text-xs text-slate-600">
                      <span>Troco para:</span>
                      <span className="shrink-0 font-medium">{formatCurrency(order?.change_amount)}</span>
                    </div>
                  )}
                  {couponCode && (
                    <div className="flex min-w-0 justify-between gap-4 text-xs text-slate-600">
                      <span>{isLoyaltyDiscount ? 'Código fidelidade:' : 'Cupom aplicado:'}</span>
                      <span className="min-w-0 break-all text-right font-medium">{couponCode}</span>
                    </div>
                  )}
                  {benefitsSummary.length > 0 && (
                    <div className="min-w-0 space-y-1 pt-1 text-xs text-slate-600">
                      <span className="font-medium">Subsídios e descontos:</span>
                      {benefitsSummary.map((benefit: any, index: number) => (
                        <div key={`${benefit?.description || 'benefit'}-${index}`} className="flex min-w-0 justify-between gap-3">
                          <span className="min-w-0 break-words">{String(benefit?.description || 'Desconto iFood')}</span>
                          <span className="shrink-0 font-medium">- {formatCurrency(benefit?.value || 0)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Informações Adicionais */}
              <div className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <h3 className="text-base font-bold text-slate-900">Informações Adicionais</h3>
                <div className="min-w-0 space-y-3 text-sm">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    <span className="min-w-0 break-words text-xs text-slate-700">Pedido realizado em: {formatDateTime(order?.created_at || '')}</span>
                  </div>
                  {order?.source === 'ifood' && (
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Package className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <span className="min-w-0 break-all text-xs text-slate-700">Canal: iFood {order?.external_order_id ? `· ID ${order.external_order_id}` : ''}</span>
                    </div>
                  )}
                  {customerDocument && (
                    <div className="flex min-w-0 items-start gap-2.5">
                      <User className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <span className="min-w-0 break-all text-xs text-slate-700">CPF/CNPJ para fiscal: {customerDocument}</span>
                    </div>
                  )}
                  {pickupCode && (
                    <div className="flex min-w-0 items-start gap-2.5">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <span className="min-w-0 break-all text-xs text-slate-700">Código de coleta: {pickupCode}</span>
                    </div>
                  )}
                  {scheduledAt && (
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <span className="min-w-0 break-words text-xs text-slate-700">Agendado para: {formatDateTime(scheduledAt)}</span>
                    </div>
                  )}
                  {order?.estimated_time && (
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <span className="min-w-0 break-words text-xs text-slate-700">Tempo estimado: {order.estimated_time} {typeof order.estimated_time === 'number' ? 'minutos' : ''}</span>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
          {/* Ações sempre visíveis, sem exigir rolagem até o fim do pedido. */}
          {onStatusChange && order && ['pending', 'preparing', 'ready'].includes(order.status) && (
            <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
              {order.status === 'pending' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    onClick={() => handleStatusUpdate('preparing')}
                    className="h-11 rounded-xl bg-emerald-600 text-sm font-bold shadow-sm hover:bg-emerald-700"
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Aceitar pedido
                  </Button>
                  <Button
                    onClick={() => handleStatusUpdate('cancelled')}
                    variant="destructive"
                    className="h-11 rounded-xl text-sm font-bold shadow-sm"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancelar
                  </Button>
                </div>
              )}

              {order.status === 'preparing' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    onClick={() => handleStatusUpdate('ready')}
                    className="h-11 rounded-xl bg-lime-600 text-sm font-bold shadow-sm hover:bg-lime-700"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Marcar como pronto
                  </Button>
                  <Button
                    onClick={() => handleStatusUpdate('cancelled')}
                    variant="destructive"
                    className="h-11 rounded-xl text-sm font-bold shadow-sm"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancelar
                  </Button>
                </div>
              )}

              {order.status === 'ready' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    onClick={() => handleStatusUpdate('delivered')}
                    className="h-11 rounded-xl bg-blue-600 text-sm font-bold shadow-sm hover:bg-blue-700"
                  >
                    <Truck className="mr-2 h-4 w-4" />
                    Finalizar pedido
                  </Button>
                  <Button
                    onClick={() => handleStatusUpdate('cancelled')}
                    variant="destructive"
                    className="h-11 rounded-xl text-sm font-bold shadow-sm"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          )}
          </DialogContent>
        </Dialog>
      </>
    );
  } catch (error) {
    console.error('❌ ORDER_DETAILS_MODAL - Erro de renderização:', error);
    
    // Retornar um modal de erro em caso de falha
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600">Erro ao carregar detalhes</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Ocorreu um erro ao carregar os detalhes do pedido. Tente novamente.
            </p>
            <div className="text-xs text-gray-500 bg-gray-100 p-2 rounded">
              Erro: {error?.message || 'Erro desconhecido'}
            </div>
            <Button onClick={onClose} className="w-full">
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

};

export default OrderDetailsModal;
