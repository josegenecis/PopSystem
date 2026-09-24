import React, { useEffect, useMemo, useState } from 'react';
import { ChefHat, GlassWater, Search, VolumeX } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

type PreparationRoute = 'kitchen' | 'bar' | 'none';
type ProductRouteRow = { id: string; name: string; preparation_route?: PreparationRoute | null; send_to_kds?: boolean | null };

const routeLabel: Record<PreparationRoute, string> = {
  kitchen: 'Cozinha',
  bar: 'Bar / Copa',
  none: 'Não imprimir',
};

export default function ProductPreparationRoutingSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductRouteRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const loadProducts = async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id,name,preparation_route,send_to_kds')
        .eq('user_id', user.id)
        .order('name');
      if (!active) return;
      if (error) {
        toast({ title: 'Não foi possível carregar os produtos', description: error.message, variant: 'destructive' });
      } else {
        setProducts((data || []).map((product) => ({
          ...product,
          preparation_route: ['kitchen', 'bar', 'none'].includes(product.preparation_route)
            ? product.preparation_route as PreparationRoute
            : null,
        })));
      }
      setLoading(false);
    };
    void loadProducts();
    return () => { active = false; };
  }, [toast, user?.id]);

  const normalizedRoute = (product: ProductRouteRow): PreparationRoute =>
    product.preparation_route || (product.send_to_kds ? 'kitchen' : 'none');
  const filtered = useMemo(() => products.filter((product) => product.name.toLowerCase().includes(search.trim().toLowerCase())), [products, search]);
  const counts = useMemo(() => products.reduce((result, product) => {
    result[normalizedRoute(product)] += 1;
    return result;
  }, { kitchen: 0, bar: 0, none: 0 } as Record<PreparationRoute, number>), [products]);

  const updateRoute = async (product: ProductRouteRow, route: PreparationRoute) => {
    const previous = products;
    setSavingId(product.id);
    setProducts((rows) => rows.map((row) => row.id === product.id ? { ...row, preparation_route: route, send_to_kds: route !== 'none' } : row));
    const { error } = await supabase.from('products')
      .update({ preparation_route: route, send_to_kds: route !== 'none' })
      .eq('id', product.id)
      .eq('user_id', user?.id);
    if (error) {
      setProducts(previous);
      toast({ title: 'Não foi possível alterar o destino', description: error.message, variant: 'destructive' });
    }
    setSavingId(null);
  };

  return (
    <Card className="overflow-hidden border-emerald-200">
      <CardHeader className="border-b bg-emerald-50/60">
        <CardTitle className="text-lg">Destino dos produtos</CardTitle>
        <p className="text-sm text-muted-foreground">Defina em qual setor cada item será impresso quando entrar em um pedido.</p>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-3"><ChefHat className="h-5 w-5 text-emerald-700" /><div className="mt-2 text-2xl font-black text-emerald-950">{counts.kitchen}</div><div className="text-xs text-muted-foreground">Cozinha</div></div>
          <div className="rounded-2xl border bg-white p-3"><GlassWater className="h-5 w-5 text-sky-700" /><div className="mt-2 text-2xl font-black text-emerald-950">{counts.bar}</div><div className="text-xs text-muted-foreground">Bar / Copa</div></div>
          <div className="rounded-2xl border bg-white p-3"><VolumeX className="h-5 w-5 text-slate-500" /><div className="mt-2 text-2xl font-black text-emerald-950">{counts.none}</div><div className="text-xs text-muted-foreground">Somente conta</div></div>
        </div>
        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto..." /></div>
        <div className="max-h-[440px] space-y-2 overflow-y-auto pr-1">
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Carregando produtos…</p> : filtered.map((product) => (
            <div key={product.id} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-3">
              <div className="min-w-0"><p className="truncate font-semibold text-emerald-950">{product.name}</p><Badge variant="outline" className="mt-1 text-[10px]">{routeLabel[normalizedRoute(product)]}</Badge></div>
              <Select value={normalizedRoute(product)} disabled={savingId === product.id} onValueChange={(value: PreparationRoute) => void updateRoute(product, value)}>
                <SelectTrigger className="w-[150px] sm:w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kitchen">Cozinha</SelectItem>
                  <SelectItem value="bar">Bar / Copa</SelectItem>
                  <SelectItem value="none">Não imprimir</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
          {!loading && filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
