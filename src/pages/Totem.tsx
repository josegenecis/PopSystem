import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  LockKeyhole,
  ShoppingBag,
  Utensils,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSimpleCart } from '@/hooks/useSimpleCart';
import { useSimpleVariations } from '@/hooks/useSimpleVariations';
import type { SelectedVariationDetail } from '@/hooks/useSimpleVariations';
import { useMenuData } from '@/hooks/useMenuData';
import { SimpleVariationModal } from '@/components/menu/SimpleVariationModal';
import { Button } from '@/components/ui/button';
import TotemCheckoutModal from '@/components/totem/TotemCheckoutModal';
import TotemCheckoutBar from '@/components/totem/TotemCheckoutBar';
import TotemIdleScreen from '@/components/totem/TotemIdleScreen';
import TotemProductCard from '@/components/totem/TotemProductCard';
import { useAuth } from '@/contexts/AuthContext';
import MarketingPixels from '@/components/marketing/MarketingPixels';
import { getSavedTotemRestaurantId, useTotemPwa } from '@/hooks/useTotemPwa';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useTotemTheme } from '@/hooks/useTotemTheme';
import { supabase } from '@/integrations/supabase/client';
import TotemFulfillmentDialog, { type TotemOrderType } from '@/components/totem/TotemFulfillmentDialog';
import TotemUpsellModal, { type TotemUpsellRecommendation } from '@/components/totem/TotemUpsellModal';
import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';
import { warmImageCache } from '@/utils/imageCache';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  original_price?: number;
  discount_percentage?: number;
  image_url?: string;
  is_available: boolean;
  show_in_delivery: boolean;
  is_highlight: boolean;
  order_count: number;
  category_id: string;
}

interface Category {
  id: string;
  name: string;
  description?: string;
  display_order: number;
  totem_image_url?: string;
  is_pizza?: boolean;
  pizza_half_price_mode?: 'highest' | 'split_halves';
}

type UpsellRule = {
  id: string;
  trigger_product_id: string | null;
  suggested_product_id: string;
  message: string | null;
  placement: 'product' | 'checkout' | 'both';
  discount_type: 'percentage' | 'fixed' | null;
  discount_value: number | null;
};

type UpsellOffer = {
  mode: 'product' | 'checkout';
  recommendations: TotemUpsellRecommendation[];
};

