import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { formatBRL } from '@/lib/currency';
import { Plus, Edit, Trash2, Eye, EyeOff, Copy, Link2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import ProductVariationForm from './ProductVariationForm';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface VariationOption {
  name: string;
  price: number;
  active?: boolean;
}

interface GlobalVariation {
  id?: string;
  name: string;
  options: VariationOption[];
  description?: string;
  customer_label?: string;
  receipt_label?: string;
  required?: boolean;
  max_selections?: number;
  active?: boolean;
}

const GlobalVariationManager: React.FC = () => {
  const [variations, setVariations] = useState<GlobalVariation[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingVariation, setEditingVariation] = useState<GlobalVariation | undefined>();
  const [loading, setLoading] = useState(true);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigningVariation, setAssigningVariation] = useState<GlobalVariation | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [assigningProducts, setAssigningProducts] = useState(false);
  const assignmentRequestRef = useRef(0);
  const { toast } = useToast();
  const { user } = useAuth();
  const confirm = useConfirmDialog();

  useEffect(() => {
    if (user) {
      fetchVariations();
      fetchProducts();
    }
  }, [user]);

  const fetchVariations = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('global_variations')
        .select('*')
        .eq('user_id', user?.id)
        .order('name');
      if (error) throw error;
      setVariations((data || []).map((variation: any) => ({
        ...variation,
        options: typeof variation.options === 'string' ? JSON.parse(variation.options) : variation.options
      })));
    } catch (error) {
      toast({ title: 'Erro', description: 'Erro ao carregar complementos.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name')
        .eq('user_id', user?.id)
        .order('name');
      if (error) throw error;
      setProducts(data || []);
    } catch {
      toast({ title: 'Erro', description: 'Erro ao carregar produtos para atribuição.', variant: 'destructive' });
    }
  };

  const handleSaveVariation = async (variationData: GlobalVariation) => {
    try {
      if (editingVariation?.id) {
        const updateData = {
          name: variationData.name,
          options: JSON.stringify(variationData.options),
          description: variationData.description || '',
          customer_label: variationData.customer_label || '',
          receipt_label: variationData.receipt_label || '',
          required: variationData.required ?? false,
          max_selections: variationData.max_selections ?? 1,
          active: variationData.active ?? true,
          updated_at: new Date().toISOString()
        };
        const first = await supabase.from('global_variations').update(updateData as any).eq('id', editingVariation.id);
        if ((first as any).error) {
          const msg = String((first as any).error?.message || '');
          if (msg.includes('customer_label') || msg.includes('receipt_label')) {
            const fallback = await supabase
              .from('global_variations')
              .update({ name: variationData.name, options: JSON.stringify(variationData.options), description: variationData.description || '', required: variationData.required ?? false, max_selections: variationData.max_selections ?? 1, active: variationData.active ?? true, updated_at: new Date().toISOString() } as any)
              .eq('id', editingVariation.id);
            if ((fallback as any).error) throw (fallback as any).error;
          } else {
            throw (first as any).error;
          }
        }
      } else {
        const insertData = {
          user_id: user?.id,
          name: variationData.name,
          options: JSON.stringify(variationData.options),
          description: variationData.description || '',
          customer_label: variationData.customer_label || '',
          receipt_label: variationData.receipt_label || '',
          required: variationData.required ?? false,
          max_selections: variationData.max_selections ?? 1,
          active: variationData.active ?? true
        };
        const first = await supabase.from('global_variations').insert(insertData as any);
        if ((first as any).error) {
          const msg = String((first as any).error?.message || '');
          if (msg.includes('customer_label') || msg.includes('receipt_label')) {
            const fallback = await supabase
              .from('global_variations')
              .insert({ user_id: user?.id, name: variationData.name, options: JSON.stringify(variationData.options), description: variationData.description || '', required: variationData.required ?? false, max_selections: variationData.max_selections ?? 1, active: variationData.active ?? true } as any);
            if ((fallback as any).error) throw (fallback as any).error;
          } else {
            throw (first as any).error;
          }
        }
      }
      toast({ title: 'Sucesso', description: `Complemento ${editingVariation ? 'atualizado' : 'criado'} com sucesso!` });
      setShowForm(false);
      setEditingVariation(undefined);
      fetchVariations();
    } catch (error) {
      toast({ title: 'Erro', description: 'Erro ao salvar complemento.', variant: 'destructive' });
    }
  };

  const handleDeleteVariation = async (variationId: string) => {
    const ok = await confirm({
      title: 'Excluir complemento',
      description: 'Tem certeza que deseja excluir este complemento?',
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const { error } = await supabase
        .from('global_variations')
        .delete()
        .eq('id', variationId);
      if (error) throw error;
      toast({ title: 'Sucesso', description: 'Complemento excluído com sucesso.' });
      fetchVariations();
    } catch (error) {
      toast({ title: 'Erro', description: 'Erro ao excluir complemento.', variant: 'destructive' });
    }
  };

  const toggleVariationActive = async (variation: GlobalVariation) => {
    try {
      const { error } = await supabase
        .from('global_variations')
        .update({ active: !(variation.active !== false), updated_at: new Date().toISOString() } as any)
        .eq('id', variation.id!);
      if (error) throw error;
      toast({ title: 'Sucesso', description: `Complemento ${variation.active !== false ? 'ocultado' : 'ativado'} com sucesso.` });
      fetchVariations();
    } catch {
      toast({ title: 'Erro', description: 'Erro ao atualizar visibilidade do complemento.', variant: 'destructive' });
    }
  };

  const handleDuplicateVariation = async (variation: GlobalVariation) => {
    try {
      const duplicated = {
        user_id: user?.id,
        name: `${variation.name} (cópia)`,
        options: JSON.stringify(Array.isArray(variation.options) ? variation.options : []),
        description: variation.description || '',
        customer_label: variation.customer_label || '',
        receipt_label: variation.receipt_label || '',
        required: variation.required ?? false,
        max_selections: variation.max_selections ?? 1,
        active: variation.active ?? true
      };

      const first = await supabase.from('global_variations').insert(duplicated as any);
      if ((first as any).error) {
        const msg = String((first as any).error?.message || '');
        if (msg.includes('customer_label') || msg.includes('receipt_label')) {
          const fallback = await supabase.from('global_variations').insert({
            user_id: user?.id,
            name: `${variation.name} (cópia)`,
            options: JSON.stringify(Array.isArray(variation.options) ? variation.options : []),
            description: variation.description || '',
            required: variation.required ?? false,
            max_selections: variation.max_selections ?? 1,
            active: variation.active ?? true
          } as any);
          if ((fallback as any).error) throw (fallback as any).error;
        } else {
          throw (first as any).error;
        }
      }

      toast({ title: 'Sucesso', description: 'Grupo de complementos duplicado com sucesso.' });
      fetchVariations();
    } catch (error) {
      toast({ title: 'Erro', description: 'Erro ao duplicar grupo de complementos.', variant: 'destructive' });
    }
  };

  const openAssignDialog = async (variation: GlobalVariation) => {
    const requestId = assignmentRequestRef.current + 1;
    assignmentRequestRef.current = requestId;
    setAssigningVariation(variation);
    setSelectedProductIds([]);
    setAssignDialogOpen(true);

    if (!variation.id) return;

    try {
      setLoadingAssignments(true);
      const { data, error } = await supabase
        .from('product_global_variation_links')
        .select('product_id')
        .eq('global_variation_id', variation.id);

      if (error) throw error;

      if (assignmentRequestRef.current !== requestId) return;

      setSelectedProductIds(Array.from(new Set(
        (data || [])
          .map((link: any) => String(link?.product_id || ''))
          .filter(Boolean)
      )));
    } catch {
      if (assignmentRequestRef.current !== requestId) return;
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar os produtos já vinculados.',
        variant: 'destructive'
      });
      setAssignDialogOpen(false);
      setAssigningVariation(null);
    } finally {
      if (assignmentRequestRef.current === requestId) {
        setLoadingAssignments(false);
      }
    }
  };

  const closeAssignDialog = () => {
    assignmentRequestRef.current += 1;
    setLoadingAssignments(false);
    setAssignDialogOpen(false);
    setAssigningVariation(null);
    setSelectedProductIds([]);
  };

  const handleAssignProducts = async () => {
    if (!assigningVariation?.id) {
      setAssignDialogOpen(false);
      return;
    }

    try {
      setAssigningProducts(true);
      const { data: currentLinks, error: currentLinksError } = await supabase
        .from('product_global_variation_links')
        .select('product_id')
        .eq('global_variation_id', assigningVariation.id);

      if (currentLinksError) throw currentLinksError;

      const currentProductIds = Array.from(new Set(
        (currentLinks || [])
          .map((link: any) => String(link?.product_id || ''))
          .filter(Boolean)
      ));
      const selectedSet = new Set(selectedProductIds);
      const currentSet = new Set(currentProductIds);
      const productIdsToAdd = selectedProductIds.filter((productId) => !currentSet.has(productId));
      const productIdsToRemove = currentProductIds.filter((productId) => !selectedSet.has(productId));

      const payload = productIdsToAdd.map((productId) => ({
        product_id: productId,
        global_variation_id: assigningVariation.id
      }));

      if (payload.length > 0) {
        const { error } = await supabase
          .from('product_global_variation_links')
          .upsert(payload as any, { onConflict: 'product_id,global_variation_id', ignoreDuplicates: true });

        if (error) throw error;
      }

      if (productIdsToRemove.length > 0) {
        const { error } = await supabase
          .from('product_global_variation_links')
          .delete()
          .eq('global_variation_id', assigningVariation.id)
          .in('product_id', productIdsToRemove);

        if (error) throw error;
      }

      toast({ title: 'Sucesso', description: 'Produtos vinculados ao grupo foram atualizados.' });
      setAssignDialogOpen(false);
      setAssigningVariation(null);
      setSelectedProductIds([]);
    } catch {
      toast({ title: 'Erro', description: 'Erro ao atribuir grupo aos produtos.', variant: 'destructive' });
    } finally {
      setAssigningProducts(false);
    }
  };

  if (!user) {
    return (
      <div className="text-center py-8 text-gray-500">É necessário estar autenticado para gerenciar complementos.</div>
    );
  }

  if (showForm) {
    return (
      <ProductVariationForm
        variation={editingVariation}
        onSave={handleSaveVariation}
        onCancel={() => { setShowForm(false); setEditingVariation(undefined); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="mt-2 text-lg font-semibold text-slate-900">Adicionais</h3>
        </div>
        <Button onClick={() => setShowForm(true)} size="sm" className="h-9 rounded-xl bg-[#8CC850] px-4 text-white hover:bg-[#79b541] shadow-[0_18px_35px_-20px_rgba(140,200,80,0.45)]">
          <Plus size={16} className="mr-1" /> Nova Variação Global
        </Button>
      </div>
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        </div>
      ) : (
        <div className="space-y-3">
          {variations.length === 0 ? (
            <Card className="rounded-[28px] border border-[#FF6400]/12 bg-gradient-to-br from-[#FFF8F2] via-white to-[#F5EBE1]/60">
              <CardContent className="text-center py-8">
                <p className="text-gray-500">Nenhuma variação global cadastrada.</p>
                <Button onClick={() => setShowForm(true)} className="mt-3 h-9 rounded-xl bg-[#8CC850] px-4 text-white hover:bg-[#79b541]" size="sm">
                  <Plus size={16} className="mr-1" /> Criar Nova Variação Global
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {variations.map((variation) => (
                <AccordionItem key={variation.id} value={String(variation.id)}>
                  <Card className="overflow-hidden rounded-[26px] border border-[#FF6400]/12 bg-gradient-to-br from-white via-[#FFF8F2]/45 to-[#F5EBE1]/45 shadow-[0_20px_50px_-35px_rgba(0,50,35,0.18)] backdrop-blur-md">
                    <CardContent className="p-0">
                      <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:justify-between">
                        <AccordionTrigger className="flex-1 px-0 py-0 hover:no-underline">
                          <div className="flex-1 text-left">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-medium text-slate-900">{variation.name}</div>
                              <Badge variant="secondary" className={variation.active !== false ? 'border border-[#8CC850]/40 bg-[#8CC850]/15 text-[#003223]' : 'bg-slate-100 text-slate-500 border border-slate-200'}>
                                {variation.active !== false ? 'Ativo' : 'Oculto'}
                              </Badge>
                              {variation.required && (
                                <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">Obrigatório</Badge>
                              )}
                            </div>
                            {variation.description && (
                              <div className="mt-1 text-xs text-muted-foreground">{variation.description}</div>
                            )}
                          </div>
                        </AccordionTrigger>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          <Button type="button" variant="outline" size="sm" className="rounded-xl border-[#003223]/15 bg-white/85 text-[#003223] hover:bg-[#F5EBE1]" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openAssignDialog(variation); }}>
                            <Link2 size={14} className="mr-2" /> Atribuir produto
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="rounded-xl border-[#8CC850]/30 bg-white/85 text-[#003223] hover:bg-[#8CC850]/15" onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleDuplicateVariation(variation); }}>
                            <Copy size={14} className="mr-2" /> Duplicar grupo
                          </Button>
                          <button
                            type="button"
                            className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${variation.active !== false ? 'text-[#16a34a] hover:bg-[#16a34a]/10' : 'text-slate-400 hover:bg-slate-200/70'}`}
                            onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleVariationActive(variation); }}
                          >
                            {variation.active !== false ? <Eye size={18} /> : <EyeOff size={18} />}
                          </button>
                          <Button type="button" variant="outline" size="sm" className="rounded-xl border-[#FF6400]/15 bg-white/85 text-[#FF6400] hover:bg-[#F5EBE1]" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setEditingVariation(variation); setShowForm(true); }}>
                            <Edit size={14} className="mr-2" /> Editar
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="rounded-xl border-red-200 bg-white/85 text-red-500 hover:bg-red-50" onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleDeleteVariation(variation.id!); }}>
                            <Trash2 size={14} className="mr-2" /> Excluir
                          </Button>
                        </div>
                      </div>
                      <AccordionContent className="px-4 pb-4">
                        <div className="space-y-2">
                          {variation.options?.map((option, index) => (
                            <div key={index} className="flex justify-between text-sm">
                              <span className={option.active === false ? 'text-gray-400 line-through' : ''}>{option.name}</span>
                              <span className="text-gray-600">
                                {option.active === false ? 'Oculto' : option.price > 0 ? `+${formatBRL(option.price)}` : 'Grátis'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </CardContent>
                  </Card>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      )}
      <Dialog
        open={assignDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeAssignDialog();
          } else {
            setAssignDialogOpen(true);
          }
        }}
      >
        <DialogContent className="max-w-2xl rounded-[28px] border border-[#FF6400]/12 bg-gradient-to-br from-[#FFF8F2] via-white to-[#F5EBE1]/65 shadow-[0_28px_70px_-35px_rgba(0,50,35,0.22)]">
          <DialogHeader>
            <DialogTitle className="text-slate-900">Atribuir grupo a produtos</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-[#003223]/70">
              {assigningVariation ? `Selecione os produtos que devem receber o grupo ${assigningVariation.name}.` : 'Selecione os produtos.'}
            </div>
            <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-2 sm:grid-cols-2">
              {loadingAssignments ? (
                <div className="col-span-full flex items-center justify-center py-10 text-sm text-[#003223]/60">
                  <div className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-[#8CC850] border-t-transparent" />
                  Carregando produtos vinculados...
                </div>
              ) : products.map((product) => (
                <div key={product.id} className="flex items-start space-x-3 rounded-2xl border border-[#FF6400]/10 bg-white/90 p-4 shadow-sm">
                  <Checkbox
                    id={`assign-product-${product.id}`}
                    checked={selectedProductIds.includes(product.id)}
                    onCheckedChange={(checked) => {
                      setSelectedProductIds((prev) => checked
                        ? Array.from(new Set([...prev, product.id]))
                        : prev.filter((id) => id !== product.id));
                    }}
                  />
                  <Label htmlFor={`assign-product-${product.id}`} className="cursor-pointer font-medium text-slate-900">
                    {product.name}
                  </Label>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-9 rounded-xl border-[#003223]/12 bg-white/85 px-4 text-[#003223] hover:bg-[#F5EBE1]" onClick={closeAssignDialog}>
              Cancelar
            </Button>
            <Button type="button" className="h-9 rounded-xl bg-[#8CC850] px-4 text-[#003223] hover:bg-[#79b541]" disabled={assigningProducts || loadingAssignments} onClick={handleAssignProducts}>
              {assigningProducts ? 'Salvando...' : 'Salvar atribuições'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GlobalVariationManager;
