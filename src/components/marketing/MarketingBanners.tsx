import React from 'react';
import PromotionalBanner from '@/components/marketing/PromotionalBanner';
import { StoryLinkedProduct } from '@/components/marketing/BannerStoryViewer';

export default function MarketingBanners({
  restaurantId,
  onSelectProductId,
  onQuickAddProduct,
  linkedProducts,
  fallbackImage
}: {
  restaurantId?: string;
  onSelectProductId?: (productId: string) => void;
  onQuickAddProduct?: (productId: string) => Promise<void> | void;
  linkedProducts?: Record<string, StoryLinkedProduct>;
  fallbackImage?: string;
}) {
  return (
    <div className="space-y-3">
      <PromotionalBanner
        restaurantId={restaurantId}
        variant="wide"
        onSelectProductId={onSelectProductId}
        onQuickAddProduct={onQuickAddProduct}
        linkedProducts={linkedProducts}
        fallbackImage={fallbackImage}
      />
      <PromotionalBanner
        restaurantId={restaurantId}
        variant="tile"
        autoPlay={false}
        onSelectProductId={onSelectProductId}
        onQuickAddProduct={onQuickAddProduct}
        linkedProducts={linkedProducts}
      />
    </div>
  );
}