export default function Totem() {
  const { userId } = useParams();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const userIdFromQuery = queryParams.get('userId');
  const { user } = useAuth();
  const [savedRestaurantId] = useState(getSavedTotemRestaurantId);
  const finalUserId = userId || userIdFromQuery || user?.id || savedRestaurantId || '';

  const { toast } = useToast();
  const { cart, addToCart, removeFromCart, updateQuantity, clearCart, getCartTotal, getCartItemCount } = useSimpleCart(finalUserId ? `totem:${finalUserId}` : 'totem');
  const clearCartRef = useRef(clearCart);
  const { fetchVariations } = useSimpleVariations();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [started, setStarted] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null);
  const [orderType, setOrderType] = useState<TotemOrderType | null>(null);
  const [fulfillmentOpen, setFulfillmentOpen] = useState(false);
  const [checkoutAfterFulfillment, setCheckoutAfterFulfillment] = useState(false);
  const [upsellRules, setUpsellRules] = useState<UpsellRule[]>([]);
  const [upsellOffer, setUpsellOffer] = useState<UpsellOffer | null>(null);
  const [selectionContext, setSelectionContext] = useState<'normal' | 'product-upsell' | 'checkout-upsell'>('normal');
  const [checkoutUpsellHandled, setCheckoutUpsellHandled] = useState(false);

  const { products, categories, profile, isLoading: menuLoading, error: menuError } = useMenuData({ userId: finalUserId, enableCache: true, cacheTTL: 60, pricingChannel: 'totem' });
  useTotemPwa(finalUserId);
  const { settings: totemSettings, cssVariables } = useTotemTheme(finalUserId);

  const itemCount = getCartItemCount();
  const total = getCartTotal();

  useEffect(() => {
    warmImageCache([
      ...products.map((product) => product.image_url),
      ...categories.map((category) => category.totem_image_url),
      profile?.logo_url,
      profile?.banner_url,
    ]);
  }, [products, categories, profile?.logo_url, profile?.banner_url]);

  useEffect(() => {
    clearCartRef.current = clearCart;
  }, [clearCart]);

  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0].id);
    }
  }, [categories, activeCategory]);

  useEffect(() => {
    if (itemCount > 0) setStarted(true);
  }, [itemCount]);

  useEffect(() => {
    if (!finalUserId) return;
    let cancelled = false;
    const loadUpsells = async () => {
      const { data, error } = await (supabase.from('upsell_rules') as any)
        .select('id,trigger_product_id,suggested_product_id,message,placement,discount_type,discount_value')
        .eq('user_id', finalUserId)
        .eq('active', true)
        .order('display_order', { ascending: true });
      if (!cancelled && !error) setUpsellRules((data || []) as UpsellRule[]);
    };
    void loadUpsells();
    return () => { cancelled = true; };
  }, [finalUserId]);

  const featuredProducts = useMemo(() => {
    return (products as Product[])
      .filter((product) => product?.is_available && (product.is_highlight || Number(product.order_count || 0) > 0))
      .sort((a, b) => Number(b.order_count || 0) - Number(a.order_count || 0))
      .slice(0, 3);
  }, [products]);

  const filteredProductsByCategory = useMemo(() => {
    const byCat: Record<string, Product[]> = {};
    for (const c of categories as Category[]) byCat[c.id] = [];
    for (const prod of products as Product[]) {
      if (!prod?.is_available) continue;
      if (!byCat[prod.category_id]) byCat[prod.category_id] = [];
      byCat[prod.category_id].push(prod);
    }
    return byCat;
  }, [products, categories]);

  const visibleCategories = useMemo(() => {
    return (categories as Category[]).filter((category) => (filteredProductsByCategory[category.id] || []).length > 0);
  }, [categories, filteredProductsByCategory]);

  const activeCategoryData = useMemo(() => visibleCategories.find((category) => category.id === activeCategory) || visibleCategories[0], [visibleCategories, activeCategory]);

  useEffect(() => {
    if (visibleCategories.length > 0 && !visibleCategories.some((category) => category.id === activeCategory)) {
      setActiveCategory(visibleCategories[0].id);
    }
  }, [visibleCategories, activeCategory]);

  const scrollToCategory = (categoryId: string) => {
    setActiveCategory(categoryId);
    setStarted(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleProductClick = async (product: Product, context: typeof selectionContext = 'normal') => {
    if (!finalUserId) {
      toast({ title: 'Erro', description: 'Totem não configurado para este restaurante.', variant: 'destructive' });
      return;
    }
    try {
      await fetchVariations(product.id);
    } catch {
      // O modal ainda pode abrir sem adicionais quando a consulta falhar.
    }
    setStarted(true);
    setSelectionContext(context);
    setSelectedProduct(product);
    setShowVariationModal(true);
  };

  const buildRecommendations = useCallback((triggerProductIds: string[], mode: 'product' | 'checkout') => {
    const productsById = new Map((products as Product[]).map((product) => [product.id, product]));
    const cartProductIds = new Set(cart.map((item) => item.product.id));
    const usedProducts = new Set<string>();
    return upsellRules.flatMap((rule): TotemUpsellRecommendation[] => {
      if (rule.placement !== mode && rule.placement !== 'both') return [];
      if (rule.trigger_product_id && !triggerProductIds.includes(rule.trigger_product_id)) return [];
      const original = productsById.get(rule.suggested_product_id);
      if (!original?.is_available || cartProductIds.has(original.id) || usedProducts.has(original.id)) return [];
      usedProducts.add(original.id);
      const discount = Math.max(0, Number(rule.discount_value || 0));
      const discountedPrice = rule.discount_type === 'percentage'
        ? Math.max(0, Number(original.price) * (1 - Math.min(100, discount) / 100))
        : rule.discount_type === 'fixed'
          ? Math.max(0, Number(original.price) - discount)
          : Number(original.price);
      const offeredProduct = discountedPrice < Number(original.price)
        ? { ...original, original_price: Number(original.price), price: Number(discountedPrice.toFixed(2)) }
        : original;
      return [{ ruleId: rule.id, message: rule.message, product: offeredProduct }];
    }).slice(0, 8);
  }, [products, cart, upsellRules]);

  const handleAddToCartFromModal = (product: Product, quantity: number, variations: string[], notes: string, variationPrice: number, optionDetails?: SelectedVariationDetail[]) => {
    addToCart(product, quantity, variations, notes, variationPrice, optionDetails);
    setShowVariationModal(false);
    setSelectedProduct(null);
    if (selectionContext === 'checkout-upsell') {
      setCheckoutUpsellHandled(true);
      setShowCheckoutModal(true);
    } else if (selectionContext === 'normal') {
      const recommendations = buildRecommendations([product.id], 'product');
      if (recommendations.length > 0) setUpsellOffer({ mode: 'product', recommendations });
    }
    setSelectionContext('normal');
  };

  const openCheckout = useCallback(() => {
    if (!checkoutUpsellHandled) {
      const recommendations = buildRecommendations(cart.map((item) => item.product.id), 'checkout');
      if (recommendations.length > 0) {
        setUpsellOffer({ mode: 'checkout', recommendations });
        return;
      }
    }
    setShowCheckoutModal(true);
  }, [buildRecommendations, cart, checkoutUpsellHandled]);

  const requestCheckout = () => {
    if (!orderType) {
      setCheckoutAfterFulfillment(true);
      setFulfillmentOpen(true);
      return;
    }
    openCheckout();
  };

  const selectFulfillment = (type: TotemOrderType) => {
    setOrderType(type);
    setFulfillmentOpen(false);
    if (checkoutAfterFulfillment) {
      setCheckoutAfterFulfillment(false);
      window.setTimeout(openCheckout, 0);
    }
  };

  const selectUpsell = (recommendation: TotemUpsellRecommendation) => {
    const context = upsellOffer?.mode === 'checkout' ? 'checkout-upsell' : 'product-upsell';
    setUpsellOffer(null);
    void handleProductClick(recommendation.product as Product, context);
  };

  const handleNewSession = useCallback(() => {
    clearCartRef.current();
    setShowCheckoutModal(false);
    setShowVariationModal(false);
    setSelectedProduct(null);
    setUpsellOffer(null);
    setOrderType(null);
    setFulfillmentOpen(false);
    setCheckoutAfterFulfillment(false);
    setCheckoutUpsellHandled(false);
    setSelectionContext('normal');
    setIdleSecondsLeft(null);
    setStarted(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!started) {
      setIdleSecondsLeft(null);
      return;
    }

    let lastInteraction = Date.now();
    const resetIdle = () => {
      lastInteraction = Date.now();
      setIdleSecondsLeft(null);
    };
    const timeoutSeconds = Math.min(60, Math.max(1, Number(totemSettings.idle_timeout_minutes || 3))) * 60;
    const warningSeconds = Math.min(30, Math.max(10, Math.floor(timeoutSeconds / 3)));
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'];
    events.forEach((eventName) => window.addEventListener(eventName, resetIdle, { passive: true }));

    const interval = window.setInterval(() => {
      const idleSeconds = Math.floor((Date.now() - lastInteraction) / 1000);
      if (idleSeconds >= timeoutSeconds) {
        handleNewSession();
        return;
      }
      setIdleSecondsLeft(itemCount > 0 && idleSeconds >= timeoutSeconds - warningSeconds ? timeoutSeconds - idleSeconds : null);
    }, 1000);

    return () => {
      window.clearInterval(interval);
      events.forEach((eventName) => window.removeEventListener(eventName, resetIdle));
    };
  }, [started, handleNewSession, itemCount, totemSettings.idle_timeout_minutes]);

  if (!finalUserId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#063d2e] p-6 text-white">
        <div className="w-full max-w-xl rounded-[28px] border border-white/15 bg-white/10 p-8 text-center shadow-2xl backdrop-blur">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-[#063d2e]"><LockKeyhole className="h-8 w-8" /></div>
          <div className="mt-6 text-3xl font-black">Totem ainda não vinculado</div>
          <p className="mx-auto mt-3 max-w-md text-base font-medium leading-7 text-white/70">
            Entre no PopSystem como administrador e abra o link de instalação deste totem. O vínculo da loja ficará salvo neste equipamento.
          </p>
          <div className="mt-6 rounded-2xl bg-black/15 p-4 text-sm font-bold text-white/75">
            Endereço de configuração: /totem/ID-DA-LOJA
          </div>
        </div>
      </div>
    );
  }

  if (menuError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 p-6">
        <div className="w-full max-w-md rounded-lg border bg-white p-6 shadow-sm">
          <div className="text-xl font-bold">Erro ao carregar</div>
          <div className="mt-2 text-sm text-muted-foreground">{String(menuError)}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{
        ...cssVariables,
        backgroundColor: 'var(--totem-background)',
        color: 'var(--totem-text)',
      } as CSSProperties}
    >
      <MarketingPixels userId={finalUserId} />

      {!started ? (
        <TotemIdleScreen
          restaurantId={finalUserId}
          profile={profile}
          featuredProducts={featuredProducts}
          settings={totemSettings}
          onStart={() => {
            setStarted(true);
            setCheckoutAfterFulfillment(false);
            setFulfillmentOpen(true);
          }}
        />
      ) : null}

      <div className={started ? 'block' : 'hidden'}>
        <header className="sticky top-0 z-40 border-b border-stone-200 shadow-sm backdrop-blur" style={{ backgroundColor: 'color-mix(in srgb, var(--totem-surface) 95%, transparent)' }}>
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 lg:px-6">
            <div className="flex items-center">
              <div className="flex items-center gap-3">
                {profile?.logo_url ? <img src={profile.logo_url} alt="" className="h-14 w-14 rounded-xl border border-stone-200 bg-white object-contain p-1" /> : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#073a2d] text-white"><ShoppingBag className="h-7 w-7" /></div>}
                <div>
                  <div className="text-2xl font-black leading-tight" style={{ color: 'var(--totem-secondary)' }}>{profile?.restaurant_name || 'Autoatendimento'}</div>
                  <div className="text-sm font-semibold text-stone-500">Escolha seus produtos e finalize pelo Totem</div>
                </div>
              </div>
            </div>
            {orderType ? (
              <button type="button" onClick={() => { setCheckoutAfterFulfillment(false); setFulfillmentOpen(true); }} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-2 text-left shadow-sm">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-[#073a2d]">{orderType === 'dine_in' ? <Utensils className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}</span>
                <span><span className="block text-xs font-bold text-stone-400">Seu pedido</span><span className="block font-black text-[#073a2d]">{orderType === 'dine_in' ? 'Comer aqui' : 'Para levar'}</span></span>
                <span className="hidden text-xs font-bold text-orange-600 sm:block">Alterar</span>
              </button>
            ) : null}
          </div>
        </header>

        <main className="totem-menu-main mx-auto flex max-w-[1600px] items-start pb-44">
          <aside className="sticky top-[81px] h-[calc(100dvh-170px)] w-[112px] flex-none overflow-y-auto border-r border-stone-200 bg-white p-2 sm:w-[148px] sm:p-3 lg:w-[180px]">
            <div className="space-y-2">
              {visibleCategories.map((category) => {
                const selected = activeCategoryData?.id === category.id;
                const categoryImage = normalizeImageUrlForDisplay(category.totem_image_url || filteredProductsByCategory[category.id]?.find((product) => product.image_url)?.image_url);
                return (
                  <button key={category.id} type="button" onClick={() => scrollToCategory(category.id)} className={`w-full overflow-hidden rounded-2xl border-2 p-1.5 text-center transition ${selected ? 'shadow-md' : 'border-transparent hover:border-stone-200'}`} style={selected ? { borderColor: 'var(--totem-primary)', backgroundColor: 'color-mix(in srgb, var(--totem-primary) 8%, white)' } : undefined}>
                    <span className="block aspect-square overflow-hidden rounded-xl bg-stone-100">{categoryImage ? <img src={categoryImage} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center"><ShoppingBag className="h-7 w-7 text-stone-300" /></span>}</span>
                    <span className="mt-2 block line-clamp-2 text-xs font-black leading-tight sm:text-sm" style={{ color: selected ? 'var(--totem-primary)' : 'var(--totem-text)' }}>{category.name}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-w-0 flex-1 space-y-8 px-3 py-5 sm:px-5 lg:px-7">
            {menuLoading ? (
              <div className="rounded-lg border border-stone-200 p-8 text-lg font-bold" style={{ backgroundColor: 'var(--totem-surface)', color: 'var(--totem-text)' }}>
                Carregando cardapio...
              </div>
            ) : visibleCategories.length === 0 ? (
              <div className="rounded-lg border border-stone-200 p-8" style={{ backgroundColor: 'var(--totem-surface)', color: 'var(--totem-text)' }}>
                <div className="text-2xl font-black">Nenhum produto encontrado</div>
                <div className="mt-2 opacity-60">Assim que o cardápio for publicado, os itens aparecerão aqui.</div>
              </div>
            ) : (
              <div>
                {activeCategoryData ? (() => {
                  const category = activeCategoryData;
                  const items = filteredProductsByCategory[category.id] || [];
                  return (
                    <section key={category.id}>
                      <div className="mb-4 flex items-end justify-between gap-4">
                        <div>
                          <h2 className="text-3xl font-black" style={{ color: 'var(--totem-text)' }}>{category.name}</h2>
                          {category.description ? (
                            <p className="mt-1 max-w-2xl text-base font-medium opacity-60" style={{ color: 'var(--totem-text)' }}>{category.description}</p>
                          ) : null}
                        </div>
                        <div className="hidden rounded-full bg-white px-3 py-1 text-sm font-bold text-stone-500 shadow-sm lg:block">
                          {items.length} itens
                        </div>
                      </div>

                      <div className="totem-product-grid grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                        {items.map((product: Product) => (
                          <TotemProductCard key={product.id} product={product} onSelect={handleProductClick} />
                        ))}
                      </div>
                    </section>
                  );
                })() : null}
              </div>
            )}
          </section>

        </main>

        <TotemCheckoutBar
          itemCount={itemCount}
          total={total}
          onCheckout={requestCheckout}
          onCancel={handleNewSession}
        />
      </div>

      <SimpleVariationModal
        isOpen={showVariationModal}
        onClose={() => {
          setShowVariationModal(false);
          setSelectedProduct(null);
        }}
        product={selectedProduct}
        categoryConfig={(categories as Category[]).find((category) => category.id === selectedProduct?.category_id)}
        onAddToCart={handleAddToCartFromModal}
        presentation="totem"
      />

      <TotemCheckoutModal
        isOpen={showCheckoutModal}
        onClose={() => setShowCheckoutModal(false)}
        userId={finalUserId}
        cart={cart}
        total={total}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeFromCart}
        onClearCart={clearCart}
        orderType={orderType || 'pickup'}
        onNewSession={handleNewSession}
      />

      <TotemFulfillmentDialog open={fulfillmentOpen} onSelect={selectFulfillment} />

      <TotemUpsellModal
        open={Boolean(upsellOffer)}
        mode={upsellOffer?.mode || 'product'}
        recommendations={upsellOffer?.recommendations || []}
        onSelect={selectUpsell}
        onContinue={() => {
          const mode = upsellOffer?.mode;
          setUpsellOffer(null);
          if (mode === 'checkout') {
            setCheckoutUpsellHandled(true);
            setShowCheckoutModal(true);
          }
        }}
      />

      <Dialog open={idleSecondsLeft !== null}>
        <DialogContent className="max-w-lg rounded-[28px] border-0 p-8 text-center" onPointerDownOutside={(event) => event.preventDefault()}>
          <DialogTitle className="text-3xl font-black text-[#073a2d]">Você ainda está aí?</DialogTitle>
          <p className="mt-3 text-base font-medium leading-7 text-stone-600">
            Por segurança, este pedido será cancelado e o totem voltará ao início em
          </p>
          <div className="mx-auto my-6 flex h-28 w-28 items-center justify-center rounded-full bg-orange-50 text-5xl font-black text-boracume-orange">
            {idleSecondsLeft ?? 30}
          </div>
          <Button type="button" className="h-16 w-full rounded-2xl bg-[#073a2d] text-xl font-black text-white hover:bg-[#0a4b3a]" onClick={() => setIdleSecondsLeft(null)}>
            Continuar meu pedido
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
