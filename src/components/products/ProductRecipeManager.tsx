import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Plus, Calculator, ChevronDown, ChevronUp } from 'lucide-react';
import { formatBRL } from '@/lib/currency';

interface RecipeItem {
  id: string;
  ingredient_id: string;
  quantity: number;
  waste_percentage?: number;
  ingredient?: {
    name: string;
    unit: string;
    cost_price: number;
  };
}

interface ProductRecipeManagerProps {
  productId: string;
}

export interface ProductRecipeManagerHandle {
  savePendingItem: () => Promise<void>;
}

const ProductRecipeManager = forwardRef<ProductRecipeManagerHandle, ProductRecipeManagerProps>(function ProductRecipeManager(
  { productId },
  ref,
) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [recipeItems, setRecipeItems] = useState<RecipeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Novo item form
  const [selectedIngredient, setSelectedIngredient] = useState('');
  const [quantity, setQuantity] = useState('');
  const [wastePercentage, setWastePercentage] = useState('0');

  useEffect(() => {
    if (user && productId && isOpen) {
      void Promise.all([loadIngredients(), loadRecipe()]).catch((error: any) => {
        setLoading(false);
        toast({
          title: 'Erro ao carregar ficha técnica',
          description: error?.message || 'Não foi possível consultar os insumos vinculados.',
          variant: 'destructive',
        });
      });
    }
  }, [user, productId, isOpen]);

  const loadIngredients = async () => {
    const { data } = await supabase
      .from('ingredients')
      .select('id, name, unit, cost_price')
      .eq('user_id', user?.id)
      .order('name');
    setIngredients(data || []);
  };

  const loadRecipe = async () => {
    const { data, error } = await (supabase
      .from('product_recipes') as any)
      .select(`
        id, 
        ingredient_id, 
        quantity,
        waste_percentage,
        ingredient:ingredients(name, unit, cost_price)
      `)
      .eq('product_id', productId);
    if (error) throw error;
    const rows = (data || []) as RecipeItem[];
    setRecipeItems(rows);
    setLoading(false);
    return rows;
  };

  const persistPendingItem = async (notifySuccess: boolean) => {
    if (!selectedIngredient && !quantity.trim()) return;

    const parsedQuantity = Number(quantity);
    const parsedWaste = Number(wastePercentage);
    if (!selectedIngredient || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      throw new Error('Selecione um insumo e informe uma quantidade maior que zero.');
    }
    if (!Number.isFinite(parsedWaste) || parsedWaste < 0 || parsedWaste > 100) {
      throw new Error('A perda deve ficar entre 0% e 100%.');
    }
    if (recipeItems.some(item => item.ingredient_id === selectedIngredient)) {
      throw new Error('Este insumo já está cadastrado na ficha técnica.');
    }

    setSaving(true);
    setSaveError(null);
    try {
      const { error } = await (supabase as any).rpc('save_product_recipe', {
        p_product_id: productId,
        p_ingredient_id: selectedIngredient,
        p_quantity: parsedQuantity,
        p_waste_percentage: parsedWaste,
      });

      if (error) throw error;
      const savedRows = await loadRecipe();
      if (!savedRows.some(item => item.ingredient_id === selectedIngredient)) {
        throw new Error('O vínculo foi enviado, mas não apareceu ao conferir a ficha técnica.');
      }

      setSelectedIngredient('');
      setQuantity('');
      setWastePercentage('0');
      if (notifySuccess) {
        toast({ title: 'Ficha técnica salva', description: 'O insumo foi gravado e conferido com sucesso.' });
      }
    } catch (error: any) {
      const message = error?.message || 'Confira a loja do produto e do insumo e tente novamente.';
      setSaveError(message);
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddItem = async () => {
    try {
      await persistPendingItem(true);
    } catch (error: any) {
      toast({
        title: 'Não foi possível salvar a ficha técnica',
        description: error?.message || 'Confira os dados e tente novamente.',
        variant: 'destructive',
      });
    }
  };

  useImperativeHandle(ref, () => ({
    savePendingItem: async () => {
      await persistPendingItem(false);
    },
  }));

  const handleRemoveItem = async (id: string) => {
    try {
      const { error } = await (supabase.from('product_recipes') as any).delete().eq('id', id);
      if (error) throw error;
      loadRecipe();
    } catch (error) {
      toast({ title: 'Erro', description: 'Não foi possível remover o insumo.', variant: 'destructive' });
    }
  };

  const totalCost = recipeItems.reduce((acc, item) => {
    const cost = item.ingredient?.cost_price || 0;
    const wasteMultiplier = 1 + Number(item.waste_percentage || 0) / 100;
    return acc + (cost * item.quantity * wasteMultiplier);
  }, 0);

  return (
    <div className="bg-boracume-light/30 p-4 rounded-2xl border border-boracume-light mt-3">
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-boracume-orange" />
          <span className="font-semibold text-boracume-dark-green">Ficha Técnica e Custos (CMV)</span>
        </div>
        {isOpen ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
      </button>

      {isOpen && (
        <div className="pt-4 mt-2 border-t border-gray-100 space-y-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto] sm:items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Insumo</Label>
              <Select value={selectedIngredient} onValueChange={setSelectedIngredient}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {ingredients.map(ing => (
                    <SelectItem key={ing.id} value={ing.id}>
                      {ing.name} ({formatBRL(ing.cost_price)}/{ing.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Qtd.</Label>
              <Input 
                type="number" 
                step="0.001" 
                min="0.001"
                value={quantity} 
                onChange={e => setQuantity(e.target.value)} 
                className="bg-white"
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Perda %</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={wastePercentage}
                onChange={event => setWastePercentage(event.target.value)}
                className="bg-white"
                aria-label="Percentual de perda do insumo"
              />
            </div>
            <Button
              type="button"
              onClick={handleAddItem}
              disabled={saving}
              className="bg-boracume-green hover:bg-boracume-green/90 sm:min-w-40"
            >
              <Plus className="h-4 w-4" />
              {saving ? 'Salvando...' : 'Adicionar e salvar'}
            </Button>
          </div>

          {saveError ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {saveError}
            </div>
          ) : null}

          {loading ? (
            <div className="text-center text-sm text-gray-500 py-4">Carregando ficha técnica...</div>
          ) : recipeItems.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-4 border border-dashed rounded-lg bg-white">
              Nenhum insumo cadastrado na ficha técnica.
            </div>
          ) : (
            <div className="space-y-2">
              {recipeItems.map(item => (
                <div key={item.id} className="flex items-center justify-between bg-white p-2 rounded-lg border border-gray-100 shadow-sm">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{item.ingredient?.name}</div>
                    <div className="text-xs text-gray-500">
                      {item.quantity} {item.ingredient?.unit} × R$ {Number(item.ingredient?.cost_price || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      {Number(item.waste_percentage || 0) > 0 ? ` + ${item.waste_percentage}% de perda` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="font-semibold text-sm">
                      {formatBRL((item.ingredient?.cost_price || 0) * item.quantity * (1 + Number(item.waste_percentage || 0) / 100))}
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => handleRemoveItem(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              
              <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border mt-2">
                <span className="font-semibold text-gray-700">Custo Total de Produção:</span>
                <span className="font-bold text-lg text-red-600">{formatBRL(totalCost)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default ProductRecipeManager;
