import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Package, Search, Edit, Trash2, Import, GripVertical, ChevronDown, ChevronRight, Folder, Eye, EyeOff, Plus, SlidersHorizontal, Copy, Database, Tags } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import { supabase } from '@/integrations/supabase/client';
import ProductForm from '@/components/products/ProductForm';
import ProductImageUpload from '@/components/products/ProductImageUpload';
import MenuImportModal from '@/components/products/MenuImportModal';
import DataMigrationModal from '@/components/products/DataMigrationModal';
import ProductVariationsButton from '@/components/products/ProductVariationsButton';
import GlobalVariationManager from '@/components/products/GlobalVariationManager';
import CategoryManager from '@/components/products/CategoryManager';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { formatBRL } from '@/lib/currency';
import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';

interface ProductItem {
  id: string;
  name: string;
  barcode?: string | null;
  description?: string;
  price: number;
  costing_mode?: 'automatic_recipe' | 'manual';
  manual_unit_cost?: number | null;
  category: string;
  category_id?: string;
  image_url?: string;
  available: boolean;
  is_available?: boolean;
  weight_based: boolean;
  send_to_kds: boolean;
  preparation_route?: 'kitchen' | 'bar' | 'none';
  show_in_pdv: boolean;
  show_in_delivery: boolean;
  receipt_ingredients_enabled?: boolean;
  receipt_ingredients?: string | null;
  display_order?: number;
  track_stock: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
  is_daily_special?: boolean;
  availability_schedule?: {
    enabled: boolean;
    days: number[];
    start_time: string;
    end_time: string;
  } | null;
}

interface Category {
  id: string;
  name: string;
  active?: boolean;
  description?: string;
  display_order?: number;
}

interface GlobalVariationGroup {
  id: string;
  name: string;
  active?: boolean;
}

interface InlineProductDraft {
  name: string;
  image_url: string;
  price: string;
  variationIds: string[];
}

