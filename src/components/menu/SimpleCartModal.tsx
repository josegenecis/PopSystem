
import React, { useRef, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Plus, Minus, Navigation, MapPin, Phone, User, CreditCard, Banknote, Smartphone, CheckCircle, Loader2, CalendarClock, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useCustomerLookup } from '@/hooks/useCustomerLookup';
import { SimpleVariationModal } from '@/components/menu/SimpleVariationModal';
import PixCheckoutModal from '@/components/payment/PixCheckoutModal';
import PopPayCardCheckoutModal from '@/components/payment/PopPayCardCheckoutModal';
import { getOrderItemDetailGroups } from '@/lib/orderDetails';
import { useToast } from '@/hooks/use-toast';
import { isConfiguredCartItem } from '@/hooks/useSimpleCart';
import { resolveDeliveryFee } from '@/lib/deliveryPricing';
import { createMarketingContent, trackMarketingEvent } from '@/lib/marketingTracking';
import { buildOrderScheduleSlots, getScheduledPreparationAt, type OrderSchedulingConfig } from '@/lib/orderScheduling';
import { isProductAvailableAt } from '@/lib/productAvailability';

interface CartItem {
  product: {
    id: string;
    name: string;
    price: number;
    image_url?: string;
  };
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

type PaymentMethodCode = 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'cartao' | 'cartao_online';
type OrderMode = 'delivery' | 'pickup';

interface CheckoutPaymentMethod {
  id: string;
  name: string;
  is_card: boolean;
  extra_fee_percent: number;
  icon: 'pix' | 'cartao_credito' | 'cartao_debito' | 'cartao' | 'dinheiro';
  code: PaymentMethodCode;
}

type UpsellOffer = {
  ruleId: string;
  triggerProductId: string | null;
  message: string | null;
  discountType: 'percentage' | 'fixed' | null;
  discountValue: number | null;
  product: { id: string; name: string; price: number; description?: string; image_url?: string };
};

const normalizePaymentMethodText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const inferPaymentMethodCode = (method: { id?: string; name?: string; is_card?: boolean; icon?: string | null }): PaymentMethodCode => {
  const raw = [
    normalizePaymentMethodText(method.id),
    normalizePaymentMethodText(method.name),
    normalizePaymentMethodText(method.icon)
  ].join(' ');

  if (raw.includes('pix')) return 'pix';
  if (raw.includes('online') && (raw.includes('cartao') || raw.includes('credito') || raw.includes('credit'))) return 'cartao_online';
  if (raw.includes('debito')) return 'cartao_debito';
  if (raw.includes('credito') || raw.includes('credit')) return 'cartao_credito';
  if (raw.includes('dinheiro') || raw.includes('cash') || raw.includes('especie')) return 'dinheiro';
  return method.is_card ? 'cartao' : 'dinheiro';
};

const getPaymentMethodIcon = (code: PaymentMethodCode): CheckoutPaymentMethod['icon'] => {
  switch (code) {
    case 'pix':
      return 'pix';
    case 'cartao_credito':
      return 'cartao_credito';
    case 'cartao_debito':
      return 'cartao_debito';
    case 'cartao':
      return 'cartao';
    case 'cartao_online':
      return 'cartao_credito';
    default:
      return 'dinheiro';
  }
};

const paymentMethodPriority: Record<PaymentMethodCode, number> = {
  pix: 0,
  cartao_online: 1,
  cartao_credito: 2,
  cartao_debito: 3,
  cartao: 4,
  dinheiro: 5
};

const mapCheckoutPaymentMethod = (method: any): CheckoutPaymentMethod => {
  const isCard = Boolean(method?.is_card);
  const code = inferPaymentMethodCode({
    id: String(method?.id || ''),
    name: String(method?.name || ''),
    is_card: isCard,
    icon: typeof method?.icon === 'string' ? method.icon : null
  });
  const displayName = code === 'cartao_credito'
      ? 'Crédito na entrega'
      : code === 'cartao_debito'
        ? 'Débito na entrega'
        : code === 'cartao'
          ? 'Cartão na entrega'
          : String(method?.name || '');

  return {
    id: String(method?.id || code),
    name: displayName,
    is_card: isCard,
    extra_fee_percent: Number(method?.extra_fee_percent || 0),
    icon: getPaymentMethodIcon(code),
    code
  };
};

const fallbackPaymentMethods: CheckoutPaymentMethod[] = [
  { id: 'pix', name: 'PIX', is_card: false, extra_fee_percent: 0, icon: 'pix', code: 'pix' },
  { id: 'cartao_credito', name: 'Crédito na entrega', is_card: true, extra_fee_percent: 0, icon: 'cartao_credito', code: 'cartao_credito' },
  { id: 'cartao_debito', name: 'Débito na entrega', is_card: true, extra_fee_percent: 0, icon: 'cartao_debito', code: 'cartao_debito' },
  { id: 'dinheiro', name: 'Dinheiro', is_card: false, extra_fee_percent: 0, icon: 'dinheiro', code: 'dinheiro' }
];

interface SimpleCartModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  total: number;
  onUpdateQuantity: (uniqueId: string, quantity: number) => void;
  onRemoveItem: (uniqueId: string) => void;
  onPlaceOrder: (orderData: any) => void;
  deliveryZones?: any[];
  deliverySettings?: any;
  userId: string;
  isStoreOpen?: boolean;
  storeClosedMessage?: string;
  schedulingConfig?: OrderSchedulingConfig;
  openingHours?: unknown;
  onPixPaid?: (orderId: string) => void;
}

