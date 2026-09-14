import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { formatBRL } from '@/lib/currency';

type UpsellRule = {
  id: string;
  trigger_product_id: string | null;
  suggested_product_id: string | null;
  message: string | null;
  active: boolean;
  display_order: number;
  discount_type: 'percentage' | 'fixed' | null;
  discount_value: number | null;
  placement: 'product' | 'checkout' | 'both';
};

type ProductOption = {
  id: string;
  name: string;
  price: number;
};

export default function UpsellManager({ context = 'marketing' }: { context?: 'marketing' | 'totem' }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirmDialog();

  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<UpsellRule[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UpsellRule | null>(null);
  const [form, setForm] = useState({
    trigger_product_id: '__any__',
    suggested_product_id: '',
    message: '',
    active: true,
    display_order: 0,
    discount_type: 'none',
    discount_value: 0,
    placement: context === 'totem' ? 'both' : 'checkout'
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const fetchAll = async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const [rulesRes, productsRes] = await Promise.all([
        supabase.from('upsell_rules').select('*').eq('user_id', user.id).order('display_order', { ascending: true }) as any,
        (supabase.from('products') as any)
          .select('id,name,price')
          .eq('user_id', user.id)
          .eq('is_available', true)
          .eq('show_in_delivery', true)
          .order('name', { ascending: true })
      ]);
      if (rulesRes.error) throw rulesRes.error;
      if (productsRes.error) throw productsRes.error;
      setRules((rulesRes.data || []) as any);
      setProducts((productsRes.data || []) as any);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message || 'Falha ao carregar upsells.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
  }, [user?.id]);

  const resetForm = () => {
    setEditing(null);
    setForm({ trigger_product_id: '__any__', suggested_product_id: '', message: '', active: true, display_order: 0, discount_type: 'none', discount_value: 0, placement: context === 'totem' ? 'both' : 'checkout' });
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (rule: UpsellRule) => {
    setEditing(rule);
    setForm({
      trigger_product_id: rule.trigger_product_id || '__any__',
      suggested_product_id: rule.suggested_product_id || '',
      message: rule.message || '',
      active: Boolean(rule.active),
      display_order: Number(rule.display_order || 0),
      discount_type: rule.discount_type || 'none',
      discount_value: Number(rule.discount_value || 0),
      placement: rule.placement || 'checkout'
    });
    setOpen(true);
  };

  const save = async () => {
    if (!user?.id) return;
    if (!form.suggested_product_id) {
      toast({ title: 'Produto sugerido obrigatório', variant: 'destructive' });
      return;
    }
    try {
      setLoading(true);
      const payload: any = {
        user_id: user.id,
        trigger_product_id: form.trigger_product_id === '__any__' ? null : (form.trigger_product_id || null),
        suggested_product_id: form.suggested_product_id || null,
        message: form.message || null,
        active: Boolean(form.active),
        display_order: Number(form.display_order || 0),
        discount_type: form.discount_type === 'none' ? null : form.discount_type,
        discount_value: form.discount_type === 'none' ? null : Number(form.discount_value || 0),
        placement: form.placement,
        updated_at: new Date().toISOString()
      };
      if (editing?.id) {
        const { error } = await supabase.from('upsell_rules').update(payload).eq('id', editing.id).eq('user_id', user.id) as any;
        if (error) throw error;
      } else {
        const { error } = await supabase.from('upsell_rules').insert(payload).select() as any;
        if (error) throw error;
      }
      setOpen(false);
      resetForm();
      await fetchAll();
      toast({ title: 'Upsell salvo' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message || 'Falha ao salvar upsell.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!user?.id) return;
    const ok = await confirm({
      title: 'Excluir upsell',
      description: 'Tem certeza que deseja excluir esta regra de upsell?',
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      variant: 'destructive',
    });
    if (!ok) return;

    try {
      setLoading(true);
      const { error } = await supabase.from('upsell_rules').delete().eq('id', id).eq('user_id', user.id) as any;
      if (error) throw error;
      await fetchAll();
      toast({ title: 'Upsell excluído' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message || 'Falha ao excluir upsell.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>{context === 'totem' ? 'Venda adicional do Totem' : 'Venda Mais'}</CardTitle>
          <Button onClick={openCreate} disabled={loading}>
            <Plus className="h-4 w-4 mr-2" />
            Nova regra
          </Button>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground mb-4">
            {context === 'totem'
              ? 'Relacione qualquer produto a bebidas, acompanhamentos ou adicionais de outras categorias e escolha em qual etapa a oferta será exibida.'
              : 'Configure sugestões automáticas para o cliente (ex.: “Quer adicionar uma borda?”).'}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gatilho</TableHead>
                <TableHead>Sugestão</TableHead>
                <TableHead>Desconto</TableHead>
                <TableHead>Momento</TableHead>
                <TableHead>Mensagem</TableHead>
                <TableHead className="w-[100px] text-center">Ativo</TableHead>
                <TableHead className="w-[120px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => {
                const trigger = r.trigger_product_id ? productById.get(r.trigger_product_id)?.name : null;
                const suggested = r.suggested_product_id ? productById.get(r.suggested_product_id)?.name : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{trigger || <span className="text-muted-foreground">Qualquer produto</span>}</TableCell>
                    <TableCell className="font-medium">{suggested || '-'}</TableCell>
                    <TableCell>
                      {r.discount_type === 'percentage' ? `${Number(r.discount_value || 0)}%` : r.discount_type === 'fixed' ? formatBRL(r.discount_value) : '-'}
                    </TableCell>
                    <TableCell>{r.placement === 'product' ? 'Após o produto' : r.placement === 'both' ? 'Produto e finalização' : 'Antes do pagamento'}</TableCell>
                    <TableCell className="max-w-[420px] truncate">{r.message || '-'}</TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={Boolean(r.active)}
                        onCheckedChange={async (v) => {
                          if (!user?.id) return;
                          try {
                            setLoading(true);
                            const { error } = await supabase
                              .from('upsell_rules')
                              .update({ active: v, updated_at: new Date().toISOString() })
                              .eq('id', r.id)
                              .eq('user_id', user.id) as any;
                            if (error) throw error;
                            await fetchAll();
                          } catch (e: any) {
                            toast({ title: 'Erro', description: e.message || 'Falha ao atualizar.', variant: 'destructive' });
                          } finally {
                            setLoading(false);
                          }
                        }}
                        disabled={loading}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <Button variant="outline" size="icon" onClick={() => openEdit(r)} disabled={loading}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="destructive" size="icon" onClick={() => remove(r.id)} disabled={loading}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                    Nenhuma regra cadastrada.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Upsell' : 'Novo Upsell'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Gatilho (opcional)</Label>
              <Select value={form.trigger_product_id} onValueChange={(v) => setForm((p) => ({ ...p, trigger_product_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Qualquer produto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Qualquer produto</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Produto sugerido</Label>
              <Select value={form.suggested_product_id} onValueChange={(v) => setForm((p) => ({ ...p, suggested_product_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um produto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} • {formatBRL(p.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Mensagem (opcional)</Label>
              <Input value={form.message} onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))} placeholder="Ex.: Quer adicionar uma bebida?" />
            </div>

            <div className="space-y-2">
              <Label>Quando apresentar</Label>
              <Select value={form.placement} onValueChange={(value) => setForm((current) => ({ ...current, placement: value as 'product' | 'checkout' | 'both' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">Logo após escolher o produto</SelectItem>
                  <SelectItem value="checkout">Antes de abrir o pagamento</SelectItem>
                  <SelectItem value="both">Nos dois momentos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tipo de desconto</Label>
                <Select value={form.discount_type} onValueChange={(v) => setForm((p) => ({ ...p, discount_type: v as 'none' | 'percentage' | 'fixed' }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sem desconto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem desconto</SelectItem>
                    <SelectItem value="percentage">Percentual (%)</SelectItem>
                    <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{form.discount_type === 'percentage' ? 'Desconto (%)' : 'Desconto (R$)'}</Label>
                <Input
                  type="number"
                  min="0"
                  step={form.discount_type === 'percentage' ? '1' : '0.01'}
                  value={form.discount_value}
                  disabled={form.discount_type === 'none'}
                  onChange={(e) => setForm((p) => ({ ...p, discount_value: Number(e.target.value || 0) }))}
                  placeholder={form.discount_type === 'percentage' ? 'Ex.: 10' : 'Ex.: 5,00'}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Ordem</Label>
                <Input
                  type="number"
                  value={form.display_order}
                  onChange={(e) => setForm((p) => ({ ...p, display_order: Number(e.target.value || 0) }))}
                />
              </div>
              <div className="space-y-2 flex items-end justify-between">
                <Label>Ativo</Label>
                <Switch checked={form.active} onCheckedChange={(v) => setForm((p) => ({ ...p, active: v }))} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={loading}>
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
