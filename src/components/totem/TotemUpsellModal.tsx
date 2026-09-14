import { Plus, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';
import { formatBRL } from '@/lib/currency';

export type TotemUpsellRecommendation = {
  ruleId: string;
  message?: string | null;
  product: {
    id: string;
    name: string;
    description?: string;
    price: number;
    original_price?: number;
    image_url?: string;
    [key: string]: unknown;
  };
};

export default function TotemUpsellModal({
  open,
  mode,
  recommendations,
  onSelect,
  onContinue,
}: {
  open: boolean;
  mode: 'product' | 'checkout';
  recommendations: TotemUpsellRecommendation[];
  onSelect: (recommendation: TotemUpsellRecommendation) => void;
  onContinue: () => void;
}) {
  const customMessage = recommendations.find((item) => item.message)?.message;
  return (
    <Dialog open={open}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-[30px] border-0 p-6 sm:p-8" onPointerDownOutside={(event) => event.preventDefault()}>
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-500"><Sparkles className="h-7 w-7" /></span>
          <DialogTitle className="mt-4 text-3xl font-black text-[#073a2d]">{mode === 'checkout' ? 'Que tal completar seu pedido?' : 'Isso combina com seu pedido'}</DialogTitle>
          <DialogDescription className="mx-auto mt-2 max-w-2xl text-base font-semibold text-stone-500">{customMessage || 'Escolha um acompanhamento ou continue quando quiser.'}</DialogDescription>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {recommendations.map((recommendation) => {
            const product = recommendation.product;
            const imageUrl = normalizeImageUrlForDisplay(product.image_url);
            return (
              <button key={recommendation.ruleId} type="button" onClick={() => onSelect(recommendation)} className="overflow-hidden rounded-2xl border border-stone-200 bg-white text-left shadow-sm transition hover:-translate-y-1 hover:border-orange-300 hover:shadow-lg">
                <div className="aspect-square bg-stone-100">{imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs font-bold text-stone-400">Sem imagem</div>}</div>
                <div className="p-3">
                  <div className="line-clamp-2 min-h-10 text-sm font-black text-[#073a2d]">{product.name}</div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div>{product.original_price && product.original_price > product.price ? <div className="text-xs font-semibold text-stone-400 line-through">{formatBRL(product.original_price)}</div> : null}<div className="font-black text-orange-600">{formatBRL(product.price)}</div></div>
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 text-white"><Plus className="h-5 w-5" /></span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <Button type="button" variant="outline" className="mt-5 h-14 w-full rounded-2xl text-base font-black" onClick={onContinue}>{mode === 'checkout' ? 'Continuar para o pagamento' : 'Agora não'}</Button>
      </DialogContent>
    </Dialog>
  );
}
