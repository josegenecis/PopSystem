import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Trash2, Minus, Plus, CreditCard, Smartphone, CheckCircle2 } from 'lucide-react';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import TotemPixCheckoutModal from '@/components/totem/TotemPixCheckoutModal';
import { PrinterService } from '@/utils/printerService';
import { notifyOrderCreatedById } from '@/utils/orderNotifications';
import { useToast } from '@/hooks/use-toast';
import { isConfiguredCartItem } from '@/hooks/useSimpleCart';
import { formatBRL } from '@/lib/currency';

export interface TotemCartItem {
  product: { id: string; name: string; price: number; image_url?: string };
  quantity: number;
  variations: string[];
  options?: Array<{
    key?: string;
    label?: string;
    value?: string;
    price?: number;
  }>;
  notes: string;
  totalPrice: number;
  uniqueId: string;
}

interface TotemCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  cart: TotemCartItem[];
  onUpdateQuantity: (uniqueId: string, quantity: number) => void;
  onRemoveItem: (uniqueId: string) => void;
  onClearCart: () => void;
  total: number;
  orderType: 'dine_in' | 'pickup';
  onNewSession: () => void;
}

type Payment = 'pix' | 'cartao_credito' | 'cartao_debito';

export default function TotemCheckoutModal(props: TotemCheckoutModalProps) {
  const { isOpen, onClose, userId, cart, onUpdateQuantity, onRemoveItem, onClearCart, total, orderType, onNewSession } = props;
  const [payment, setPayment] = useState<Payment>('pix');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pixCheckout, setPixCheckout] = useState<{ correlationID: string; brCode: string; qrCodeImage?: string; paymentLinkUrl?: string } | null>(null);
  const [successOrder, setSuccessOrder] = useState<any | null>(null);
  const [orderNumber, setOrderNumber] = useState(() => `TOT${Date.now().toString().slice(-6)}`);
  const senha = useMemo(() => String(orderNumber).slice(-4), [orderNumber]);
  const { toast } = useToast();

  useEffect(() => {
    if (!isOpen) return;
    if (pixCheckout || successOrder) return;
    setOrderNumber(`TOT${Date.now().toString().slice(-6)}`);
  }, [isOpen, pixCheckout, successOrder]);

  const cartItems = useMemo(() => {
    return cart.map((item) => ({
      product_id: item.product.id,
      product_name: item.product.name,
      quantity: item.quantity,
      price: item.product.price,
      options: Array.isArray(item.options) ? item.options : [],
      variations: item.variations,
      notes: item.notes,
      total: item.totalPrice
    }));
  }, [cart]);

  const canSubmit = useMemo(() => {
    return Boolean(userId && cart.length > 0);
  }, [userId, cart.length]);

  const resetToNewOrder = () => {
    setPixCheckout(null);
    setSuccessOrder(null);
    setIsSubmitting(false);
    setPayment('pix');
    setOrderNumber(`TOT${Date.now().toString().slice(-6)}`);
    onNewSession();
  };

  const printCoupon = async (order: any) => {
    try {
      await PrinterService.printOrder(order);
    } catch {
      // A reimpressao continua disponivel mesmo quando a impressora nao esta conectada.
    }
  };

  const finalizeNonPix = async () => {
    setIsSubmitting(true);
    try {
      const orderData: any = {
        user_id: userId,
        customer_name: orderType === 'dine_in' ? 'Totem - Consumir no local' : 'Totem - Para levar',
        customer_phone: null,
        customer_address: null,
        order_type: orderType,
        items: cartItems,
        total: total,
        delivery_fee: 0,
        payment_method: payment,
        change_amount: null,
        status: 'pending',
        acceptance_status: 'pending_acceptance',
        order_number: orderNumber,
        variations: { source: 'TOTEM', fulfillment_label: orderType === 'dine_in' ? 'Consumir no local' : 'Para viagem' }
      };

      const { data, error } = await (supabase as any)
        .from('orders')
        .insert([orderData])
        .select()
        .single();

      if (error) throw error;
      setSuccessOrder(data);
      onClearCart();
      try {
        await notifyOrderCreatedById(data?.id);
      } catch (waErr) {
        console.warn('Falha ao notificar pedido do totem via WhatsApp:', waErr);
      }
      await printCoupon(data);
    } catch (e: any) {
      const msg = String(e?.message || e || 'Erro ao criar pedido');
      throw new Error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startPix = async () => {
    setIsSubmitting(true);
    try {
      const orderData: any = {
        user_id: userId,
        customer_name: orderType === 'dine_in' ? 'Totem - Consumir no local' : 'Totem - Para levar',
        customer_phone: null,
        customer_address: null,
        order_type: orderType,
        items: cartItems,
        total: total,
        delivery_fee: 0,
        payment_method: 'pix_online',
        change_amount: null,
        status: 'pending',
        acceptance_status: 'awaiting_pix_payment',
        order_number: orderNumber,
        variations: { source: 'TOTEM', fulfillment_label: orderType === 'dine_in' ? 'Consumir no local' : 'Para viagem' }
      };

      const { data, status } = await invokeEdgeFunction('pix-start-checkout', {
        restaurantUserId: userId,
        orderPayload: orderData,
        preferredMethod: 'pix'
      }, { allowAnonymous: true });

      if (!data) {
        throw new Error(`Erro na conexão com checkout (HTTP ${status})`);
      }
      if (!data.ok) {
        throw new Error(data.error || `Não foi possível iniciar pagamento (HTTP ${status})`);
      }
      if (data.initPoint) {
        window.location.href = data.initPoint;
        return;
      }
      setPixCheckout({
        correlationID: data.correlationID,
        brCode: data.brCode,
        qrCodeImage: data.qrCodeImage,
        paymentLinkUrl: data.paymentLinkUrl
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaidPix = async (orderId: string) => {
    try {
      const { data } = await (supabase as any)
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();
      if (data) {
        setSuccessOrder(data);
        onClearCart();
        await printCoupon(data);
      }
      setPixCheckout(null);
    } catch {
      setPixCheckout(null);
    }
  };

  const handleConfirm = async () => {
    if (!canSubmit || isSubmitting) return;
    try {
      if (payment === 'pix') {
        await startPix();
        return;
      }
      await finalizeNonPix();
    } catch (error) {
      toast({
        title: 'Não foi possível finalizar',
        description: error instanceof Error ? error.message : 'Confira a conexão e tente novamente.',
        variant: 'destructive',
      });
    }
  };

  if (successOrder) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-lg rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-3xl">Pedido confirmado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Card className="rounded-lg border-0 bg-gradient-to-r from-emerald-600 to-green-600 p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-base font-bold text-white/90">Sua senha</div>
                  <div className="text-7xl font-black tracking-widest">{senha}</div>
                </div>
                <CheckCircle2 className="h-14 w-14 text-white" />
              </div>
              <div className="mt-3 text-base font-semibold text-white/90">
                Pedido {successOrder?.order_number ? `#${successOrder.order_number}` : ''}
              </div>
              <div className="mt-1 text-sm font-black text-white/90">{orderType === 'dine_in' ? 'COMER AQUI' : 'PARA LEVAR'}</div>
            </Card>

            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-center text-sm font-bold leading-6 text-emerald-800">
              {String(successOrder?.payment_method || '').includes('pix')
                ? 'Pagamento confirmado. Aguarde sua senha ser chamada.'
                : 'Dirija-se ao caixa ou à maquininha com esta senha para concluir o pagamento.'}
            </div>

            <div>
              <Button className="h-14 w-full rounded-lg bg-boracume-orange text-base font-bold hover:bg-boracume-orange/90" onClick={resetToNewOrder}>
                Novo pedido
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-3xl">Finalizar pedido</DialogTitle>
        </DialogHeader>

        {pixCheckout && (
          <TotemPixCheckoutModal
            isOpen={!!pixCheckout}
            onClose={() => setPixCheckout(null)}
            correlationID={pixCheckout.correlationID}
            brCode={pixCheckout.brCode}
            qrCodeImage={pixCheckout.qrCodeImage}
            paymentLinkUrl={pixCheckout.paymentLinkUrl}
            onPaid={handlePaidPix}
          />
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-3">
            <div className="text-base font-black">Itens do pedido</div>
            <div className="space-y-2">
              {cart.map((item) => {
                const configuredItem = isConfiguredCartItem(item);
                return (
                <Card key={item.uniqueId} className="rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-black">{item.product.name}</div>
                      {item.variations?.length ? (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.variations.join(', ')}</div>
                      ) : null}
                      {item.notes ? (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">Obs: {item.notes}</div>
                      ) : null}
                      {configuredItem ? (
                        <div className="mt-2 text-xs font-semibold text-orange-700">Cada unidade deve ser personalizada separadamente.</div>
                      ) : null}
                      <div className="text-sm font-bold text-boracume-orange mt-2">{formatBRL(item.totalPrice)}</div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => onRemoveItem(item.uniqueId)} disabled={isSubmitting} aria-label={`Remover ${item.product.name} do pedido`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" className="h-11 w-11 rounded-lg" onClick={() => onUpdateQuantity(item.uniqueId, item.quantity - 1)} disabled={isSubmitting || item.quantity <= 1} aria-label={`Diminuir quantidade de ${item.product.name}`}>
                          <Minus className="h-4 w-4" />
                        </Button>
                        <div className="w-8 text-center text-lg font-black">{item.quantity}</div>
                        <Button variant="outline" size="icon" className="h-11 w-11 rounded-lg" onClick={() => onUpdateQuantity(item.uniqueId, item.quantity + 1)} disabled={isSubmitting || configuredItem} aria-label={configuredItem ? `Adicione outra unidade de ${item.product.name} e personalize novamente` : `Aumentar quantidade de ${item.product.name}`} title={configuredItem ? 'Adicione outra unidade e personalize os complementos novamente.' : 'Aumentar quantidade'}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <Card className="rounded-lg bg-slate-50 p-5">
              <div className="flex items-center justify-between">
                <div className="text-base font-bold text-muted-foreground">Total</div>
                <div className="text-4xl font-black">{formatBRL(total)}</div>
              </div>
              <div className="mt-2 text-sm font-semibold text-muted-foreground">Senha do pedido: {senha}</div>
            </Card>

            <div className="space-y-2">
              <div className="text-base font-black">Forma de pagamento</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  type="button"
                  variant={payment === 'pix' ? 'default' : 'outline'}
                  className={`h-16 rounded-lg text-base font-black ${payment === 'pix' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
                  onClick={() => setPayment('pix')}
                  disabled={isSubmitting}
                >
                  <Smartphone className="mr-2 h-4 w-4" />
                  PIX
                </Button>
                <Button
                  type="button"
                  variant={payment === 'cartao_credito' ? 'default' : 'outline'}
                  className={`h-16 rounded-lg text-base font-black ${payment === 'cartao_credito' ? 'bg-violet-600 hover:bg-violet-700' : ''}`}
                  onClick={() => setPayment('cartao_credito')}
                  disabled={isSubmitting}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Crédito
                </Button>
                <Button
                  type="button"
                  variant={payment === 'cartao_debito' ? 'default' : 'outline'}
                  className={`h-16 rounded-lg text-base font-black ${payment === 'cartao_debito' ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                  onClick={() => setPayment('cartao_debito')}
                  disabled={isSubmitting}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Débito
                </Button>
              </div>
              {payment !== 'pix' ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-5 text-amber-900">
                  O pagamento será concluído na maquininha integrada ao atendimento. O Totem aceita somente meios eletrônicos.
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className="h-12 rounded-lg px-6 font-bold" onClick={onClose} disabled={isSubmitting}>
            Voltar
          </Button>
          <Button
            className="h-12 rounded-lg bg-boracume-orange px-6 font-black hover:bg-boracume-orange/90"
            onClick={handleConfirm}
            disabled={!canSubmit || isSubmitting}
          >
            {payment === 'pix' ? 'Pagar com PIX' : 'Gerar senha para pagar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
