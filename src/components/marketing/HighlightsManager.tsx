import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { formatBRL } from '@/lib/currency';

type ProductRow = {
  id: string;
  name: string;
  price: number;
  is_highlight: boolean;
  highlight_order: number | null;
  order_count: number | null;
};

export default function HighlightsManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState('');

  const fetchProducts = async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('products')
        .select('id,name,price,is_highlight,highlight_order,order_count')
        .eq('user_id', user.id)
        .order('name', { ascending: true }) as any;
      if (error) throw error;
      setProducts((data || []) as any);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message || 'Falha ao carregar produtos.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProducts();
  }, [user?.id]);

  const highlightList = useMemo(() => {
    return products
      .filter((p) => p.is_highlight)
      .sort((a, b) => {
        const ao = a.highlight_order !== null && a.highlight_order !== undefined ? Number(a.highlight_order) : 10_000;
        const bo = b.highlight_order !== null && b.highlight_order !== undefined ? Number(b.highlight_order) : 10_000;
        if (ao !== bo) return ao - bo;
        return Number(b.order_count || 0) - Number(a.order_count || 0);
      });
  }, [products]);

  const filteredAll = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => String(p.name || '').toLowerCase().includes(q));
  }, [products, search]);

  const setHighlight = async (productId: string, enabled: boolean) => {
    if (!user?.id) return;
    try {
      setLoading(true);
      if (enabled) {
        const maxOrder = highlightList.reduce((m, p) => {
          const v = p.highlight_order !== null && p.highlight_order !== undefined ? Number(p.highlight_order) : 0;
          return Math.max(m, v);
        }, 0);
        const { error } = await supabase
          .from('products')
          .update({ is_highlight: true, highlight_order: maxOrder + 1 })
          .eq('id', productId)
          .eq('user_id', user.id) as any;
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('products')
          .update({ is_highlight: false })
          .eq('id', productId)
          .eq('user_id', user.id) as any;
        if (error) throw error;
      }
      await fetchProducts();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message || 'Falha ao atualizar destaque.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const move = async (productId: string, dir: 'up' | 'down') => {
    if (!user?.id) return;
    const list = highlightList;
    const idx = list.findIndex((p) => p.id === productId);
    if (idx < 0) return;
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;

    const a = list[idx];
    const b = list[targetIdx];
    const ao = a.highlight_order !== null && a.highlight_order !== undefined ? Number(a.highlight_order) : idx;
    const bo = b.highlight_order !== null && b.highlight_order !== undefined ? Number(b.highlight_order) : targetIdx;

    try {
      setLoading(true);
      const [{ error: ea }, { error: eb }] = await Promise.all([
        supabase.from('products').update({ highlight_order: bo }).eq('id', a.id).eq('user_id', user.id) as any,
        supabase.from('products').update({ highlight_order: ao }).eq('id', b.id).eq('user_id', user.id) as any
      ]);
      if (ea) throw ea;
      if (eb) throw eb;
      await fetchProducts();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message || 'Falha ao reordenar destaques.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Destaques do Cardápio</CardTitle>
          <Button variant="outline" size="sm" onClick={() => fetchProducts()} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            A ordem aqui controla a sequência exibida para o cliente no cardápio digital.
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto..." />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="w-[120px] text-center">Destaque</TableHead>
                <TableHead className="w-[140px] text-right">Ordem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAll.map((p) => {
                const position = highlightList.findIndex((x) => x.id === p.id);
                const canUp = position > 0;
                const canDown = position >= 0 && position < highlightList.length - 1;
                const order = p.highlight_order !== null && p.highlight_order !== undefined ? Number(p.highlight_order) : 0;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{p.name}</span>
                        <span className="text-xs text-muted-foreground">{formatBRL(p.price)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={Boolean(p.is_highlight)} onCheckedChange={(v) => setHighlight(p.id, v)} disabled={loading} />
                    </TableCell>
                    <TableCell className="text-right">
                      {p.is_highlight ? (
                        <div className="inline-flex items-center justify-end gap-2">
                          <Button variant="outline" size="icon" onClick={() => move(p.id, 'up')} disabled={loading || !canUp}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="icon" onClick={() => move(p.id, 'down')} disabled={loading || !canDown}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <span className="text-sm tabular-nums w-[44px] text-right">{order}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredAll.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                    Nenhum produto encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
