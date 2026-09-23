
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Eye, Phone, MapPin, Clock, User, Package } from 'lucide-react';
import OrderStatusBadge from './OrderStatusBadge';
import type { OrderStatusType } from './OrderStatusBadge';
import { formatPaymentMethodLabel } from '@/lib/orderDetails';
import { formatSaleQuantity } from '@/utils/saleQuantity';

interface OrderItem {
  product_name: string;
  quantity: number;
  sale_unit?: 'un' | 'kg';
  price: number;
  subtotal: number;
  options?: string[];
  notes?: string;
}

interface Order {
  id: string;
  order_number: string;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  items: OrderItem[];
  total: number;
  status: OrderStatusType;
  acceptance_status?: string;
  payment_method: string;
  order_type: string;
  created_at: string;
  estimated_time?: string;
}

interface OrderCardProps {
  order: Order;
  onStatusChange?: (orderId: string, newStatus: OrderStatusType) => void;
  onViewDetails?: (order: Order) => void;
}

const OrderCard: React.FC<OrderCardProps> = ({ order, onStatusChange, onViewDetails }) => {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getOrderTypeColor = (type: string) => {
    switch (type) {
      case 'delivery': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'pickup': return 'bg-green-100 text-green-800 border-green-300';
      case 'dine_in': return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'local': return 'bg-purple-100 text-purple-800 border-purple-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getOrderTypeLabel = (type: string) => {
    switch (type) {
      case 'delivery': return 'Delivery';
      case 'pickup': return 'Retirada';
      case 'dine_in': return 'Mesa';
      case 'local': return 'Local';
      default: return type;
    }
  };

  return (
    <Card className="w-full max-w-xs hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg font-bold text-primary">
            #{order.order_number}
          </CardTitle>
          <div className="flex flex-col gap-1">
            <OrderStatusBadge status={order.status} isTableOrder={order.order_type === 'dine_in'} />
            <Badge className={`text-xs ${getOrderTypeColor(order.order_type)}`} variant="outline">
              {getOrderTypeLabel(order.order_type)}
            </Badge>
          </div>
        </div>
        
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock size={14} />
          <span>{formatTime(order.created_at)}</span>
          {order.estimated_time && (
            <>
              <span>•</span>
              <span>{order.estimated_time}</span>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Informações do Cliente */}
        {order.customer_name && (
          <div className="flex items-center gap-2 text-sm">
            <User size={14} className="text-muted-foreground" />
            <span className="font-medium">{order.customer_name}</span>
          </div>
        )}
        
        {order.customer_phone && (
          <div className="flex items-center gap-2 text-sm">
            <Phone size={14} className="text-muted-foreground" />
            <span>{order.customer_phone}</span>
          </div>
        )}
        
        {order.customer_address && (
          <div className="flex items-start gap-2 text-sm">
            <MapPin size={14} className="text-muted-foreground mt-0.5" />
            <span className="text-xs leading-tight">{order.customer_address}</span>
          </div>
        )}

        <Separator />

        {/* Itens */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Package size={14} />
            <span>Itens ({order.items.length})</span>
          </div>
          
          <div className="space-y-1">
            {order.items.slice(0, 3).map((item, index) => (
              <div key={index} className="text-xs bg-gray-50 p-2 rounded">
                <div className="flex justify-between items-start">
                  <span className="font-medium">{formatSaleQuantity(item.quantity, item.sale_unit)} {item.product_name}</span>
                  <span className="text-muted-foreground">{formatCurrency(item.subtotal)}</span>
                </div>
                {item.options && item.options.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {item.options.join(', ')}
                  </div>
                )}
              </div>
            ))}
            
            {order.items.length > 3 && (
              <div className="text-xs text-muted-foreground text-center py-1">
                +{order.items.length - 3} item(s) adicional(s)
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Total e Pagamento */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Total:</span>
            <span className="text-lg font-bold text-primary">{formatCurrency(order.total)}</span>
          </div>
          
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Pagamento:</span>
            <Badge variant="outline" className="text-xs">
              {formatPaymentMethodLabel(order.payment_method, order.acceptance_status)}
            </Badge>
          </div>
        </div>

        {/* Ações */}
        <div className="pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onViewDetails?.(order)}
            className="w-full"
          >
            <Eye size={14} className="mr-2" />
            Ver Detalhes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default OrderCard;
