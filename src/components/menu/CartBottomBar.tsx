
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart } from 'lucide-react';
import { formatBRL } from '@/lib/currency';

interface CartBottomBarProps {
  itemCount: number;
  total: number;
  onOpenCart: () => void;
}

const CartBottomBar: React.FC<CartBottomBarProps> = ({
  itemCount,
  total,
  onOpenCart
}) => {
  if (itemCount === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-50 p-4 mobile-safe-bottom">
      <div className="max-w-4xl mx-auto">
        <Button 
          onClick={onOpenCart}
          className="w-full flex items-center justify-between h-12 text-base text-white"
          style={{ backgroundColor: 'var(--menu-primary, #85C441)' }}
          size="lg"
        >
          <div className="flex items-center gap-2">
            <div className="relative">
              <ShoppingCart className="h-5 w-5" />
              <Badge 
                variant="secondary" 
                className="absolute -top-2 -right-2 h-4 w-4 flex items-center justify-center p-0 text-[10px] bg-white"
                style={{ color: 'var(--menu-primary, #85C441)' }}
              >
                {itemCount}
              </Badge>
            </div>
            <span>Ver Carrinho</span>
          </div>
          <span className="font-bold">{formatBRL(total)}</span>
        </Button>
      </div>
    </div>
  );
};

export default CartBottomBar;