const Products = () => {
  const navigate = useNavigate();
  const normalizeImageUrl = normalizeImageUrlForDisplay;

  const FALLBACK_PIXEL =
    'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<ProductItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [displayOrderSupported, setDisplayOrderSupported] = useState(true);
  const [tab, setTab] = useState<string>(() => {
    const t = searchParams.get('tab');
    return t === 'categories' || t === 'global-variations' || t === 'products' ? t : 'products';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDataMigrationModal, setShowDataMigrationModal] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 640 : false));
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inlinePriceDrafts, setInlinePriceDrafts] = useState<Record<string, string>>({});
  const [inlinePriceSavingId, setInlinePriceSavingId] = useState<string | null>(null);
  const [globalVariationGroups, setGlobalVariationGroups] = useState<GlobalVariationGroup[]>([]);
  const [inlineCreatorCategoryId, setInlineCreatorCategoryId] = useState<string | null>(null);
  const [inlineProductDraft, setInlineProductDraft] = useState<InlineProductDraft>({ name: '', image_url: '', price: '', variationIds: [] });
  const [inlineProductSaving, setInlineProductSaving] = useState(false);

  useEffect(() => {
    const t = searchParams.get('tab');
    const next = t === 'products' || t === 'categories' || t === 'global-variations' ? t : 'products';
    if (next === tab) return;
    setTab(next);
  }, [searchParams, tab]);

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;

    setTab('products');
    setEditingProduct(null);
    setShowForm(true);
    setIsSheetOpen(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'products');
      next.delete('new');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    try {
      const mq = window.matchMedia('(max-width: 639px)');
      const handler = (e: MediaQueryListEvent | MediaQueryList) => {
        // @ts-ignore
        const matches = 'matches' in e ? e.matches : e.currentTarget?.matches;
        setIsMobile(!!matches);
      };
      setIsMobile(mq.matches);
      // @ts-ignore
      mq.addEventListener ? mq.addEventListener('change', handler) : mq.addListener(handler);
      return () => {
        // @ts-ignore
        mq.removeEventListener ? mq.removeEventListener('change', handler) : mq.removeListener(handler);
      };
    } catch {}
  }, []);
  const { toast } = useToast();
  const { user, session } = useAuth();
  const activeUserIdSync = user?.id || session?.user?.id || '';
  const confirm = useConfirmDialog();

  useEffect(() => {
    if (user || session) {
      fetchData();
    }
  }, [user, session]);

  useEffect(() => {
    filterProducts();
  }, [products, searchQuery, selectedCategory]);

  useEffect(() => {
    setInlinePriceDrafts(prev => {
      const next = { ...prev };
      for (const product of products) {
        if (!next[product.id]) {
          next[product.id] = Number(product.price || 0).toFixed(2);
        }
      }
      return next;
    });
  }, [products]);

  const fetchData = async () => {
    await Promise.all([fetchProducts(), fetchCategories(), fetchGlobalVariationGroups()]);
  };

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      const getActiveUserId = async () => {
        const id = user?.id || session?.user?.id;
        if (id) return id;
        try {
          const { data } = await supabase.auth.getSession();
          return data?.session?.user?.id || '';
        } catch {
          return '';
        }
      };
      const activeUserId = await getActiveUserId();
      if (!activeUserId) return;

      const runQuery = async () => {
        let data: any = null;
        let error: any = null;

        const res1 = await supabase
          .from('products')
          .select('*')
          .eq('user_id', activeUserId)
          .order('display_order', { ascending: true })
          .order('name', { ascending: true });

        data = res1.data;
        error = res1.error;

        if (error && String(error.message || '').includes('display_order')) {
          setDisplayOrderSupported(false);
          const res2 = await supabase
            .from('products')
            .select('*')
            .eq('user_id', activeUserId)
            .order('name', { ascending: true });
          data = res2.data;
          error = res2.error;
        } else {
          setDisplayOrderSupported(true);
        }

        return { data, error };
      };
      
      let { data, error } = await runQuery();
      
      if (error) throw error;
      
      let transformedProducts = (data || []).map((product: any) => ({
        ...product,
        category: product.category || 'Sem categoria',
        available: product.available !== undefined && product.available !== null ? product.available : product.is_available !== false,
        show_in_pdv: product.show_in_pdv !== undefined ? product.show_in_pdv : true,
        show_in_delivery: product.show_in_delivery !== undefined ? product.show_in_delivery : true,
        weight_based: product.weight_based !== undefined ? product.weight_based : false,
        send_to_kds: product.send_to_kds !== undefined ? product.send_to_kds : false,
        preparation_route: product.preparation_route || (product.send_to_kds ? 'kitchen' : 'none'),
        receipt_ingredients_enabled: Boolean(product.receipt_ingredients_enabled),
        receipt_ingredients: product.receipt_ingredients || null,
        track_stock: product.track_stock !== undefined ? product.track_stock : false,
        stock_quantity: product.stock_quantity !== undefined ? product.stock_quantity : 0,
        low_stock_threshold: product.low_stock_threshold !== undefined ? product.low_stock_threshold : 5
      })) as ProductItem[];

      if (transformedProducts.length === 0 && products.length > 0) {
        const { data: sData } = await supabase.auth.getSession();
        if (!sData?.session) {
          toast({
            title: 'Sessão expirada',
            description: 'Recarregue a página ou faça login novamente.',
            variant: 'destructive',
          });
          return;
        }

        const refreshed = await supabase.auth.refreshSession();
        if (refreshed?.data?.session) {
          const retry = await runQuery();
          if (retry.error) throw retry.error;
          transformedProducts = (retry.data || []).map((product: any) => ({
            ...product,
            category: product.category || 'Sem categoria',
            available: product.available !== undefined && product.available !== null ? product.available : product.is_available !== false,
            show_in_pdv: product.show_in_pdv !== undefined ? product.show_in_pdv : true,
            show_in_delivery: product.show_in_delivery !== undefined ? product.show_in_delivery : true,
            weight_based: product.weight_based !== undefined ? product.weight_based : false,
            send_to_kds: product.send_to_kds !== undefined ? product.send_to_kds : false,
            preparation_route: product.preparation_route || (product.send_to_kds ? 'kitchen' : 'none'),
            receipt_ingredients_enabled: Boolean(product.receipt_ingredients_enabled),
            receipt_ingredients: product.receipt_ingredients || null,
            track_stock: product.track_stock !== undefined ? product.track_stock : false,
            stock_quantity: product.stock_quantity !== undefined ? product.stock_quantity : 0,
            low_stock_threshold: product.low_stock_threshold !== undefined ? product.low_stock_threshold : 5
          })) as ProductItem[];
        }
      }
      
      setProducts(transformedProducts);
    } catch (error: any) {
      console.error('Erro ao carregar produtos:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar os produtos.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      if (!activeUserIdSync) return;
      const { data, error } = await supabase
        .from('product_categories')
        .select('id, name, active, description, display_order')
        .eq('user_id', activeUserIdSync)
        .order('display_order');

      if (error) throw error;
      setCategories(data || []);
      // Auto-expand all categories initially
      setExpandedCategories(new Set((data || []).map((c: any) => c.id)));
    } catch (error: any) {
      console.error('Erro ao carregar categorias:', error);
    }
  };

  const fetchGlobalVariationGroups = async () => {
    try {
      if (!activeUserIdSync) return;
      const { data, error } = await supabase
        .from('global_variations')
        .select('id, name, active')
        .eq('user_id', activeUserIdSync)
        .order('name', { ascending: true });

      if (error) throw error;
      setGlobalVariationGroups((data || []) as GlobalVariationGroup[]);
    } catch (error: any) {
      console.error('Erro ao carregar complementos globais:', error);
    }
  };

  const filterProducts = () => {
    let filtered = products;

    if (searchQuery) {
      filtered = filtered.filter(product =>
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.barcode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(product => product.category_id === selectedCategory);
    }

    setFilteredProducts(filtered);
  };

  const updateProductAvailabilityFields = async (productId: string, isAvailable: boolean) => {
    let payload: Record<string, any> = {
      available: isAvailable,
      is_available: isAvailable
    };
    const removed = new Set<string>();

    while (true) {
      const { error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', productId)
        .eq('user_id', activeUserIdSync);

      if (!error) return;

      const message = String(error?.message || '');
      const missingColumn = ['available', 'is_available'].find((column) => message.includes(`'${column}'`) || message.includes(`"${column}"`) || message.includes(column));
      if (String((error as any)?.code || '') === 'PGRST204' && missingColumn && !removed.has(missingColumn)) {
        removed.add(missingColumn);
        delete payload[missingColumn];
        continue;
      }

      throw error;
    }
  };

  const canReorderProducts = displayOrderSupported;

  const persistProductOrder = async (ordered: ProductItem[]) => {
    try {
      if (!activeUserIdSync) throw new Error('Sessão expirada');
      const results = await Promise.all(
        ordered.map((p, idx) =>
          (supabase as any)
            .from('products')
            .update({ display_order: p.display_order ?? idx })
            .eq('id', p.id)
            .eq('user_id', activeUserIdSync)
        )
      );
      const firstError = results.find((r: any) => r?.error)?.error;
      if (firstError) throw firstError;
    } catch (e: any) {
      if (String(e?.message || '').includes('display_order')) setDisplayOrderSupported(false);
      toast({ title: 'Erro', description: e?.message || 'Falha ao salvar ordem', variant: 'destructive' });
      fetchProducts();
    }
  };

  const onProductsDragEnd = async (result: DropResult) => {
    if (!canReorderProducts) return;
    if (!result.destination) return;
    
    // Check if dragging within the same category (droppableId)
    if (result.destination.droppableId !== result.source.droppableId) {
      toast({
        title: "Ação não permitida",
        description: "Não é possível mover produtos entre categorias ainda.",
        variant: "destructive"
      });
      return;
    }
    
    if (result.destination.index === result.source.index) return;

    const categoryId = result.source.droppableId.replace('category-', '');
    const categoryKey = categoryId === 'uncategorized' ? 'uncategorized' : categoryId;

    const sorted = [...products].sort((a, b) => {
      const ao = typeof a.display_order === 'number' ? a.display_order : Number.MAX_SAFE_INTEGER;
      const bo = typeof b.display_order === 'number' ? b.display_order : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });

    const groupsMap = new Map<string, ProductItem[]>();
    for (const p of sorted) {
      const key = p.category_id ? String(p.category_id) : 'uncategorized';
      const arr = groupsMap.get(key) || [];
      arr.push(p);
      groupsMap.set(key, arr);
    }

    const list = Array.from(groupsMap.get(categoryKey) || []);
    const [moved] = list.splice(result.source.index, 1);
    list.splice(result.destination.index, 0, moved);
    groupsMap.set(categoryKey, list);

    const orderedAll: ProductItem[] = [];
    for (const c of categories) {
      const key = String(c.id);
      orderedAll.push(...(groupsMap.get(key) || []));
    }
    orderedAll.push(...(groupsMap.get('uncategorized') || []));

    const nextProducts = orderedAll.map((p, idx) => ({ ...p, display_order: idx }));
    const prevOrder = new Map(products.map((p) => [p.id, p.display_order]));
    const changed = nextProducts.filter((p) => prevOrder.get(p.id) !== p.display_order);

    setProducts(nextProducts);
    await persistProductOrder(changed);
  };

  const handleDeleteProduct = async (productId: string) => {
    const ok = await confirm({
      title: 'Excluir produto',
      description: 'Tem certeza que deseja excluir este produto?',
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      variant: 'destructive',
    });
    if (!ok) return;

    try {
      setIsLoading(true);
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId);
      
      if (error) throw error;
      
      toast({
        title: 'Produto excluído',
        description: 'O produto foi excluído com sucesso.',
      });
      
      fetchProducts();
    } catch (error: any) {
      const msg = error?.message || error?.details || error?.hint || 'Não foi possível excluir este produto.';
      const preservesHistory = String(error?.code || '') === '23503'
        || /nfce_items|movimenta[cç][aã]o|pedido|cupom|fiscal/i.test(msg);

      if (preservesHistory) {
        try {
          await updateProductAvailabilityFields(productId, false);
          toast({
            title: 'Produto arquivado',
            description: 'Como este produto já faz parte de uma venda ou NFC-e, ele foi desativado para preservar o histórico fiscal.',
          });
          await fetchProducts();
          return;
        } catch (archiveError: any) {
          toast({
            title: 'Erro ao arquivar produto',
            description: archiveError?.message || 'Não foi possível desativar este produto.',
            variant: 'destructive',
          });
          return;
        }
      }
      toast({
        title: 'Erro ao excluir produto',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuplicateProduct = async (product: ProductItem) => {
    if (!activeUserIdSync) {
      toast({
        title: 'Sessão expirada',
        description: 'Faça login novamente para duplicar o produto.',
        variant: 'destructive',
      });
      return;
    }

    const existingNames = new Set(products.map((item) => String(item.name || '').trim().toLowerCase()));
    const baseName = String(product.name || 'Produto').trim() || 'Produto';
    let copyName = `${baseName} (cópia)`;
    let counter = 2;
    while (existingNames.has(copyName.trim().toLowerCase())) {
      copyName = `${baseName} (cópia ${counter})`;
      counter += 1;
    }

    const completePayload: Record<string, any> = {
      user_id: activeUserIdSync,
      name: copyName,
      description: product.description || null,
      price: Number(product.price || 0),
      category: product.category || null,
      category_id: product.category_id || null,
      image_url: product.image_url || null,
      available: product.available !== false,
      is_available: product.is_available ?? product.available !== false,
      weight_based: Boolean(product.weight_based),
      send_to_kds: Boolean(product.send_to_kds),
      preparation_route: product.preparation_route || (product.send_to_kds ? 'kitchen' : 'none'),
      show_in_pdv: product.show_in_pdv !== false,
      show_in_delivery: product.show_in_delivery !== false,
      receipt_ingredients_enabled: Boolean(product.receipt_ingredients_enabled),
      receipt_ingredients: product.receipt_ingredients || null,
      display_order: products.length + 1,
      track_stock: Boolean(product.track_stock),
      stock_quantity: Number(product.stock_quantity || 0),
      low_stock_threshold: Number(product.low_stock_threshold || 0),
    };

    const fallbackPayload = {
      user_id: activeUserIdSync,
      name: copyName,
      description: product.description || null,
      price: Number(product.price || 0),
      category: product.category || null,
      category_id: product.category_id || null,
      image_url: product.image_url || null,
      available: product.available !== false,
      weight_based: Boolean(product.weight_based),
      send_to_kds: Boolean(product.send_to_kds),
      preparation_route: product.preparation_route || (product.send_to_kds ? 'kitchen' : 'none'),
      show_in_pdv: product.show_in_pdv !== false,
      show_in_delivery: product.show_in_delivery !== false,
      receipt_ingredients_enabled: Boolean(product.receipt_ingredients_enabled),
      receipt_ingredients: product.receipt_ingredients || null,
    };

    try {
      setIsLoading(true);
      let insertResult = await (supabase as any)
        .from('products')
        .insert(completePayload)
        .select('id')
        .single();

      if (insertResult.error && String(insertResult.error?.code || '') === 'PGRST204') {
        insertResult = await (supabase as any)
          .from('products')
          .insert(fallbackPayload)
          .select('id')
          .single();
      }

      if (insertResult.error) throw insertResult.error;

      const duplicatedId = insertResult.data?.id;
      if (duplicatedId) {
        const { data: linkedVariations } = await (supabase as any)
          .from('product_global_variation_links')
          .select('global_variation_id')
          .eq('product_id', product.id);

        if (Array.isArray(linkedVariations) && linkedVariations.length > 0) {
          const links = linkedVariations
            .filter((link: any) => link?.global_variation_id)
            .map((link: any) => ({
              product_id: duplicatedId,
              global_variation_id: link.global_variation_id,
            }));

          if (links.length > 0) {
            await (supabase as any)
              .from('product_global_variation_links')
              .insert(links);
          }
        }
      }

      toast({
        title: 'Produto duplicado',
        description: `${product.name} foi copiado para ${copyName}.`,
      });

      await fetchProducts();
    } catch (error: any) {
      toast({
        title: 'Erro ao duplicar produto',
        description: error?.message || 'Não foi possível duplicar este produto.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleProductAvailability = async (product: ProductItem) => {
    try {
      setIsLoading(true);
      const nextAvailable = !product.available;
      await updateProductAvailabilityFields(product.id, nextAvailable);

      toast({
        title: 'Produto atualizado',
        description: `Produto ${product.available ? 'ocultado' : 'ativado'} com sucesso.`,
      });

      fetchProducts();
    } catch (error: any) {
      toast({
        title: 'Erro ao atualizar produto',
        description: error?.message || 'Não foi possível alterar a visibilidade do produto.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelect = (productId: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(productId); else next.delete(productId);
      return next;
    });
  };

  const bulkDeleteByCategory = async (categoryId: string) => {
    const ids = filteredProducts
      .filter(p => p.category_id === categoryId)
      .map(p => p.id)
      .filter(id => selectedIds.has(id));
    if (ids.length === 0) return;
    {
      const ok = await confirm({
        title: 'Excluir produtos',
        description: `Excluir ${ids.length} produto(s) desta categoria?`,
        confirmText: 'Excluir',
        cancelText: 'Cancelar',
        variant: 'destructive',
      });
      if (!ok) return;
    }
    try {
      setIsLoading(true);
      const { error } = await supabase
        .from('products')
        .delete()
        .in('id', ids)
        .eq('user_id', activeUserIdSync);
      if (error) throw error;
      setSelectedIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      toast({ title: 'Exclusão concluída', description: `${ids.length} produto(s) removidos.` });
      fetchProducts();
    } catch (e: any) {
      const msg = e?.message || e?.details || e?.hint || 'Não foi possível excluir os produtos.';
      toast({ title: 'Erro ao excluir', description: msg, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelectCategory = (categoryId: string) => {
    const ids = filteredProducts.filter(p => p.category_id === categoryId).map(p => p.id);
    const allSelected = ids.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach(id => next.delete(id));
      } else {
        ids.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filteredProducts.map(p => p.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const bulkDeleteSelected = async () => {
    const ids = filteredProducts.map(p => p.id).filter(id => selectedIds.has(id));
    if (ids.length === 0) return;
    {
      const ok = await confirm({
        title: 'Excluir produtos',
        description: `Excluir ${ids.length} produto(s) selecionados?`,
        confirmText: 'Excluir',
        cancelText: 'Cancelar',
        variant: 'destructive',
      });
      if (!ok) return;
    }
    try {
      setIsLoading(true);
      const { error } = await supabase
        .from('products')
        .delete()
        .in('id', ids)
        .eq('user_id', activeUserIdSync);
      if (error) throw error;
      clearSelection();
      toast({ title: 'Exclusão concluída', description: `${ids.length} produto(s) removidos.` });
      fetchProducts();
    } catch (e: any) {
      const msg = e?.message || e?.details || e?.hint || 'Não foi possível excluir os produtos.';
      toast({ title: 'Erro ao excluir', description: msg, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };
  const handleEditProduct = (product: ProductItem) => {
    setEditingProduct(product);
    setIsSheetOpen(true);
    setShowForm(true);
  };

  const handleFormSubmit = async (savedProductId?: string) => {
    await fetchProducts();
    if (savedProductId) {
      const produtoSalvo = products.find(p => p.id === savedProductId);
      if (produtoSalvo) {
        setEditingProduct(produtoSalvo);
        setShowForm(true);
        return;
      }
    }
    
    setShowForm(false);
    setEditingProduct(null);
    setIsSheetOpen(false);
  };

  const resetInlineProductDraft = () => {
    setInlineProductDraft({ name: '', image_url: '', price: '', variationIds: [] });
  };

  const toggleInlineCreator = (categoryId: string) => {
    setInlineCreatorCategoryId(prev => {
      const next = prev === categoryId ? null : categoryId;
      if (next !== categoryId) resetInlineProductDraft();
      return next;
    });
  };

  const toggleCategoryAvailability = async (category: Category) => {
    try {
      setIsLoading(true);
      const { error } = await supabase
        .from('product_categories')
        .update({ active: !(category.active !== false) })
        .eq('id', category.id)
        .eq('user_id', activeUserIdSync);

      if (error) throw error;

      toast({
        title: 'Categoria atualizada',
        description: `Categoria ${category.active !== false ? 'ocultada' : 'ativada'} com sucesso.`,
      });

      await fetchCategories();
    } catch (error: any) {
      toast({
        title: 'Erro ao atualizar categoria',
        description: error?.message || 'Não foi possível alterar a visibilidade da categoria.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInlineVariationToggle = (variationId: string) => {
    setInlineProductDraft(prev => ({
      ...prev,
      variationIds: prev.variationIds.includes(variationId)
        ? prev.variationIds.filter(id => id !== variationId)
        : [...prev.variationIds, variationId]
    }));
  };

  const handleInlineProductSave = async (category: Category) => {
    const name = String(inlineProductDraft.name || '').trim();
    const price = parseInlinePrice(inlineProductDraft.price);

    if (!name) {
      toast({ title: 'Nome obrigatório', description: 'Informe o nome do produto.', variant: 'destructive' });
      return;
    }

    if (price === null) {
      toast({ title: 'Preço inválido', description: 'Informe um preço válido para o produto.', variant: 'destructive' });
      return;
    }

    try {
      setInlineProductSaving(true);
      const productPayload: any = {
        user_id: activeUserIdSync,
        name,
        category: category.name,
        category_id: category.id,
        price,
        image_url: String(inlineProductDraft.image_url || '').trim() || null,
        available: true,
        show_in_delivery: true,
        show_in_pdv: true
      };

      const { data: insertedProduct, error: productError } = await supabase
        .from('products')
        .insert(productPayload)
        .select('id')
        .single();

      if (productError) throw productError;

      if (inlineProductDraft.variationIds.length > 0 && insertedProduct?.id) {
        const variationLinks = inlineProductDraft.variationIds.map((variationId, index) => ({
          product_id: insertedProduct.id,
          global_variation_id: variationId,
          display_order: index
        }));

        const { error: variationError } = await supabase
          .from('product_global_variation_links')
          .upsert(variationLinks as any, { onConflict: 'product_id,global_variation_id' });

        if (variationError) throw variationError;
      }

      toast({
        title: 'Produto criado',
        description: `Produto adicionado em ${category.name}.`,
      });

      setExpandedCategories(prev => new Set(prev).add(category.id));
      setInlineCreatorCategoryId(null);
      resetInlineProductDraft();
      await fetchProducts();
    } catch (error: any) {
      toast({
        title: 'Erro ao criar produto',
        description: error?.message || 'Não foi possível criar o produto nesta categoria.',
        variant: 'destructive',
      });
    } finally {
      setInlineProductSaving(false);
    }
  };

  const renderInlineCategoryCreator = (category: Category) => {
    if (inlineCreatorCategoryId !== category.id) return null;

    const availableVariationGroups = globalVariationGroups.filter(group => group.active !== false);

    return (
      <div className="mx-2 mt-2 rounded-2xl border border-[#8CC850]/20 bg-white p-4 shadow-[0_20px_50px_-38px_rgba(0,50,35,0.28)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[#003223]">Novo produto em {category.name}</div>
            <div className="text-xs text-slate-500">Cadastre rápido e vincule complementos sem sair da categoria.</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-xl px-3 text-[#003223] hover:bg-[#F5EBE1]"
            onClick={() => {
              setInlineCreatorCategoryId(null);
              resetInlineProductDraft();
            }}
          >
            Fechar
          </Button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[128px,1fr,220px]">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#003223]/60">Imagem</div>
            <ProductImageUpload
              currentImageUrl={inlineProductDraft.image_url}
              onImageUploaded={(imageUrl) => setInlineProductDraft(prev => ({ ...prev, image_url: imageUrl }))}
              compact
            />
          </div>
          <Input
            placeholder="Nome do produto"
            value={inlineProductDraft.name}
            onChange={(e) => setInlineProductDraft(prev => ({ ...prev, name: e.target.value }))}
            className="h-10 rounded-xl border-[#FF6400]/15 bg-white"
          />
          <Input
            placeholder="Preço"
            inputMode="decimal"
            value={inlineProductDraft.price}
            onChange={(e) => setInlineProductDraft(prev => ({ ...prev, price: e.target.value }))}
            className="h-10 rounded-xl border-[#FF6400]/15 bg-white"
          />
        </div>

        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#003223]/60">Adicionais</div>
          {availableVariationGroups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#FF6400]/15 bg-[#FFF8F2] px-3 py-4 text-sm text-slate-500">
              Nenhum grupo de complementos ativo cadastrado.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableVariationGroups.map((group) => {
                const isSelected = inlineProductDraft.variationIds.includes(group.id);
                return (
                  <Button
                    key={group.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`h-9 rounded-xl px-3 ${isSelected ? 'bg-[#8CC850] text-white hover:bg-[#79b541] border-[#8CC850]' : 'border-[#FF6400]/15 bg-white text-[#003223] hover:bg-[#F5EBE1]'}`}
                    onClick={() => handleInlineVariationToggle(group.id)}
                  >
                    {group.name}
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            className="h-10 rounded-xl bg-[#8CC850] px-4 font-semibold text-white hover:bg-[#79b541]"
            disabled={inlineProductSaving}
            onClick={() => handleInlineProductSave(category)}
          >
            {inlineProductSaving ? 'Salvando...' : 'Salvar produto'}
          </Button>
        </div>
      </div>
    );
  };

  const formatCurrency = (value: number) => {
    return formatBRL(value);
  };

  const parseInlinePrice = (raw: string) => {
    const normalized = String(raw || '').replace(/\s/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  };

  const handleInlinePriceChange = (productId: string, value: string) => {
    setInlinePriceDrafts(prev => ({
      ...prev,
      [productId]: value
    }));
  };

  const saveInlinePrice = async (product: ProductItem) => {
    const rawValue = inlinePriceDrafts[product.id] ?? Number(product.price || 0).toFixed(2);
    const parsedPrice = parseInlinePrice(rawValue);

    if (parsedPrice === null) {
      toast({
        title: 'Preço inválido',
        description: 'Digite um valor válido para o preço do produto.',
        variant: 'destructive',
      });
      setInlinePriceDrafts(prev => ({
        ...prev,
        [product.id]: Number(product.price || 0).toFixed(2)
      }));
      return;
    }

    if (Math.abs(parsedPrice - Number(product.price || 0)) < 0.0001) {
      setInlinePriceDrafts(prev => ({
        ...prev,
        [product.id]: parsedPrice.toFixed(2)
      }));
      return;
    }

    try {
      setInlinePriceSavingId(product.id);
      const { error } = await supabase
        .from('products')
        .update({ price: parsedPrice })
        .eq('id', product.id);

      if (error) throw error;

      setProducts(prev => prev.map(item => item.id === product.id ? { ...item, price: parsedPrice } : item));
      setInlinePriceDrafts(prev => ({
        ...prev,
        [product.id]: parsedPrice.toFixed(2)
      }));
    } catch (error: any) {
      toast({
        title: 'Erro ao atualizar preço',
        description: error?.message || 'Não foi possível atualizar o preço do produto.',
        variant: 'destructive',
      });
      setInlinePriceDrafts(prev => ({
        ...prev,
        [product.id]: Number(product.price || 0).toFixed(2)
      }));
    } finally {
      setInlinePriceSavingId(current => current === product.id ? null : current);
    }
  };

  const renderInlinePriceEditor = (product: ProductItem) => (
    <div className="flex items-center gap-2 rounded-xl border border-[#FF6400]/12 bg-white px-2.5 py-1 shadow-[0_10px_24px_-22px_rgba(0,50,35,0.28)] dark:border-white/10 dark:bg-[#102019]">
      <span className="text-[11px] font-bold uppercase tracking-wide text-[#003223]/75">R$</span>
      <Input
        value={inlinePriceDrafts[product.id] ?? Number(product.price || 0).toFixed(2)}
        inputMode="decimal"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => handleInlinePriceChange(product.id, e.target.value)}
        onBlur={() => saveInlinePrice(product)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            setInlinePriceDrafts(prev => ({
              ...prev,
              [product.id]: Number(product.price || 0).toFixed(2)
            }));
            e.currentTarget.blur();
          }
        }}
        className="h-7 w-[88px] border-0 bg-transparent px-0 text-sm font-bold text-[#0B5137] shadow-none focus-visible:ring-0 dark:text-[#8CC850]"
      />
      {product.weight_based && <span className="text-[10px] text-[#003223]/55 dark:text-slate-400">/kg</span>}
      {inlinePriceSavingId === product.id && <span className="text-[10px] font-semibold text-[#FF6400]">Salvando</span>}
    </div>
  );

  const renderMobileProductCard = (product: ProductItem) => (
    <Card key={product.id} className={`overflow-hidden rounded-[20px] border bg-white/95 shadow-[0_18px_40px_-28px_rgba(0,50,35,0.22)] ${product.track_stock && product.stock_quantity <= product.low_stock_threshold ? 'border-red-200' : 'border-[#FF6400]/12'}`}>
      <CardContent className="p-3">
        <div className="flex items-start gap-2.5">
          <button type="button" className="shrink-0" onClick={() => handleEditProduct(product)}>
            {normalizeImageUrl(product.image_url) ? (
              <div className="h-16 w-16 overflow-hidden rounded-[16px] border border-[#FF6400]/10 bg-[#FFF8F2]">
                <img
                  src={normalizeImageUrl(product.image_url)}
                  alt={product.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = FALLBACK_PIXEL;
                  }}
                />
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-[16px] border border-[#FF6400]/10 bg-[#FFF8F2]">
                <Package className="h-6 w-6 text-[#FF6400]/55" />
              </div>
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <button type="button" className="min-w-0 text-left" onClick={() => handleEditProduct(product)}>
                <div className="truncate text-[15px] font-bold text-slate-900">{product.name}</div>
                <div className="mt-0.5 text-[12px] text-slate-500">{product.category || 'Sem categoria'}</div>
              </button>
              <Badge variant={product.available ? "default" : "secondary"} className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${product.available ? 'bg-[#8CC850] text-[#003223] hover:bg-[#79b541]' : 'bg-slate-200 text-slate-600'}`}>
                {product.available ? 'Ativo' : 'Inativo'}
              </Badge>
            </div>

            {product.description && (
              <div className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-slate-500">{product.description}</div>
            )}

            <div className="mt-2 flex items-center justify-between gap-2">
              <div onClick={(e) => e.stopPropagation()}>
                {renderInlinePriceEditor(product)}
              </div>
              {product.track_stock && product.stock_quantity <= product.low_stock_threshold && (
                <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-600">
                  Estoque baixo
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-5 gap-2">
          <Button variant="outline" size="icon" className="h-9 rounded-[14px] border-[#003223]/10 bg-white text-[#003223] hover:bg-[#F5EBE1]" onClick={() => toggleProductAvailability(product)}>
            {product.available ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" className="h-9 rounded-[14px] border-[#003223]/10 bg-white text-[#003223] hover:bg-[#F5EBE1]" onClick={() => handleEditProduct(product)}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-9 rounded-[14px] border-[#003223]/10 bg-white text-[#003223] hover:bg-[#F5EBE1]" onClick={() => handleDuplicateProduct(product)}>
            <Copy className="h-4 w-4" />
          </Button>
          <div className="flex items-center justify-center rounded-[14px] border border-[#003223]/10 bg-white text-[#003223] hover:bg-[#F5EBE1]">
            <ProductVariationsButton productId={product.id} compact />
          </div>
          <Button variant="outline" size="icon" className="h-9 rounded-[14px] border-red-200 bg-white text-red-500 hover:bg-red-50" onClick={() => handleDeleteProduct(product.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center space-x-2">
          <Package className="h-6 w-6 text-orange-500" />
          <div>
            <h1 className="text-2xl font-bold">Produtos</h1>
            <p className="mt-1 text-sm text-slate-500 md:hidden">Busque, organize e edite seu cardápio com cara de app.</p>
          </div>
        </div>
      </div>

      <MenuImportModal 
        isOpen={showImportModal} 
        onClose={() => setShowImportModal(false)} 
        onImportComplete={fetchProducts}
      />
      <DataMigrationModal
        isOpen={showDataMigrationModal}
        onClose={() => setShowDataMigrationModal(false)}
        onImportComplete={fetchData}
      />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('tab', v);
            return next;
          });
        }}
        className="w-full"
      >
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex justify-center lg:flex-1">
            <TabsList className="grid h-10 w-full max-w-[420px] grid-cols-3 rounded-xl border border-[#FF6400]/10 bg-[#F5EBE1]/70 p-1">
            <TabsTrigger value="products" className="h-8 rounded-lg px-4 text-sm font-semibold">Produtos</TabsTrigger>
            <TabsTrigger value="categories" className="h-8 rounded-lg px-4 text-sm font-semibold">Categorias</TabsTrigger>
            <TabsTrigger value="global-variations" className="h-8 rounded-lg px-4 text-sm font-semibold">Adicionais</TabsTrigger>
            </TabsList>
          </div>

          <div className="hidden items-center justify-end gap-2 lg:flex">
            <Button variant="outline" onClick={() => navigate('/precos')} className="h-9 rounded-xl border-[#003223]/15 bg-white px-4 text-sm font-semibold text-[#003223] hover:bg-[#F5EBE1]">
              <Tags className="mr-2 h-4 w-4" />
              Preços e promoções
            </Button>
            <Button variant="outline" onClick={() => setShowDataMigrationModal(true)} className="h-9 rounded-xl border-[#003223]/15 bg-white px-4 text-sm font-semibold text-[#003223] hover:bg-[#F5EBE1]">
              <Database className="mr-2 h-4 w-4" />
              Migrar sistema
            </Button>
            <Button variant="outline" onClick={() => setShowImportModal(true)} className="h-9 rounded-xl border-[#FF6400]/15 bg-white px-4 text-sm font-semibold text-[#003223] hover:bg-[#F5EBE1]">
              <Import className="mr-2 h-4 w-4" />
              Importar cardápio
            </Button>
            <Button className="h-9 rounded-xl bg-[#8CC850] px-4 text-sm font-semibold text-white hover:bg-[#79b541]" onClick={() => {
              setEditingProduct(null);
              setShowForm(true);
              setIsSheetOpen(true);
            }}>
              <Plus className="mr-2 h-4 w-4" />
              Novo produto
            </Button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 lg:hidden">
          <Button variant="outline" onClick={() => navigate('/precos')} className="h-10 rounded-xl border-[#003223]/15 bg-white text-sm font-semibold text-[#003223]">
            <Tags className="mr-2 h-4 w-4" />
            Preços e promoções
          </Button>
          <Button className="h-10 rounded-xl bg-[#8CC850] text-sm font-semibold text-white hover:bg-[#79b541]" onClick={() => {
            setEditingProduct(null);
            setShowForm(true);
            setIsSheetOpen(true);
          }}>
            <Plus className="mr-2 h-4 w-4" />
            Novo produto
          </Button>
        </div>
        
        <TabsContent value="products" className="space-y-5 pt-1">
          <Card className="rounded-[24px] border border-[#FF6400]/12 bg-white shadow-[0_18px_40px_-28px_rgba(0,50,35,0.18)]">
            <CardContent className="py-4">
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                    <Input
                      placeholder="Buscar produtos..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 rounded-xl border-[#FF6400]/15 bg-white/85 pl-10"
                    />
                  </div>
                </div>
                <div className="sm:hidden w-full">
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="h-9 w-full rounded-xl border-[#FF6400]/15 bg-white/85">
                      <SelectValue placeholder="Filtrar por categoria" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {categories.map(category => (
                        <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="hidden sm:flex gap-2 flex-nowrap overflow-x-auto scrollbar-hide py-1">
                  <Button variant="outline" size="sm" className="h-9 shrink-0 rounded-xl border-[#FF6400]/15 bg-white/85 px-4 font-semibold text-[#003223] hover:bg-[#F5EBE1]" onClick={selectAllFiltered}>
                    Selecionar todos
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 shrink-0 rounded-xl border-[#FF6400]/15 bg-white/85 px-4 font-semibold text-[#003223] hover:bg-[#F5EBE1]" onClick={clearSelection}>
                    Limpar seleção
                  </Button>
                  <Button variant="destructive" size="sm" className="h-9 shrink-0 rounded-xl px-4 font-semibold" onClick={bulkDeleteSelected} disabled={filteredProducts.every(p => !selectedIds.has(p.id))}>
                    Excluir selecionados
                  </Button>
                  <Button
                    variant={selectedCategory === 'all' ? "default" : "outline"}
                    size="sm"
                    className={`h-9 shrink-0 rounded-xl px-4 font-semibold ${selectedCategory === 'all' ? 'bg-[#8CC850] text-white hover:bg-[#79b541]' : 'border-[#FF6400]/15 bg-white/85 text-[#003223] hover:bg-[#F5EBE1]'}`}
                    onClick={() => setSelectedCategory('all')}
                  >
                    Todos
                  </Button>
                  {categories.map(category => (
                    <Button
                      key={category.id}
                      variant={selectedCategory === category.id ? "default" : "outline"}
                      size="sm"
                      className={`h-9 shrink-0 rounded-xl px-4 font-semibold ${selectedCategory === category.id ? 'bg-[#8CC850] text-white hover:bg-[#79b541]' : 'border-[#FF6400]/15 bg-white/85 text-[#003223] hover:bg-[#F5EBE1]'}`}
                      onClick={() => setSelectedCategory(category.id)}
                    >
                      {category.name}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-2 md:hidden">
            <div className="flex gap-2">
              <Button
                className="h-11 flex-1 rounded-2xl bg-[#8CC850] text-white hover:bg-[#79b541]"
                onClick={() => {
                  setEditingProduct(null);
                  setShowForm(true);
                  setIsSheetOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Novo produto
              </Button>
              <Button variant="outline" className="h-11 flex-1 rounded-2xl border-[#FF6400]/15 bg-white px-4 text-[#003223] hover:bg-[#F5EBE1]" onClick={() => setShowImportModal(true)}>
                <Import className="mr-2 h-4 w-4" />
                Importar cardápio
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="h-11 flex-1 rounded-2xl border-[#003223]/15 bg-white px-4 text-[#003223] hover:bg-[#F5EBE1]" onClick={() => setShowDataMigrationModal(true)}>
                <Database className="mr-2 h-4 w-4" />
                Migrar sistema
              </Button>
              <Button variant="outline" className="h-11 flex-1 rounded-2xl border-[#FF6400]/15 bg-white text-[#003223] hover:bg-[#F5EBE1]" onClick={() => setSelectedCategory('all')}>
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Todas categorias
              </Button>
            </div>
          </div>

          {filteredProducts.length === 0 ? (
             <div className="text-center py-10 bg-white rounded-lg border">
                <Package className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-gray-900">Nenhum produto encontrado</h3>
                <p className="text-gray-500">Tente buscar por outro termo ou adicione um novo produto.</p>
             </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-3 md:hidden">
                {filteredProducts.map(renderMobileProductCard)}
              </div>
              <div className="hidden md:block">
              <DragDropContext onDragEnd={onProductsDragEnd}>
                {categories.map(category => {
                  const categoryProducts = filteredProducts.filter(p => p.category_id === category.id);
                  if (categoryProducts.length === 0 && searchQuery) return null;
                  
                  const isExpanded = expandedCategories.has(category.id) || searchQuery !== '';
                  const isCategoryActive = category.active !== false;

                  return (
                    <div key={category.id} className={`border rounded-lg overflow-hidden shadow-sm ${isCategoryActive ? 'bg-white' : 'bg-slate-50/80 border-slate-200'}`}>
                      <div 
                        className={`flex items-center p-3 cursor-pointer border-b select-none transition-colors ${isCategoryActive ? 'hover:bg-gray-50 bg-gray-50' : 'hover:bg-slate-100 bg-slate-100/80'}`}
                        onClick={() => toggleCategory(category.id)}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4 mr-2 text-gray-500" /> : <ChevronRight className="h-4 w-4 mr-2 text-gray-500" />}
                        <Folder className={`h-4 w-4 mr-2 ${isCategoryActive ? 'text-orange-500' : 'text-slate-400'}`} />
                        <span className={`font-medium flex-1 ${isCategoryActive ? 'text-gray-700' : 'text-slate-500'}`}>{category.name}</span>
                        <Badge variant="secondary" className={`ml-2 ${isCategoryActive ? '' : 'bg-slate-200 text-slate-600'}`}>{isCategoryActive ? 'Ativa' : 'Inativa'}</Badge>
                        <Badge variant="secondary" className="ml-2">{categoryProducts.length}</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="ml-2"
                          onClick={(e) => { e.stopPropagation(); toggleCategoryAvailability(category); }}
                        >
                          {isCategoryActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleInlineCreator(category.id);
                            setExpandedCategories(prev => new Set(prev).add(category.id));
                          }}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Novo produto
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-2"
                          onClick={(e) => { e.stopPropagation(); toggleSelectCategory(category.id); }}
                        >
                          {categoryProducts.every(p => selectedIds.has(p.id)) ? 'Desmarcar categoria' : 'Selecionar categoria'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-2"
                          onClick={(e) => { e.stopPropagation(); bulkDeleteByCategory(category.id); }}
                          disabled={categoryProducts.every(p => !selectedIds.has(p.id))}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Excluir selecionados
                        </Button>
                      </div>
                      
                      {isExpanded && (
                        <div className="p-2 space-y-2 bg-slate-50/50">
                          {renderInlineCategoryCreator(category)}
                          {categoryProducts.length === 0 ? (
                            <div className="text-sm text-gray-400 text-center py-4 italic">Nenhum produto nesta categoria</div>
                          ) : (
                            <Droppable droppableId={`category-${category.id}`}>
                              {(droppableProvided) => (
                                <div ref={droppableProvided.innerRef} {...droppableProvided.droppableProps} className="space-y-2">
                                  {categoryProducts.map((product, index) => (
                                    <Draggable key={product.id} draggableId={product.id} index={index} isDragDisabled={!canReorderProducts}>
                                      {(draggableProvided) => (
                                        <div ref={draggableProvided.innerRef} {...draggableProvided.draggableProps}>
                                          <Card className={`overflow-hidden hover:shadow-md transition-all ${product.track_stock && product.stock_quantity <= product.low_stock_threshold ? 'border-l-4 border-l-red-500' : ''}`}>
                                            <CardContent className="p-3 cursor-pointer" onClick={() => handleEditProduct(product)}>
                                              <div className="flex items-center gap-3">
                                                <input
                                                  type="checkbox"
                                                  className="w-4 h-4"
                                                  checked={selectedIds.has(product.id)}
                                                  onClick={(e) => e.stopPropagation()}
                                                  onChange={(e) => { e.stopPropagation(); toggleSelect(product.id, e.target.checked); }}
                                                />
                                                <button
                                                  type="button"
                                                  {...(canReorderProducts ? draggableProvided.dragHandleProps : {})}
                                                  onClick={(e) => e.stopPropagation()}
                                                  className={`inline-flex items-center justify-center w-8 h-8 rounded hover:bg-gray-100 text-muted-foreground ${canReorderProducts ? 'cursor-grab active:cursor-grabbing' : 'opacity-40 cursor-not-allowed'}`}
                                                >
                                                  <GripVertical className="h-4 w-4" />
                                                </button>
                                                {normalizeImageUrl(product.image_url) ? (
                                                  <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-gray-100 border">
                                                    <img
                                                      src={normalizeImageUrl(product.image_url)}
                                                      alt={product.name}
                                                      className="w-full h-full object-cover"
                                                      loading="lazy"
                                                      onError={(e) => {
                                                        e.currentTarget.onerror = null;
                                                        e.currentTarget.src = FALLBACK_PIXEL;
                                                      }}
                                                    />
                                                  </div>
                                                ) : (
                                                  <div className="w-12 h-12 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0 border">
                                                    <Package className="h-5 w-5 text-gray-400" />
                                                  </div>
                                                )}
                                                
                                                <div className="flex-1 min-w-0">
                                                  <div className="flex items-start justify-between gap-2 mb-1">
                                                    <h3 className="font-semibold text-sm leading-tight truncate flex-1 text-gray-800">{product.name}</h3>
                                                    <div className="flex flex-col items-end gap-1 shrink-0">
                                                      <Badge variant={product.available ? "default" : "secondary"} className={`text-[10px] h-5 ${product.available ? 'bg-green-500 hover:bg-green-600' : ''}`}>
                                                        {product.available ? 'Ativo' : 'Inativo'}
                                                      </Badge>
                                                    </div>
                                                  </div>
                                                  <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                      <div onClick={(e) => e.stopPropagation()}>
                                                        {renderInlinePriceEditor(product)}
                                                      </div>
                                                      {product.track_stock && product.stock_quantity <= product.low_stock_threshold && (
                                                        <span className="text-[10px] text-red-600 font-medium bg-red-50 px-1.5 py-0.5 rounded">Estoque baixo: {product.stock_quantity}</span>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>
                                                
                                                <div className="flex flex-row flex-nowrap items-center gap-1 flex-shrink-0">
                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-boracume-orange" onClick={(e) => { e.stopPropagation(); toggleProductAvailability(product); }}>
                                                    {product.available ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                                  </Button>
                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-blue-600" onClick={(e) => { e.stopPropagation(); handleEditProduct(product); }}>
                                                    <Edit className="h-4 w-4" />
                                                  </Button>
                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-[#0B5137]" onClick={(e) => { e.stopPropagation(); handleDuplicateProduct(product); }}>
                                                    <Copy className="h-4 w-4" />
                                                  </Button>
                                                  <div onClick={(e) => e.stopPropagation()}>
                                                    <ProductVariationsButton productId={product.id} compact />
                                                  </div>
                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-red-600" onClick={(e) => { e.stopPropagation(); handleDeleteProduct(product.id); }}>
                                                    <Trash2 className="h-4 w-4" />
                                                  </Button>
                                                </div>
                                              </div>
                                            </CardContent>
                                          </Card>
                                        </div>
                                      )}
                                    </Draggable>
                                  ))}
                                  {droppableProvided.placeholder}
                                </div>
                              )}
                            </Droppable>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Products without category */}
                {filteredProducts.filter(p => !p.category_id).length > 0 && (
                   <div className="border rounded-lg bg-white overflow-hidden mt-4 shadow-sm">
                      <div 
                        className="flex items-center p-3 bg-gray-50 border-b cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => toggleCategory('uncategorized')}
                      >
                        {expandedCategories.has('uncategorized') ? <ChevronDown className="h-4 w-4 mr-2 text-gray-500" /> : <ChevronRight className="h-4 w-4 mr-2 text-gray-500" />}
                        <Folder className="h-4 w-4 mr-2 text-gray-400" />
                        <span className="font-medium flex-1 text-gray-700">Sem Categoria</span>
                        <Badge variant="secondary" className="ml-2">{filteredProducts.filter(p => !p.category_id).length}</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-2"
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            const uncategorizedIds = filteredProducts.filter(p => !p.category_id).map(p => p.id);
                            const allSelected = uncategorizedIds.every(id => selectedIds.has(id));
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (allSelected) uncategorizedIds.forEach(id => next.delete(id));
                              else uncategorizedIds.forEach(id => next.add(id));
                              return next;
                            });
                          }}
                        >
                          {filteredProducts.filter(p => !p.category_id).every(p => selectedIds.has(p.id)) ? 'Desmarcar categoria' : 'Selecionar categoria'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-2"
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            const ids = filteredProducts.filter(p => !p.category_id).map(p => p.id).filter(id => selectedIds.has(id));
                            if (ids.length === 0) return;
                            (async () => {
                              try {
                                const ok = await confirm({
                                  title: 'Excluir produtos',
                                  description: `Excluir ${ids.length} produto(s) desta categoria?`,
                                  confirmText: 'Excluir',
                                  cancelText: 'Cancelar',
                                  variant: 'destructive',
                                });
                                if (!ok) return;
                                setIsLoading(true);
                                const { error } = await supabase
                                  .from('products')
                                  .delete()
                                  .in('id', ids)
                                  .eq('user_id', activeUserIdSync);
                                if (error) throw error;
                                setSelectedIds(prev => {
                                  const next = new Set(prev);
                                  ids.forEach(id => next.delete(id));
                                  return next;
                                });
                                toast({ title: 'Exclusão concluída', description: `${ids.length} produto(s) removidos.` });
                                fetchProducts();
                              } catch (e: any) {
                                toast({ title: 'Erro ao excluir', description: e.message, variant: 'destructive' });
                              } finally {
                                setIsLoading(false);
                              }
                            })();
                          }}
                          disabled={filteredProducts.filter(p => !p.category_id).every(p => !selectedIds.has(p.id))}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Excluir selecionados
                        </Button>
                      </div>
                      
                      {expandedCategories.has('uncategorized') && (
                        <div className="p-2 space-y-2 bg-slate-50/50">
                          <Droppable droppableId="category-uncategorized">
                            {(droppableProvided) => (
                              <div ref={droppableProvided.innerRef} {...droppableProvided.droppableProps} className="space-y-2">
                                {filteredProducts.filter(p => !p.category_id).map((product, index) => (
                                  <Draggable key={product.id} draggableId={product.id} index={index} isDragDisabled={!canReorderProducts}>
                                    {(draggableProvided) => (
                                      <div ref={draggableProvided.innerRef} {...draggableProvided.draggableProps}>
                                         <Card className={`overflow-hidden hover:shadow-md transition-all ${product.track_stock && product.stock_quantity <= product.low_stock_threshold ? 'border-l-4 border-l-red-500' : ''}`}>
                                            <CardContent className="p-3 cursor-pointer" onClick={() => handleEditProduct(product)}>
                                              <div className="flex items-center gap-3">
                                                <input
                                                  type="checkbox"
                                                  className="w-4 h-4"
                                                  checked={selectedIds.has(product.id)}
                                                  onClick={(e) => e.stopPropagation()}
                                                  onChange={(e) => { e.stopPropagation(); toggleSelect(product.id, e.target.checked); }}
                                                />
                                                <button
                                                  type="button"
                                                  {...(canReorderProducts ? draggableProvided.dragHandleProps : {})}
                                                  onClick={(e) => e.stopPropagation()}
                                                  className={`inline-flex items-center justify-center w-8 h-8 rounded hover:bg-gray-100 text-muted-foreground ${canReorderProducts ? 'cursor-grab active:cursor-grabbing' : 'opacity-40 cursor-not-allowed'}`}
                                                >
                                                  <GripVertical className="h-4 w-4" />
                                                </button>
                                                {normalizeImageUrl(product.image_url) ? (
                                                  <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-gray-100 border">
                                                    <img
                                                      src={normalizeImageUrl(product.image_url)}
                                                      alt={product.name}
                                                      className="w-full h-full object-cover"
                                                      loading="lazy"
                                                      onError={(e) => {
                                                        e.currentTarget.onerror = null;
                                                        e.currentTarget.src = FALLBACK_PIXEL;
                                                      }}
                                                    />
                                                  </div>
                                                ) : (
                                                  <div className="w-12 h-12 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0 border">
                                                    <Package className="h-5 w-5 text-gray-400" />
                                                  </div>
                                                )}
                                                
                                                <div className="flex-1 min-w-0">
                                                  <div className="flex items-start justify-between gap-2 mb-1">
                                                    <h3 className="font-semibold text-sm leading-tight truncate flex-1 text-gray-800">{product.name}</h3>
                                                    <div className="flex flex-col items-end gap-1 shrink-0">
                                                      <Badge variant={product.available ? "default" : "secondary"} className={`text-[10px] h-5 ${product.available ? 'bg-green-500 hover:bg-green-600' : ''}`}>
                                                        {product.available ? 'Ativo' : 'Inativo'}
                                                      </Badge>
                                                    </div>
                                                  </div>
                                                  <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                      <div onClick={(e) => e.stopPropagation()}>
                                                        {renderInlinePriceEditor(product)}
                                                      </div>
                                                    </div>
                                                  </div>
                                                </div>
                                                
                                                <div className="flex flex-row flex-nowrap items-center gap-1 flex-shrink-0">
                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-boracume-orange" onClick={(e) => { e.stopPropagation(); toggleProductAvailability(product); }}>
                                                    {product.available ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                                  </Button>
                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-blue-600" onClick={(e) => { e.stopPropagation(); handleEditProduct(product); }}>
                                                    <Edit className="h-4 w-4" />
                                                  </Button>
                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-[#0B5137]" onClick={(e) => { e.stopPropagation(); handleDuplicateProduct(product); }}>
                                                    <Copy className="h-4 w-4" />
                                                  </Button>
                                                  <div onClick={(e) => e.stopPropagation()}>
                                                    <ProductVariationsButton productId={product.id} compact />
                                                  </div>
                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-red-600" onClick={(e) => { e.stopPropagation(); handleDeleteProduct(product.id); }}>
                                                    <Trash2 className="h-4 w-4" />
                                                  </Button>
                                                </div>
                                              </div>
                                            </CardContent>
                                          </Card>
                                      </div>
                                    )}
                                  </Draggable>
                                ))}
                                {droppableProvided.placeholder}
                              </div>
                            )}
                          </Droppable>
                        </div>
                      )}
                   </div>
                )}
              </DragDropContext>
              </div>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="global-variations">
          <GlobalVariationManager />
        </TabsContent>
        <TabsContent value="categories">
          <CategoryManager />
        </TabsContent>
        
      </Tabs>

      <Sheet open={isSheetOpen} onOpenChange={(o) => { setIsSheetOpen(o); if (!o) { setShowForm(false); setEditingProduct(null) } }}>
        <SheetContent side={isMobile ? "bottom" : "right"} className={`${isMobile ? 'h-[94vh] rounded-t-[32px] border-x-0 border-b-0 border-t border-[#FF6400]/10' : 'w-full sm:w-[58vw] sm:max-w-none lg:w-[900px] xl:w-[1020px] 2xl:w-[1100px] border-l border-[#FF6400]/10'} bg-gradient-to-b from-[#FFF8F2] via-white to-[#F5EBE1]/75 p-0`}>
          {showForm && (
            <div className="overflow-y-auto h-full pb-6">
              <ProductForm
                product={editingProduct || undefined}
                onSave={handleFormSubmit}
                onCancel={() => { setIsSheetOpen(false); setShowForm(false); setEditingProduct(null); }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Products;
