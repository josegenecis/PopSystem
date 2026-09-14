
import React, { useRef, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CreditCard, Banknote, Smartphone, MapPin, Phone, User, Navigation, CheckCircle } from 'lucide-react';
import { useCustomerLookup } from '@/hooks/useCustomerLookup';
import { supabase } from '@/integrations/supabase/client';
import PixCheckoutModal from '@/components/payment/PixCheckoutModal';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';
import { formatBRL } from '@/lib/currency';
// Removido hook de mobile fora do componente para evitar uso inválido

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  selectedOptions?: string[];
  notes?: string;
  subtotal: number;
}

interface DeliveryZone {
  id: string;
  name: string;
  delivery_fee: number;
  minimum_order: number;
  delivery_time: string;
}

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  total: number;
  deliveryZones: DeliveryZone[];
  onPlaceOrder: (orderData: any) => void;
  userId?: string;
}

const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  cart,
  total,
  deliveryZones,
  onPlaceOrder,
  userId
}) => {
  const menuPrimaryColor = 'var(--menu-primary, #85C441)';
  const menuBackgroundColor = 'var(--menu-bg, #F7EEDF)';
  const [customerData, setCustomerData] = useState({
    name: '',
    phone: '',
    address: '',
    neighborhood: '',
    notes: ''
  });
  const [isExistingCustomer, setIsExistingCustomer] = useState(false);
  const [location, setLocation] = useState({
    latitude: null as number | null,
    longitude: null as number | null,
    accuracy: null as number | null,
    isLoading: false,
    error: null as string | null
  });
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [changeAmount, setChangeAmount] = useState('');
  const [selectedZone, setSelectedZone] = useState<string>('');
  const [manualZoneSelection, setManualZoneSelection] = useState(false);
  const [isDetectingZone, setIsDetectingZone] = useState(false);
  const [detectZoneError, setDetectZoneError] = useState<string | null>(null);
  const [deliveryQuote, setDeliveryQuote] = useState<any | null>(null);
  const detectTimerRef = useRef<number | null>(null);
  const zoneWasAutoRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [pixCheckout, setPixCheckout] = useState<{ correlationID: string; brCode: string; qrCodeImage?: string; paymentLinkUrl?: string } | null>(null);

  // Métodos de pagamento personalizados
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<any>(null);

  // Métodos de pagamento padrão - SEMPRE disponíveis
  const getDefaultPaymentMethods = () => {
    return [
      { id: 'pix', name: 'PIX', extra_fee_percent: 0, is_card: false },
      { id: 'dinheiro', name: 'Dinheiro', extra_fee_percent: 0, is_card: false },
      { id: 'cartao', name: 'Cartão', extra_fee_percent: 3, is_card: true }
    ];
  };

  // Inicializar com métodos padrão SEMPRE - garantia absoluta
  useEffect(() => {
    console.log('🔄 [INIT] Inicializando CheckoutModal...');
    
    const defaultMethods = getDefaultPaymentMethods();
    
    // SEMPRE garantir que há métodos disponíveis
    console.log('🔄 [INIT] Definindo métodos padrão iniciais...');
    setPaymentMethods(defaultMethods);
    setSelectedPaymentMethod(defaultMethods[0]);
    setPaymentMethod('pix');
    console.log('✅ [INIT] Métodos padrão definidos:', defaultMethods);
  }, []);

  // Garantir métodos padrão quando modal abrir
  useEffect(() => {
    if (isOpen) {
      console.log('🔄 [MODAL OPEN] Modal aberto, verificando métodos...');
      console.log('🔄 [MODAL OPEN] Métodos atuais:', paymentMethods.length);
      
      // Se não há métodos, garantir métodos padrão
      if (paymentMethods.length === 0) {
        const defaultMethods = getDefaultPaymentMethods();
        console.log('🔄 [MODAL OPEN] Forçando métodos padrão...');
        setPaymentMethods(defaultMethods);
        setSelectedPaymentMethod(defaultMethods[0]);
        setPaymentMethod('pix');
        console.log('✅ [MODAL OPEN] Métodos padrão garantidos:', defaultMethods);
      }
    }
  }, [isOpen]);

  // Buscar métodos personalizados do Supabase (opcional)
  useEffect(() => {
    if (isOpen && userId) {
      const fetchPaymentMethods = async () => {
        console.log('🔄 [FETCH] Buscando métodos personalizados...');
        console.log('🔄 [FETCH] User ID:', userId);
        
        try {
          const { data, error } = await (supabase as any)
            .from('payment_methods')
            .select('*')
            .eq('user_id', userId)
            .order('name');
          
          if (error) {
            console.error('❌ [SUPABASE ERROR]:', error);
            return; // Manter métodos padrão em caso de erro
          }
          
          if (data && data.length > 0) {
            console.log('✅ [SUPABASE] Métodos personalizados encontrados:', data.length);
            
            // Mapear para estrutura consistente com ID slug
            const slugify = (s: string) => s
              .toLowerCase()
              .normalize('NFD')
              .replace(/\p{Diacritic}/gu, '')
              .replace(/\s+/g, '_');
            const mapped = data.map((m: any) => ({
              id: slugify(m.name || ''),
              name: m.name || 'Método',
              extra_fee_percent: m.extra_fee_percent ?? 0,
              is_card: m.is_card ?? false
            }));
            
            // Substituir métodos padrão pelos personalizados
            setPaymentMethods(mapped);
            setSelectedPaymentMethod(mapped[0]);
            setPaymentMethod(mapped[0].id);
            
            console.log('✅ [PAYMENT UPDATE] Métodos personalizados carregados');
          } else {
            console.log('⚠️ [SUPABASE] Nenhum método personalizado encontrado, mantendo padrão');
          }
        } catch (error) {
          console.error('💥 [FETCH ERROR]:', error);
          // Manter métodos padrão em caso de erro
        }
      };
      
      // Buscar métodos personalizados após um pequeno delay
      const timeoutId = setTimeout(() => {
        fetchPaymentMethods();
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen, userId]);

  useEffect(() => {
    if (paymentMethods.length > 0) {
      const found = paymentMethods.find(m => m.id === paymentMethod);
      setSelectedPaymentMethod(found || null);
    }
  }, [paymentMethod, paymentMethods]);

  const selectedZoneData = deliveryZones.find(zone => zone.id === selectedZone);
  const quoteMode = String(deliveryQuote?.mode || '');
  const quoteZone = deliveryQuote?.zone || null;
  const deliveryFee = selectedZone !== '' ? (selectedZoneData?.delivery_fee || 0) : (Number(quoteZone?.delivery_fee || 0) || 0);
  const minimumOrder = selectedZone !== '' ? (selectedZoneData?.minimum_order || 0) : (Number(quoteZone?.minimum_order || 0) || 0);
  const totalWithDelivery = total + deliveryFee;

  const extraFee = selectedPaymentMethod && selectedPaymentMethod.extra_fee_percent > 0 ? (total + deliveryFee) * (selectedPaymentMethod.extra_fee_percent / 100) : 0;
  const totalWithDeliveryAndFee = total + deliveryFee + extraFee;

  const { lookupCustomer, isLoading: isLookingUp } = useCustomerLookup(userId || '');

  const handleLookupCustomer = async () => {
    const found = await lookupCustomer(customerData.phone);
    if (!found) {
      setIsExistingCustomer(false);
      alert('Nenhum cadastro encontrado para este telefone.');
      return;
    }

    setIsExistingCustomer(true);
    setCustomerData((prev) => ({
      ...prev,
      name: found.name || prev.name,
      phone: found.phone || prev.phone,
      address: found.address || prev.address,
      neighborhood: found.neighborhood || prev.neighborhood,
    }));

    if (found.deliveryZoneId) {
      zoneWasAutoRef.current = false;
      setManualZoneSelection(true);
      setSelectedZone(String(found.deliveryZoneId));
    }
  };

  const paymentOptions = [
    { value: 'pix', label: 'PIX', icon: Smartphone },
    { value: 'cartao_credito', label: 'Cartão de Crédito', icon: CreditCard },
    { value: 'cartao_debito', label: 'Cartão de Débito', icon: CreditCard },
    { value: 'dinheiro', label: 'Dinheiro', icon: Banknote }
  ];

  const generateOrderNumber = () => {
    const now = new Date();
    const timestamp = now.getTime().toString().slice(-6);
    return `PED-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${timestamp}`;
  };

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocation(prev => ({ ...prev, error: 'Geolocalização não é suportada neste dispositivo' }));
      return;
    }

    setLocation(prev => ({ ...prev, isLoading: true, error: null }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          isLoading: false,
          error: null
        });
      },
      (error) => {
        let errorMessage = 'Erro ao obter localização';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Permissão de localização negada';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Localização não disponível';
            break;
          case error.TIMEOUT:
            errorMessage = 'Tempo limite para obter localização';
            break;
        }
        setLocation(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  };

  useEffect(() => {
    if (!isOpen) return;
    if (!userId) return;

    const addr = String(customerData.address || '').trim();
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
        }, { allowAnonymous: true });

        if (data?.ok) {
          setDeliveryQuote(data);
          const mode = String(data?.mode || '');
          if (mode === 'neighborhood' && data?.zone?.id) {
            if (!manualZoneSelection && (!selectedZone || zoneWasAutoRef.current)) {
              zoneWasAutoRef.current = true;
              setSelectedZone(String(data.zone.id));
            }
          } else {
            if (!manualZoneSelection && zoneWasAutoRef.current) setSelectedZone('');
          }
          return;
        }

        const message = String(data?.error || 'Não foi possível detectar a área de entrega.')
        setDetectZoneError(message);
        setDeliveryQuote(null);
      } catch (e: any) {
        setDetectZoneError(e?.message || 'Falha ao detectar área de entrega. Tente novamente.');
        setDeliveryQuote(null);
      } finally {
        setIsDetectingZone(false);
      }
    }, 650);

    return () => {
      if (detectTimerRef.current) window.clearTimeout(detectTimerRef.current);
      detectTimerRef.current = null;
    };
  }, [isOpen, userId, customerData.address, location.latitude, location.longitude, total, selectedZone, manualZoneSelection]);

  const generateGoogleMapsLink = (lat: number, lng: number) => {
    return `https://maps.google.com/maps?q=${lat},${lng}`;
  };

  const handlePlaceOrder = async () => {
    if (!isFormValid()) {
      // Verificar cada campo individualmente para dar feedback específico
      const errors: string[] = [];
      const hasDelivery = selectedZone !== '' || (deliveryQuote && quoteMode && quoteMode !== 'neighborhood');
      if (!customerData.name.trim()) errors.push('Nome é obrigatório');
      if (!customerData.phone.trim()) errors.push('Telefone é obrigatório');
      if (!customerData.address.trim()) errors.push('Endereço é obrigatório');
      if (!hasDelivery) errors.push('Selecione uma área de entrega');
      if (total < minimumOrder) errors.push(`Pedido mínimo: ${formatBRL(minimumOrder)}`);
      if (!paymentMethod) errors.push('Selecione forma de pagamento');
      if (paymentMethod === 'dinheiro' && changeAmount && parseFloat(changeAmount) < totalWithDelivery) {
        errors.push('Valor para troco deve ser maior que o total');
      }
      
      alert('Por favor, corrija os seguintes campos:\n' + errors.join('\n'));
      return;
    }

    if (!userId) {
      alert('Erro interno: ID do usuário não encontrado');
      return;
    }

    setLoading(true);
    try {
      const orderNumber = generateOrderNumber();
      
      const orderData = {
        user_id: userId,
        order_number: orderNumber,
        customer_name: customerData.name.trim(),
        customer_phone: customerData.phone.trim(),
        customer_address: customerData.address.trim(),
        customer_neighborhood: customerData.neighborhood.trim() || selectedZoneData?.name || quoteZone?.name || '',
        delivery_zone_id: selectedZone || null,
        items: cart.map(item => ({
          product_id: item.id,
          product_name: item.name,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.subtotal,
          options: Array.from(new Set((item.selectedOptions || []).map(opt => typeof opt === 'string' ? opt.trim() : '').filter(opt => opt && !opt.includes(',')))),
          notes: item.notes || ''
        })),
        total: totalWithDeliveryAndFee,
        delivery_fee: deliveryFee,
        payment_method: paymentMethod,
        change_amount: paymentMethod === 'dinheiro' ? parseFloat(changeAmount) || null : null,
        order_type: 'delivery',
        delivery_instructions: customerData.notes.trim() || null,
        estimated_time: selectedZoneData?.delivery_time || '30-45 min',
        status: 'pending',
        acceptance_status: 'pending_acceptance',
        customer_latitude: location.latitude,
        customer_longitude: location.longitude,
        customer_location_accuracy: location.accuracy ? Math.round(location.accuracy) : null,
        google_maps_link: location.latitude && location.longitude ? 
          generateGoogleMapsLink(location.latitude, location.longitude) : null
      };

      if (paymentMethod === 'pix') {
        const { data, status } = await invokeEdgeFunction<any>('pix-start-checkout', {
          restaurantUserId: userId,
          orderPayload: orderData,
          preferredMethod: paymentMethod
        }, { allowAnonymous: true })
        if (!data) {
          throw new Error(`Erro na conexão com checkout (HTTP ${status})`)
        }
        if (!data.ok) {
          throw new Error(data.error || `Não foi possível iniciar pagamento (HTTP ${status})`)
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
        return;
      }
      await onPlaceOrder(orderData);
    } catch (error) {
      let errorMessage = 'Erro desconhecido ao processar pedido';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      alert(`Erro ao finalizar pedido: ${errorMessage}\n\nTente novamente ou entre em contato conosco.`);
    } finally {
      setLoading(false);
    }
  };

  const isFormValid = () => {
    const hasDelivery = selectedZone !== '' || (deliveryQuote && quoteMode && quoteMode !== 'neighborhood');
    const isValid = (
      customerData.name.trim() !== '' &&
      customerData.phone.trim() !== '' &&
      customerData.address.trim() !== '' &&
      hasDelivery &&
      total >= minimumOrder &&
      paymentMethod !== '' &&
      (paymentMethod !== 'dinheiro' || changeAmount === '' || parseFloat(changeAmount) >= totalWithDelivery)
    );
    
    return isValid;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Finalizar Pedido</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {pixCheckout && (
            <PixCheckoutModal
              isOpen={!!pixCheckout}
              onClose={() => setPixCheckout(null)}
              correlationID={pixCheckout.correlationID}
              brCode={pixCheckout.brCode}
              qrCodeImage={pixCheckout.qrCodeImage}
              paymentLinkUrl={pixCheckout.paymentLinkUrl}
            />
          )}
          {/* Resumo do Pedido */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-3">Resumo do Pedido</h3>
              <div className="space-y-2">
                {cart.map((item, index) => (
                  <div key={index} className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium">{item.quantity}x {item.name}</p>
                      {item.selectedOptions && item.selectedOptions.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          {item.selectedOptions.join(', ')}
                        </p>
                      )}
                      {item.notes && (
                        <p className="text-sm text-muted-foreground italic">
                          Obs: {item.notes}
                        </p>
                      )}
                    </div>
                    <span className="font-medium">{formatBRL(item.subtotal)}</span>
                  </div>
                ))}
                
                <Separator />
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatBRL(total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Taxa de Entrega</span>
                  <span>{formatBRL(deliveryFee)}</span>
                </div>
                {extraFee > 0 && (
                  <div className="flex justify-between">
                    <span>Taxa do Pagamento</span>
                    <span>{formatBRL(extraFee)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>{formatBRL(totalWithDeliveryAndFee)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Dados do Cliente */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Dados para Entrega</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLookupCustomer}
                  disabled={!customerData.phone || isLookingUp}
                >
                  {isLookingUp ? 'Buscando...' : 'Buscar Cliente'}
                </Button>
              </div>
              {isExistingCustomer ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  Cliente encontrado. Você pode editar nome, endereço e bairro antes de finalizar.
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome Completo *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="name"
                      placeholder="Seu nome completo"
                      value={customerData.name}
                      onChange={(e) => setCustomerData(prev => ({ ...prev, name: e.target.value }))}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Telefone *</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      placeholder="(11) 99999-9999"
                      value={customerData.phone}
                      onChange={(e) => setCustomerData(prev => ({ ...prev, phone: e.target.value }))}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Endereço Completo *</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="address"
                    placeholder="Rua, número, complemento"
                    value={customerData.address}
                    onChange={(e) => setCustomerData(prev => ({ ...prev, address: e.target.value }))}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                  <Label htmlFor="delivery-zone">Bairro de entrega *</Label>
                  {quoteMode !== 'neighborhood' && deliveryQuote?.ok && !manualZoneSelection ? (
                    <div className="p-3 border rounded-lg bg-gray-50">
                      <div className="text-sm font-medium">Frete calculado automaticamente</div>
                      <div className="text-sm text-muted-foreground">
                        {formatBRL(quoteZone?.delivery_fee || 0)}
                        {typeof deliveryQuote?.distanceKm === 'number' ? ` • ${Number(deliveryQuote.distanceKm).toFixed(2)} km` : ''}
                      </div>
                      {deliveryZones.length > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => setManualZoneSelection(true)}
                        >
                          Trocar bairro manualmente
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <Select
                        value={selectedZone}
                        onValueChange={(v) => {
                          zoneWasAutoRef.current = false;
                          setManualZoneSelection(true);
                          setDeliveryQuote(null);
                          setSelectedZone(v);
                          const zone = deliveryZones.find((item) => String(item.id) === String(v));
                          setCustomerData(prev => ({ ...prev, neighborhood: zone?.name || '' }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione seu bairro" />
                        </SelectTrigger>
                        <SelectContent>
                          {deliveryZones.map((zone) => (
                            <SelectItem key={zone.id} value={zone.id}>
                              {zone.name} - {formatBRL(zone.delivery_fee)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isDetectingZone && (
                        <p className="text-xs text-muted-foreground">
                          Detectando bairro automaticamente...
                        </p>
                      )}
                      {quoteMode !== 'neighborhood' && deliveryQuote?.ok && manualZoneSelection ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="px-0 text-xs"
                          onClick={() => {
                            setManualZoneSelection(false);
                            setSelectedZone('');
                          }}
                        >
                          Voltar para frete automático
                        </Button>
                      ) : null}
                      {detectZoneError && (
                        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
                          ❌ {detectZoneError}
                        </div>
                      )}
                    </>
                  )}
                  {selectedZoneData && total < minimumOrder && (
                    <p className="text-sm text-red-500">
                      Pedido mínimo para esta área: {formatBRL(minimumOrder)}
                    </p>
                  )}
              </div>

              {/* Localização GPS */}
              <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Localização GPS (Opcional)</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={requestLocation}
                    disabled={location.isLoading}
                  >
                    <Navigation className="h-4 w-4 mr-2" />
                    {location.isLoading ? 'Obtendo...' : 'Obter Localização'}
                  </Button>
                </div>
                
                {location.latitude && location.longitude && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    ✅ Localização obtida com precisão de {Math.round(location.accuracy || 0)}m
                  </div>
                )}
                
                {location.error && (
                  <div className="text-sm text-red-500">
                    ❌ {location.error}
                  </div>
                )}
                
                <p className="text-xs text-muted-foreground">
                  A localização GPS ajuda o entregador a encontrar você com mais facilidade
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Observações da Entrega</Label>
                <Textarea
                  id="notes"
                  placeholder="Instruções especiais para entrega..."
                  value={customerData.notes}
                  onChange={(e) => setCustomerData(prev => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </CardContent>
          </Card>

          {/* Forma de Pagamento */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <h3 className="font-semibold">Forma de Pagamento</h3>
              
              <div className="space-y-3">
                <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod} className="space-y-3">
                  {paymentMethods.map((option) => (
                    <div
                      key={option.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${paymentMethod === option.id ? '' : 'border-border hover:bg-accent'}`}
                      style={paymentMethod === option.id ? { borderColor: menuPrimaryColor, backgroundColor: menuBackgroundColor } : undefined}
                      onClick={() => setPaymentMethod(option.id)}
                    >
                      <RadioGroupItem value={option.id} id={option.id} className="h-5 w-5" />
                      <span className="flex-1 font-medium">{option.name}</span>
                      {option.is_card && option.extra_fee_percent > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          Taxa {option.extra_fee_percent}%
                        </Badge>
                      )}
                    </div>
                  ))}
                </RadioGroup>

                {paymentMethod === 'pix' && (
                  <div className="text-sm text-muted-foreground bg-muted/50 border rounded-lg p-2 mt-2">
                    Ao selecionar PIX, vamos gerar o QR Code e liberar o pedido apenas após confirmação do pagamento.
                  </div>
                )}

              </div>

              {paymentMethod === 'dinheiro' && (
                <div className="space-y-2">
                  <Label htmlFor="change">Troco para quanto? (opcional)</Label>
                  <Input
                    id="change"
                    type="number"
                    step="0.01"
                    placeholder={`Mínimo: ${formatBRL(totalWithDeliveryAndFee)}`}
                    value={changeAmount}
                    onChange={(e) => setChangeAmount(e.target.value)}
                  />
                  {changeAmount && parseFloat(changeAmount) < totalWithDeliveryAndFee && (
                    <p className="text-sm text-red-500">
                      O valor deve ser maior ou igual ao total do pedido
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1" disabled={loading}>
              Voltar
            </Button>
            <Button 
              onClick={handlePlaceOrder} 
              disabled={!isFormValid() || loading}
              className="flex-1"
            >
              {loading ? 'Processando...' : 'Finalizar Pedido'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Removido uso inválido de hook fora do componente

export default CheckoutModal;
