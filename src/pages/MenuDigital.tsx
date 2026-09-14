import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { useSimpleCart } from '@/hooks/useSimpleCart';
import { useMenuData } from '@/hooks/useMenuData';
import { useScrollSpy } from '@/hooks/useScrollSpy';
import {
  getCachedSimpleVariations,
  getSimpleVariationPresence,
  isSimpleVariationReady,
  prefetchSimpleVariations,
  prefetchSimpleVariationsBulk,
  primeSimpleVariationPresence
} from '@/hooks/useSimpleVariations';
import { SimpleVariationModal } from '@/components/menu/SimpleVariationModal';
import { SimpleCartModal } from '@/components/menu/SimpleCartModal';
import CartBottomBar from '@/components/menu/CartBottomBar';
import { Input } from '@/components/ui/input';
import { MapPin, Search, ShoppingBag, SlidersHorizontal } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import HighlightsSection from '@/components/menu/HighlightsSection';
import CategoryTabs from '@/components/menu/CategoryTabs';
import ProductCard from '@/components/menu/ProductCard';
import MarketingBanners from '@/components/marketing/MarketingBanners';
import MarketingPixels from '@/components/marketing/MarketingPixels';
import { Badge } from '@/components/ui/badge';
import { getStoreOpenInfo } from '@/lib/storeHours';
import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';
import { notifyOrderCreatedById } from '@/utils/orderNotifications';
import { createMarketingContent, trackMarketingEvent } from '@/lib/marketingTracking';
// import ClubDiscountBanner from '@/components/menu/ClubDiscountBanner';

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
  track_stock?: boolean;
  stock_quantity?: number;
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

