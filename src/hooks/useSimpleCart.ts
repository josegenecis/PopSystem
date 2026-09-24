import { useEffect, useMemo, useRef, useState } from 'react';
import { perfStart } from '@/utils/perf';

interface CartProduct {
  id: string;
  name: string;
  price: number;
  image_url?: string;
  base_price?: number;
  effective_price?: number;
  price_table_id?: string | null;
  price_rule_id?: string | null;
  price_table_name?: string | null;
  price_source?: 'base' | 'price_table';
  preparation_route?: 'kitchen' | 'bar' | 'none';
  send_to_kds?: boolean;
}

interface CartItem {
  product: CartProduct;
  quantity: number;
  variations: string[];
  options?: Array<{
    key?: string;
    label?: string;
    value?: string;
    price?: number;
  }>;
  notes: string;
  totalPrice: number;
  uniqueId: string; // Para distinguir mesmo produto com variações diferentes
}

type ConfigurableCartItem = Pick<CartItem, 'variations' | 'options' | 'notes'>;

export const isConfiguredCartItem = (item: Partial<ConfigurableCartItem>) =>
  (Array.isArray(item.variations) && item.variations.length > 0) ||
  (Array.isArray(item.options) && item.options.length > 0) ||
  String(item.notes || '').trim().length > 0;

const MENU_CART_STORAGE_PREFIX = 'boracume_menu_cart';
const LEGACY_MENU_CART_STORAGE_KEY = 'boracume_menu_cart';

const readCartFromStorage = (storageKey: string) => {
  try {
    const scoped = localStorage.getItem(storageKey);
    if (scoped) return normalizeStoredCart(JSON.parse(scoped));
    if (storageKey !== LEGACY_MENU_CART_STORAGE_KEY) {
      const legacy = localStorage.getItem(LEGACY_MENU_CART_STORAGE_KEY);
      if (legacy) return normalizeStoredCart(JSON.parse(legacy));
    }
  } catch {}
  return [];
};

const normalizeStoredCart = (raw: unknown): CartItem[] => {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item: CartItem) => {
    const quantity = Math.max(1, Math.floor(Number(item?.quantity) || 1));
    if (!isConfiguredCartItem(item) || quantity === 1) return [{ ...item, quantity }];

    const unitTotal = (Number(item.totalPrice) || 0) / quantity;
    return Array.from({ length: quantity }, (_, index) => ({
      ...item,
      quantity: 1,
      totalPrice: unitTotal,
      uniqueId: `${item.uniqueId}|unit-${index + 1}`,
    }));
  });
};

export const getMenuCartStorageKey = (scope?: string) => {
  const normalizedScope = String(scope || '').trim();
  return normalizedScope ? `${MENU_CART_STORAGE_PREFIX}:${normalizedScope}` : LEGACY_MENU_CART_STORAGE_KEY;
};

export const clearMenuCartStorage = (scope?: string) => {
  try {
    const storageKey = getMenuCartStorageKey(scope);
    localStorage.removeItem(storageKey);
    if (storageKey !== LEGACY_MENU_CART_STORAGE_KEY) {
      localStorage.removeItem(LEGACY_MENU_CART_STORAGE_KEY);
    }
  } catch {}
};

