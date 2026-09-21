import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Edit, Search, Package, ShoppingBag, ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, RefreshCw, ShoppingCart } from 'lucide-react';
import { CurrencyInput } from '@/components/ui/currency-input';
import { useNavigate } from 'react-router-dom';

interface Ingredient {
  id: string;
  name: string;
  unit: string;
  price: number;
  cost_price?: number;
  purchase_unit: string;
  purchase_conversion: number;
  yield_percentage: number;
  last_purchase_cost?: number | null;
  current_stock: number;
  min_stock: number;
  stock_control_mode: 'automatic_recipe' | 'manual_withdrawal' | 'periodic_count';
  user_id: string;
  created_at: string;
  updated_at: string;
}

interface ProductStock {
  id: string;
  name: string;
  category?: string | null;
  price: number;
  weight_based?: boolean | null;
  track_stock: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
  available?: boolean | null;
  show_in_delivery?: boolean | null;
  updated_at?: string | null;
}

interface PurchaseSuggestion {
  item_type: 'ingredient' | 'product';
  item_id: string;
  name: string;
  current_stock: number;
  minimum_stock: number;
  stock_unit: string;
  purchase_unit: string;
  purchase_conversion: number;
  consumed_in_period: number;
  average_daily_consumption: number;
  target_stock: number;
  suggested_stock_quantity: number;
  suggested_purchase_quantity: number;
  days_remaining: number | null;
  reason: string;
  history_days: number;
  cover_days: number;
}

const UNITS = [
  { value: 'kg', label: 'Quilograma (kg)' },
  { value: 'g', label: 'Grama (g)' },
  { value: 'l', label: 'Litro (L)' },
  { value: 'ml', label: 'Mililitro (ml)' },
  { value: 'un', label: 'Unidade (un)' }
];

