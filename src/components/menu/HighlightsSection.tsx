import React from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';
import AutoplayVideo from '@/components/media/AutoplayVideo';
import { isVideoAsset } from '@/utils/videoAutoplay';
import { formatBRL } from '@/lib/currency';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  original_price?: number;
  discount_percentage?: number;
  image_url?: string;
  order_count: number;
}

interface HighlightsSectionProps {
  products: Product[];
  onProductClick: (product: Product) => void;
}

const HighlightsSection: React.FC<HighlightsSectionProps> = ({ products, onProductClick }) => {
  if (!products || products.length === 0) return null;

  return (
    <div className="mb-6 sm:mb-8">
      <div className="mb-3 flex items-center gap-1.5 sm:mb-4 sm:gap-2">
        <Sparkles className="h-4 w-4" style={{ color: 'var(--menu-primary, #85C441)' }} />
        <div>
          <h2 className="text-base font-black sm:text-xl" style={{ color: 'var(--menu-secondary, #063D2E)' }}>Mais pedidos</h2>
          <p className="text-[10px] text-slate-500 sm:text-xs">Os favoritos dos clientes</p>
        </div>
      </div>
      
      <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-2 sm:-mx-1 sm:gap-3 sm:px-1">
        {products.map((product, index) => {
          const mediaUrl = normalizeImageUrlForDisplay(product.image_url) || product.image_url || '';

          return (
          <div
            key={product.id}
            onClick={() => onProductClick(product)}
            className="min-w-[125px] max-w-[125px] overflow-hidden rounded-2xl border border-white bg-white shadow-[0_12px_30px_-24px_rgba(15,23,42,.65)] transition-all hover:-translate-y-1 hover:shadow-lg sm:min-w-[230px] sm:max-w-[230px] sm:rounded-[24px]"
          >
            <div className="relative">
              <div className="aspect-square w-full bg-[#f8f5ef] sm:aspect-[4/3]">
                {mediaUrl ? (
                  isVideoAsset(mediaUrl) ? (
                    <AutoplayVideo
                      src={mediaUrl}
                      className="w-full h-full object-cover"
                      loop
                    />
                  ) : (
                    <img
                      src={mediaUrl}
                      alt={product.name}
                      className="w-full h-full object-cover"
                      loading={index < 2 ? 'eager' : 'lazy'}
                      fetchPriority={index < 2 ? 'high' : 'auto'}
                      decoding="async"
                    />
                  )
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <span className="text-xs">Sem imagem</span>
                  </div>
                )}
              </div>
              <div className="absolute left-2 top-2 max-w-[105px] truncate rounded-full bg-[var(--menu-secondary,#063D2E)] px-2 py-1 text-[7px] font-black uppercase tracking-wide text-white shadow-sm sm:left-3 sm:top-3 sm:max-w-none sm:px-2.5 sm:text-[10px]">
                {index === 0 ? 'Campeão de vendas' : 'Popular'}
              </div>
            </div>

            <div className="p-2.5 sm:p-4">
              <h3 className="line-clamp-2 min-h-[30px] text-[11px] font-bold leading-snug text-gray-900 sm:min-h-0 sm:text-sm sm:font-semibold">
                {product.name}
              </h3>

              {product.description ? <p className="mt-1 line-clamp-2 min-h-[24px] text-[9px] leading-snug text-slate-500 sm:min-h-[32px] sm:text-xs sm:leading-relaxed">{product.description}</p> : <div className="min-h-[26px] sm:min-h-[36px]" />}
              {Number(product.order_count || 0) > 0 && <p className="mt-1.5 truncate text-[8px] font-semibold text-slate-400 sm:mt-2 sm:text-[11px]">{product.order_count} pedidos</p>}
              <div className="mt-2 flex items-end justify-between gap-1 sm:mt-3 sm:gap-2">
                {product.original_price && product.discount_percentage ? (
                  <div className="space-y-1">
                    <div className="flex items-end gap-2">
                      <span className="text-base font-black tracking-normal" style={{ color: 'var(--menu-price, #EF6C20)' }}>{formatBRL(product.price)}</span>
                      <span className="text-[11px] text-gray-500 line-through">{formatBRL(product.original_price)}</span>
                    </div>
                    <div className="inline-flex items-center rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-semibold">
                      -{Math.round(Number(product.discount_percentage))}%
                    </div>
                  </div>
                ) : (
                  <div className="text-sm font-black tracking-normal sm:text-base" style={{ color: 'var(--menu-price, #EF6C20)' }}>{formatBRL(product.price)}</div>
                )}
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-white shadow-md sm:h-10 sm:w-10" style={{ backgroundColor: 'var(--menu-primary, #85C441)' }}><Plus className="h-4 w-4 sm:h-5 sm:w-5" /></span>
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
};

export default HighlightsSection;