export const SimpleCartModal: React.FC<SimpleCartModalProps> = ({
  isOpen,
  onClose,
  cart,
  total,
  onUpdateQuantity,
  onRemoveItem,
  onPlaceOrder,
  deliveryZones = [],
  deliverySettings = null,
  userId,
  isStoreOpen = true,
  storeClosedMessage = 'A loja está fechada no momento.',
  schedulingConfig,
  openingHours,
  onPixPaid
}) => {
  const { toast } = useToast();
  const formatBRL = (value: number) =>
    `R$ ${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const menuPrimaryColor = 'var(--menu-primary, #85C441)';
  const menuPriceColor = 'var(--menu-price, #EF6C20)';
  const menuSecondaryColor = 'var(--menu-secondary, #063D2E)';
  const menuBackgroundColor = 'var(--menu-bg, #F7EEDF)';
  const menuAccentBorder = 'rgba(133, 196, 65, 0.18)';

  const [customerName, setCustomerName] = React.useState('');
  const [customerPhone, setCustomerPhone] = React.useState('');
  const [customerNeighborhood, setCustomerNeighborhood] = React.useState('');
  const [customerAddress, setCustomerAddress] = React.useState('');
  const [isExistingCustomer, setIsExistingCustomer] = React.useState(false);
  const [orderMode, setOrderMode] = React.useState<OrderMode>('delivery');
  const [deliveryZoneId, setDeliveryZoneId] = React.useState('');
  const [isDetectingZone, setIsDetectingZone] = React.useState(false);
  const [detectZoneError, setDetectZoneError] = React.useState<string | null>(null);
  const [deliveryQuote, setDeliveryQuote] = React.useState<any | null>(null);
  const detectTimerRef = useRef<number | null>(null);
  const zoneWasAutoRef = useRef(false);
  const checkoutTrackedRef = useRef(false);
  const paymentTrackedRef = useRef(false);
  const [paymentMethod, setPaymentMethod] = React.useState('');
  const [changeAmount, setChangeAmount] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [fulfillmentTime, setFulfillmentTime] = React.useState<'asap' | 'scheduled'>('asap');
  const [scheduledAt, setScheduledAt] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const submittingRef = React.useRef(false);
  const [pixCheckout, setPixCheckout] = React.useState<null | { correlationID: string; brCode: string; qrCodeImage?: string; paymentLinkUrl?: string; paymentId?: string }>(null);
  const [cardCheckoutOrder, setCardCheckoutOrder] = React.useState<any | null>(null);
  const [upsellOpen, setUpsellOpen] = React.useState(false);
  const [upsellOffers, setUpsellOffers] = React.useState<UpsellOffer[]>([]);
  const [pendingOrderData, setPendingOrderData] = React.useState<any | null>(null);
  const [upsellSelectedProduct, setUpsellSelectedProduct] = React.useState<any | null>(null);
  const [selectedUpsellOffer, setSelectedUpsellOffer] = React.useState<UpsellOffer | null>(null);
  const [upsellVariationOpen, setUpsellVariationOpen] = React.useState(false);
  const [upsellBusy, setUpsellBusy] = React.useState(false);
  const [upsellLoadingRuleId, setUpsellLoadingRuleId] = React.useState<string | null>(null);
  
  // Coupon State
  const [couponCode, setCouponCode] = React.useState('');
  const [couponError, setCouponError] = React.useState('');
  const [discount, setDiscount] = React.useState(0);
  const [appliedCoupon, setAppliedCoupon] = React.useState<{ code: string; type: string } | null>(null);
  const [autoLoyaltyReward, setAutoLoyaltyReward] = React.useState<{ id: string; code: string; type: string; discountAmount: number; message: string } | null>(null);
  const [firstOrderPromotion, setFirstOrderPromotion] = React.useState<null | {
    id: string;
    title: string;
    rewardType: 'percent' | 'fixed' | 'free_product';
    discountAmount: number;
    message: string;
    product: null | { id: string; name: string; price: number; imageUrl?: string | null };
  }>(null);
  const [loyaltyProgress, setLoyaltyProgress] = React.useState<string[]>([]);
  const [isValidatingCoupon, setIsValidatingCoupon] = React.useState(false);
  const [isCheckingLoyalty, setIsCheckingLoyalty] = React.useState(false);
  const [scheduleClock, setScheduleClock] = React.useState(() => Date.now());
  const scheduleSlots = React.useMemo(
    () => schedulingConfig?.enabled ? buildOrderScheduleSlots(openingHours, schedulingConfig, new Date(scheduleClock)) : [],
    [openingHours, schedulingConfig, scheduleClock],
  );
  const canPlaceAtSelectedTime = isStoreOpen || (fulfillmentTime === 'scheduled' && Boolean(scheduledAt));

  const [location, setLocation] = React.useState({
    latitude: null as number | null,
    longitude: null as number | null,
    accuracy: null as number | null,
    isLoading: false,
    error: null as string | null
  });

  const [paymentMethods, setPaymentMethods] = useState<CheckoutPaymentMethod[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<CheckoutPaymentMethod | null>(null);
  const [pixOnlineCheckoutAvailable, setPixOnlineCheckoutAvailable] = useState<boolean | null>(null);
  const [cardOnlineCheckoutAvailable, setCardOnlineCheckoutAvailable] = useState(false);
  const [mercadoPagoPublicKey, setMercadoPagoPublicKey] = useState('');
  const isPixSelected = selectedPaymentMethod?.code === 'pix';
  const isCardOnlineSelected = selectedPaymentMethod?.code === 'cartao_online';
  const isCardOnDeliverySelected = selectedPaymentMethod?.code === 'cartao';
  const visiblePaymentMethods = React.useMemo(() => {
    const deliveryCardMethods = paymentMethods.filter((method) =>
      ['cartao', 'cartao_credito', 'cartao_debito'].includes(method.code)
    );
    const normalizedMethods = paymentMethods.filter((method) =>
      method.code !== 'cartao_online' &&
      !['cartao', 'cartao_credito', 'cartao_debito'].includes(method.code)
    );

    if (deliveryCardMethods.length > 0) {
      normalizedMethods.push({
        id: 'cartao',
        name: 'Cartão na entrega',
        is_card: true,
        extra_fee_percent: Math.max(...deliveryCardMethods.map((method) => method.extra_fee_percent || 0)),
        icon: 'cartao',
        code: 'cartao',
      });
    }

    if (cardOnlineCheckoutAvailable) {
      normalizedMethods.push({
        id: 'cartao_online',
        name: 'Cartão online',
        is_card: true,
        extra_fee_percent: 0,
        icon: 'cartao_credito' as const,
        code: 'cartao_online' as const,
      });
    }

    return normalizedMethods.sort((a, b) => paymentMethodPriority[a.code] - paymentMethodPriority[b.code]);
  }, [paymentMethods, cardOnlineCheckoutAvailable]);
  const [step, setStep] = useState<'bag' | 'checkout'>('bag');
  const phoneInputRef = useRef<HTMLInputElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const phoneLookupTimerRef = useRef<number | null>(null);
  const lastLookupDigitsRef = useRef<string>('');
  const normalizeNeighborhood = (value: string) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  const deliveryModalities = {
    delivery: deliverySettings?.modalities?.delivery !== false,
    pickup: deliverySettings?.modalities?.pickup !== false,
  };
  const isDeliveryMode = orderMode === 'delivery';

  useEffect(() => {
    if (deliveryModalities.delivery) {
      if (orderMode !== 'delivery' && !deliveryModalities.pickup) {
        setOrderMode('delivery');
      }
      return;
    }

    if (deliveryModalities.pickup && orderMode !== 'pickup') {
      setOrderMode('pickup');
    }
  }, [deliveryModalities.delivery, deliveryModalities.pickup, orderMode]);

  useEffect(() => {
    if (isDeliveryMode) return;
    setDeliveryZoneId('');
    setDeliveryQuote(null);
    setDetectZoneError(null);
  }, [isDeliveryMode]);

  // Setup Google Places Autocomplete para o endereço do cliente
  useEffect(() => {
    if (!isOpen || step !== 'checkout') return;
    if (!isDeliveryMode) return;
    if (!window.google?.maps?.places) return;

    const inputElement = addressInputRef.current;
    if (!inputElement) return;

    // Limpar listeners antigos se houver
    google.maps.event.clearInstanceListeners(inputElement);

    const autocomplete = new window.google.maps.places.Autocomplete(inputElement, {
      types: ['address'],
      componentRestrictions: { country: 'br' } // Restringir buscas ao Brasil
    });

    // Mudar de place_changed para pac-input-changed ou apenas pegar o valor diretamente do input
    // se o usuário clicar na sugestão, o input é preenchido e o place_changed é disparado.
    // O problema pode ser que o state do React não está atualizando quando o Google altera o valor do input diretamente.
    const listener = autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      
      // Mesmo se não tiver geometria, queremos pegar o endereço que o usuário selecionou
      const formattedAddress = place.formatted_address || inputElement.value;
      
      if (formattedAddress) {
        setCustomerAddress(formattedAddress);
        
        if (place.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          
          setLocation({
            latitude: lat,
            longitude: lng,
            accuracy: 10, // precisão simulada alta
            isLoading: false,
            error: null
          });
        }
      }
    });

    // Listener adicional para garantir que o React pegue qualquer alteração manual 
    // ou clique em sugestões que não disparem o place_changed
    const handleInput = () => {
      if (inputElement.value !== customerAddress) {
        setCustomerAddress(inputElement.value);
      }
    };
    
    inputElement.addEventListener('input', handleInput);
    inputElement.addEventListener('blur', handleInput);

    return () => {
      if (listener) {
        window.google.maps.event.removeListener(listener);
      }
      inputElement.removeEventListener('input', handleInput);
      inputElement.removeEventListener('blur', handleInput);
    };
  }, [isOpen, step, window.google?.maps?.places]);

  useEffect(() => {
    const fetchPaymentMethods = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('payment_methods')
          .select('*')
          .eq('user_id', userId)
          .order('name');

        if (!error && Array.isArray(data) && data.length > 0) {
          const mapped = data
            .map((m: any) => mapCheckoutPaymentMethod(m))
            .sort((a, b) => {
              const priorityDelta = paymentMethodPriority[a.code] - paymentMethodPriority[b.code];
              if (priorityDelta !== 0) return priorityDelta;
              return a.name.localeCompare(b.name, 'pt-BR');
            });
          setPaymentMethods(mapped);
          setSelectedPaymentMethod(mapped[0] || null);
          setPaymentMethod(mapped[0]?.code || '');
        } else {
          // Fallback para ambientes onde o fetch falha ou não há métodos cadastrados
          const fallback = [
            { id: 'pix', name: 'PIX', is_card: false, extra_fee_percent: 0, icon: 'pix' },
            { id: 'cartao_credito', name: 'Cartão de Crédito', is_card: true, extra_fee_percent: 0, icon: 'cartao_credito' },
            { id: 'cartao_debito', name: 'Cartão de Débito', is_card: true, extra_fee_percent: 0, icon: 'cartao_debito' },
            { id: 'dinheiro', name: 'Dinheiro', is_card: false, extra_fee_percent: 0, icon: 'dinheiro' }
          ];
          setPaymentMethods(fallbackPaymentMethods);
          setSelectedPaymentMethod(fallbackPaymentMethods[0] || null);
          setPaymentMethod(fallbackPaymentMethods[0]?.code || '');
        }
      } catch (e) {
        const fallback = [
          { id: 'pix', name: 'PIX', is_card: false, extra_fee_percent: 0, icon: 'pix' },
          { id: 'cartao_credito', name: 'Cartão de Crédito', is_card: true, extra_fee_percent: 0, icon: 'cartao_credito' },
          { id: 'cartao_debito', name: 'Cartão de Débito', is_card: true, extra_fee_percent: 0, icon: 'cartao_debito' },
          { id: 'dinheiro', name: 'Dinheiro', is_card: false, extra_fee_percent: 0, icon: 'dinheiro' }
        ];
        setPaymentMethods(fallbackPaymentMethods);
        setSelectedPaymentMethod(fallbackPaymentMethods[0] || null);
        setPaymentMethod(fallbackPaymentMethods[0]?.code || '');
      }
    };
    if (isOpen) fetchPaymentMethods();
  }, [isOpen, userId]);

  useEffect(() => {
    const fetchPixOnlineAvailability = async () => {
      try {
        const { data } = await invokeEdgeFunction('pix-settings-public', { userId }, {
          timeoutMs: 20000,
          allowAnonymous: true,
        });

        if (!data?.ok) {
          setPixOnlineCheckoutAvailable(null);
          return;
        }

        setPixOnlineCheckoutAvailable(Boolean(data.onlineCheckoutAvailable));
        setCardOnlineCheckoutAvailable(Boolean(data.cardOnlineAvailable));
        setMercadoPagoPublicKey(String(data.mercadoPagoPublicKey || ''));
      } catch {
        setPixOnlineCheckoutAvailable(null);
        setCardOnlineCheckoutAvailable(false);
        setMercadoPagoPublicKey('');
      }
    };

    if (isOpen) {
      setPixOnlineCheckoutAvailable(null);
      setCardOnlineCheckoutAvailable(false);
      setMercadoPagoPublicKey('');
      fetchPixOnlineAvailability();
    } else {
      setPixOnlineCheckoutAvailable(null);
    }
  }, [isOpen, userId]);

  useEffect(() => {
    if (!isOpen) return;
    setScheduleClock(Date.now());
    const timer = window.setInterval(() => setScheduleClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setStep('bag');
      checkoutTrackedRef.current = false;
      paymentTrackedRef.current = false;
      const mustSchedule = !isStoreOpen && Boolean(schedulingConfig?.enabled);
      setFulfillmentTime(mustSchedule ? 'scheduled' : 'asap');
      setScheduledAt('');
    }
  }, [isOpen, isStoreOpen, schedulingConfig?.enabled]);

  useEffect(() => {
    if (fulfillmentTime !== 'scheduled') return;
    if (scheduledAt && scheduleSlots.some((slot) => slot.value === scheduledAt)) return;
    setScheduledAt(scheduleSlots[0]?.value || '');
  }, [fulfillmentTime, scheduleSlots, scheduledAt]);

  useEffect(() => {
    if (!isOpen) return;
    if (step !== 'checkout') return;
    window.setTimeout(() => {
      try {
        phoneInputRef.current?.focus();
      } catch {}
    }, 0);
  }, [isOpen, step, isDeliveryMode]);

  const storePricingMode = deliverySettings?.pricing?.mode || 'neighborhood';
  const showNeighborhoodSelect = isDeliveryMode && storePricingMode === 'neighborhood';

  useEffect(() => {
    if (!isOpen) return;
    if (!userId) return;
    if (!isDeliveryMode) {
      setDetectZoneError(null);
      setDeliveryQuote(null);
      setIsDetectingZone(false);
      return;
    }
    if (showNeighborhoodSelect) {
      setDetectZoneError(null);
      setDeliveryQuote(null);
      setIsDetectingZone(false);
      return;
    }

    const addr = String(customerAddress || '').trim();
    const hasGps = typeof location.latitude === 'number' && typeof location.longitude === 'number';
    if (!hasGps && addr.length < 8) return;

    if (detectTimerRef.current) window.clearTimeout(detectTimerRef.current);
    detectTimerRef.current = window.setTimeout(async () => {
      try {
        setIsDetectingZone(true);
        setDetectZoneError(null);

        const { data } = await invokeEdgeFunction('delivery-quote', {
          userId,
          address: addr || undefined,
          lat: hasGps ? location.latitude : undefined,
          lng: hasGps ? location.longitude : undefined,
          cartTotal: total
        }, { timeoutMs: 8000, allowAnonymous: true });

        if (data?.ok) {
          setDeliveryQuote(data);
          const mode = String(data?.mode || '');
          if (mode === 'neighborhood' && data?.zone?.id) {
            if (!deliveryZoneId || zoneWasAutoRef.current) {
              zoneWasAutoRef.current = true;
              setDeliveryZoneId(String(data.zone.id));
            }
          } else {
            if (zoneWasAutoRef.current) setDeliveryZoneId('');
          }
          return;
        }

        const message = String(data?.error || 'Não foi possível detectar a área de entrega.')
        setDetectZoneError(message);
        setDeliveryQuote(null);
      } catch (e: any) {
        setDetectZoneError(e?.message || 'Falha ao detectar área de entrega. Tente novamente.')
        setDeliveryQuote(null);
      } finally {
        setIsDetectingZone(false);
      }
    }, 650);

    return () => {
      if (detectTimerRef.current) window.clearTimeout(detectTimerRef.current);
      detectTimerRef.current = null;
    };
  }, [isOpen, userId, customerAddress, location.latitude, location.longitude, total, deliveryZoneId, showNeighborhoodSelect, isDeliveryMode]);
  const selectedZone = deliveryZones.find(zone => zone.id === deliveryZoneId);
  const quoteMode = String(deliveryQuote?.mode || '');
  const quoteZone = deliveryQuote?.zone || null;

  useEffect(() => {
    if (!isDeliveryMode) return;
    if (!showNeighborhoodSelect) return;
    const normalizedNeighborhood = normalizeNeighborhood(customerNeighborhood);
    if (!normalizedNeighborhood) return;

    const matchedZone = deliveryZones.find((zone: any) => normalizeNeighborhood(zone?.name) === normalizedNeighborhood);
    if (!matchedZone) return;
    if (String(deliveryZoneId || '') === String(matchedZone.id)) return;

    zoneWasAutoRef.current = true;
    setDeliveryZoneId(String(matchedZone.id));
    setDetectZoneError(null);
  }, [showNeighborhoodSelect, customerNeighborhood, deliveryZones, deliveryZoneId, isDeliveryMode]);
  
  const deliveryFee = resolveDeliveryFee({
    isDeliveryMode,
    showNeighborhoodSelect,
    deliveryZoneId,
    selectedZone,
    deliveryQuote,
    storePricingMode,
    deliverySettings,
  });
  // Calcular taxa extra como percentual, igual ao CheckoutModal
  const computedExtraFee = selectedPaymentMethod && selectedPaymentMethod.extra_fee_percent > 0 ? (total + deliveryFee) * (selectedPaymentMethod.extra_fee_percent / 100) : 0;
  
  // Calcular Total Final com Desconto
  const preTotal = total + deliveryFee + computedExtraFee;
  const finalTotal = Math.max(0, preTotal - discount);

  const getMarketingContents = () => cart.map((item) => createMarketingContent(
    item.product.id,
    item.quantity,
    Number(item.totalPrice || 0) / Math.max(1, Number(item.quantity) || 1),
  ));

  const handleContinueToCheckout = () => {
    setStep('checkout');
    if (checkoutTrackedRef.current) return;
    checkoutTrackedRef.current = true;
    try {
      trackMarketingEvent('InitiateCheckout', {
        content_type: 'product',
        content_ids: cart.map((item) => String(item.product.id)),
        contents: getMarketingContents(),
        num_items: cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
        value: finalTotal,
        currency: 'BRL',
      }, { scope: userId });
    } catch (error) {
      console.warn('[checkout] Falha não crítica ao registrar início do checkout:', error);
    }
  };

  useEffect(() => {
    const digits = String(customerPhone || '').replace(/\D/g, '');

    if (!isOpen || digits.length < 10 || appliedCoupon) {
      if (!appliedCoupon) {
        setAutoLoyaltyReward(null);
        setFirstOrderPromotion(null);
        setLoyaltyProgress([]);
        if (!couponCode.trim()) {
          setDiscount(0);
        }
      }
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        setIsCheckingLoyalty(true);
        const { data, error } = await supabase.functions.invoke('loyalty-status', {
          body: {
            userId,
            customerPhone: digits,
            cartTotal: total,
            deliveryFee,
          }
        });

        if (!active) return;
        if (error) throw error;

        const reward = data?.reward || null;
        const welcomePromotion = data?.firstOrderPromotion || null;
        setLoyaltyProgress(Array.isArray(data?.progress) ? data.progress : []);

        if (welcomePromotion) {
          setFirstOrderPromotion({
            id: String(welcomePromotion.id),
            title: String(welcomePromotion.title || 'Oferta de primeiro pedido'),
            rewardType: welcomePromotion.rewardType,
            discountAmount: Number(welcomePromotion.discountAmount || 0),
            message: String(welcomePromotion.message || 'Benefício de primeiro pedido aplicado.'),
            product: welcomePromotion.product || null,
          });
          setAutoLoyaltyReward(null);
          setDiscount(Number(welcomePromotion.discountAmount || 0));
          setCouponError('');
        } else if (reward) {
          setFirstOrderPromotion(null);
          setAutoLoyaltyReward({
            id: String(reward.id),
            code: String(reward.code),
            type: String(reward.discount_type || reward.type || ''),
            discountAmount: Number(reward.discountAmount || 0),
            message: String(reward.message || 'Desconto fidelidade aplicado automaticamente.'),
          });
          setDiscount(Number(reward.discountAmount || 0));
          setCouponError('');
        } else {
          setFirstOrderPromotion(null);
          setAutoLoyaltyReward(null);
          if (!couponCode.trim()) {
            setDiscount(0);
          }
        }
      } catch {
        if (!active) return;
        setFirstOrderPromotion(null);
        setAutoLoyaltyReward(null);
      } finally {
        if (active) setIsCheckingLoyalty(false);
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [customerPhone, userId, total, deliveryFee, isOpen, appliedCoupon, couponCode]);

  const handleApplyCoupon = async () => {
    if (!couponCode) return;
    setIsValidatingCoupon(true);
    setCouponError('');
    setDiscount(0);
    setAppliedCoupon(null);
    setAutoLoyaltyReward(null);
    setFirstOrderPromotion(null);

    try {
      const { data, error } = await supabase.functions.invoke('validate-coupon', {
        body: { 
          code: couponCode, 
          cartTotal: total, 
          userId: userId,
          customerPhone: String(customerPhone || '').replace(/\D/g, '')
        }
      });

      if (error) throw error;

      if (!data.valid) {
        setCouponError(data.message);
        return;
      }

      setDiscount(data.discountAmount);
      setAppliedCoupon({ code: couponCode, type: data.type });
      
      // Se for frete grátis e o desconto veio 0 da API (porque ela não sabe o frete), aplicamos aqui
      if (data.type === 'shipping' || data.type === 'free_shipping') {
        setDiscount(deliveryFee);
      }

    } catch (err: any) {
      console.error('Erro cupom:', err);
      setCouponError('Erro ao validar cupom');
    } finally {
      setIsValidatingCoupon(false);
    }
  };



  const { lookupCustomer, isLoading: isLookingUp } = useCustomerLookup(userId);

  const paymentOptions = [
    { value: 'pix', label: 'PIX', icon: Smartphone },
    { value: 'cartao_credito', label: 'Cartão de Crédito', icon: CreditCard },
    { value: 'cartao_debito', label: 'Cartão de Débito', icon: CreditCard },
    { value: 'dinheiro', label: 'Dinheiro', icon: Banknote }
  ];

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocation(prev => ({ ...prev, error: 'Geolocalização não é suportada neste dispositivo' }));
      return;
    }

    setLocation(prev => ({ ...prev, isLoading: true, error: null }));

    // Request permission first for mobile devices
    const requestPermission = async () => {
      if ('permissions' in navigator) {
        try {
          const permission = await navigator.permissions.query({ name: 'geolocation' });
          console.log('📍 Permissão de geolocalização:', permission.state);
          
          if (permission.state === 'denied') {
            setLocation(prev => ({ 
              ...prev, 
              isLoading: false, 
              error: "Permissão de localização negada. Ative nas configurações do navegador." 
            }));
            return;
          }
        } catch (permError) {
          console.log('⚠️ Não foi possível verificar permissões:', permError);
        }
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log('✅ Localização obtida:', position.coords);
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            isLoading: false,
            error: null
          });
        },
        (error) => {
          console.error('❌ Erro de geolocalização:', error);
          let errorMessage = "Erro desconhecido ao obter localização";
          
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = "Permissão de localização negada. Verifique as configurações do seu navegador/celular.";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = "Informações de localização não disponíveis. Tente novamente.";
              break;
            case error.TIMEOUT:
              errorMessage = "Tempo esgotado ao obter localização. Tente novamente.";
              break;
          }
          
          setLocation(prev => ({ ...prev, isLoading: false, error: errorMessage }));
        },
        {
          enableHighAccuracy: true,
          timeout: 15000, // Increased timeout for mobile
          maximumAge: 300000 // 5 minutes cache
        }
      );
    };

    requestPermission();
  };

  const generateGoogleMapsLink = (lat: number, lng: number) => {
    return `https://maps.google.com/maps?q=${lat},${lng}`;
  };

  const isFormValid = () => {

    const isPaymentValid = paymentMethod !== '';
    const hasDelivery =
      !isDeliveryMode ||
      (showNeighborhoodSelect && deliveryZoneId !== '') ||
      (!showNeighborhoodSelect && deliveryQuote?.ok);
    
    const valid = (
      customerName.trim() !== '' &&
      customerPhone.trim() !== '' &&
      (!isDeliveryMode || customerAddress.trim() !== '') &&
      hasDelivery &&
      isPaymentValid &&
      canPlaceAtSelectedTime &&
      (paymentMethod !== 'dinheiro' || changeAmount === '' || parseFloat(changeAmount) >= finalTotal)
    );
    
    console.log('💳 VALIDAÇÃO FORMULÁRIO:', {
      customerName: customerName.trim() !== '',
      customerPhone: customerPhone.trim() !== '',
      customerAddress: !isDeliveryMode || customerAddress.trim() !== '',
      orderMode,
      deliveryZoneId: deliveryZoneId !== '',
      quoteMode,
      paymentMethod: paymentMethod,
      isPaymentValid,
      changeValid: paymentMethod !== 'dinheiro' || changeAmount === '' || parseFloat(changeAmount) >= finalTotal,
      finalValid: valid
    });
    
    return valid;
  };

  const placeOrderNow = async (data: any) => {
    await onPlaceOrder(data);
  };

  const getCheckoutErrorMessage = (error: unknown) => {
    const raw = String(error instanceof Error ? error.message : error || '').trim();
    if (!raw) return 'Nao foi possivel finalizar o pedido. Tente novamente.';
    if (raw.includes('store_closed') || /loja est[aá] fechada/i.test(raw)) {
      return 'A loja esta fechada no momento. Aguarde o horario de atendimento para finalizar seu pedido.';
    }
    if (
      raw.includes('pix_not_configured') ||
      raw.includes('pix_disabled') ||
      raw.includes('missing_provider_credentials')
    ) {
      return 'O checkout via PIX nao esta configurado para este restaurante.';
    }
    return raw;
  };

  const startPixCheckout = async (orderData: any) => {
    const { data, status } = await invokeEdgeFunction('pix-start-checkout', {
      restaurantUserId: userId,
      orderPayload: orderData,
      preferredMethod: 'pix',
      useCheckoutPro: false
    }, { timeoutMs: 60000, allowAnonymous: true });

    if (!data) throw new Error(`Erro na conexão com checkout (HTTP ${status})`);
    if (!data.ok) {
      if (String(data?.error || '') === 'store_closed') {
        throw new Error(String(data?.message || 'A loja esta fechada no momento.'));
      }
      if (
        ['pix_not_configured', 'pix_disabled', 'missing_provider_credentials'].includes(String(data?.error || ''))
      ) {
        throw new Error('O checkout via PIX nao esta configurado para este restaurante.');
      }
      if (String(data?.error || '') === 'collector_pix_key_missing') {
        throw new Error(String(data?.message || 'A conta Mercado Pago do restaurante ainda nao possui uma chave PIX ativa.'));
      }
      const providerMessage =
        data?.details?.message ||
        data?.details?.error ||
        data?.details?.cause?.[0]?.description ||
        data?.details?.cause?.[0]?.message ||
        '';
      const cid = data?.correlationID ? ` (cid: ${String(data.correlationID)})` : '';
      const msg = providerMessage ? `PopPay: ${String(providerMessage)}${cid}` : `${String(data.message || data.error || 'Não foi possível iniciar pagamento')}${cid}`;
      throw new Error(msg);
    }

    if (data.initPoint) {
      window.location.href = String(data.initPoint);
      return;
    }

    setPixCheckout({
      correlationID: String(data.correlationID),
      brCode: String(data.brCode || ''),
      qrCodeImage: data.qrCodeImage ? String(data.qrCodeImage) : undefined,
      paymentLinkUrl: data.paymentLinkUrl ? String(data.paymentLinkUrl) : undefined,
      paymentId: data.paymentId ? String(data.paymentId) : undefined
    });
  };

  const isPixCheckoutConfigurationError = (error: unknown) => {
    const raw = String(error instanceof Error ? error.message : error || '').toLowerCase();
    return (
      raw.includes('checkout via pix nao esta configurado') ||
      raw.includes('pix_not_configured') ||
      raw.includes('pix_disabled') ||
      raw.includes('missing_provider_credentials')
    );
  };

  const finalizeOrder = async (orderData: any) => {
    const isOnlineCardOrder = selectedPaymentMethod?.code === 'cartao_online' ||
      String(orderData?.payment_method || '') === 'cartao_online';
    if (isOnlineCardOrder) {
      if (!cardOnlineCheckoutAvailable || !mercadoPagoPublicKey) {
        throw new Error('O crédito online não está habilitado para este restaurante.');
      }
      setCardCheckoutOrder({ ...orderData, payment_method: 'cartao_online' });
      return;
    }

    const isPixOrder = selectedPaymentMethod?.code === 'pix' || String(orderData?.payment_method || '').startsWith('pix');
    if (!isPixOrder) {
      await placeOrderNow(orderData);
      return;
    }

    if (pixOnlineCheckoutAvailable !== false) {
      try {
        await startPixCheckout({ ...orderData, payment_method: 'pix_online' });
        return;
      } catch (error) {
        if (!isPixCheckoutConfigurationError(error)) throw error;
      }
    }

    await placeOrderNow({ ...orderData, payment_method: 'pix_entrega' });
  };

  const hasProductVariations = async (productId: string) => {
    try {
      const [{ count: c1 }, { count: c2 }] = await Promise.all([
        (supabase.from('product_variations') as any)
          .select('id', { count: 'exact', head: true })
          .eq('product_id', productId),
        (supabase.from('product_global_variation_links') as any)
          .select('id', { count: 'exact', head: true })
          .eq('product_id', productId)
      ]);
      return Number(c1 || 0) > 0 || Number(c2 || 0) > 0;
    } catch {
      return false;
    }
  };

  const getUpsellDiscountAmount = (offer: UpsellOffer | null, unitPrice: number) => {
    if (!offer) return 0;
    const safeUnitPrice = Math.max(0, Number(unitPrice || 0));
    const rawValue = Math.max(0, Number(offer.discountValue || 0));
    if (!safeUnitPrice || !rawValue) return 0;
    if (offer.discountType === 'percentage') {
      return Math.min(safeUnitPrice, safeUnitPrice * Math.min(rawValue, 100) / 100);
    }
    if (offer.discountType === 'fixed') {
      return Math.min(safeUnitPrice, rawValue);
    }
    return 0;
  };

  const getUpsellFinalUnitPrice = (offer: UpsellOffer | null, unitPrice: number) => {
    return Math.max(0, Number(unitPrice || 0) - getUpsellDiscountAmount(offer, unitPrice));
  };

  const resetUpsellState = () => {
    setUpsellOpen(false);
    setUpsellOffers([]);
    setPendingOrderData(null);
    setUpsellSelectedProduct(null);
    setSelectedUpsellOffer(null);
    setUpsellVariationOpen(false);
  };

  const applyUpsellAndPlace = async (
    product: any,
    quantity: number,
    variations: string[],
    itemNotes: string,
    variationPrice: number,
    optionDetails?: CartItem['options'],
    offerOverride?: UpsellOffer | null
  ) => {
    const base = pendingOrderData;
    if (!base) return;
    const selectedOffer = offerOverride || selectedUpsellOffer;
    const safeQuantity = Math.max(1, Number(quantity || 1));
    const unitPrice = Number(product?.price || 0) + Number(variationPrice || 0);
    const discountPerUnit = getUpsellDiscountAmount(selectedOffer, unitPrice);
    const finalUnitPrice = getUpsellFinalUnitPrice(selectedOffer, unitPrice);
    const lineTotal = finalUnitPrice * safeQuantity;
    const lineDiscount = discountPerUnit * safeQuantity;
    const next = {
      ...base,
      items: [
        ...(Array.isArray(base.items) ? base.items : []),
        {
          product_id: String(product.id),
          product_name: String(product.name || ''),
          quantity: safeQuantity,
          price: finalUnitPrice,
          options: Array.isArray(optionDetails) ? optionDetails : [],
          variations: Array.isArray(variations) ? variations : [],
          notes: String(itemNotes || ''),
          total: Number(lineTotal || 0),
          original_price: unitPrice,
          upsell_rule_id: selectedOffer?.ruleId || null,
          upsell_discount_type: selectedOffer?.discountType || null,
          upsell_discount_value: selectedOffer?.discountValue || null,
          upsell_discount_amount: lineDiscount
        }
      ],
      total: Number(base.total || 0) + Number(lineTotal || 0),
      discount: Number(base.discount || 0) + Number(lineDiscount || 0)
    };
    try {
      onClose();
      await finalizeOrder(next);
      resetUpsellState();
    } catch (error) {
      setUpsellOpen(true);
      throw error;
    }
  };

  const skipUpsellAndPlace = async () => {
    const base = pendingOrderData;
    if (!base) return;
    if (upsellBusy) return;
    setUpsellBusy(true);
    try {
      setUpsellLoadingRuleId(null);
      onClose();
      await finalizeOrder(base);
      resetUpsellState();
    } finally {
      setUpsellBusy(false);
    }
  };

  const chooseUpsellOffer = async (offer: UpsellOffer) => {
    if (!offer?.product?.id) return;
    if (upsellBusy) return;
    setUpsellBusy(true);
    setUpsellLoadingRuleId(String(offer.ruleId));
    try {
      const hasVars = await hasProductVariations(String(offer.product.id));
      if (!hasVars) {
        await applyUpsellAndPlace(offer.product, 1, [], '', 0, [], offer);
        return;
      }
      setSelectedUpsellOffer(offer);
      setUpsellSelectedProduct(offer.product);
      setUpsellVariationOpen(true);
      setUpsellOpen(false);
    } finally {
      setUpsellBusy(false);
      setUpsellLoadingRuleId(null);
    }
  };

  const handlePlaceOrder = async () => {
    if (!isFormValid()) return;
    if (submittingRef.current) return;
    if (!canPlaceAtSelectedTime) {
      toast({
        title: 'Escolha um horário',
        description: schedulingConfig?.enabled ? 'Selecione um horário disponível para agendar o pedido.' : storeClosedMessage,
        variant: 'destructive'
      });
      return;
    }
    submittingRef.current = true;
    setIsLoading(true);

    try {
      if (!paymentTrackedRef.current) {
        paymentTrackedRef.current = true;
        try {
          trackMarketingEvent('AddPaymentInfo', {
            content_type: 'product',
            content_ids: cart.map((item) => String(item.product.id)),
            contents: getMarketingContents(),
            num_items: cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
            value: finalTotal,
            currency: 'BRL',
            payment_method: paymentMethod,
          }, { scope: userId });
        } catch (error) {
          console.warn('[checkout] Falha não crítica ao registrar pagamento:', error);
        }
      }

      const phoneDigits = String(customerPhone || '').replace(/\D/g, '');
      const neighborhood = isDeliveryMode
        ? String(customerNeighborhood || '').trim() || String(selectedZone?.name || '').trim() || String(quoteZone?.name || '').trim() || ''
        : '';
      const baseOrderData = {
        user_id: userId,
        customer_name: customerName,
        customer_phone: phoneDigits,
        customer_address: isDeliveryMode ? customerAddress : null,
        customer_neighborhood: neighborhood,
        delivery_zone_id: isDeliveryMode ? (deliveryZoneId || null) : null,
        payment_method: paymentMethod === 'pix' ? (pixOnlineCheckoutAvailable === false ? 'pix_entrega' : 'pix_online') : paymentMethod,
        change_amount: paymentMethod === 'dinheiro' ? parseFloat(changeAmount) || null : null,
        delivery_instructions: notes,
        customer_latitude: isDeliveryMode ? location.latitude : null,
        customer_longitude: isDeliveryMode ? location.longitude : null,
        customer_location_accuracy: isDeliveryMode && location.accuracy ? Math.round(location.accuracy) : null,
        google_maps_link: isDeliveryMode && location.latitude && location.longitude ? generateGoogleMapsLink(location.latitude, location.longitude) : null,
        scheduled_at: fulfillmentTime === 'scheduled' ? scheduledAt : null,
        variations: fulfillmentTime === 'scheduled' ? {
          source: 'menu',
          scheduledAt,
          scheduledPreparationAt: getScheduledPreparationAt(scheduledAt, schedulingConfig?.preparationLeadMinutes || 0),
        } : { source: 'menu' },
        items: [
          ...cart.map(item => ({
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.quantity,
          price: item.product.price,
          options: Array.isArray(item.options) ? item.options : [],
          variations: item.variations,
          notes: item.notes,
          total: item.totalPrice
          })),
          ...(firstOrderPromotion?.rewardType === 'free_product' && firstOrderPromotion.product
            ? [{
                product_id: firstOrderPromotion.product.id,
                product_name: firstOrderPromotion.product.name,
                quantity: 1,
                price: 0,
                options: [],
                variations: [],
                notes: 'Brinde da promoção de primeiro pedido',
                total: 0,
                original_price: firstOrderPromotion.product.price,
                promotion_type: 'first_order',
              }]
            : []),
        ],
        delivery_fee: isDeliveryMode ? deliveryFee : 0,
        discount: discount,
        coupon_code: firstOrderPromotion?.id
          ? `PRIMEIRO:${firstOrderPromotion.id}`
          : appliedCoupon?.code || autoLoyaltyReward?.code || null,
        loyalty_reward_id: autoLoyaltyReward?.id || null,
        total: finalTotal,
        status: 'pending',
        order_type: orderMode,
        order_number: 'PED' + Date.now().toString().slice(-6)
      };

      const offers = await (async (): Promise<UpsellOffer[]> => {
        try {
          const rulesRes = await supabase
            .from('upsell_rules')
            .select('id,trigger_product_id,suggested_product_id,message,active,display_order,discount_type,discount_value')
            .eq('user_id', userId)
            .eq('active', true)
            .order('display_order', { ascending: true }) as any;
          if (rulesRes.error) {
            if (String(rulesRes.error.code || '') === '42P01') return [];
            return [];
          }
          const rules = Array.isArray(rulesRes.data) ? rulesRes.data : [];
          const cartProductIds = new Set(cart.map((i) => String(i.product.id)));
          const applicable = rules.filter((r: any) => !r.trigger_product_id || cartProductIds.has(String(r.trigger_product_id)));
          const suggestedIds = Array.from(new Set(applicable.map((r: any) => String(r.suggested_product_id || '')).filter(Boolean)));
          if (suggestedIds.length === 0) return [];

          let productsRes = await (supabase.from('products') as any)
            .select('id,name,description,price,image_url,available,is_available,availability_schedule')
            .eq('user_id', userId)
            .eq('show_in_delivery', true)
            .in('id', suggestedIds);
          if (productsRes.error && String(productsRes.error.message || '').includes('is_available')) {
            productsRes = await (supabase.from('products') as any)
              .select('id,name,description,price,image_url,available')
              .eq('user_id', userId)
              .eq('show_in_delivery', true)
              .in('id', suggestedIds);
          }
          if (productsRes.error) return [];
          const byId = new Map((productsRes.data || [])
            .filter((p: any) => {
              const available = p?.is_available !== undefined && p?.is_available !== null ? p.is_available : p?.available;
              const availabilityDate = baseOrderData.scheduled_at ? new Date(baseOrderData.scheduled_at) : new Date();
              return available !== false && isProductAvailableAt(p, availabilityDate);
            })
            .map((p: any) => [String(p.id), p]));

          const out: UpsellOffer[] = [];
          for (const r of applicable) {
            const pid = String(r.suggested_product_id || '');
            const p = byId.get(pid);
            if (!p) continue;
            out.push({
              ruleId: String(r.id),
              triggerProductId: r.trigger_product_id ? String(r.trigger_product_id) : null,
              message: r.message ? String(r.message) : null,
              discountType: r.discount_type === 'percentage' || r.discount_type === 'fixed' ? r.discount_type : null,
              discountValue: r.discount_value !== null && r.discount_value !== undefined ? Number(r.discount_value) : null,
              product: {
                id: String(p.id),
                name: String(p.name || ''),
                description: p.description ? String(p.description) : '',
                price: Number(p.price || 0),
                image_url: p.image_url ? String(p.image_url) : ''
              }
            });
          }
          return out.slice(0, 3);
        } catch {
          return [];
        }
      })();

      if (offers.length === 0) {
        await finalizeOrder(baseOrderData);
        return;
      }

      setPendingOrderData(baseOrderData);
      setUpsellOffers(offers);
      setUpsellOpen(true);
    } catch (error: any) {
      console.error('Erro ao finalizar pedido:', error);
      toast({
        title: 'Erro ao finalizar pedido',
        description: getCheckoutErrorMessage(error),
        variant: 'destructive'
      });
    } finally {
      submittingRef.current = false;
      setIsLoading(false);
    }
  };

  if (cart.length === 0) {
    return (
      <Dialog open={isOpen && !pixCheckout && !cardCheckoutOrder} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Carrinho</DialogTitle>
          </DialogHeader>
          <div className="text-center py-8">
            <p className="text-muted-foreground">Seu carrinho está vazio</p>
            <Button onClick={onClose} className="mt-4">
              Continuar comprando
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      {pixCheckout ? (
        <PixCheckoutModal
          isOpen={!!pixCheckout}
          onClose={() => setPixCheckout(null)}
          correlationID={pixCheckout.correlationID}
          brCode={pixCheckout.brCode}
          qrCodeImage={pixCheckout.qrCodeImage}
          paymentLinkUrl={pixCheckout.paymentLinkUrl}
          paymentId={pixCheckout.paymentId}
          onPaid={(orderId) => {
            setPixCheckout(null);
            onPixPaid?.(orderId);
          }}
        />
      ) : null}
      {cardCheckoutOrder ? (
        <PopPayCardCheckoutModal
          isOpen={!!cardCheckoutOrder}
          onClose={() => setCardCheckoutOrder(null)}
          restaurantUserId={userId}
          publicKey={mercadoPagoPublicKey}
          amount={Number(cardCheckoutOrder.total || finalTotal)}
          orderPayload={cardCheckoutOrder}
          onPaid={(orderId) => {
            setCardCheckoutOrder(null);
            onPixPaid?.(orderId);
          }}
        />
      ) : null}
      <Dialog open={isOpen && !pixCheckout && !cardCheckoutOrder} onOpenChange={onClose}>
      <DialogContent className="h-[100dvh] max-h-[100dvh] w-[calc(100dvw-1rem)] max-w-[calc(100dvw-1rem)] overflow-hidden overflow-x-hidden rounded-none border border-gray-100 bg-white p-0 shadow-2xl sm:h-[90dvh] sm:max-h-[90dvh] sm:max-w-lg sm:rounded-xl">
        <div className="flex flex-col h-full min-h-0">
          <DialogHeader className="border-b border-gray-100 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="text-lg font-bold text-gray-900">
                {step === 'bag' ? 'SACOLA' : 'Finalizar pedido'}
              </DialogTitle>
              {step === 'checkout' ? (
                <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={() => setStep('bag')}>
                  Voltar
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={onClose}>
                  Fechar
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y px-4 py-4 space-y-6" style={{ WebkitOverflowScrolling: 'touch' }}>
            {step === 'bag' ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-gray-900">Itens adicionados</h3>
                  <Button variant="ghost" style={{ color: menuPrimaryColor }} onClick={onClose}>
                    Adicionar mais itens
                  </Button>
                </div>

                <div className="space-y-4">
                  {cart.map((item) => {
                    const detailGroups = getOrderItemDetailGroups(item);
                    const configuredItem = isConfiguredCartItem(item);

                    return (
                    <Card key={item.uniqueId} className="overflow-hidden p-4 border border-gray-100 shadow-sm rounded-xl">
                      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-gray-900">{item.product.name}</h4>
                          {detailGroups.length > 0 && (
                            <div className="mt-1 space-y-1">
                              {detailGroups.map((group) => (
                                <div key={group.key} className="space-y-1">
                                  {group.label ? (
                                    <p className="text-sm font-medium text-gray-700">{group.label}:</p>
                                  ) : null}
                                  {group.items.map((detail) => (
                                    <p key={detail.key} className="text-sm text-gray-600">
                                      {detail.text}
                                      {detail.price && detail.price > 0
                                        ? item.quantity > 1
                                          ? ` (+${formatBRL(detail.price)} cada · total +${formatBRL(detail.price * item.quantity)})`
                                          : ` (+${formatBRL(detail.price)})`
                                        : ''}
                                    </p>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}
                          {item.notes && (
                            <p className="text-sm text-gray-600 italic bg-gray-50 p-2 rounded-lg mt-2">Obs: {item.notes}</p>
                          )}
                          {configuredItem ? (
                            <p className="mt-2 text-xs text-orange-700">Esta configuração pertence somente a esta unidade.</p>
                          ) : null}
                          <p className="text-sm font-bold mt-2" style={{ color: menuPriceColor }}>{formatBRL(item.totalPrice)}</p>
                        </div>

                        <div className="flex flex-none items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onUpdateQuantity(item.uniqueId, item.quantity - 1)}
                            aria-label={`Diminuir quantidade de ${item.product.name}`}
                            className="rounded-lg border-gray-200"
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center font-bold">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onUpdateQuantity(item.uniqueId, item.quantity + 1)}
                            disabled={configuredItem}
                            title={configuredItem ? 'Adicione outra unidade pelo cardápio para personalizá-la.' : 'Aumentar quantidade'}
                            aria-label={configuredItem ? `Adicione outra unidade de ${item.product.name} pelo cardápio e personalize novamente` : `Aumentar quantidade de ${item.product.name}`}
                            className="rounded-lg border-gray-200"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onRemoveItem(item.uniqueId)}
                            aria-label={`Remover ${item.product.name} do carrinho`}
                            className="rounded-lg border-red-200 hover:bg-red-50"
                          >
                            <Trash2 className="h-3 w-3 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                    );
                  })}
                </div>

                <div className="bg-gray-50 p-4 rounded-xl space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-700">Subtotal</span>
                    <span className="font-bold">{formatBRL(total)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t border-gray-200 pt-2">
                    <span className="text-gray-900">Total</span>
                    <span style={{ color: menuPriceColor }}>{formatBRL(total)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">

          {/* Dados do cliente */}
          <div className="space-y-4">
            <h3 className="font-bold text-gray-900">{isDeliveryMode ? 'Dados para entrega:' : 'Dados para retirada:'}</h3>
            {(deliveryModalities.delivery || deliveryModalities.pickup) && (
              <div className="p-4 rounded-2xl border" style={{ backgroundColor: menuBackgroundColor, borderColor: menuAccentBorder }}>
                <Label className="text-sm font-semibold mb-3 block" style={{ color: menuSecondaryColor }}>Modalidade do pedido</Label>
                <div className="grid grid-cols-2 gap-2">
                  {deliveryModalities.delivery && (
                    <Button
                      type="button"
                      variant={orderMode === 'delivery' ? 'default' : 'outline'}
                      className="h-11 rounded-xl"
                      style={orderMode === 'delivery' ? { backgroundColor: menuPrimaryColor, color: '#fff' } : undefined}
                      onClick={() => setOrderMode('delivery')}
                    >
                      Entrega
                    </Button>
                  )}
                  {deliveryModalities.pickup && (
                    <Button
                      type="button"
                      variant={orderMode === 'pickup' ? 'default' : 'outline'}
                      className="h-11 rounded-xl"
                      style={orderMode === 'pickup' ? { backgroundColor: menuSecondaryColor, color: '#fff' } : undefined}
                      onClick={() => setOrderMode('pickup')}
                    >
                      Retirada
                    </Button>
                  )}
                </div>
              </div>
            )}

            {schedulingConfig?.enabled && (
              <div className="rounded-2xl border p-4" style={{ backgroundColor: menuBackgroundColor, borderColor: menuAccentBorder }}>
                <Label className="mb-3 block text-sm font-semibold" style={{ color: menuSecondaryColor }}>Para quando você quer?</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={fulfillmentTime === 'asap' ? 'default' : 'outline'}
                    className="h-11 rounded-xl"
                    disabled={!isStoreOpen}
                    style={fulfillmentTime === 'asap' ? { backgroundColor: menuPrimaryColor, color: '#fff' } : undefined}
                    onClick={() => {
                      setFulfillmentTime('asap');
                      setScheduledAt('');
                    }}
                  >
                    <Zap className="mr-2 h-4 w-4" /> Agora
                  </Button>
                  <Button
                    type="button"
                    variant={fulfillmentTime === 'scheduled' ? 'default' : 'outline'}
                    className="h-11 rounded-xl"
                    style={fulfillmentTime === 'scheduled' ? { backgroundColor: menuSecondaryColor, color: '#fff' } : undefined}
                    onClick={() => {
                      setFulfillmentTime('scheduled');
                      setScheduledAt((current) => current || scheduleSlots[0]?.value || '');
                    }}
                  >
                    <CalendarClock className="mr-2 h-4 w-4" /> Agendar
                  </Button>
                </div>

                {fulfillmentTime === 'scheduled' && (
                  <div className="mt-3 space-y-2">
                    <Label htmlFor="scheduled-at">Data e horário</Label>
                    {scheduleSlots.length > 0 ? (
                      <Select value={scheduledAt} onValueChange={setScheduledAt}>
                        <SelectTrigger id="scheduled-at" className="h-12 rounded-xl bg-white">
                          <SelectValue placeholder="Escolha um horário" />
                        </SelectTrigger>
                        <SelectContent>
                          {scheduleSlots.map((slot) => (
                            <SelectItem key={slot.value} value={slot.value}>{slot.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Não há horários disponíveis dentro do período configurado.</p>
                    )}
                    <p className="text-xs text-gray-500">O restaurante receberá o pedido agora e será avisado no momento de iniciar o preparo.</p>
                  </div>
                )}
              </div>
            )}
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="phone" className="text-sm font-semibold mb-2 block" style={{ color: menuSecondaryColor }}>WhatsApp *</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-3 h-5 w-5" style={{ color: menuPrimaryColor }} />
                  <Input
                    id="phone"
                    ref={phoneInputRef}
                    value={customerPhone}
                    onChange={async (e) => {
                      const phone = e.target.value;
                      let val = phone.replace(/\D/g, '');
                      if (val.length > 11) val = val.slice(0, 11);
                      let formatted = val;
                      if (val.length > 2) formatted = `(${val.slice(0, 2)}) ${val.slice(2)}`;
                      if (val.length > 7) formatted = `(${val.slice(0, 2)}) ${val.slice(2, 7)}-${val.slice(7)}`;
                      setCustomerPhone(formatted);
                      
                      // Auto-lookup customer if phone has enough digits
                      const digits = formatted.replace(/\D/g, '');
                      if (digits.length < 10) {
                        setIsExistingCustomer(false);
                        lastLookupDigitsRef.current = '';
                        if (phoneLookupTimerRef.current) window.clearTimeout(phoneLookupTimerRef.current);
                        phoneLookupTimerRef.current = null;
                        return;
                      }

                      if (digits === lastLookupDigitsRef.current) return;
                      lastLookupDigitsRef.current = digits;
                      if (phoneLookupTimerRef.current) window.clearTimeout(phoneLookupTimerRef.current);
                      
                      phoneLookupTimerRef.current = window.setTimeout(async () => {
                        const customer = await lookupCustomer(digits);
                        if (customer) {
                          setCustomerName(customer.name || '');
                          setCustomerAddress(customer.address || '');
                          setCustomerNeighborhood(String((customer as any)?.neighborhood || ''));
                          const zoneId = String((customer as any)?.deliveryZoneId || '');
                          if (zoneId && (!deliveryZoneId || zoneWasAutoRef.current)) {
                            zoneWasAutoRef.current = true;
                            setDeliveryZoneId(zoneId);
                          }
                          setIsExistingCustomer(true);
                        } else {
                          setIsExistingCustomer(false);
                        }
                      }, 350);
                    }}
                    placeholder="(11) 99999-9999"
                    className="pl-11 h-12 bg-white rounded-xl text-base shadow-sm border-gray-200"
                  />
                  {isLookingUp && (
                    <div className="absolute right-3 top-3.5">
                      <div className="animate-spin h-5 w-5 border-2 border-t-transparent rounded-full" style={{ borderColor: menuPrimaryColor, borderTopColor: 'transparent' }} />
                    </div>
                  )}
                </div>
                {isExistingCustomer && (
                  <div className="flex items-center gap-2 text-sm text-green-600 mt-2 bg-green-50 p-2 rounded-lg border border-green-100">
                    <CheckCircle className="h-4 w-4" />
                    Cliente encontrado! Dados preenchidos automaticamente.
                  </div>
                )}
                {loyaltyProgress.length > 0 && (
                  <div className="mt-2 rounded-lg border border-[#8CC850]/25 bg-[#F4FAEC] p-2 text-xs text-[#245B2B]">
                    {loyaltyProgress.map((item, index) => (
                      <div key={`${index}-${item}`}>{item}</div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label htmlFor="name" className="text-sm font-semibold mb-2 block" style={{ color: menuSecondaryColor }}>Nome completo *</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-5 w-5" style={{ color: menuPrimaryColor }} />
                  <Input
                    id="name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Seu nome completo"
                    className="pl-11 h-12 bg-white rounded-xl text-base shadow-sm border-gray-200"
                  />
                </div>
              </div>

              {isDeliveryMode && showNeighborhoodSelect && (
                <div>
                  <Label htmlFor="neighborhood-zone" className="text-sm font-semibold mb-2 block" style={{ color: menuSecondaryColor }}>Bairro de entrega *</Label>
                  <Select
                    value={deliveryZoneId}
                    onValueChange={(v) => {
                      zoneWasAutoRef.current = false;
                      const zone = deliveryZones.find((item: any) => String(item?.id || '') === String(v));
                      setDeliveryZoneId(v);
                      setCustomerNeighborhood(String(zone?.name || ''));
                      setDeliveryQuote(null);
                      setDetectZoneError(null);
                    }}
                  >
                    <SelectTrigger id="neighborhood-zone" className="h-12 bg-white rounded-xl text-base shadow-sm border-gray-200">
                      <SelectValue placeholder="Selecione seu bairro" />
                    </SelectTrigger>
                    <SelectContent>
                      {deliveryZones.map((zone: any) => (
                        <SelectItem key={zone.id} value={String(zone.id)}>
                          {zone.name} - {formatBRL(zone.delivery_fee)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {deliveryZones.length === 0 && (
                    <div className="mt-2 text-sm text-red-600">
                      Nenhum bairro de entrega cadastrado para esta loja.
                    </div>
                  )}
                </div>
              )}
            </div>

            {isDeliveryMode && <div className="p-4 rounded-2xl border" style={{ backgroundColor: menuBackgroundColor, borderColor: menuAccentBorder }}>
              <Label htmlFor="address" className="text-sm font-semibold mb-2 block" style={{ color: menuSecondaryColor }}>Endereço completo *</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-5 w-5" style={{ color: menuPrimaryColor }} />
                <Input
                  id="address"
                  ref={addressInputRef}
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  placeholder="Rua, número, bairro, cidade"
                  className="pl-11 h-12 bg-white rounded-xl text-base shadow-sm border-gray-200"
                />
              </div>
            </div>}

            {isDeliveryMode && <div className="p-4 rounded-2xl border" style={{ backgroundColor: menuBackgroundColor, borderColor: menuAccentBorder }}>
              <Label className="text-sm font-semibold mb-2 block" style={{ color: menuSecondaryColor }}>Localização Exata (GPS)</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestLocation}
                  disabled={location.isLoading}
                  className="flex items-center gap-2 h-11 rounded-xl w-full justify-center bg-white transition-colors"
                  style={{ borderColor: menuAccentBorder, color: menuSecondaryColor }}
                >
                  <Navigation className="h-4 w-4" style={{ color: menuPrimaryColor }} />
                  {location.isLoading ? 'Obtendo localização...' : 'Usar minha localização atual'}
                </Button>
              </div>
              
              {location.latitude && location.longitude && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 flex-shrink-0" />
                  <span>Localização capturada com sucesso!</span>
                </div>
              )}
              
              {location.error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
                  <span className="flex-shrink-0">❌</span>
                  <span>{location.error}</span>
                </div>
              )}
              
              <p className="text-xs text-gray-500 mt-3 text-center">
                A localização ajuda o entregador a chegar mais rápido.
              </p>
            </div>}

            {isDeliveryMode && (!showNeighborhoodSelect ? (
              <div className="p-4 rounded-2xl border" style={{ backgroundColor: menuBackgroundColor, borderColor: menuAccentBorder }}>
                <div className="text-sm font-semibold mb-1" style={{ color: menuSecondaryColor }}>Frete da entrega</div>
                {deliveryQuote?.ok ? (
                  <div className="text-sm mt-1">
                    <span className="font-bold text-lg" style={{ color: menuPriceColor }}>{deliveryFee === 0 ? 'Grátis' : formatBRL(deliveryFee)}</span>
                    {typeof deliveryQuote?.distanceKm === 'number' ? <span className="text-gray-500"> • {Number(deliveryQuote.distanceKm).toFixed(2)} km</span> : ''}
                    {deliveryQuote?.zone?.name ? <span className="text-gray-500"> • {deliveryQuote.zone.name}</span> : ''}
                  </div>
                ) : storePricingMode === 'free' ? (
                  <div className="text-lg font-bold mt-1" style={{ color: menuPriceColor }}>Grátis</div>
                ) : storePricingMode === 'fixed' ? (
                  <div className="text-lg font-bold mt-1" style={{ color: menuPriceColor }}>Fixo: {formatBRL(deliveryFee)}</div>
                ) : (
                  <div className="text-sm mt-2 flex items-center gap-1 font-medium p-2 rounded-lg" style={{ color: menuPrimaryColor, backgroundColor: menuBackgroundColor }}>
                    {isDetectingZone ? 'Calculando valor...' : 'Preencha o endereço completo para calcular o frete'}
                  </div>
                )}
                {detectZoneError && !isDetectingZone && (
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
                    <span>❌</span> {detectZoneError}
                  </div>
                )}
              </div>
            ) : selectedZone ? (
              <div className="p-4 rounded-2xl border" style={{ backgroundColor: menuBackgroundColor, borderColor: menuAccentBorder }}>
                <div className="text-sm font-semibold mb-1" style={{ color: menuSecondaryColor }}>Frete do bairro</div>
                <div className="text-lg font-bold" style={{ color: menuPriceColor }}>
                  {selectedZone.name} • {formatBRL(selectedZone.delivery_fee)}
                  {Number(selectedZone.minimum_order || 0) > 0 ? (
                    <span className="text-gray-500 text-sm font-normal"> • mínimo {formatBRL(selectedZone.minimum_order)}</span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl border" style={{ backgroundColor: menuBackgroundColor, borderColor: menuAccentBorder }}>
                <div className="text-sm font-semibold mb-1" style={{ color: menuSecondaryColor }}>Frete da entrega</div>
                <div className="text-sm text-gray-500">Selecione o bairro de entrega para calcular o frete.</div>
                {isDetectingZone && (
                  <div className="mt-2 text-sm font-medium" style={{ color: menuPrimaryColor }}>
                    Detectando bairro automaticamente...
                  </div>
                )}
                {detectZoneError && (
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
                    <span>❌</span> {detectZoneError}
                  </div>
                )}
              </div>
            ))}

            <div className="p-4 rounded-2xl border" style={{ backgroundColor: menuBackgroundColor, borderColor: menuAccentBorder }}>
              <Label className="text-sm font-semibold mb-3 block" style={{ color: menuSecondaryColor }}>Forma de Pagamento *</Label>

              <div className="space-y-2">
                {visiblePaymentMethods.length > 0 ? visiblePaymentMethods.map((option) => {
                  const IconComponent = option.code === 'pix' ? Smartphone : option.is_card ? CreditCard : Banknote;
                  const isSelected = selectedPaymentMethod?.id === option.id;
                  return (
                    <div
                      key={option.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 cursor-pointer ${isSelected ? '' : 'border-gray-200 hover:border-gray-300'}`}
                      style={isSelected ? { borderColor: menuPrimaryColor, backgroundColor: menuBackgroundColor } : undefined}
                      onClick={() => {
                        setSelectedPaymentMethod(option)
                        setPaymentMethod(option.code)
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedPaymentMethod(option);
                          setPaymentMethod(option.code);
                        }
                      }}
                    >
                      <div
                        className="flex h-4 w-4 items-center justify-center rounded-full border flex-shrink-0"
                        style={{ borderColor: isSelected ? menuPrimaryColor : '#D1D5DB' }}
                      >
                        <div
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: isSelected ? menuPrimaryColor : 'transparent' }}
                        />
                      </div>
                      <IconComponent className={`h-5 w-5 ${isSelected ? '' : 'text-gray-600'}`} style={isSelected ? { color: menuPrimaryColor } : undefined} />
                      <Label className={`flex-1 text-sm font-medium cursor-pointer ${isSelected ? '' : 'text-gray-900'}`} style={isSelected ? { color: menuPrimaryColor } : undefined}>{option.name}</Label>
                      {option.is_card && option.extra_fee_percent > 0 && (
                        <span className="ml-2 text-xs font-bold" style={{ color: menuPrimaryColor }}>+{option.extra_fee_percent}%</span>
                      )}
                    </div>
                  );
                }) : <span className="text-muted-foreground">Nenhuma forma de pagamento cadastrada</span>}
              </div>

              {isPixSelected && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mt-2 space-y-2">
                  {pixOnlineCheckoutAvailable !== false ? (
                    <>
                      <div className="text-sm font-medium text-gray-900">PIX online</div>
                      <div className="text-sm text-gray-700">
                        O QR Code será gerado pelo PopPay para pagamento imediato e confirmação automática.
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-medium text-gray-900">PIX na entrega</div>
                      <div className="text-sm text-gray-700">
                        O pedido será enviado ao restaurante e o pagamento via PIX será combinado na entrega ou retirada.
                      </div>
                    </>
                  )}
                </div>
              )}

              {isCardOnlineSelected && (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-sm font-semibold text-emerald-950">Cartão online • crédito à vista</div>
                  <div className="mt-1 text-sm text-emerald-800">
                    O cartão será processado com segurança pelo Mercado Pago dentro do PopSystem. Não há parcelamento.
                  </div>
                </div>
              )}

              {isCardOnDeliverySelected && (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-sm font-semibold text-gray-900">Cartão na entrega</div>
                  <div className="mt-1 text-sm text-gray-700">
                    O pagamento será feito em crédito ou débito na maquininha do restaurante.
                  </div>
                </div>
              )}

              {/* Campo de Troco */}
              {selectedPaymentMethod?.code === 'dinheiro' && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <Label htmlFor="change" className="text-sm font-medium mb-1 block">
                    Precisa de troco para quanto?
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">R$</span>
                    <Input
                      id="change"
                      type="number"
                      step="0.01"
                      min={finalTotal}
                      placeholder={finalTotal.toFixed(2)}
                      value={changeAmount}
                      onChange={(e) => setChangeAmount(e.target.value)}
                      className="pl-9 bg-white"
                    />
                  </div>
                  {changeAmount && parseFloat(changeAmount) < finalTotal && (
                    <p className="text-xs text-red-600 mt-1">
                      O valor deve ser maior ou igual ao total do pedido ({formatBRL(finalTotal)})
                    </p>
                  )}
                  {changeAmount && parseFloat(changeAmount) >= finalTotal && (
                    <p className="text-xs text-green-600 mt-1">
                      Troco: {formatBRL(parseFloat(changeAmount) - finalTotal)}
                    </p>
                  )}
                </div>
              )}

            </div>

            <div>
              <Label htmlFor="notes">Observações da entrega</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Instruções especiais para entrega..."
                rows={2}
              />
            </div>
          </div>

          {/* Cupom de Desconto */}
          <div className="border-t border-gray-100 pt-4">
             <Label htmlFor="coupon">Cupom de Desconto</Label>
             <div className="flex gap-2 mt-1">
               <Input 
                 id="coupon" 
                 placeholder="Digite seu código" 
                 value={couponCode}
                 onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                 className="uppercase"
                 disabled={!!appliedCoupon}
               />
               {appliedCoupon ? (
                 <Button variant="outline" onClick={() => {
                   setAppliedCoupon(null); 
                   setDiscount(0); 
                   setCouponCode('');
                 }} className="border-red-200 text-red-600 hover:bg-red-50">
                   Remover
                 </Button>
               ) : autoLoyaltyReward ? (
                 <Button variant="outline" disabled className="border-[#8CC850]/30 text-[#245B2B]">
                   Automático
                 </Button>
               ) : (
                 <Button onClick={handleApplyCoupon} disabled={!couponCode || isValidatingCoupon}>
                   {isValidatingCoupon ? '...' : 'Aplicar'}
                 </Button>
               )}
             </div>
             {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
             {appliedCoupon && <p className="text-xs text-green-600 mt-1">Cupom {appliedCoupon.code} aplicado!</p>}
             {firstOrderPromotion && (
               <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-[#7a3510]">
                 <p className="font-extrabold">{firstOrderPromotion.title}</p>
                 <p className="mt-0.5 text-xs">{firstOrderPromotion.message}</p>
               </div>
             )}
             {autoLoyaltyReward && <p className="text-xs mt-1 text-[#245B2B]">{autoLoyaltyReward.message}</p>}
             {isCheckingLoyalty && !appliedCoupon && !autoLoyaltyReward && !firstOrderPromotion && <p className="text-xs mt-1 text-muted-foreground">Verificando promoções...</p>}
            {!isStoreOpen && fulfillmentTime !== 'scheduled' && <p className="text-xs text-red-500 mt-1">{storeClosedMessage}</p>}
          </div>

          {/* Resumo */}
          <div className="border-t border-gray-100 pt-6 space-y-3">
            <div className="bg-gray-50 p-4 rounded-xl space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-700">Subtotal:</span>
                <span className="font-bold">{formatBRL(total)}</span>
              </div>
              {isDeliveryMode && (
                <div className="flex justify-between">
                  <span className="text-gray-700">Taxa de entrega:</span>
                  <span className="font-bold">{formatBRL(deliveryFee)}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span className="font-medium">{firstOrderPromotion ? 'Primeiro pedido:' : autoLoyaltyReward ? 'Desconto fidelidade:' : 'Desconto:'}</span>
                  <span className="font-bold">- {formatBRL(discount)}</span>
                </div>
              )}
              {firstOrderPromotion?.rewardType === 'free_product' && firstOrderPromotion.product && (
                <div className="flex justify-between gap-3 text-orange-700">
                  <span className="font-medium">Brinde do primeiro pedido:</span>
                  <span className="text-right font-bold">{firstOrderPromotion.product.name}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg border-t border-gray-200 pt-2">
                <span className="text-gray-900">Total:</span>
                <span style={{ color: menuPriceColor }}>{formatBRL(finalTotal)}</span>
              </div>
            </div>
          </div>

          {/* Botões */}
          <div className="flex gap-3 pt-4">
            <Button variant="outline" onClick={() => setStep('bag')} className="flex-1 rounded-xl h-12 text-boracume-dark-green border-gray-200">
              Voltar
            </Button>
            <Button 
              onClick={handlePlaceOrder}
              disabled={!isFormValid() || isLoading || !canPlaceAtSelectedTime}
              className="flex-1 rounded-xl font-bold h-12 text-white transition-transform hover:scale-[1.02]"
              style={{ backgroundColor: 'var(--menu-primary, #85C441)' }}
            >
              {isLoading ? 'Processando...' : 'Finalizar Pedido'}
            </Button>
          </div>
              </div>
            )}
          </div>

          {step === 'bag' && (
            <div className="border-t border-gray-100 p-4 bg-white">
              <Button
                onClick={handleContinueToCheckout}
                disabled={!isStoreOpen && !schedulingConfig?.enabled}
                className="w-full rounded-xl font-bold h-12 text-white transition-transform hover:scale-[1.02]"
                style={{ backgroundColor: 'var(--menu-primary, #85C441)' }}
              >
                Continuar • {formatBRL(total)}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
      </Dialog>

      <Dialog open={upsellOpen} onOpenChange={setUpsellOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Antes de finalizar…</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Quer aproveitar alguma oferta?
            </div>
            <div className="space-y-3">
              {upsellOffers.map((offer) => (
                <Card key={offer.ruleId} className="p-3 border border-gray-100">
                  <div className="flex gap-3 items-start">
                    <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                      {offer.product.image_url ? (
                        <img src={offer.product.image_url} alt={offer.product.name} className="w-full h-full object-cover" />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      {(() => {
                        const originalPrice = Number(offer.product.price || 0);
                        const discountedPrice = getUpsellFinalUnitPrice(offer, originalPrice);
                        const hasDiscount = discountedPrice < originalPrice;
                        return (
                          <>
                      <div className="font-bold text-gray-900 truncate">{offer.product.name}</div>
                      {offer.message ? (
                        <div className="text-xs text-muted-foreground mt-1">{offer.message}</div>
                      ) : offer.product.description ? (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{offer.product.description}</div>
                      ) : null}
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex flex-col">
                          <div className="font-extrabold" style={{ color: menuPriceColor }}>{formatBRL(discountedPrice)}</div>
                          {hasDiscount ? (
                            <div className="text-[11px] text-muted-foreground line-through">{formatBRL(originalPrice)}</div>
                          ) : null}
                        </div>
                        <Button onClick={() => chooseUpsellOffer(offer)} disabled={upsellBusy}>
                          {upsellBusy && upsellLoadingRuleId === offer.ruleId ? (
                            <span className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Adicionando...
                            </span>
                          ) : 'Add oferta'}
                        </Button>
                      </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </Card>
              ))}
              {upsellOffers.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhuma oferta disponível.</div>
              ) : null}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={skipUpsellAndPlace} disabled={upsellBusy}>
                Pular
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SimpleVariationModal
        isOpen={upsellVariationOpen}
        onClose={() => {
          setUpsellVariationOpen(false);
          setUpsellSelectedProduct(null);
          setSelectedUpsellOffer(null);
          setUpsellOpen(true);
        }}
        product={upsellSelectedProduct}
        onAddToCart={(product, quantity, variations, notes, variationPrice, optionDetails) =>
          applyUpsellAndPlace(product, quantity, variations, notes, variationPrice, optionDetails)
        }
      />
    </>
  );
};
