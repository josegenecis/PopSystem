import React from 'react';
import { formatBRL } from '@/lib/currency';

interface DiscountBadgeProps {
  originalPrice: number;
  discountedPrice: number;
  discountPercentage: number;
}

const DiscountBadge: React.FC<DiscountBadgeProps> = ({ 
  originalPrice, 
  discountedPrice, 
  discountPercentage
}) => {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-bold text-black text-lg">
        {formatBRL(discountedPrice)}
      </span>
      <span className="text-gray-400 line-through text-sm">
        {formatBRL(originalPrice)}
      </span>
      <span className="bg-orange-600 text-white px-2 py-1 rounded-full text-xs font-medium">
        -{discountPercentage}%
      </span>
    </div>
  );
};

export default DiscountBadge;