const MenuDigital = () => {
  const { userId } = useParams();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const userIdFromQuery = queryParams.get('userId');
  const { user } = useAuth();
  
  const finalUserId = userId || userIdFromQuery || user?.id || '';
  
  const { toast } = useToast();
  const { 
    cart, 
    addToCart, 
    removeFromCart, 
    updateQuantity, 
    clearCart, 
    getCartTotal, 
    getCartItemCount 
  } = useSimpleCart(finalUserId);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [showCartModal, setShowCartModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [openingProductId, setOpeningProductId] = useState<string | null>(null);
  const warnedStockRef = useRef<Set<string>>(new Set());
  const lastTrackedSearchRef = useRef('');
  const navigate = useNavigate();

  // Buscar dados do menu
  const { 
    products, 
    categories, 
    highlights, 
    profile, 
    deliveryZones,
    deliverySettings,
    isLoading: menuLoading,
    error: menuError 
  } = useMenuData({ userId: finalUserId, enableCache: false });
  const storeOpenInfo = useMemo(() => getStoreOpenInfo((profile as any)?.opening_hours), [profile]);
  const menuProductIds = useMemo(() => {
    return Array.from(
      new Set(
        [...highlights, ...(products as any[])]
          .map((p: any) => String(p?.id || '').trim())
          .filter(Boolean)
      )
    );
  }, [highlights, products]);
  const priorityImageUrls = useMemo(() => {
    const urls = [
      normalizeImageUrlForDisplay(String((profile as any)?.banner_url || '')),
      normalizeImageUrlForDisplay(String((profile as any)?.logo_url || '')),
      ...highlights.slice(0, 4).map((product) => normalizeImageUrlForDisplay(String(product.image_url || ''))),
      ...(products as any[]).slice(0, 8).map((product) => normalizeImageUrlForDisplay(String(product?.image_url || '')))
    ].filter(Boolean);

    return Array.from(new Set(urls));
  }, [profile, highlights, products]);
  const variationsReadyFromCache = useMemo(() => {
    if (menuProductIds.length === 0) return true;
    return menuProductIds.every((id) => isSimpleVariationReady(id));
  }, [menuProductIds]);

  // Pré-carregar script do Google Maps se houver chave configurada e o usuário precisar usar mapas
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY;
  // Aplicar cores personalizadas ao CSS via variáveis no root do cardápio
  useEffect(() => {
    if (!profile) return;
    
    const themeConfig = (profile as any)?.theme_config;
    const root = document.documentElement;
    const primary = themeConfig?.primary || '#85C441';
    const secondary = themeConfig?.secondary || '#063D2E';
    const accent = themeConfig?.accent || '#EF6C20';
    const background = themeConfig?.background || '#F7EEDF';
    const price = themeConfig?.price || accent;
    const tag = themeConfig?.tag || primary;

    root.style.setProperty('--menu-primary', primary);
    root.style.setProperty('--menu-secondary', secondary);
    root.style.setProperty('--menu-accent', accent);
    root.style.setProperty('--menu-price', price);
    root.style.setProperty('--menu-tag', tag);
    root.style.setProperty('--menu-bg', background);
  }, [profile]);

  useEffect(() => {
    if (!googleKey) return;
    const mode = deliverySettings?.pricing?.mode;
    if (mode === 'distance_km' || mode === 'radius_km' || mode === 'polygon') {
      import('@/components/settings/delivery/PolygonAreasEditor').then(({ loadGoogleMaps }) => {
        loadGoogleMaps(googleKey).catch(console.error);
      });
    }
  }, [googleKey, deliverySettings]);

  useEffect(() => {
    const name = String(profile?.restaurant_name || '').trim();
    if (!name) return;
    document.title = `${name} • Cardápio`;
    const upsert = (key: 'name' | 'property', value: string, content: string) => {
      try {
        const head = document.head;
        if (!head) return;
        const selector = `meta[${key}="${value}"]`;
        let el = head.querySelector(selector) as HTMLMetaElement | null;
        if (!el) {
          el = document.createElement('meta');
          el.setAttribute(key, value);
          head.appendChild(el);
        }
        el.setAttribute('content', content);
      } catch {}
    };
    upsert('property', 'og:title', name);
    upsert('name', 'twitter:title', name);
    const image = String((profile as any)?.logo_url || (profile as any)?.banner_url || '').trim();
    if (image) {
      upsert('property', 'og:image', image);
      upsert('property', 'og:image:secure_url', image);
      upsert('property', 'og:image:alt', `Logo do restaurante ${name}`);
      upsert('name', 'twitter:image', image);
      upsert('name', 'twitter:image:alt', `Logo do restaurante ${name}`);
    }
  }, [profile]);

  useEffect(() => {
    const stockById = new Map<string, number>();
    for (const p of products as any[]) {
      const track = Boolean(p.track_stock);
      const available = Number(p.stock_quantity);
      if (track && Number.isFinite(available)) {
        stockById.set(String(p.id), Math.max(0, Math.floor(available)));
      }
    }
    if (stockById.size === 0) return;

    const qtyInCart = new Map<string, number>();
    for (const item of cart) {
      const pid = String(item.product.id);
      qtyInCart.set(pid, (qtyInCart.get(pid) || 0) + (Number(item.quantity) || 0));
    }

    for (const [pid, qty] of qtyInCart.entries()) {
      const available = stockById.get(pid);
      if (available === undefined) continue;
      if (qty > available && !warnedStockRef.current.has(pid)) {
        warnedStockRef.current.add(pid);
        toast({
          title: 'Estoque atualizado',
          description: 'Alguns itens no carrinho excedem o estoque disponível.',
          variant: 'destructive'
        });
      }
      if (qty <= available && warnedStockRef.current.has(pid)) {
        warnedStockRef.current.delete(pid);
      }
    }
  }, [products, cart]);

  // Pré-carregar imagens dos destaques para exibição instantânea
  useEffect(() => {
    if (priorityImageUrls.length === 0) return;

    const preload = () => {
      priorityImageUrls.forEach((src) => {
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
      });
    };

    if ('requestIdleCallback' in window) {
      const idleId = (window as any).requestIdleCallback(preload, { timeout: 800 });
      return () => {
        if ('cancelIdleCallback' in window) {
          (window as any).cancelIdleCallback(idleId);
        }
      };
    }

    const timeoutId = window.setTimeout(preload, 0);
    return () => window.clearTimeout(timeoutId);
  }, [priorityImageUrls]);

  useEffect(() => {
    if (!finalUserId || menuLoading || menuError || menuProductIds.length === 0 || variationsReadyFromCache) return;

    let cancelled = false;
    const run = async () => {
      const idsWithVariations = await primeSimpleVariationPresence(menuProductIds);
      if (cancelled) return;

      const idsToWarm = idsWithVariations.length > 0
        ? idsWithVariations
        : menuProductIds.filter((id) => getSimpleVariationPresence(id) !== 'none');

      if (idsToWarm.length > 0) {
        await prefetchSimpleVariationsBulk(idsToWarm, 12);
      }
    };

    void run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [finalUserId, menuLoading, menuError, menuProductIds, variationsReadyFromCache]);

  // Configurar scroll spy para tabs
  const categoryIds = categories.map(cat => `category-${cat.id}`);
  const { activeSection, registerSection } = useScrollSpy(categoryIds);

  // Atualizar categoria ativa baseada no scroll
  useEffect(() => {
    if (activeSection) {
      const categoryId = activeSection.replace('category-', '');
      setActiveCategory(categoryId);
    }
  }, [activeSection]);

  // Definir categoria inicial
  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0].id);
    }
  }, [categories, activeCategory]);

  useEffect(() => {
    const search = searchQuery.trim();
    if (!finalUserId || search.length < 2) return;

    const timer = window.setTimeout(() => {
      if (lastTrackedSearchRef.current === search) return;
      lastTrackedSearchRef.current = search;
      trackMarketingEvent('Search', {
        search_string: search,
        content_category: 'cardapio',
      }, { scope: finalUserId });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [finalUserId, searchQuery]);

  const getProductCategoryName = (product: Product) =>
    categories.find((category) => String(category.id) === String(product.category_id))?.name || 'Cardápio';

  const trackProductView = (product: Product) => {
    const price = Number(product.price || 0);
    trackMarketingEvent('ViewContent', {
      content_ids: [String(product.id)],
      content_name: product.name,
      content_category: getProductCategoryName(product),
      content_type: 'product',
      contents: [createMarketingContent(product.id, 1, price)],
      value: price,
      currency: 'BRL',
    }, { scope: finalUserId });
  };

  const trackProductAdded = (product: Product, quantity = 1, variationPrice = 0) => {
    const unitPrice = Number(product.price || 0) + Number(variationPrice || 0);
    trackMarketingEvent('AddToCart', {
      content_ids: [String(product.id)],
      content_name: product.name,
      content_category: getProductCategoryName(product),
      content_type: 'product',
      contents: [createMarketingContent(product.id, quantity, unitPrice)],
      value: unitPrice * Math.max(1, Number(quantity) || 1),
      currency: 'BRL',
    }, { scope: finalUserId });
  };

  const handleProductClick = async (product: Product) => {
    if (!finalUserId) {
      console.error('❌ MenuDigital - userId não encontrado');
      return;
    }

    trackProductView(product);

    const cachedVariationsReady = isSimpleVariationReady(product.id);
    const cachedVariations = cachedVariationsReady ? getCachedSimpleVariations(product.id) : [];
    const variationPresence = cachedVariations.length > 0 ? 'has' : getSimpleVariationPresence(product.id);
    const needsVariationFetch = variationPresence !== 'none' && !cachedVariationsReady;
    const shouldOpenModalImmediately = variationPresence === 'has';

    if (needsVariationFetch && !shouldOpenModalImmediately) {
      setOpeningProductId(product.id);
    }

    try {
      const track = Boolean((product as any).track_stock);
      const stock = Number((product as any).stock_quantity);
      const inCart = cart.reduce((sum, item) => sum + (item.product.id === product.id ? Number(item.quantity || 0) : 0), 0);
      if (track && Number.isFinite(stock)) {
        const remaining = Math.max(0, Math.floor(stock) - inCart);
        if (remaining <= 0) {
          toast({
            title: 'Produto sem estoque',
            description: 'Este item está indisponível no momento.',
            variant: 'destructive'
          });
          return;
        }
      }

      if (shouldOpenModalImmediately) {
        setSelectedProduct(product);
        setShowVariationModal(true);
        if (!cachedVariationsReady) {
          void prefetchSimpleVariations(product.id);
        }
        return;
      }

      if (variationPresence === 'none') {
        addToCart(product, 1, [], '', 0);
        trackProductAdded(product);
        toast({
          title: 'Adicionado ao carrinho',
          description: `${product.name} foi adicionado com sucesso.`,
        });
        return;
      }

      if (cachedVariations.length > 0) {
        setSelectedProduct(product);
        setShowVariationModal(true);
        return;
      }

      if (variationPresence === 'has' && cachedVariationsReady && cachedVariations.length === 0) {
        const variations = await prefetchSimpleVariations(product.id);
        if (variations.length > 0) {
          setSelectedProduct(product);
          setShowVariationModal(true);
          return;
        }
      }

      if (variationPresence === 'has' && !cachedVariationsReady) {
        const variations = await prefetchSimpleVariations(product.id);
        if (variations.length > 0) {
          setSelectedProduct(product);
          setShowVariationModal(true);
          return;
        }

        addToCart(product, 1, [], '', 0);
        trackProductAdded(product);
        toast({
          title: 'Adicionado ao carrinho',
          description: `${product.name} foi adicionado com sucesso.`,
        });
        return;
      }

      const variations = await prefetchSimpleVariations(product.id);
      if (variations.length > 0) {
        setSelectedProduct(product);
        setShowVariationModal(true);
        return;
      }

      addToCart(product, 1, [], '', 0);
      trackProductAdded(product);
      toast({
        title: 'Adicionado ao carrinho',
        description: `${product.name} foi adicionado com sucesso.`,
      });
    } finally {
      if (needsVariationFetch) {
        setOpeningProductId((current) => (current === product.id ? null : current));
      }
    }
  };

  const handleAddToCartFromModal = (
    product: Product,
    quantity: number,
    variations: string[],
    notes: string,
    variationPrice: number,
    optionDetails?: any[]
  ) => {
    const track = Boolean((product as any).track_stock);
    const stock = Number((product as any).stock_quantity);
    const inCart = cart.reduce((sum, item) => sum + (item.product.id === product.id ? Number(item.quantity || 0) : 0), 0);
    if (track && Number.isFinite(stock)) {
      const remaining = Math.max(0, Math.floor(stock) - inCart);
      if (quantity > remaining) {
        toast({
          title: 'Estoque insuficiente',
          description: `Quantidade máxima disponível: ${remaining}.`,
          variant: 'destructive'
        });
        return;
      }
    }
    addToCart(product, quantity, variations, notes, variationPrice, optionDetails);
    trackProductAdded(product, quantity, variationPrice);
    setShowVariationModal(false);
    setSelectedProduct(null);
  };

  const linkedProducts = useMemo(() => {
    return (products as Product[]).reduce<Record<string, { id: string; name: string; description?: string; price: number; imageUrl?: string }>>((acc, product) => {
      acc[String(product.id)] = {
        id: String(product.id),
        name: String(product.name || ''),
        description: String(product.description || ''),
        price: Number(product.price || 0),
        imageUrl: String((product as any).image_url || ''),
      };
      return acc;
    }, {});
  }, [products]);

  const handleQuickAddFromBanner = async (productId: string) => {
    const product = (products as Product[]).find((item) => String(item.id) === String(productId));
    if (!product) {
      toast({
        title: 'Produto não encontrado',
        description: 'Este item não está disponível no cardápio no momento.',
        variant: 'destructive'
      });
      return;
    }

    const track = Boolean((product as any).track_stock);
    const stock = Number((product as any).stock_quantity);
    const inCart = cart.reduce((sum, item) => sum + (item.product.id === product.id ? Number(item.quantity || 0) : 0), 0);
    if (track && Number.isFinite(stock)) {
      const remaining = Math.max(0, Math.floor(stock) - inCart);
      if (remaining <= 0) {
        toast({
          title: 'Produto sem estoque',
          description: 'Este item está indisponível no momento.',
          variant: 'destructive'
        });
        return;
      }
    }

    if (getSimpleVariationPresence(product.id) === 'none') {
      addToCart(product, 1, [], '', 0);
      trackProductAdded(product);
      toast({
        title: 'Adicionado ao carrinho',
        description: `${product.name} foi adicionado com sucesso.`,
      });
      return;
    }

    const variations = await prefetchSimpleVariations(product.id);
    const requiresSelection = variations.some((variation) => Boolean((variation as any)?.required) || Number((variation as any)?.min_selections || 0) > 0);

    if (requiresSelection) {
      toast({
        title: 'Escolha as opções',
        description: 'Este produto precisa que você selecione os complementos antes de adicionar.',
      });
      await handleProductClick(product);
      return;
    }

    addToCart(product, 1, [], '', 0);
    trackProductAdded(product);
    toast({
      title: 'Adicionado ao carrinho',
      description: `${product.name} foi adicionado com sucesso.`,
    });
  };

  const handlePlaceOrder = async (orderData: any) => {
    try {
      if (!storeOpenInfo.isOpen) {
        throw new Error('A loja está fechada no momento. Aguarde o horário de atendimento para finalizar seu pedido.');
      }

      // Validar dados obrigatórios antes de enviar
      if (!orderData.user_id) {
        throw new Error('ID do usuário é obrigatório');
      }
      if (!orderData.customer_name?.trim()) {
        throw new Error('Nome do cliente é obrigatório');
      }
      if (!orderData.customer_phone?.trim()) {
        throw new Error('Telefone do cliente é obrigatório');
      }
      if (!orderData.items || orderData.items.length === 0) {
        throw new Error('Pedido deve ter pelo menos um item');
      }

      const qtyByProduct: Record<string, number> = {};
      const nameByProduct: Record<string, string> = {};
      for (const item of orderData.items as any[]) {
        const pid = String(item.product_id || '').trim();
        if (!pid) continue;
        qtyByProduct[pid] = (qtyByProduct[pid] || 0) + (Number(item.quantity) || 0);
        nameByProduct[pid] = String(item.product_name || item.name || '').trim() || nameByProduct[pid] || 'Produto';
      }

      const productIds = Object.keys(qtyByProduct);
      if (productIds.length > 0) {
        let lastError: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const { data: stockRows, error: stockError } = await (supabase as any)
              .from('products')
              .select('id, track_stock, stock_quantity')
              .eq('user_id', orderData.user_id)
              .in('id', productIds as any);

            if (stockError) throw stockError;
            const rows: any[] = Array.isArray(stockRows) ? stockRows : [];
            for (const row of rows) {
              const pid = String(row.id);
              const requested = Number(qtyByProduct[pid] || 0);
              const track = Boolean(row.track_stock);
              const available = Number(row.stock_quantity);
              if (track && Number.isFinite(available) && requested > Math.max(0, Math.floor(available))) {
                throw new Error(`Estoque insuficiente para ${nameByProduct[pid] || 'produto'}. Disponível: ${Math.max(0, Math.floor(available))}.`);
              }
            }
            lastError = null;
            break;
          } catch (e: any) {
            lastError = e;
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 250 * Math.pow(2, attempt)));
            }
          }
        }
        if (lastError) {
          throw new Error(lastError?.message || 'Não foi possível validar estoque. Tente novamente.');
        }
      }

      const phoneDigits = String(orderData.customer_phone || '').replace(/\D/g, '');
      if (phoneDigits.length >= 10) {
        orderData.customer_phone = phoneDigits;
      }

      // Primeiro, verificar se o cliente já existe
      let customerId = null;
      try {
        const { data: existingCustomer, error: customerCheckError } = await supabase
          .from('customers')
          .select('id')
          .eq('user_id', orderData.user_id)
          .eq('phone', orderData.customer_phone)
          .maybeSingle();

        if (customerCheckError) {
          console.error('Erro ao verificar cliente existente:', customerCheckError);
        } else if (existingCustomer) {
          customerId = existingCustomer.id;
        }
      } catch (customerError) {
        console.error('Erro na verificação de cliente:', customerError);
      }

      if (!customerId) {
        try {
          // Criar novo cliente
          const customerData = {
            user_id: orderData.user_id,
            name: orderData.customer_name,
            phone: orderData.customer_phone,
            address: orderData.customer_address,
            neighborhood: orderData.customer_neighborhood || ''
          };

          const { data: newCustomer, error: customerError } = await supabase
            .from('customers')
            .insert([customerData])
            .select('id')
            .single();

          if (customerError) {
            console.error('Erro ao criar cliente:', customerError);
          } else {
            customerId = newCustomer.id;
          }
        } catch (customerError) {
          console.error('Erro na criação de cliente:', customerError);
        }
      }

      // Adicionar customer_id ao pedido se cliente foi criado/encontrado
      if (customerId) {
        orderData.customer_id = customerId;
      }

      const loyaltyRewardId = orderData.loyalty_reward_id ? String(orderData.loyalty_reward_id) : null;
      const { loyalty_reward_id: _loyaltyRewardId, ...dbOrderData } = orderData;

      const { data, error } = await supabase
        .from('orders')
        .insert([dbOrderData])
        .select()
        .single();

      if (error) {
        console.error('Erro ao criar pedido no banco:', error);
        
        // Tratar erros específicos do banco
        if (error.code === '23505') {
          throw new Error('Número do pedido já existe. Tente novamente.');
        } else if (error.code === '23503') {
          throw new Error('Dados de referência inválidos. Verifique área de entrega.');
        } else if (error.code === '23502') {
          throw new Error('Campos obrigatórios não preenchidos.');
        } else {
          throw new Error(`Erro no banco de dados: ${error.message}`);
        }
      }

      if (data?.id) {
        type PurchasedItem = {
          product_id?: string | number | null;
          quantity?: string | number | null;
          price?: string | number | null;
          total?: string | number | null;
        };
        const purchasedItems = ((Array.isArray(orderData.items) ? orderData.items : []) as PurchasedItem[])
          .filter((item) => item.product_id !== null && item.product_id !== undefined && String(item.product_id).trim() !== '');
        const purchaseValue = Number(orderData.total ?? orderData.total_amount ?? 0);
        trackMarketingEvent('Purchase', {
          order_id: String(data.id),
          content_type: 'product',
          content_ids: purchasedItems.map((item) => String(item.product_id)),
          contents: purchasedItems.map((item) => createMarketingContent(
            item.product_id,
            item.quantity,
            Number(item.price ?? (Number(item.total || 0) / Math.max(1, Number(item.quantity) || 1))),
          )),
          num_items: purchasedItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
          value: purchaseValue,
          currency: 'BRL',
        }, {
          scope: finalUserId,
          eventId: `popsystem-purchase-${data.id}`,
        });

        void (async () => {
          try {
            await notifyOrderCreatedById(data.id);
          } catch (waErr) {
            console.warn('⚠️ Falha ao notificar via WhatsApp (não crítico):', waErr);
          }
        })();

        void (async () => {
          try {
            if (!loyaltyRewardId) return;
            const { data: redeemResult, error: redeemError } = await supabase.functions.invoke('loyalty-redeem-reward', {
              body: {
                rewardId: loyaltyRewardId,
                orderId: data.id,
                userId: orderData.user_id,
              }
            });

            if (redeemError) throw redeemError;
            if (!redeemResult?.ok) {
              console.warn('⚠️ Recompensa fidelidade não foi marcada como usada:', redeemResult);
            }
          } catch (loyaltyErr) {
            console.warn('⚠️ Falha ao marcar recompensa fidelidade como usada:', loyaltyErr);
          }
        })();

        void (async () => {
          try {
            await supabase.functions.invoke('send-push', {
              body: { orderId: data.id }
            });
          } catch (pushErr) {
            console.warn('Falha ao enviar push (não crítico):', pushErr);
          }
        })();
      }
      toast({
        title: "Pedido realizado!",
        description: String(orderData.payment_method || '').includes('pix_entrega')
          ? `Pagamento via PIX será realizado na entrega do pedido ${orderData.order_number}.`
          : `Acompanhe o andamento do pedido ${orderData.order_number}.`,
      });
      clearCart();
      setShowCartModal(false);
      if (data?.id) {
        navigate(`/track/${data.id}`);
      }
    } catch (error) {
      console.error('Erro completo ao finalizar pedido:', error);
      
      let userMessage = "Tente novamente ou entre em contato conosco.";
      if (error instanceof Error) {
        userMessage = error.message;
      }
      
      toast({
        title: "Erro ao finalizar pedido",
        description: userMessage,
        variant: "destructive",
      });
      
      // Re-throw para que o CheckoutModal saiba que houve erro
      throw error;
    }
  };

  // Filtrar produtos por busca
  const filteredProducts = products.filter(product => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      String((product as any)?.name || '').toLowerCase().includes(query) ||
      String((product as any)?.description || '').toLowerCase().includes(query)
    );
  });

  // Agrupar produtos por categoria
  const productsByCategory = categories.length > 0
    ? categories.map(category => ({
        ...category,
        products: filteredProducts.filter(product => product.category_id === category.id)
      })).filter(category => category.products.length > 0)
    : (filteredProducts.length > 0
        ? [{
            id: 'all-products',
            name: 'Cardápio',
            description: '',
            display_order: 0,
            products: filteredProducts
          }]
        : []);

  const visualCategories = categories.map((category) => ({
    ...category,
    image_url: normalizeImageUrlForDisplay(category.totem_image_url || '') ||
      normalizeImageUrlForDisplay(products.find((product) => product.category_id === category.id)?.image_url || '') || null
  }));
  const featuredProducts = highlights.length > 0
    ? highlights
    : [...products].filter((product) => Number(product.order_count || 0) > 0 && Boolean(normalizeImageUrlForDisplay(product.image_url || ''))).sort((a, b) => Number(b.order_count || 0) - Number(a.order_count || 0)).slice(0, 8);

  if (menuLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Carregando cardápio...</p>
        </div>
      </div>
    );
  }

  if (menuError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Erro ao carregar cardápio</h1>
          <p className="text-gray-600">{menuError}</p>
        </div>
      </div>
    );
  }

  if (!finalUserId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Link inválido</h1>
          <p className="text-gray-600">Verifique se o link está correto.</p>
        </div>
      </div>
    );
  }

  if (!profile || products.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            {profile?.restaurant_name || 'Restaurante'}
          </h1>
          <p className="text-gray-600">Este restaurante ainda não possui produtos disponíveis.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: 'color-mix(in srgb, var(--menu-bg, #F7EEDF) 78%, white)' }}>
      <MarketingPixels userId={finalUserId} />
      <div className="mx-auto max-w-6xl px-3 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-8">
          <header className="rounded-[22px] border border-white/80 bg-white/90 p-3 shadow-[0_18px_50px_-35px_rgba(15,23,42,.45)] backdrop-blur sm:rounded-[28px] sm:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-xl bg-[#f5f2eb] shadow-sm sm:h-16 sm:w-16 sm:rounded-2xl">
                {(profile as any)?.logo_url ? (
                  <img
                    src={String((profile as any).logo_url)}
                    alt={profile.restaurant_name || 'Logo'}
                    className="h-full w-full object-cover"
                    loading="eager"
                    decoding="async"
                  />
                ) : (
                  <div className="text-xs font-bold text-gray-600">
                    {(profile?.restaurant_name || 'BC').slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[8px] font-bold uppercase tracking-[.16em] text-slate-400 sm:text-[10px]">Bem-vindo ao cardápio</p>
                <h1 className="line-clamp-2 text-sm font-black leading-tight sm:text-2xl" style={{ color: 'var(--menu-secondary, #063D2E)' }}>
                  {profile?.restaurant_name || 'Cardápio'}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge className={storeOpenInfo.isOpen ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-red-100 text-red-700 hover:bg-red-100'}>
                    {storeOpenInfo.label}
                  </Badge>
                  <span className="text-[9px] font-medium text-gray-500 sm:text-xs">{storeOpenInfo.detail}</span>
                </div>
              </div>
              <button type="button" onClick={() => setShowCartModal(true)} className="relative flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[#f8f6f1] shadow-sm sm:h-12 sm:w-12 sm:rounded-2xl" aria-label="Abrir sacola">
                <ShoppingBag className="h-5 w-5" style={{ color: 'var(--menu-secondary, #063D2E)' }} />
                {getCartItemCount() > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black text-white" style={{ backgroundColor: 'var(--menu-accent, #EF6C20)' }}>{getCartItemCount()}</span>}
              </button>
            </div>
            {(profile as any)?.address && <p className="mt-2 flex items-center gap-1 truncate text-[9px] text-slate-500 sm:mt-3 sm:gap-1.5 sm:text-xs"><MapPin className="h-3 w-3 flex-none sm:h-3.5 sm:w-3.5" />{String((profile as any).address)}</p>}
            <div className="mt-3 flex gap-2 sm:mt-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder={`Buscar em ${profile?.restaurant_name || 'Cardápio'}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 w-full rounded-xl border-0 bg-[#f7f5f0] pl-9 pr-3 text-[11px] shadow-inner transition-all focus:ring-2 sm:h-12 sm:rounded-2xl sm:pl-10 sm:pr-4 sm:text-sm"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--menu-primary, #85C441) 40%, #d1d5db)',
                    boxShadow: '0 1px 0 rgba(0,0,0,0.02)'
                  }}
                />
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f7f5f0] text-slate-600 sm:h-12 sm:w-12 sm:rounded-2xl"><SlidersHorizontal className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            </div>
          </header>
      </div>

      <div className="mx-auto max-w-6xl px-3 sm:px-6">
        <div>
          <MarketingBanners
            restaurantId={finalUserId}
            linkedProducts={linkedProducts}
            fallbackImage={normalizeImageUrlForDisplay(String((profile as any)?.banner_url || '')) || undefined}
            onQuickAddProduct={handleQuickAddFromBanner}
            onSelectProductId={(productId) => {
              const p = (products as any[]).find((x: any) => String(x?.id) === String(productId));
              if (p) void handleProductClick(p as any);
            }}
          />
        </div>

        <div className="sticky top-0 z-40 mt-2 rounded-3xl bg-[color-mix(in_srgb,var(--menu-bg,#F7EEDF)_78%,white)]/95 backdrop-blur sm:mt-3 sm:py-1">
          {categories.length > 0 && (
            <CategoryTabs
              categories={visualCategories}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
            />
          )}
        </div>

        <div className="h-3 sm:h-5" />
        {/* Seção de Destaques */}
        {featuredProducts.length > 0 && (
          <HighlightsSection
            products={featuredProducts}
            onProductClick={handleProductClick}
          />
        )}

        <div className="h-1 sm:h-3" />

        {/* Produtos por Categoria */}
        <div className="space-y-6 sm:space-y-8">
          {productsByCategory.map((category) => (
            <section
              key={category.id}
              id={`category-${category.id}`}
              ref={(el) => {
                if (el) registerSection(`category-${category.id}`, el);
              }}
              className="scroll-mt-32"
            >
              <h2 className="mb-1 text-lg font-black sm:text-2xl" style={{ color: 'var(--menu-secondary, #063D2E)' }}>
                {category.name}
              </h2>
              {category.description && <p className="mb-4 text-sm text-slate-500">{category.description}</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
                {category.products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onProductClick={handleProductClick}
                    isAdding={openingProductId === product.id}
                    layout="grid"
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* Modals */}
      <SimpleVariationModal
        isOpen={showVariationModal}
        onClose={() => {
          setShowVariationModal(false);
          setSelectedProduct(null);
        }}
        product={selectedProduct}
        categoryConfig={categories.find((category: any) => category.id === selectedProduct?.category_id) as any}
        onAddToCart={handleAddToCartFromModal}
        maxQuantity={(() => {
          if (!selectedProduct) return null;
          const track = Boolean((selectedProduct as any).track_stock);
          const stock = Number((selectedProduct as any).stock_quantity);
          if (!track || !Number.isFinite(stock)) return null;
          const inCart = cart.reduce((sum, item) => sum + (item.product.id === selectedProduct.id ? Number(item.quantity || 0) : 0), 0);
          return Math.max(0, Math.floor(stock) - inCart);
        })()}
      />

      <SimpleCartModal
        isOpen={showCartModal}
        onClose={() => setShowCartModal(false)}
        cart={cart}
        total={getCartTotal()}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeFromCart}
        onPlaceOrder={handlePlaceOrder}
        deliveryZones={deliveryZones}
        deliverySettings={deliverySettings}
        userId={finalUserId}
        isStoreOpen={storeOpenInfo.isOpen}
        storeClosedMessage={storeOpenInfo.detail}
        onPixPaid={(orderId) => {
          clearCart();
          setShowCartModal(false);
          if (orderId) {
            navigate(`/track/${orderId}`);
          }
        }}
      />

      {/* Clube de Vantagens removido conforme solicitação */}

      {/* Carrinho Fixo */}
      <CartBottomBar
        itemCount={getCartItemCount()}
        total={getCartTotal()}
        onOpenCart={() => {
          if (!storeOpenInfo.isOpen) {
            toast({
              title: 'Loja fechada',
              description: storeOpenInfo.detail,
              variant: 'destructive'
            });
            return;
          }
          setShowCartModal(true);
        }}
      />
    </div>
  );
};

export default MenuDigital;
