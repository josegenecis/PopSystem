import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, Package } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import ProductVariationSelector from './ProductVariationSelector';
import type { PizzaCategoryConfig } from '@/lib/pizza-pricing';
import { prefetchSimpleVariations, type Variation } from '@/hooks/useSimpleVariations';
import { enrichCategoryWithMetadata } from '@/lib/category-metadata';
import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';
import { formatBRL } from '@/lib/currency';

interface Product {
  id: string;
  name: string;
  price: number;
  description?: string;
  image_url?: string;
  category_id?: string;
  track_stock: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
}

const ProductThumb: React.FC<{ product: Product; className?: string; iconClassName?: string }> = ({
  product,
  className = 'h-full w-full object-cover',
  iconClassName = 'h-5 w-5 text-slate-400',
}) => {
  const [failed, setFailed] = useState(false);
  const src = normalizeImageUrlForDisplay(product.image_url);

  if (!src || failed) {
    return <Package className={iconClassName} />;
  }

  return (
    <img
      src={src}
      alt={product.name}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
};

interface CategoryConfig extends PizzaCategoryConfig {
  id: string;
  name: string;
}

interface ProductSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (product: Product, quantity: number, variations?: any[], notes?: string, variationPrice?: number) => void;
  layout?: 'grid' | 'list';
}