export const clearAllMenuCartStorage = () => {
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (key === LEGACY_MENU_CART_STORAGE_KEY || key.startsWith(`${MENU_CART_STORAGE_PREFIX}:`)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {}
};

export const useSimpleCart = (scope?: string) => {
  const storageKey = useMemo(() => getMenuCartStorageKey(scope), [scope]);
  const [cart, setCart] = useState<CartItem[]>(() => {
    return readCartFromStorage(storageKey);
  });
  
  const persistTimerRef = useRef<number | null>(null);
  const pendingPerfRef = useRef<{ start: ReturnType<typeof perfStart> } | null>(null);

  useEffect(() => {
    setCart(readCartFromStorage(storageKey));
  }, [storageKey]);

  // Persistir carrinho
  useEffect(() => {
    try {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
      persistTimerRef.current = window.setTimeout(() => {
        try {
          const payload = JSON.stringify(cart);
          const idle = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: any) => number);
          if (idle) {
            idle(() => {
              try {
                localStorage.setItem(storageKey, payload);
                if (storageKey !== LEGACY_MENU_CART_STORAGE_KEY) {
                  localStorage.removeItem(LEGACY_MENU_CART_STORAGE_KEY);
                }
              } catch {}
            }, { timeout: 500 });
          } else {
            localStorage.setItem(storageKey, payload);
            if (storageKey !== LEGACY_MENU_CART_STORAGE_KEY) {
              localStorage.removeItem(LEGACY_MENU_CART_STORAGE_KEY);
            }
          }
        } catch {}
      }, 120);
    } catch {}
  }, [cart, storageKey]);

  useEffect(() => {
    if (pendingPerfRef.current) {
      pendingPerfRef.current.start.end({ cartItems: cart.length });
      pendingPerfRef.current = null;
    }
  }, [cart]);

  const cartTotal = useMemo(() => {
    return cart.reduce((total, item) => total + (Number(item.totalPrice) || 0), 0);
  }, [cart]);

  const cartItemCount = useMemo(() => {
    return cart.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
  }, [cart]);

  const addToCart = (
    product: CartProduct, 
    quantity: number = 1, 
    variations: string[] = [], 
    notes: string = '',
    variationPrice: number = 0,
    options: CartItem['options'] = []
  ) => {
    // Garantir tipos numéricos para evitar NaN
    const basePrice = Number(product.price) || 0;
    const extraPrice = Number(variationPrice) || 0;
    
    // Garantir que variations seja um array de strings
    // Removida a restrição de vírgulas que causava bugs em nomes compostos
    const uniqueVariations = Array.from(new Set(
      (variations || []).filter(v => typeof v === 'string' && v.trim() !== '')
    ));
    const normalizedOptions = Array.isArray(options) ? options : [];
    const configured = isConfiguredCartItem({ variations: uniqueVariations, options: normalizedOptions, notes });
    // Uma configuracao de adicionais pertence a uma unidade. Novas unidades
    // precisam passar novamente pelo modal para evitar multiplicacao silenciosa.
    const safeQuantity = configured ? 1 : Math.max(1, Number(quantity) || 1);
    pendingPerfRef.current = { start: perfStart('menu.cart.add', { productId: product.id, qty: safeQuantity }) };

    // Criar ID único baseado no produto + variações + notas
    // Usamos pipe | como separador para evitar conflito com vírgulas nos nomes
    const configurationKey = `${product.id}|${uniqueVariations.sort().join('|')}|${notes.trim()}`;
    const uniqueId = configured
      ? `${configurationKey}|unit-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`
      : configurationKey;
    
    // Calcular preço total
    const totalPrice = (basePrice + extraPrice) * safeQuantity;
    
    setCart(prev => {
      // Verificar se item já existe
      const existingIndex = configured ? -1 : prev.findIndex(item => item.uniqueId === uniqueId);

      if (existingIndex >= 0) {
        // Atualizar quantidade do item existente
        const updated = [...prev];
        updated[existingIndex].quantity += safeQuantity;
        updated[existingIndex].totalPrice = 
          (basePrice + extraPrice) * updated[existingIndex].quantity;
        
        return updated;
      } else {
        // Adicionar novo item
        const newItem: CartItem = {
          product,
          quantity: safeQuantity,
          variations: uniqueVariations,
          options: normalizedOptions,
          notes: notes.trim(),
          totalPrice,
          uniqueId
        };

        return [...prev, newItem];
      }
    });
  };

  const updateQuantity = (uniqueId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeFromCart(uniqueId);
      return;
    }

    setCart(prev => prev.map(item => {
      if (item.uniqueId === uniqueId) {
        if (newQuantity > item.quantity && isConfiguredCartItem(item)) {
          return item;
        }
        // Recalcular com base no preço unitário original implícito
        const unitPrice = item.totalPrice / item.quantity;
        return {
          ...item,
          quantity: newQuantity,
          totalPrice: unitPrice * newQuantity
        };
      }
      return item;
    }));
  };

  const removeFromCart = (uniqueId: string) => {
    setCart(prev => prev.filter(item => item.uniqueId !== uniqueId));
  };

  const clearCart = () => {
    try {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    } catch {}
    clearMenuCartStorage(scope);
    setCart([]);
  };

  const getCartTotal = () => {
    return cartTotal;
  };

  const getCartItemCount = () => {
    return cartItemCount;
  };

  return {
    cart,
    addToCart,
    updateQuantity,
    removeFromCart,
    clearCart,
    getCartTotal,
    getCartItemCount
  };
};