export default function Ingredientes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [filteredIngredients, setFilteredIngredients] = useState<Ingredient[]>([]);
  const [products, setProducts] = useState<ProductStock[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<ProductStock[]>([]);
  const [purchaseSuggestions, setPurchaseSuggestions] = useState<PurchaseSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStockStatus, setFilterStockStatus] = useState('all'); // all, low_stock
  
  // Form states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null);
  const [stockEntryOpen, setStockEntryOpen] = useState(false);
  const [stockEntryTarget, setStockEntryTarget] = useState<{ type: 'product' | 'ingredient'; id: string; name: string } | null>(null);
  const [stockEntryQuantity, setStockEntryQuantity] = useState('');
  const [stockEntryCost, setStockEntryCost] = useState(0);
  const [stockOperationOpen, setStockOperationOpen] = useState(false);
  const [stockOperationTarget, setStockOperationTarget] = useState<Ingredient | null>(null);
  const [stockOperationQuantity, setStockOperationQuantity] = useState('');
  const [stockOperationUnit, setStockOperationUnit] = useState<'purchase' | 'consumption'>('purchase');
  const [formData, setFormData] = useState({
    name: '',
    unit: 'un',
    purchase_unit: 'un',
    purchase_conversion: 1,
    yield_percentage: 100,
    cost_price: 0,
    current_stock: 0,
    min_stock: 0,
    stock_control_mode: 'automatic_recipe' as Ingredient['stock_control_mode']
  });

  useEffect(() => {
    if (user) {
      void Promise.all([loadIngredients(), loadPurchaseSuggestions()]);
    }
  }, [user]);

  const loadPurchaseSuggestions = async () => {
    if (!user?.id) return;
    setSuggestionsLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc('get_inventory_purchase_suggestions', {
        p_store_user_id: user.id,
        p_history_days: 30,
        p_cover_days: 7,
      });
      if (error) throw error;
      setPurchaseSuggestions(Array.isArray(data) ? data.map((item: any) => ({
        ...item,
        current_stock: Number(item.current_stock || 0),
        minimum_stock: Number(item.minimum_stock || 0),
        purchase_conversion: Number(item.purchase_conversion || 1),
        consumed_in_period: Number(item.consumed_in_period || 0),
        average_daily_consumption: Number(item.average_daily_consumption || 0),
        target_stock: Number(item.target_stock || 0),
        suggested_stock_quantity: Number(item.suggested_stock_quantity || 0),
        suggested_purchase_quantity: Number(item.suggested_purchase_quantity || 0),
        days_remaining: item.days_remaining == null ? null : Number(item.days_remaining),
      })) : []);
    } catch (error) {
      console.error('Error loading purchase suggestions:', error);
      setPurchaseSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const filterIngredients = () => {
    let filtered = ingredients;
    let filteredProductRows = products;

    if (searchTerm) {
      filtered = filtered.filter(ing => 
        ing.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      filteredProductRows = filteredProductRows.filter(product =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(product.category || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (filterStockStatus === 'low_stock') {
      filtered = filtered.filter(ing => (ing.current_stock || 0) <= (ing.min_stock || 0));
      filteredProductRows = filteredProductRows.filter(product =>
        product.track_stock && (product.stock_quantity || 0) <= (product.low_stock_threshold || 0)
      );
    } else if (filterStockStatus === 'controlled') {
      filteredProductRows = filteredProductRows.filter(product => product.track_stock);
    } else if (filterStockStatus === 'out') {
      filteredProductRows = filteredProductRows.filter(product => product.track_stock && (product.stock_quantity || 0) <= 0);
    }

    setFilteredIngredients(filtered);
    setFilteredProducts(filteredProductRows);
  };

  useEffect(() => {
    filterIngredients();
  }, [searchTerm, filterStockStatus, ingredients, products]);

  const normalizeIngredient = (ingredient: any): Ingredient => ({
    ...ingredient,
    price: Number(ingredient?.cost_price ?? ingredient?.price ?? 0),
    cost_price: Number(ingredient?.cost_price ?? ingredient?.price ?? 0),
    purchase_unit: String(ingredient?.purchase_unit || ingredient?.unit || 'un'),
    purchase_conversion: Number(ingredient?.purchase_conversion ?? 1),
    yield_percentage: Number(ingredient?.yield_percentage ?? 100),
    last_purchase_cost: ingredient?.last_purchase_cost == null ? null : Number(ingredient.last_purchase_cost),
    current_stock: Number(ingredient?.current_stock ?? 0),
    min_stock: Number(ingredient?.min_stock ?? 0),
    stock_control_mode: ingredient?.stock_control_mode || 'automatic_recipe',
  });

  const normalizeProductStock = (product: any): ProductStock => ({
    ...product,
    price: Number(product?.price ?? 0),
    track_stock: Boolean(product?.track_stock),
    stock_quantity: Number(product?.stock_quantity ?? 0),
    low_stock_threshold: Number(product?.low_stock_threshold ?? 0),
  });

  const buildIngredientPayloadVariants = () => {
    const base = {
      name: formData.name,
      unit: formData.unit,
      purchase_unit: formData.purchase_unit,
      purchase_conversion: Number(formData.purchase_conversion || 1),
      yield_percentage: Number(formData.yield_percentage || 100),
      stock_control_mode: formData.stock_control_mode,
      user_id: user?.id,
    };

    return [
      {
        ...base,
        current_stock: Number(formData.current_stock || 0),
        min_stock: Number(formData.min_stock || 0),
        cost_price: Number(formData.cost_price || 0),
      },
      {
        ...base,
        current_stock: Number(formData.current_stock || 0),
        min_stock: Number(formData.min_stock || 0),
        price: Number(formData.cost_price || 0),
      },
      {
        ...base,
        category: 'Insumos',
        is_active: true,
        price: Number(formData.cost_price || 0),
      },
      {
        ...base,
        category: 'Insumos',
        is_active: true,
        current_stock: Number(formData.current_stock || 0),
        min_stock: Number(formData.min_stock || 0),
        price: Number(formData.cost_price || 0),
      },
    ];
  };

  const persistIngredient = async () => {
    const payloadVariants = buildIngredientPayloadVariants();
    let lastError: any = null;

    for (const payload of payloadVariants) {
      if (editingIngredient) {
        const { error } = await (supabase.from('ingredients') as any)
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingIngredient.id);

        if (!error) {
          return;
        }

        lastError = error;
        continue;
      }

      const { error } = await (supabase.from('ingredients') as any)
        .insert([payload]);

      if (!error) {
        return;
      }

      lastError = error;
    }

    throw lastError;
  };

  const loadIngredients = async () => {
    try {
      if (!user) return;
      const [{ data, error }, productsResult] = await Promise.all([
        supabase
          .from('ingredients')
          .select('*')
          .eq('user_id', user.id)
          .order('name'),
        (supabase as any)
          .from('products')
          .select('id,name,category,price,weight_based,track_stock,stock_quantity,low_stock_threshold,available,show_in_delivery,updated_at')
          .eq('user_id', user.id)
          .order('name')
      ]);
        
      if (error) throw error;
      if (productsResult.error) throw productsResult.error;
      const normalizedIngredients = (data || []).map(normalizeIngredient);
      const normalizedProducts = (productsResult.data || []).map(normalizeProductStock);
      setIngredients(normalizedIngredients);
      setFilteredIngredients(normalizedIngredients);
      setProducts(normalizedProducts);
      setFilteredProducts(normalizedProducts);
    } catch (error) {
      console.error('Error loading ingredients:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar o estoque.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!user) return;
      if (formData.purchase_conversion <= 0) {
        throw new Error('A conversão da compra deve ser maior que zero.');
      }
      if (formData.yield_percentage <= 0 || formData.yield_percentage > 100) {
        throw new Error('O rendimento deve ficar entre 0,01% e 100%.');
      }

      await persistIngredient();

      if (editingIngredient) {
        toast({ title: 'Sucesso', description: 'Insumo atualizado com sucesso.' });
      } else {
        toast({ title: 'Sucesso', description: 'Insumo cadastrado com sucesso.' });
      }

      setIsFormOpen(false);
      void Promise.all([loadIngredients(), loadPurchaseSuggestions()]);
    } catch (error: any) {
      console.error('Error saving ingredient:', error);
      toast({
        title: 'Erro',
        description: error?.message || 'Não foi possível salvar o insumo.',
        variant: 'destructive'
      });
    }
  };

  const handleEdit = (ingredient: Ingredient) => {
    setEditingIngredient(ingredient);
    setFormData({
      name: ingredient.name,
      unit: ingredient.unit,
      purchase_unit: ingredient.purchase_unit || ingredient.unit,
      purchase_conversion: ingredient.purchase_conversion || 1,
      yield_percentage: ingredient.yield_percentage || 100,
      cost_price: ingredient.price,
      current_stock: ingredient.current_stock || 0,
      min_stock: ingredient.min_stock || 0,
      stock_control_mode: ingredient.stock_control_mode || 'automatic_recipe'
    });
    setIsFormOpen(true);
  };

  const handleNewIngredient = () => {
    setEditingIngredient(null);
    resetForm();
    setIsFormOpen(true);
  };

  const openStockEntry = (target: { type: 'product' | 'ingredient'; id: string; name: string }) => {
    setStockEntryTarget(target);
    setStockEntryQuantity('');
    setStockEntryCost(0);
    setStockEntryOpen(true);
  };

  const handleStockEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !stockEntryTarget) return;

    const quantity = Number(String(stockEntryQuantity || '').replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast({
        title: 'Quantidade inválida',
        description: 'Informe uma quantidade maior que zero.',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (stockEntryTarget.type === 'product') {
        const current = products.find((product) => product.id === stockEntryTarget.id);
        if (!current?.weight_based && !Number.isInteger(quantity)) {
          throw new Error('Produtos vendidos por unidade exigem uma quantidade inteira.');
        }
        const quantityToAdd = current?.weight_based
          ? Number(quantity.toFixed(6))
          : quantity;
        const nextQuantity = Number((Math.max(0, Number(current?.stock_quantity || 0)) + quantityToAdd).toFixed(6));

        const { error: productError } = await (supabase as any)
          .from('products')
          .update({
            track_stock: true,
            stock_quantity: nextQuantity,
            available: true,
            is_available: true,
            show_in_delivery: current?.show_in_delivery ?? true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', stockEntryTarget.id)
          .eq('user_id', user.id);

        if (productError) throw productError;

        await (supabase as any).from('inventory_movements').insert({
          user_id: user.id,
          product_id: stockEntryTarget.id,
          type: 'purchase',
          quantity: quantityToAdd,
        });
      } else {
        if (stockEntryCost <= 0) {
          throw new Error('Informe o custo por unidade de compra para calcular o custo médio.');
        }
        const { error: ingredientError } = await (supabase as any).rpc('record_ingredient_purchase', {
          p_ingredient_id: stockEntryTarget.id,
          p_purchase_quantity: quantity,
          p_purchase_unit_cost: Number(stockEntryCost),
          p_reason: 'Entrada manual pelo estoque',
          p_owner_id: user.id,
        });
        if (ingredientError) throw ingredientError;
      }

      toast({
        title: 'Estoque atualizado',
        description: `${stockEntryTarget.name} recebeu entrada de estoque.`,
      });
      setStockEntryOpen(false);
      setStockEntryTarget(null);
      await Promise.all([loadIngredients(), loadPurchaseSuggestions()]);
    } catch (error: any) {
      toast({
        title: 'Erro ao lançar estoque',
        description: error?.message || 'Não foi possível somar essa entrada no estoque.',
        variant: 'destructive',
      });
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      unit: 'un',
      purchase_unit: 'un',
      purchase_conversion: 1,
      yield_percentage: 100,
      cost_price: 0,
      current_stock: 0,
      min_stock: 0,
      stock_control_mode: 'automatic_recipe'
    });
  };

  const openStockOperation = (ingredient: Ingredient) => {
    setStockOperationTarget(ingredient);
    setStockOperationQuantity('');
    setStockOperationUnit(ingredient.stock_control_mode === 'manual_withdrawal' ? 'purchase' : 'consumption');
    setStockOperationOpen(true);
  };

  const handleStockOperation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !stockOperationTarget) return;
    const quantity = Number(stockOperationQuantity.replace(',', '.'));
    const isWithdrawal = stockOperationTarget.stock_control_mode === 'manual_withdrawal';
    if (!Number.isFinite(quantity) || quantity < 0 || (isWithdrawal && quantity === 0)) {
      toast({ title: 'Quantidade inválida', description: 'Informe uma quantidade válida.', variant: 'destructive' });
      return;
    }
    try {
      const { error } = isWithdrawal
        ? await (supabase as any).rpc('record_ingredient_withdrawal', {
            p_ingredient_id: stockOperationTarget.id, p_quantity: quantity,
            p_quantity_unit: stockOperationUnit, p_reason: 'Retirada/abertura registrada no estoque', p_owner_id: user.id,
          })
        : await (supabase as any).rpc('record_ingredient_count', {
            p_ingredient_id: stockOperationTarget.id, p_counted_quantity: quantity,
            p_reason: 'Inventário por contagem física', p_owner_id: user.id,
          });
      if (error) throw error;
      toast({ title: isWithdrawal ? 'Retirada registrada' : 'Contagem registrada', description: 'O saldo e o histórico foram atualizados.' });
      setStockOperationOpen(false);
      await Promise.all([loadIngredients(), loadPurchaseSuggestions()]);
    } catch (error: any) {
      toast({ title: 'Erro ao atualizar estoque', description: error?.message || 'Não foi possível registrar a operação.', variant: 'destructive' });
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Controle de Estoque</h1>
          <p className="text-muted-foreground">
            Veja produtos do PDV e insumos usados na ficha técnica
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/produtos?new=1')}>
            <ShoppingBag className="h-4 w-4 mr-2" />
            Novo produto
          </Button>
          <Button onClick={handleNewIngredient}>
            <Plus className="h-4 w-4 mr-2" />
            Novo insumo
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-emerald-200">
        <CardHeader className="bg-gradient-to-r from-emerald-950 to-emerald-800 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />Sugestão de compras</CardTitle>
              <CardDescription className="mt-1 text-emerald-100">
                Reposição calculada pelo saldo, estoque mínimo e consumo dos últimos 30 dias para cobrir os próximos 7 dias.
              </CardDescription>
            </div>
            <Button type="button" size="sm" variant="secondary" disabled={suggestionsLoading} onClick={() => void loadPurchaseSuggestions()}>
              <RefreshCw className={`mr-2 h-4 w-4 ${suggestionsLoading ? 'animate-spin' : ''}`} />Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {suggestionsLoading ? (
            <div className="py-6 text-center text-sm text-slate-500">Calculando necessidade de reposição...</div>
          ) : purchaseSuggestions.length === 0 ? (
            <div className="rounded-xl border border-dashed p-5 text-center text-sm text-slate-600">
              O estoque está coberto. Para sugestões mais precisas, defina o estoque mínimo de cada insumo; o consumo real será aprendido automaticamente pelas vendas.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {purchaseSuggestions.map((suggestion) => (
                <div key={`${suggestion.item_type}-${suggestion.item_id}`} className="rounded-xl border bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-emerald-950">{suggestion.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{suggestion.reason}</p>
                    </div>
                    <Badge variant={suggestion.current_stock <= 0 ? 'destructive' : 'secondary'}>
                      {suggestion.item_type === 'product' ? 'Produto' : 'Insumo'}
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <div><span className="block text-slate-500">Saldo</span><strong>{suggestion.current_stock.toLocaleString('pt-BR')} {suggestion.stock_unit.toUpperCase()}</strong></div>
                    <div><span className="block text-slate-500">Mínimo</span><strong>{suggestion.minimum_stock.toLocaleString('pt-BR')} {suggestion.stock_unit.toUpperCase()}</strong></div>
                    <div><span className="block text-slate-500">Cobertura</span><strong>{suggestion.days_remaining == null ? 'Sem consumo' : `${suggestion.days_remaining.toLocaleString('pt-BR')} dias`}</strong></div>
                  </div>
                  <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                    Comprar <strong>{suggestion.suggested_purchase_quantity.toLocaleString('pt-BR')} {suggestion.purchase_unit.toUpperCase()}</strong>
                    <span className="ml-1 text-xs text-emerald-700">({suggestion.suggested_stock_quantity.toLocaleString('pt-BR')} {suggestion.stock_unit.toUpperCase()} no estoque)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="search">Pesquisar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Nome do ingrediente..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock_status">Status do Estoque</Label>
              <Select value={filterStockStatus} onValueChange={setFilterStockStatus}>
                <SelectTrigger id="stock_status">
                  <SelectValue placeholder="Todos os insumos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="controlled">Produtos com controle</SelectItem>
                  <SelectItem value="low_stock">Estoque Baixo</SelectItem>
                  <SelectItem value="out">Sem estoque</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="products" className="space-y-4">
        <TabsList>
          <TabsTrigger value="products">Produtos ({filteredProducts.length})</TabsTrigger>
          <TabsTrigger value="ingredients">Insumos ({filteredIngredients.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5" />
                Estoque de produtos
              </CardTitle>
              <CardDescription>
                Produtos com controle ativo baixam automaticamente quando a venda é finalizada.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredProducts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShoppingBag className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Nenhum produto encontrado</p>
                  <p className="text-sm mt-1">Cadastre produtos ou ative o controle de estoque no cadastro do produto.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead>Estoque Atual</TableHead>
                        <TableHead>Estoque Mínimo</TableHead>
                        <TableHead>Preço</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts.map((product) => {
                        const isControlled = product.track_stock;
                        const isLowStock = isControlled && product.stock_quantity <= product.low_stock_threshold;
                        const isOut = isControlled && product.stock_quantity <= 0;
                        return (
                          <TableRow key={product.id}>
                            <TableCell className="font-medium">{product.name}</TableCell>
                            <TableCell>{product.category || 'Sem categoria'}</TableCell>
                            <TableCell>
                              <Badge
                                variant={isLowStock ? 'destructive' : 'secondary'}
                                className={!isControlled ? 'bg-slate-100 text-slate-600' : isLowStock ? 'bg-red-500' : 'bg-boracume-green text-white'}
                              >
                                {isControlled ? `${product.stock_quantity.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}${product.weight_based ? ' kg' : ''}` : 'Não controla'}
                              </Badge>
                            </TableCell>
                            <TableCell>{isControlled ? `${product.low_stock_threshold.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}${product.weight_based ? ' kg' : ''}` : '-'}</TableCell>
                            <TableCell>{formatCurrency(product.price)}</TableCell>
                            <TableCell>
                              {isOut ? (
                                <span className="text-red-600 font-semibold text-xs">Sem estoque</span>
                              ) : isLowStock ? (
                                <span className="text-red-500 font-semibold text-xs flex items-center gap-1">
                                  <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
                                  Baixo
                                </span>
                              ) : isControlled ? (
                                <span className="text-boracume-green font-semibold text-xs">Normal</span>
                              ) : (
                                <span className="text-slate-500 font-semibold text-xs">Sem controle</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => openStockEntry({ type: 'product', id: product.id, name: product.name })}>
                                  <ArrowDownToLine className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => navigate('/produtos')}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ingredients">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Ingredientes ({filteredIngredients.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filteredIngredients.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Nenhum ingrediente encontrado</p>
                  <p className="text-sm mt-1">Tente ajustar os filtros ou cadastrar um novo ingrediente</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Compra → Consumo</TableHead>
                        <TableHead>Controle</TableHead>
                        <TableHead>Estoque Atual</TableHead>
                        <TableHead>Estoque Mínimo</TableHead>
                        <TableHead>Preço de Custo</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredIngredients.map((ingredient) => {
                        const isLowStock = (ingredient.current_stock || 0) <= (ingredient.min_stock || 0);
                        return (
                          <TableRow key={ingredient.id}>
                            <TableCell className="font-medium">{ingredient.name}</TableCell>
                            <TableCell>
                              <div className="text-sm font-medium">
                                1 {ingredient.purchase_unit} = {ingredient.purchase_conversion} {ingredient.unit}
                              </div>
                              {ingredient.yield_percentage < 100 ? (
                                <div className="text-xs text-amber-600">Rendimento: {ingredient.yield_percentage}%</div>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {ingredient.stock_control_mode === 'automatic_recipe' ? 'Automático por venda' : ingredient.stock_control_mode === 'manual_withdrawal' ? 'Retirada manual' : 'Contagem periódica'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={isLowStock ? "destructive" : "secondary"} className={isLowStock ? "bg-red-500" : "bg-boracume-green text-white"}>
                                {ingredient.current_stock || 0}
                              </Badge>
                            </TableCell>
                            <TableCell>{ingredient.min_stock || 0}</TableCell>
                            <TableCell>{formatCurrency(ingredient.price)}</TableCell>
                            <TableCell>
                              {isLowStock ? (
                                <span className="text-red-500 font-semibold text-xs flex items-center gap-1">
                                  <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
                                  Baixo
                                </span>
                              ) : (
                                <span className="text-boracume-green font-semibold text-xs">Normal</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {ingredient.stock_control_mode !== 'automatic_recipe' ? (
                                  <Button variant="ghost" size="sm" onClick={() => openStockOperation(ingredient)} title={ingredient.stock_control_mode === 'manual_withdrawal' ? 'Registrar retirada' : 'Registrar contagem'}>
                                    {ingredient.stock_control_mode === 'manual_withdrawal' ? <ArrowUpFromLine className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
                                  </Button>
                                ) : null}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openStockEntry({ type: 'ingredient', id: ingredient.id, name: ingredient.name })}
                                >
                                  <ArrowDownToLine className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEdit(ingredient)}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>
                {editingIngredient ? 'Editar Insumo' : 'Novo Insumo'}
              </DialogTitle>
              <DialogDescription>
                {editingIngredient 
                  ? 'Edite as informações do insumo para a Ficha Técnica.' 
                  : 'Cadastre um novo insumo para controle de estoque e custos.'
                }
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Nome do Insumo *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: Queijo Muçarela, Tomate"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="unit">Unidade usada na ficha técnica *</Label>
                <Select 
                  value={formData.unit} 
                  onValueChange={(value) => setFormData(prev => ({ ...prev, unit: value }))}
                  required
                >
                  <SelectTrigger id="unit">
                    <SelectValue placeholder="Selecione a unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map(unit => (
                      <SelectItem key={unit.value} value={unit.value}>
                        {unit.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">É a unidade consumida na receita, como g, ml ou un.</p>
              </div>

              <div className="grid gap-2 rounded-xl border p-4">
                <Label htmlFor="stock_control_mode">Modelo de controle físico *</Label>
                <Select value={formData.stock_control_mode} onValueChange={(value: Ingredient['stock_control_mode']) => setFormData(prev => ({ ...prev, stock_control_mode: value }))}>
                  <SelectTrigger id="stock_control_mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic_recipe">Automático pela ficha técnica</SelectItem>
                    <SelectItem value="manual_withdrawal">Manual ao retirar/abrir pacote</SelectItem>
                    <SelectItem value="periodic_count">Inventário por contagem periódica</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {formData.stock_control_mode === 'automatic_recipe' && 'Cada venda baixa a quantidade prevista na receita.'}
                  {formData.stock_control_mode === 'manual_withdrawal' && 'As vendas calculam o CMV, mas o saldo só baixa quando alguém registra a retirada.'}
                  {formData.stock_control_mode === 'periodic_count' && 'As vendas calculam o CMV e o saldo é ajustado nas contagens físicas.'}
                </p>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                <p className="mb-3 text-sm font-semibold text-emerald-950">Conversão da compra</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="purchase_unit">Unidade em que compra</Label>
                    <Select
                      value={formData.purchase_unit}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, purchase_unit: value }))}
                    >
                      <SelectTrigger id="purchase_unit"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNITS.map(unit => <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>)}
                        <SelectItem value="cx">Caixa (cx)</SelectItem>
                        <SelectItem value="pct">Pacote (pct)</SelectItem>
                        <SelectItem value="fd">Fardo (fd)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="purchase_conversion">Quanto rende em {formData.unit}</Label>
                    <Input
                      id="purchase_conversion"
                      type="number"
                      min="0.000001"
                      step="any"
                      value={formData.purchase_conversion === 0 ? '' : formData.purchase_conversion}
                      onChange={(event) => setFormData(prev => ({
                        ...prev,
                        purchase_conversion: event.target.value === '' ? 0 : Number(event.target.value),
                      }))}
                      required
                    />
                  </div>
                </div>
                <div className="mt-4 grid gap-2">
                  <Label htmlFor="yield_percentage">Rendimento aproveitável (%)</Label>
                  <Input
                    id="yield_percentage"
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={formData.yield_percentage === 0 ? '' : formData.yield_percentage}
                    onChange={(event) => setFormData(prev => ({
                      ...prev,
                      yield_percentage: event.target.value === '' ? 0 : Number(event.target.value),
                    }))}
                    required
                  />
                  <p className="text-xs text-emerald-800">
                    Exemplo: 1 kg comprado rende 1.000 g. Se 10% é descartado, informe rendimento de 90%.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="current_stock">Estoque Atual</Label>
                    <Input
                      id="current_stock"
                      type="number"
                      step="0.001"
                      min="0"
                      value={formData.current_stock === 0 ? '' : formData.current_stock}
                      onChange={(e) => setFormData(prev => ({ ...prev, current_stock: e.target.value === '' ? 0 : parseFloat(e.target.value) }))}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="min_stock">Estoque Mínimo</Label>
                    <Input
                      id="min_stock"
                      type="number"
                      step="0.001"
                      min="0"
                      value={formData.min_stock === 0 ? '' : formData.min_stock}
                      onChange={(e) => setFormData(prev => ({ ...prev, min_stock: e.target.value === '' ? 0 : parseFloat(e.target.value) }))}
                    />
                  </div>
                </div>

              <div className="grid gap-2">
                <Label htmlFor="cost_price">Custo médio atual por {formData.unit} *</Label>
                <CurrencyInput
                  id="cost_price"
                  value={formData.cost_price || 0}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, cost_price: value }))}
                  placeholder="0,00"
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsFormOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" className="bg-boracume-green hover:bg-boracume-green/90">
                {editingIngredient ? 'Salvar Alterações' : 'Cadastrar Insumo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={stockEntryOpen} onOpenChange={setStockEntryOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <form onSubmit={handleStockEntry}>
            <DialogHeader>
              <DialogTitle>Entrada de estoque</DialogTitle>
              <DialogDescription>
                Some uma compra ou reposição ao estoque de {stockEntryTarget?.name}.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="stock_entry_quantity">
                  {stockEntryTarget?.type === 'ingredient' ? 'Quantidade comprada *' : 'Quantidade que entrou *'}
                </Label>
                <Input
                  id="stock_entry_quantity"
                  type="number"
                  step={stockEntryTarget?.type === 'product' && !products.find(item => item.id === stockEntryTarget.id)?.weight_based ? '1' : '0.001'}
                  min="0"
                  value={stockEntryQuantity}
                  onChange={(event) => setStockEntryQuantity(event.target.value)}
                  placeholder={stockEntryTarget?.type === 'product' && !products.find(item => item.id === stockEntryTarget.id)?.weight_based ? 'Ex: 12' : 'Ex: 2,5'}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {stockEntryTarget?.type === 'ingredient'
                    ? `Informe em ${ingredients.find(item => item.id === stockEntryTarget.id)?.purchase_unit || 'unidade de compra'}. A conversão para estoque será automática.`
                    : products.find(item => item.id === stockEntryTarget?.id)?.weight_based
                      ? 'Produto vendido por peso: informe a quantidade em kg (ex.: 2,750).'
                      : 'Produto acabado vendido por unidade exige quantidade inteira.'}
                </p>
              </div>

              {stockEntryTarget?.type === 'ingredient' ? (
                <div className="grid gap-2">
                  <Label htmlFor="stock_entry_cost">
                    Custo por {ingredients.find(item => item.id === stockEntryTarget.id)?.purchase_unit || 'unidade de compra'}
                  </Label>
                  <CurrencyInput
                    id="stock_entry_cost"
                    value={stockEntryCost}
                    onValueChange={setStockEntryCost}
                    placeholder="0,00"
                  />
                  <p className="text-xs text-muted-foreground">
                    O sistema recalculará o custo médio ponderado sem apagar o custo do estoque anterior.
                  </p>
                </div>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStockEntryOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="bg-boracume-green hover:bg-boracume-green/90">
                Somar no estoque
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={stockOperationOpen} onOpenChange={setStockOperationOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <form onSubmit={handleStockOperation}>
            <DialogHeader>
              <DialogTitle>{stockOperationTarget?.stock_control_mode === 'manual_withdrawal' ? 'Registrar retirada' : 'Registrar contagem física'}</DialogTitle>
              <DialogDescription>
                {stockOperationTarget?.stock_control_mode === 'manual_withdrawal'
                  ? `Informe o que foi retirado ou aberto de ${stockOperationTarget?.name}.`
                  : `Informe o saldo realmente contado de ${stockOperationTarget?.name}.`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {stockOperationTarget?.stock_control_mode === 'manual_withdrawal' ? (
                <div className="grid gap-2">
                  <Label>Informar quantidade em</Label>
                  <Select value={stockOperationUnit} onValueChange={(value: 'purchase' | 'consumption') => setStockOperationUnit(value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="purchase">Embalagem de compra ({stockOperationTarget.purchase_unit})</SelectItem>
                      <SelectItem value="consumption">Unidade de consumo ({stockOperationTarget.unit})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="stock_operation_quantity">
                  {stockOperationTarget?.stock_control_mode === 'manual_withdrawal' ? 'Quantidade retirada *' : `Saldo contado em ${stockOperationTarget?.unit} *`}
                </Label>
                <Input id="stock_operation_quantity" type="number" min="0" step="0.001" value={stockOperationQuantity} onChange={(event) => setStockOperationQuantity(event.target.value)} required />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStockOperationOpen(false)}>Cancelar</Button>
              <Button type="submit">Confirmar e registrar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
