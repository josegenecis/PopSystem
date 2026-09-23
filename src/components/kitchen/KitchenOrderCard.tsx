import React from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Clock, RotateCcw, Package, User, CheckCircle, Truck, Phone, MapPin } from 'lucide-react';
import { formatElapsedSince } from '@/utils/elapsedTime';
import { formatSaleQuantity } from '@/utils/saleQuantity';

interface OrderItem {
  id: string;
  name?: string;
  product_name?: string;
  title?: string;
  quantity: number;
  sale_unit?: 'un' | 'kg';
  notes?: string;
  observation?: string;
  options?: any[];
  variations?: any[];
}

interface KitchenOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  items: OrderItem[];
  priority?: 'normal' | 'high';
  status: 'pending' | 'preparing' | 'ready' | 'completed' | 'delivered' | 'cancelled';
  created_at: string;
  updated_at: string;
  order_type?: string;
}

interface KitchenOrderCardProps {
  order: KitchenOrder;
  onStatusChange: (id: string, status: string) => void;
  onRecall?: (id: string) => void;
}

const KitchenOrderCard: React.FC<KitchenOrderCardProps> = ({ order, onStatusChange, onRecall }) => {
  const safeJsonArray = (value: any) => {
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

  const extractOptionNames = (raw: any) => {
    const out: string[] = [];
    if (!raw) return out;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item) continue;
        if (typeof item === 'string') {
          const v = item.trim();
          if (v) out.push(v);
          continue;
        }
        const name = String((item as any).name || (item as any).label || '').trim();
        if (name) out.push(name);
      }
    } else if (typeof raw === 'string') {
      const v = raw.trim();
      if (v) out.push(v);
    }
    return out;
  };

  const items = safeJsonArray((order as any)?.items);
  const orderNumber = String((order as any)?.order_number || '').trim();
  const orderNumberShort = orderNumber ? orderNumber.slice(-4) : String((order as any)?.id || '').slice(-4);

  const getItemName = (item: any) => {
    return item.name || item.product_name || item.title || "Item sem nome";
  };

  const getItemNotes = (item: any) => {
    return item.notes || item.observation || "";
  };

  const handleStatusChange = (newStatus: string) => {
    onStatusChange(order.id, newStatus);
  };

  const timePassed = formatElapsedSince(order.created_at);
  const isHighPriority = order.priority === 'high' || (items.length > 5);

  const getHeaderColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-red-600';
      case 'preparing': return 'bg-red-600';
      case 'ready': return 'bg-green-600';
      default: return 'bg-gray-700';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'Pendente';
      case 'preparing': return 'Preparando';
      case 'ready': return 'Pronto';
      case 'delivered': return order.order_type === 'dine_in' ? 'Levou para mesa' : 'Entregue';
      default: return status;
    }
  };

  const getOrderTypeColor = (type?: string) => {
    switch (type) {
      case 'delivery': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'pickup': return 'bg-green-100 text-green-800 border-green-300';
      case 'dine_in': return 'bg-purple-100 text-purple-800 border-purple-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getOrderTypeLabel = (type?: string) => {
    switch (type) {
      case 'delivery': return 'Delivery';
      case 'pickup': return 'Retirada';
      case 'dine_in': return 'Mesa';
      default: return type || 'Pedido';
    }
  };

  const getDisplayName = (name: string, type?: string) => {
      const safeName = String(name || '').trim();
      // Se for mesa ou tipo dine_in
      if (type === 'dine_in' || safeName.toLowerCase().includes('mesa')) {
          const mesaMatch = safeName.match(/mesa\s*(\d+)/i);
          if (mesaMatch) return `MESA ${mesaMatch[1]}`;
          if (safeName.length > 15 && safeName.toLowerCase().includes('mesa')) return "MESA";
      }
      return safeName || 'Cliente';
  };

  const getPaymentStatus = (order: KitchenOrder) => {
      // Lógica simples: Se for delivery/pickup online = PAGO. Se for mesa = A PAGAR.
      // Idealmente viria do banco (payment_status).
      // Vou assumir que 'pending_payment' é o status do pagamento, mas aqui só temos order.status.
      // Vou usar uma lógica baseada no tipo por enquanto.
      if (order.order_type === 'dine_in') return { label: 'A PAGAR', color: 'bg-red-100 text-red-700' };
      if (order.order_type === 'delivery') return { label: 'PAGO', color: 'bg-green-100 text-green-700' }; 
      return { label: 'PENDENTE', color: 'bg-yellow-100 text-yellow-700' };
  };
  
  const paymentInfo = getPaymentStatus(order);

  return (
    <Card className={`w-full max-w-[400px] shrink-0 border-0 ${isHighPriority ? 'ring-4 ring-red-500 shadow-2xl' : 'ring-1 ring-gray-200'} shadow-lg transition-all hover:scale-[1.01] hover:shadow-xl rounded-2xl overflow-hidden`}>
      <div className={`px-5 py-4 text-white ${getHeaderColor(order.status)} bg-gradient-to-r from-transparent via-white/5 to-transparent`}>
        <div className="flex items-center justify-between gap-2">
          <div className="font-black text-3xl tracking-tight">#{orderNumberShort}</div>
          <div className="flex items-center gap-2">
            {isHighPriority && (
              <Badge className="bg-white text-red-600 font-bold animate-pulse">
                URGENTE
              </Badge>
            )}
            <div className="flex items-center bg-black/20 px-2 py-1 rounded text-sm font-bold backdrop-blur-sm">
              <Clock size={14} className="mr-1.5" />
              {timePassed}
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <Badge variant="outline" className="text-white border-white/40 bg-white/10 text-xs uppercase tracking-wider">
            {getStatusLabel(order.status)}
          </Badge>
          <div className="flex gap-2">
             <Badge className={`text-[10px] font-bold ${paymentInfo.color}`}>
                {paymentInfo.label}
             </Badge>
             <Badge variant="secondary" className="bg-white text-black font-bold text-xs">
                {getOrderTypeLabel(order.order_type)}
             </Badge>
          </div>
        </div>
      </div>

      <CardContent className="p-4 space-y-4">
        {/* Customer Info */}
        <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
            <div className="flex items-center gap-3 mb-1">
              <User size={18} className="text-gray-500" />
              <span className="font-bold text-2xl text-gray-800 truncate">{getDisplayName((order as any)?.customer_name, order.order_type)}</span>
            </div>
             {order.customer_phone && (
              <div className="flex items-center gap-3 text-sm text-gray-600 pl-1">
                <Phone size={14} />
                <span>{order.customer_phone}</span>
              </div>
            )}
        </div>

        <Separator />

        <div className="space-y-2">
            {items.map((item: any, idx: number) => {
              const optionLines: string[] = [];
              const variationsRaw = Array.isArray(item?.variations) ? item.variations : [];
              if (variationsRaw.length > 0 && typeof variationsRaw[0] === 'string') {
                optionLines.push(...variationsRaw.map((v: any) => String(v || '').trim()).filter(Boolean));
              } else if (variationsRaw.length > 0) {
                for (const v of variationsRaw) {
                  const name = String(v?.name || '').trim();
                  const selected = Array.isArray(v?.selectedOptions) ? v.selectedOptions.map((x: any) => String(x || '').trim()).filter(Boolean) : [];
                  if (!name || selected.length === 0) continue;
                  optionLines.push(`${name}: ${selected.join(', ')}`);
                }
              }
              optionLines.push(...extractOptionNames(item?.options));

              const itemNotes = String(item?.notes || item?.observation || '').trim();

              return (
              <div key={idx} className="flex flex-col gap-1 py-1 border-b border-gray-100 last:border-0">
                <div className="flex justify-between items-start">
                   <div className="flex gap-2">
                      <span className="font-black text-lg text-gray-900 min-w-[24px]">{formatSaleQuantity(item.quantity, item.sale_unit)}</span>
                      <span className="font-bold text-gray-800 text-lg leading-tight">{getItemName(item)}</span>
                   </div>
                </div>

                {/* Opções e adicionais */}
                {optionLines.map((line, i) => {
                  const raw = String(line || '').trim();
                  if (!raw) return null;
                  const idxColon = raw.indexOf(':');
                  if (idxColon > 0) {
                    const label = raw.slice(0, idxColon).trim();
                    const value = raw.slice(idxColon + 1).trim();
                    return (
                      <div key={i} className="pl-8 text-sm text-gray-600">
                        <span className="font-bold text-blue-600">{label}:</span> {value}
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="pl-8 text-sm text-gray-600">
                      {raw}
                    </div>
                  );
                })}
                
                {/* Observações em DESTAQUE */}
                {itemNotes && (
                  <div className="mt-1 ml-8 text-sm font-bold text-red-600 bg-red-50 p-2 rounded border border-red-100 flex items-start gap-2">
                    <span className="uppercase text-[10px] bg-red-100 px-1 rounded text-red-700 mt-0.5">Obs</span>
                    {itemNotes}
                  </div>
                )}
              </div>
              );
            })}
        </div>
      </CardContent>
      
      <Separator />
      
      <CardFooter className="p-4 bg-gray-50">
        <div className="flex w-full gap-2">
          {(order.status === 'pending' || order.status === 'accepted') && (
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-sm font-bold text-lg h-12"
              onClick={() => handleStatusChange('preparing')}
            >
              <Package className="mr-2 h-5 w-5" />
              INICIAR PREPARO
            </Button>
          )}
          
          {order.status === 'preparing' && (
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white shadow-sm font-bold text-lg h-12"
              onClick={() => handleStatusChange('ready')}
            >
              <CheckCircle className="mr-2 h-5 w-5" />
              MARCAR PRONTO
            </Button>
          )}
          
          {order.status === 'ready' && (
            <div className="flex w-full gap-2">
              {onRecall && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => onRecall(order.id)}
                  title="Voltar para Preparo"
                  className="shrink-0"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
              <Button
                className="flex-1 bg-gray-800 hover:bg-gray-900 text-white shadow-sm"
                onClick={() => handleStatusChange('delivered')}
              >
                <Truck className="mr-2 h-4 w-4" />
                {order.order_type === 'dine_in' ? 'Levar à mesa' : 'Entregar'}
              </Button>
            </div>
          )}
        </div>
      </CardFooter>
    </Card>
  );
};

export default KitchenOrderCard;