const ProductSelectionModal: React.FC<ProductSelectionModalProps> = ({
  isOpen,
  onClose,
  onAddToCart,
  layout = 'grid',
}) => {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productVariations, setProductVariations] = useState<Variation[]>([]);
  const [categories, setCategories] = useState<CategoryConfig[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [showVariations, setShowVariations] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      fetchProducts();
      fetchCategories();
      setSearchTerm('');
      setSelectedCategoryId('all');
    }
  }, [isOpen, user]);

  const fetchProducts = async () => {
    if (!user) return;

    try {
      let data: any = null;
      let error: any = null;

      const res1 = await supabase
        .from('products')
        .select('*')
        .eq('user_id', user.id)
        .eq('show_in_pdv', true)
        .eq('available', true)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      data = res1.data;
      error = res1.error;

      if (error && String(error.message || '').includes('display_order')) {
        const res2 = await supabase
          .from('products')
          .select('*')
          .eq('user_id', user.id)
          .eq('show_in_pdv', true)
          .eq('available', true)
          .order('name', { ascending: true });
        data = res2.data;
        error = res2.error;
      }

      if (error) throw error;
      const transformed = (data || []).map((p: any) => ({
        ...p,
        track_stock: p.track_stock !== undefined ? p.track_stock : false,
        stock_quantity: p.stock_quantity !== undefined ? p.stock_quantity : 0,
        low_stock_threshold: p.low_stock_threshold !== undefined ? p.low_stock_threshold : 5,
      })) as Product[];
      setProducts(transformed);
    } catch (error) {
      console.error('Erro ao carregar produtos:', error);
    }
  };

  const fetchCategories = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('product_categories')
        .select('id, name, description')
        .eq('user_id', user.id)
        .eq('active', true);

      if (error) throw error;
      setCategories(((data || []) as any[]).map((category) => enrichCategoryWithMetadata(category)) as CategoryConfig[]);
    } catch (error) {
      console.error('Erro ao carregar categorias:', error);
      setCategories([]);
    }
  };

  const fetchProductVariations = async (productId: string) => {
    try {
      return await prefetchSimpleVariations(productId);
      let data: any[] | null = null;
      let error: any = null;
      const res1 = await supabase
        .from('product_variations')
        .select('*')
        .eq('product_id', productId)
        .order('display_order', { ascending: true });
      data = res1.data as any;
      error = res1.error as any;
      if (error && String(error.message || '').includes('display_order')) {
        const res2 = await supabase
          .from('product_variations')
          .select('*')
          .eq('product_id', productId)
          .order('name', { ascending: true });
        data = res2.data as any;
        error = res2.error as any;
      }

      if (error) throw error;
      
      return (data || []).map(item => ({
        id: item.id,
        name: item.name,
        required: item.required,
        max_selections: item.max_selections,
        options: Array.isArray(item.options) ? 
          item.options.map((opt: any) => ({
            name: opt.name || '',
            price: opt.price || 0
          })) : []
      }));
    } catch (error) {
      console.error('Erro ao carregar variações:', error);
      return [];
    }
  };

  const handleProductSelect = async (product: Product) => {
    setSelectedProduct(product);
    
    const variations = await fetchProductVariations(product.id);
    
    if (variations.length > 0) {
      setProductVariations(variations);
      setShowVariations(true);
    } else {
      onAddToCart(product, 1);
      onClose();
    }
  };

  const handleAddToCart = (product: Product, quantity: number, variations: any[], notes: string, variationPrice: number) => {
    onAddToCart(product, quantity, variations, notes, variationPrice);
    setShowVariations(false);
    setSelectedProduct(null);
    onClose();
  };

  const categoriesWithProducts = categories.filter((category) =>
    products.some((product) => product.category_id === category.id)
  );

  const filteredProducts = products.filter(product => {
    const matchesSearch =
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategoryId === 'all' || product.category_id === selectedCategoryId;
    return matchesSearch && matchesCategory;
  });

  if (showVariations && selectedProduct) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] max-w-2xl overflow-x-hidden overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Personalizar Produto</DialogTitle>
          </DialogHeader>
          <ProductVariationSelector
            product={selectedProduct}
            variations={productVariations}
            categoryConfig={categories.find((category) => category.id === selectedProduct.category_id)}
            onAddToCart={handleAddToCart}
            onClose={() => {
              setShowVariations(false);
              setSelectedProduct(null);
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] max-w-4xl overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Selecionar Produto</DialogTitle>
        </DialogHeader>
        
        <div className="min-w-0 max-w-full space-y-4 overflow-hidden">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produtos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {categoriesWithProducts.length > 0 && (
            <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
              <Button
                type="button"
                variant={selectedCategoryId === 'all' ? 'default' : 'outline'}
                size="sm"
                className="shrink-0"
                onClick={() => setSelectedCategoryId('all')}
              >
                Todos
              </Button>
              {categoriesWithProducts.map((category) => (
                <Button
                  key={category.id}
                  type="button"
                  variant={selectedCategoryId === category.id ? 'default' : 'outline'}
                  size="sm"
                  className="shrink-0"
                  onClick={() => setSelectedCategoryId(category.id)}
                >
                  {category.name}
                </Button>
              ))}
            </div>
          )}

          {filteredProducts.length === 0 ? (
            <div className="text-center py-8">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {searchTerm ? 'Nenhum produto encontrado' : 'Nenhum produto disponível'}
              </p>
            </div>
          ) : layout === 'list' ? (
            <div className="min-w-0 max-w-full divide-y overflow-hidden rounded-xl border bg-white">
              {filteredProducts.map((product) => {
                const isLowStock = product.track_stock && product.stock_quantity <= product.low_stock_threshold;
                return (
                  <button
                    key={product.id}
                    type="button"
                    className={`flex min-w-0 max-w-full items-center gap-3 overflow-hidden px-3 py-2.5 text-left transition-colors hover:bg-[#F8FAF8] ${
                      isLowStock ? 'bg-red-50/60' : ''
                    }`}
                    onClick={() => handleProductSelect(product)}
                  >
	                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-slate-50">
	                      <ProductThumb product={product} />
	                    </div>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="truncate text-sm font-semibold text-[#082F23]">{product.name}</div>
                      {product.description ? (
                        <div className="max-w-full truncate text-xs text-slate-500" title={product.description}>
                          {product.description}
                        </div>
                      ) : null}
                    </div>
                    {isLowStock ? (
                      <Badge variant="destructive" className="hidden shrink-0 text-xs sm:inline-flex">
                        Estoque baixo
                      </Badge>
                    ) : null}
                    <div className="shrink-0 rounded-full bg-[#F0F7E8] px-2 py-1 text-xs font-bold text-[#0B5137] sm:px-3 sm:text-sm">
                      {formatBRL(product.price)}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProducts.map((product) => (
                (() => {
                  const isLowStock = product.track_stock && product.stock_quantity <= product.low_stock_threshold;
                  return (
                <Card 
                  key={product.id} 
                  className={`cursor-pointer hover:shadow-lg transition-shadow ${isLowStock ? 'animate-stock-pulse border-red-500' : ''}`}
                  onClick={() => handleProductSelect(product)}
                >
	                  <CardContent className="p-4">
	                    <div className="mb-3 flex h-32 w-full items-center justify-center overflow-hidden rounded-md bg-slate-50">
	                      <ProductThumb
	                        product={product}
	                        className="h-full w-full object-cover"
	                        iconClassName="h-8 w-8 text-slate-300"
	                      />
	                    </div>
                    <div className="space-y-2">
                      <h3 className="font-semibold text-sm">{product.name}</h3>
                      {product.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {product.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="text-xs">
                          {formatBRL(product.price)}
                        </Badge>
                        {isLowStock && (
                          <Badge variant="destructive" className="text-xs">
                            Estoque baixo
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                  );
                })()
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductSelectionModal;
