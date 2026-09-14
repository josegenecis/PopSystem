import { useMemo, useState } from 'react';
import { Flame, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';
import { formatBRL } from '@/lib/currency';

interface TotemProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url?: string;
  original_price?: number;
  discount_percentage?: number;
  order_count?: number;
}

interface TotemProductCardProps {
  product: TotemProduct;
  onSelect: (product: TotemProduct) => void;
}

export default function TotemProductCard({ product, onSelect }: TotemProductCardProps) {
  const [imageError, setImageError] = useState(false);

  const imageUrl = useMemo(() => {
    return normalizeImageUrlForDisplay(product.image_url);
  }, [product.image_url]);

  return (
    <article className="group overflow-hidden rounded-lg border border-stone-200 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-xl" style={{ backgroundColor: 'var(--totem-surface)' }}>
      <button type="button" onClick={() => onSelect(product)} className="block w-full text-left">
        <div className="relative aspect-square bg-stone-100">
          {imageUrl && !imageError ? (
            <img
              src={imageUrl}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              loading="lazy"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-100 to-emerald-50 text-sm font-semibold text-stone-400">
              Sem imagem
            </div>
          )}

          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {Number(product.discount_percentage || 0) > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold shadow" style={{ backgroundColor: 'var(--totem-primary)', color: 'var(--totem-button-text)' }}>
                <Flame className="h-3.5 w-3.5" />
                -{Math.round(Number(product.discount_percentage))}%
              </span>
            ) : null}
            {Number(product.order_count || 0) >= 10 ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold shadow" style={{ backgroundColor: 'var(--totem-secondary)', color: 'var(--totem-button-text)' }}>
                <Sparkles className="h-3.5 w-3.5" />
                Favorito
              </span>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5 p-3">
          <h3 className="min-h-[2.5rem] text-base font-extrabold leading-tight line-clamp-2" style={{ color: 'var(--totem-text)' }}>
            {product.name}
          </h3>
          <p
            className="min-h-[2rem] text-xs leading-relaxed line-clamp-2"
            style={{ color: 'color-mix(in srgb, var(--totem-text) 68%, transparent)' }}
          >
            {product.description || 'Produto preparado na hora.'}
          </p>
        </div>
      </button>

      <div className="flex items-center justify-between gap-2 border-t border-stone-100 p-3">
        <div>
          {product.original_price && product.original_price > product.price ? (
            <div className="text-xs font-semibold text-stone-400 line-through">
              {formatBRL(product.original_price)}
            </div>
          ) : null}
          <div className="text-lg font-extrabold" style={{ color: 'var(--totem-primary)' }}>
            {formatBRL(product.price)}
          </div>
        </div>
        <Button
          type="button"
          onClick={() => onSelect(product)}
          className="h-10 rounded-lg px-3 text-sm font-extrabold brightness-100 hover:brightness-95"
          style={{ backgroundColor: 'var(--totem-primary)', color: 'var(--totem-button-text)' }}
        >
          <Plus className="mr-1 h-4 w-4" />
          Adicionar
        </Button>
      </div>
    </article>
  );
}
