/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas entram no tipo gerado após a migração remota */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Boxes, Building2, CalendarClock, CheckCircle2, Download, MessageCircle, PackageCheck, Plus, RefreshCw, Send, ShoppingCart, Truck } from 'lucide-react';

type Suggestion = {
  item_type: 'ingredient' | 'product'; item_id: string; name: string; current_stock: number; minimum_stock: number;
  stock_unit: string; purchase_unit: string; purchase_conversion: number; suggested_stock_quantity: number;
  suggested_purchase_quantity: number; supplier_id?: string | null; supplier_name?: string | null; supplier_whatsapp?: string | null;
  last_unit_price?: number | null; estimated_total?: number; lead_time_days?: number; days_remaining?: number | null; reason: string;
};
type Supplier = { id: string; name: string; document?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; payment_terms?: string | null; minimum_order_amount: number; average_lead_time_days: number; notes?: string | null; active: boolean };
type SupplierItem = { id: string; supplier_id: string; ingredient_id?: string | null; product_id?: string | null; purchase_unit: string; conversion_factor: number; minimum_order_quantity: number; package_multiple: number; last_unit_price?: number | null; lead_time_days?: number | null; preferred: boolean };
type OrderItem = { id: string; ingredient_id?: string | null; product_id?: string | null; item_name: string; purchase_unit: string; conversion_factor: number; ordered_quantity: number; received_quantity: number; unit_price: number };
type PurchaseOrder = { id: string; order_number: string; status: string; expected_date?: string | null; notes?: string | null; total_amount: number; created_at: string; supplier_id?: string | null; supplier?: { name?: string; whatsapp?: string } | null; items?: OrderItem[] };
type Batch = { id: string; ingredient_id?: string | null; product_id?: string | null; batch_code?: string | null; expiration_date?: string | null; current_quantity: number; unit: string; status: string; ingredient?: { name?: string } | null; product?: { name?: string } | null };
type PriceRow = { id: string; supplier_id?: string | null; ingredient_id?: string | null; product_id?: string | null; item_name: string; unit_price: number; quantity: number; purchase_unit: string; recorded_at: string; supplier?: { name?: string } | null };

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = (value: unknown) => Number(value || 0);
const statusLabel: Record<string, string> = { draft: 'Rascunho', sent: 'Enviado', confirmed: 'Confirmado', partial: 'Parcial', received: 'Recebido', cancelled: 'Cancelado' };
const statusClass: Record<string, string> = { draft: 'bg-slate-100 text-slate-700', sent: 'bg-blue-100 text-blue-800', confirmed: 'bg-violet-100 text-violet-800', partial: 'bg-amber-100 text-amber-800', received: 'bg-emerald-100 text-emerald-800', cancelled: 'bg-red-100 text-red-800' };

export default function Procurement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierItems, setSupplierItems] = useState<SupplierItem[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [ingredients, setIngredients] = useState<Array<{ id: string; name: string; unit: string; purchase_unit: string; purchase_conversion: number; safety_stock: number }>>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [alerts, setAlerts] = useState<Record<string, unknown>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [linkDialog, setLinkDialog] = useState(false);
  const [orderDialog, setOrderDialog] = useState(false);
  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: '', document: '', whatsapp: '', phone: '', email: '', payment_terms: '', minimum_order_amount: 0, average_lead_time_days: 1, notes: '' });
  const [linkForm, setLinkForm] = useState({ supplier_id: '', item_type: 'ingredient', item_id: '', purchase_unit: 'un', conversion_factor: 1, minimum_order_quantity: 1, package_multiple: 1, last_unit_price: 0, lead_time_days: 1, safety_stock: 0, preferred: true });
  const [orderSupplierId, setOrderSupplierId] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [orderExpectedDate, setOrderExpectedDate] = useState(format(addDays(new Date(), 2), 'yyyy-MM-dd'));
  const [receipt, setReceipt] = useState<Record<string, { quantity: number; batch_code: string; expiration_date: string }>>({});

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [suggestionRes, alertRes, supplierRes, linkRes, orderRes, batchRes, priceRes, ingredientRes, productRes] = await Promise.all([
        (supabase as any).rpc('get_procurement_purchase_suggestions', { p_store_user_id: user.id, p_history_days: 30, p_cover_days: 7 }),
        (supabase as any).rpc('get_procurement_alerts', { p_store_user_id: user.id }),
        (supabase as any).from('procurement_suppliers').select('*').eq('user_id', user.id).order('name'),
        (supabase as any).from('procurement_supplier_items').select('*').eq('user_id', user.id),
        (supabase as any).from('procurement_orders').select('*,supplier:procurement_suppliers(name,whatsapp),items:procurement_order_items(*)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
        (supabase as any).from('inventory_batches').select('*,ingredient:ingredients(name),product:products(name)').eq('user_id', user.id).order('expiration_date', { ascending: true }).limit(200),
        (supabase as any).from('procurement_price_history').select('*,supplier:procurement_suppliers(name)').eq('user_id', user.id).order('recorded_at', { ascending: false }).limit(200),
        supabase.from('ingredients').select('id,name,unit,purchase_unit,purchase_conversion,safety_stock').eq('user_id', user.id).order('name'),
        supabase.from('products').select('id,name').eq('user_id', user.id).order('name'),
      ]);
      for (const result of [suggestionRes, alertRes, supplierRes, linkRes, orderRes, batchRes, priceRes, ingredientRes, productRes]) if (result.error) throw result.error;
      setSuggestions((suggestionRes.data || []).map((row: Suggestion) => ({ ...row, current_stock: number(row.current_stock), minimum_stock: number(row.minimum_stock), suggested_purchase_quantity: number(row.suggested_purchase_quantity), suggested_stock_quantity: number(row.suggested_stock_quantity), last_unit_price: row.last_unit_price == null ? null : number(row.last_unit_price), estimated_total: number(row.estimated_total) })));
      setAlerts(alertRes.data || {}); setSuppliers(supplierRes.data || []); setSupplierItems(linkRes.data || []);
      setOrders((orderRes.data || []).map((row: PurchaseOrder) => ({ ...row, total_amount: number(row.total_amount), items: (row.items || []).map((item) => ({ ...item, ordered_quantity: number(item.ordered_quantity), received_quantity: number(item.received_quantity), unit_price: number(item.unit_price), conversion_factor: number(item.conversion_factor) })) })));
      setBatches((batchRes.data || []).map((row: Batch) => ({ ...row, current_quantity: number(row.current_quantity) })));
      setPrices((priceRes.data || []).map((row: PriceRow) => ({ ...row, unit_price: number(row.unit_price), quantity: number(row.quantity) })));
      setIngredients((ingredientRes.data || []).map((row) => ({ ...row, purchase_conversion: number(row.purchase_conversion), safety_stock: number((row as any).safety_stock) })));
      setProducts(productRes.data || []);
    } catch (error: any) {
      toast({ title: 'Erro ao carregar compras', description: error?.message || 'Não foi possível abrir a central.', variant: 'destructive' });
    } finally { setLoading(false); }
  }, [toast, user?.id]);

  useEffect(() => { void load(); }, [load]);

  const selectedSuggestions = suggestions.filter((item) => selected.has(`${item.item_type}:${item.item_id}`));
  const selectedEstimate = selectedSuggestions.reduce((sum, item) => sum + number(item.estimated_total), 0);
  const activeBatches = batches.filter((batch) => batch.status === 'active' && batch.current_quantity > 0);
  const priceComparisons = useMemo(() => prices.map((row, index) => {
    const previous = prices.slice(index + 1).find((candidate) => candidate.item_name === row.item_name);
    const change = previous?.unit_price ? ((row.unit_price - previous.unit_price) / previous.unit_price) * 100 : null;
    return { ...row, change };
  }), [prices]);
  const currentPriceComparison = useMemo(() => {
    const latestPerSupplier = new Map<string, PriceRow>();
    for (const row of prices) {
      const itemKey = row.ingredient_id || row.product_id || row.item_name;
      const key = `${itemKey}:${row.supplier_id || row.supplier?.name || 'unknown'}`;
      if (!latestPerSupplier.has(key)) latestPerSupplier.set(key, row);
    }
    const best = new Map<string, number>();
    for (const row of latestPerSupplier.values()) {
      const itemKey = row.ingredient_id || row.product_id || row.item_name;
      best.set(itemKey, Math.min(best.get(itemKey) ?? Number.POSITIVE_INFINITY, row.unit_price));
    }
    return { best, currentIds: new Set([...latestPerSupplier.values()].map((row) => row.id)) };
  }, [prices]);

  const saveSupplier = async () => {
    if (!user?.id || !supplierForm.name.trim()) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('procurement_suppliers').insert({ ...supplierForm, user_id: user.id, document: supplierForm.document.replace(/\D/g, '') || null });
      if (error) throw error;
      setSupplierDialog(false); setSupplierForm({ name: '', document: '', whatsapp: '', phone: '', email: '', payment_terms: '', minimum_order_amount: 0, average_lead_time_days: 1, notes: '' });
      await load(); toast({ title: 'Fornecedor cadastrado', description: 'Já pode ser usado nas sugestões e pedidos.' });
    } catch (error: any) { toast({ title: 'Erro ao salvar fornecedor', description: error.message, variant: 'destructive' }); } finally { setSaving(false); }
  };

  const saveSupplierItem = async () => {
    if (!user?.id || !linkForm.supplier_id || !linkForm.item_id) return;
    setSaving(true);
    try {
      if (linkForm.preferred) {
        const column = linkForm.item_type === 'ingredient' ? 'ingredient_id' : 'product_id';
        await (supabase as any).from('procurement_supplier_items').update({ preferred: false }).eq('user_id', user.id).eq(column, linkForm.item_id);
      }
      const payload = { user_id: user.id, supplier_id: linkForm.supplier_id, ingredient_id: linkForm.item_type === 'ingredient' ? linkForm.item_id : null, product_id: linkForm.item_type === 'product' ? linkForm.item_id : null, purchase_unit: linkForm.purchase_unit, conversion_factor: number(linkForm.conversion_factor), minimum_order_quantity: number(linkForm.minimum_order_quantity), package_multiple: number(linkForm.package_multiple), last_unit_price: number(linkForm.last_unit_price), lead_time_days: number(linkForm.lead_time_days), preferred: linkForm.preferred };
      const existing = supplierItems.find((item) => item.supplier_id === linkForm.supplier_id && (linkForm.item_type === 'ingredient' ? item.ingredient_id === linkForm.item_id : item.product_id === linkForm.item_id));
      const { error } = existing
        ? await (supabase as any).from('procurement_supplier_items').update(payload).eq('id', existing.id)
        : await (supabase as any).from('procurement_supplier_items').insert(payload);
      if (error) throw error;
      if (linkForm.item_type === 'ingredient') {
        const { error: safetyError } = await supabase.from('ingredients').update({ safety_stock: number(linkForm.safety_stock) } as any).eq('id', linkForm.item_id).eq('user_id', user.id);
        if (safetyError) throw safetyError;
      }
      setLinkDialog(false); await load(); toast({ title: 'Fornecimento configurado', description: 'A sugestão passará a respeitar embalagem, prazo e preço.' });
    } catch (error: any) { toast({ title: 'Erro ao vincular item', description: error.message, variant: 'destructive' }); } finally { setSaving(false); }
  };

  const openCreateOrder = () => {
    if (!selectedSuggestions.length) return;
    const supplierIds = [...new Set(selectedSuggestions.map((item) => item.supplier_id).filter(Boolean))];
    setOrderSupplierId(supplierIds.length === 1 ? String(supplierIds[0]) : '');
    setOrderDialog(true);
  };

  const createOrder = async () => {
    if (!user?.id || !orderSupplierId || !selectedSuggestions.length) return;
    setSaving(true);
    try {
      const orderNumber = `PC-${format(new Date(), 'yyyyMMdd-HHmmss')}`;
      const items = selectedSuggestions.map((suggestion) => {
        const link = supplierItems.find((row) => row.supplier_id === orderSupplierId && (suggestion.item_type === 'ingredient' ? row.ingredient_id === suggestion.item_id : row.product_id === suggestion.item_id));
        return { suggestion, link, quantity: Math.max(number(suggestion.suggested_purchase_quantity), number(link?.minimum_order_quantity || 1)), unitPrice: number(link?.last_unit_price ?? suggestion.last_unit_price) };
      });
      const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const { data: order, error } = await (supabase as any).from('procurement_orders').insert({ user_id: user.id, supplier_id: orderSupplierId, order_number: orderNumber, expected_date: orderExpectedDate || null, notes: orderNotes || null, subtotal, total_amount: subtotal, created_by: user.id }).select('*').single();
      if (error) throw error;
      const { error: itemError } = await (supabase as any).from('procurement_order_items').insert(items.map(({ suggestion, link, quantity, unitPrice }) => ({ user_id: user.id, order_id: order.id, ingredient_id: suggestion.item_type === 'ingredient' ? suggestion.item_id : null, product_id: suggestion.item_type === 'product' ? suggestion.item_id : null, item_name: suggestion.name, purchase_unit: link?.purchase_unit || suggestion.purchase_unit || 'un', conversion_factor: number(link?.conversion_factor || suggestion.purchase_conversion || 1), ordered_quantity: quantity, unit_price: unitPrice })));
      if (itemError) { await (supabase as any).from('procurement_orders').delete().eq('id', order.id); throw itemError; }
      setOrderDialog(false); setSelected(new Set()); setOrderNotes(''); await load(); toast({ title: `Pedido ${orderNumber} criado`, description: `${items.length} item(ns) preparados para envio.` });
    } catch (error: any) { toast({ title: 'Erro ao criar pedido', description: error.message, variant: 'destructive' }); } finally { setSaving(false); }
  };

  const updateOrderStatus = async (order: PurchaseOrder, status: string) => {
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === 'sent') patch.sent_at = new Date().toISOString();
    if (status === 'cancelled') patch.cancelled_at = new Date().toISOString();
    const { error } = await (supabase as any).from('procurement_orders').update(patch).eq('id', order.id);
    if (error) return toast({ title: 'Erro ao atualizar pedido', description: error.message, variant: 'destructive' });
    await load();
  };

  const openReceive = (order: PurchaseOrder) => {
    setReceipt(Object.fromEntries((order.items || []).filter((item) => item.received_quantity < item.ordered_quantity).map((item) => [item.id, { quantity: item.ordered_quantity - item.received_quantity, batch_code: '', expiration_date: '' }])));
    setReceiveOrder(order);
  };

  const confirmReceipt = async () => {
    if (!receiveOrder) return;
    setSaving(true);
    try {
      const items = Object.entries(receipt).map(([item_id, value]) => ({ item_id, ...value })).filter((item) => number(item.quantity) > 0);
      const { error } = await (supabase as any).rpc('receive_procurement_order', { p_order_id: receiveOrder.id, p_items: items });
      if (error) throw error;
      setReceiveOrder(null); await load(); toast({ title: 'Recebimento concluído', description: 'Estoque, custo, lote e pedido foram atualizados juntos.' });
    } catch (error: any) { toast({ title: 'Erro no recebimento', description: error.message, variant: 'destructive' }); } finally { setSaving(false); }
  };

  const orderText = (order: PurchaseOrder) => [`*Pedido de compra ${order.order_number}*`, `Fornecedor: ${order.supplier?.name || 'Não informado'}`, `Previsão: ${order.expected_date ? format(new Date(`${order.expected_date}T12:00:00`), 'dd/MM/yyyy') : 'A combinar'}`, '', ...(order.items || []).map((item) => `• ${item.item_name}: ${item.ordered_quantity} ${item.purchase_unit.toUpperCase()} × ${money.format(item.unit_price)}`), '', `*Total: ${money.format(order.total_amount)}*`].join('\n');
  const sendWhatsApp = (order: PurchaseOrder) => { const phone = String(order.supplier?.whatsapp || '').replace(/\D/g, ''); window.open(`https://wa.me/${phone.startsWith('55') ? phone : `55${phone}`}?text=${encodeURIComponent(orderText(order))}`, '_blank', 'noopener,noreferrer'); };
  const downloadPdf = async (order: PurchaseOrder) => { const { jsPDF } = await import('jspdf'); const doc = new jsPDF(); doc.setFontSize(17); doc.text('PopSystem · Pedido de compra', 14, 18); doc.setFontSize(11); const lines = doc.splitTextToSize(orderText(order).replace(/\*/g, ''), 180); doc.text(lines, 14, 30); doc.save(`${order.order_number}.pdf`); };

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><RefreshCw className="h-8 w-8 animate-spin text-emerald-700" /></div>;

  return <div className="space-y-6 p-4 md:p-6">
    <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-700 p-6 text-white shadow-xl">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.25em] text-emerald-200">Estoque inteligente</p><h1 className="mt-2 text-3xl font-black">Central de Compras</h1><p className="mt-2 max-w-3xl text-sm text-emerald-100">Planeje, negocie, envie, receba e acompanhe custos e validade em um único fluxo.</p></div><Button variant="secondary" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">{[
        ['Comprar', String(suggestions.length), ShoppingCart], ['Em andamento', String(orders.filter((o) => ['sent','confirmed','partial'].includes(o.status)).length), Truck], ['Fornecedores', String(suppliers.filter((s) => s.active).length), Building2], ['Vencendo', String(number(alerts.expiring_count)), CalendarClock], ['Notas a conferir', String(number(alerts.pending_invoice_count)), AlertTriangle],
      ].map(([label, value, Icon]: any) => <div key={label} className="rounded-2xl bg-white/10 p-3 backdrop-blur"><Icon className="h-4 w-4 text-emerald-200" /><strong className="mt-2 block text-2xl">{value}</strong><span className="text-xs text-emerald-100">{label}</span></div>)}</div>
    </div>

    <Tabs defaultValue="suggestions" className="space-y-4"><TabsList className="h-auto flex-wrap justify-start"><TabsTrigger value="suggestions">Sugestões</TabsTrigger><TabsTrigger value="orders">Pedidos</TabsTrigger><TabsTrigger value="suppliers">Fornecedores</TabsTrigger><TabsTrigger value="expiry">Lotes e validade</TabsTrigger><TabsTrigger value="prices">Histórico de preços</TabsTrigger></TabsList>
      <TabsContent value="suggestions" className="space-y-4">
        {number(alerts.missing_minimum_count)>0&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"/><div><strong>{number(alerts.missing_minimum_count)} insumo(s) sem estoque mínimo</strong><p className="text-sm text-amber-800">Defina os mínimos para o sistema calcular reposições mesmo quando ainda não houver histórico suficiente de consumo.</p></div></div><Button asChild size="sm" variant="outline"><Link to="/estoque">Configurar estoque</Link></Button></div>}
        <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Plano de reposição</CardTitle><CardDescription>Saldo + estoque mínimo + consumo + prazo do fornecedor + estoque de segurança − pedidos em aberto.</CardDescription></div><div className="flex items-center gap-2"><Badge variant="outline">{selected.size} selecionado(s)</Badge><Button disabled={!selected.size} onClick={openCreateOrder}><ShoppingCart className="mr-2 h-4 w-4" />Criar pedido</Button></div></div></CardHeader><CardContent>
          {suggestions.length === 0 ? <div className="rounded-2xl border border-dashed p-10 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" /><p className="mt-3 font-semibold">Estoque coberto</p><p className="text-sm text-slate-500">Configure mínimos e fornecedores para aumentar a precisão.</p></div> : <div className="grid gap-3 lg:grid-cols-2">{suggestions.map((item) => { const key=`${item.item_type}:${item.item_id}`; return <div key={key} className={`rounded-2xl border p-4 ${selected.has(key)?'border-emerald-500 bg-emerald-50/60':'bg-white'}`}><div className="flex items-start gap-3"><Checkbox checked={selected.has(key)} onCheckedChange={(checked)=>setSelected((current)=>{const next=new Set(current); if (checked) next.add(key); else next.delete(key); return next;})}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold text-emerald-950">{item.name}</p><p className="text-xs text-slate-500">{item.reason} · {item.days_remaining==null?'sem consumo médio':`${item.days_remaining} dias de cobertura`}</p></div><Badge variant={item.current_stock<=0?'destructive':'secondary'}>{item.current_stock.toLocaleString('pt-BR')} {item.stock_unit.toUpperCase()}</Badge></div><div className="mt-4 grid grid-cols-3 gap-2 text-xs"><div><span className="block text-slate-500">Comprar</span><strong>{item.suggested_purchase_quantity.toLocaleString('pt-BR')} {item.purchase_unit.toUpperCase()}</strong></div><div><span className="block text-slate-500">Fornecedor</span><strong>{item.supplier_name||'Não definido'}</strong></div><div><span className="block text-slate-500">Estimativa</span><strong>{money.format(number(item.estimated_total))}</strong></div></div>{!item.supplier_id&&<Button size="sm" variant="link" className="mt-2 h-auto p-0 text-amber-700" onClick={()=>{setLinkForm((f)=>({...f,item_type:item.item_type,item_id:item.item_id,purchase_unit:item.purchase_unit,conversion_factor:item.purchase_conversion}));setLinkDialog(true);}}>Configurar fornecedor e embalagem</Button>}</div></div></div>;})}</div>}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="orders" className="space-y-3">{orders.length===0?<Card><CardContent className="p-10 text-center text-slate-500">Nenhum pedido de compra criado.</CardContent></Card>:orders.map((order)=><Card key={order.id}><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2">{order.order_number}<Badge className={statusClass[order.status]}>{statusLabel[order.status]}</Badge></CardTitle><CardDescription>{order.supplier?.name||'Fornecedor não informado'} · criado em {format(new Date(order.created_at),'dd/MM/yyyy HH:mm')}</CardDescription></div><strong className="text-xl text-emerald-900">{money.format(order.total_amount)}</strong></div></CardHeader><CardContent><div className="grid gap-2 md:grid-cols-2">{(order.items||[]).map((item)=><div key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm"><strong>{item.item_name}</strong><span className="block text-xs text-slate-500">Pedido: {item.ordered_quantity} {item.purchase_unit.toUpperCase()} · Recebido: {item.received_quantity}</span></div>)}</div><div className="mt-4 flex flex-wrap gap-2">{order.status==='draft'&&<Button size="sm" onClick={()=>void updateOrderStatus(order,'sent')}><Send className="mr-2 h-4 w-4"/>Marcar enviado</Button>}{!['received','cancelled'].includes(order.status)&&<Button size="sm" variant="outline" onClick={()=>openReceive(order)}><PackageCheck className="mr-2 h-4 w-4"/>Receber</Button>}<Button size="sm" variant="outline" onClick={()=>void downloadPdf(order)}><Download className="mr-2 h-4 w-4"/>PDF</Button>{order.supplier?.whatsapp&&<Button size="sm" variant="outline" onClick={()=>sendWhatsApp(order)}><MessageCircle className="mr-2 h-4 w-4"/>WhatsApp</Button>}{!['received','cancelled'].includes(order.status)&&<Button size="sm" variant="ghost" className="text-red-700" onClick={()=>void updateOrderStatus(order,'cancelled')}>Cancelar</Button>}</div></CardContent></Card>)}</TabsContent>

      <TabsContent value="suppliers" className="space-y-4"><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={()=>setLinkDialog(true)}><Boxes className="mr-2 h-4 w-4"/>Vincular item</Button><Button onClick={()=>setSupplierDialog(true)}><Plus className="mr-2 h-4 w-4"/>Novo fornecedor</Button></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{suppliers.map((supplier)=><Card key={supplier.id}><CardHeader><CardTitle className="flex items-center justify-between"><span>{supplier.name}</span><Badge variant={supplier.active?'default':'secondary'}>{supplier.active?'Ativo':'Inativo'}</Badge></CardTitle><CardDescription>{supplier.document||'Documento não informado'}</CardDescription></CardHeader><CardContent className="space-y-2 text-sm"><p>{supplier.whatsapp||supplier.phone||'Telefone não informado'}</p><p>{supplier.payment_terms||'Condição de pagamento não informada'}</p><div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs"><div><span className="block text-slate-500">Entrega</span><strong>{supplier.average_lead_time_days} dia(s)</strong></div><div><span className="block text-slate-500">Pedido mínimo</span><strong>{money.format(number(supplier.minimum_order_amount))}</strong></div></div><Badge variant="outline">{supplierItems.filter((item)=>item.supplier_id===supplier.id).length} item(ns) vinculado(s)</Badge></CardContent></Card>)}</div></TabsContent>

      <TabsContent value="expiry"><Card><CardHeader><CardTitle>Lotes e validade</CardTitle><CardDescription>Priorize o que vence primeiro e evite perdas.</CardDescription></CardHeader><CardContent>{activeBatches.length===0?<div className="p-8 text-center text-slate-500">Nenhum lote ativo. Informe lote ou validade durante o recebimento.</div>:<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{activeBatches.map((batch)=>{const days=batch.expiration_date?Math.ceil((new Date(`${batch.expiration_date}T12:00:00`).getTime()-Date.now())/86400000):null;return <div key={batch.id} className={`rounded-2xl border p-4 ${days!=null&&days<=7?'border-red-300 bg-red-50':'bg-white'}`}><div className="flex justify-between gap-2"><strong>{batch.ingredient?.name||batch.product?.name}</strong>{days!=null&&<Badge variant={days<=7?'destructive':'secondary'}>{days<0?'Vencido':`${days} dias`}</Badge>}</div><p className="mt-2 text-sm">Lote: {batch.batch_code||'não informado'}</p><p className="text-xs text-slate-500">Validade: {batch.expiration_date?format(new Date(`${batch.expiration_date}T12:00:00`),'dd/MM/yyyy'):'não informada'} · {batch.current_quantity} {batch.unit.toUpperCase()}</p></div>;})}</div>}</CardContent></Card></TabsContent>

      <TabsContent value="prices"><Card><CardHeader><CardTitle>Histórico e comparação de custos</CardTitle><CardDescription>Compare o preço atual entre fornecedores e acompanhe cada variação registrada por nota ou recebimento.</CardDescription></CardHeader><CardContent><div className="space-y-2">{priceComparisons.slice(0,100).map((row)=>{const itemKey=row.ingredient_id||row.product_id||row.item_name;const isBest=currentPriceComparison.currentIds.has(row.id)&&row.unit_price===currentPriceComparison.best.get(itemKey);return <div key={row.id} className="grid gap-2 rounded-xl border p-3 text-sm md:grid-cols-[1fr_180px_160px_130px]"><div><div className="flex flex-wrap items-center gap-2"><strong>{row.item_name}</strong>{isBest&&<Badge className="bg-emerald-100 text-emerald-800">Melhor preço atual</Badge>}</div><span className="block text-xs text-slate-500">{row.supplier?.name||'Fornecedor não identificado'} · {format(new Date(row.recorded_at),"dd/MM/yyyy 'às' HH:mm",{locale:ptBR})}</span></div><span>{row.quantity} {row.purchase_unit.toUpperCase()}</span><strong>{money.format(row.unit_price)}</strong><span className={row.change!=null&&row.change>0?'font-bold text-red-700':'text-emerald-700'}>{row.change==null?'Primeira compra':`${row.change>0?'+':''}${row.change.toFixed(1)}%`}</span></div>;})}</div></CardContent></Card></TabsContent>
    </Tabs>

    <Dialog open={supplierDialog} onOpenChange={setSupplierDialog}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Novo fornecedor</DialogTitle><DialogDescription>Cadastre dados comerciais usados nos pedidos e comparações.</DialogDescription></DialogHeader><div className="grid gap-3 md:grid-cols-2"><div><Label>Nome *</Label><Input value={supplierForm.name} onChange={(e)=>setSupplierForm({...supplierForm,name:e.target.value})}/></div><div><Label>CNPJ/CPF</Label><Input value={supplierForm.document} onChange={(e)=>setSupplierForm({...supplierForm,document:e.target.value})}/></div><div><Label>WhatsApp</Label><Input value={supplierForm.whatsapp} onChange={(e)=>setSupplierForm({...supplierForm,whatsapp:e.target.value})}/></div><div><Label>E-mail</Label><Input value={supplierForm.email} onChange={(e)=>setSupplierForm({...supplierForm,email:e.target.value})}/></div><div><Label>Prazo médio (dias)</Label><Input type="number" min="0" value={supplierForm.average_lead_time_days} onChange={(e)=>setSupplierForm({...supplierForm,average_lead_time_days:number(e.target.value)})}/></div><div><Label>Pedido mínimo</Label><Input type="number" min="0" step="0.01" value={supplierForm.minimum_order_amount} onChange={(e)=>setSupplierForm({...supplierForm,minimum_order_amount:number(e.target.value)})}/></div><div className="md:col-span-2"><Label>Pagamento</Label><Input value={supplierForm.payment_terms} onChange={(e)=>setSupplierForm({...supplierForm,payment_terms:e.target.value})} placeholder="Ex.: boleto 14 dias"/></div><div className="md:col-span-2"><Label>Observações</Label><Textarea value={supplierForm.notes} onChange={(e)=>setSupplierForm({...supplierForm,notes:e.target.value})}/></div></div><DialogFooter><Button variant="outline" onClick={()=>setSupplierDialog(false)}>Cancelar</Button><Button disabled={saving||!supplierForm.name.trim()} onClick={()=>void saveSupplier()}>Salvar fornecedor</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={linkDialog} onOpenChange={setLinkDialog}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Vincular item ao fornecedor</DialogTitle><DialogDescription>Defina embalagem, preço, prazo e estoque de segurança usados no cálculo.</DialogDescription></DialogHeader><div className="grid gap-3 md:grid-cols-2"><div><Label>Fornecedor</Label><Select value={linkForm.supplier_id} onValueChange={(v)=>setLinkForm({...linkForm,supplier_id:v})}><SelectTrigger><SelectValue placeholder="Selecione"/></SelectTrigger><SelectContent>{suppliers.filter((s)=>s.active).map((s)=><SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Tipo</Label><Select value={linkForm.item_type} onValueChange={(v)=>setLinkForm({...linkForm,item_type:v,item_id:'',safety_stock:0})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="ingredient">Insumo</SelectItem><SelectItem value="product">Produto para revenda</SelectItem></SelectContent></Select></div><div className="md:col-span-2"><Label>Item</Label><Select value={linkForm.item_id} onValueChange={(v)=>{const ing=ingredients.find((i)=>i.id===v);setLinkForm({...linkForm,item_id:v,purchase_unit:ing?.purchase_unit||'un',conversion_factor:ing?.purchase_conversion||1,safety_stock:ing?.safety_stock||0});}}><SelectTrigger><SelectValue placeholder="Selecione"/></SelectTrigger><SelectContent>{(linkForm.item_type==='ingredient'?ingredients:products).map((item)=><SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>{[['Unidade compra','purchase_unit'],['Conversão','conversion_factor'],['Pedido mínimo','minimum_order_quantity'],['Múltiplo embalagem','package_multiple'],['Último preço','last_unit_price'],['Prazo (dias)','lead_time_days'],...(linkForm.item_type==='ingredient'?[['Estoque de segurança','safety_stock']]:[])].map(([label,key])=><div key={key}><Label>{label}</Label><Input type={key==='purchase_unit'?'text':'number'} min="0" step="0.001" value={(linkForm as any)[key]} onChange={(e)=>setLinkForm({...linkForm,[key]:key==='purchase_unit'?e.target.value:number(e.target.value)})}/></div>)}<label className="flex items-center gap-2 text-sm"><Checkbox checked={linkForm.preferred} onCheckedChange={(v)=>setLinkForm({...linkForm,preferred:v===true})}/>Fornecedor preferencial</label></div><DialogFooter><Button variant="outline" onClick={()=>setLinkDialog(false)}>Cancelar</Button><Button disabled={saving||!linkForm.supplier_id||!linkForm.item_id} onClick={()=>void saveSupplierItem()}>Salvar vínculo</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={orderDialog} onOpenChange={setOrderDialog}><DialogContent><DialogHeader><DialogTitle>Criar pedido de compra</DialogTitle><DialogDescription>{selectedSuggestions.length} item(ns) · estimativa {money.format(selectedEstimate)}</DialogDescription></DialogHeader><div className="space-y-3"><div><Label>Fornecedor *</Label><Select value={orderSupplierId} onValueChange={setOrderSupplierId}><SelectTrigger><SelectValue placeholder="Selecione"/></SelectTrigger><SelectContent>{suppliers.filter((s)=>s.active).map((s)=><SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Previsão de entrega</Label><Input type="date" value={orderExpectedDate} onChange={(e)=>setOrderExpectedDate(e.target.value)}/></div><div><Label>Observações</Label><Textarea value={orderNotes} onChange={(e)=>setOrderNotes(e.target.value)}/></div></div><DialogFooter><Button variant="outline" onClick={()=>setOrderDialog(false)}>Cancelar</Button><Button disabled={saving||!orderSupplierId} onClick={()=>void createOrder()}>Criar pedido</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(receiveOrder)} onOpenChange={(open)=>!open&&setReceiveOrder(null)}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Receber {receiveOrder?.order_number}</DialogTitle><DialogDescription>Informe o recebido agora. Lote e validade são opcionais, mas recomendados.</DialogDescription></DialogHeader><div className="max-h-[60vh] space-y-3 overflow-y-auto">{(receiveOrder?.items||[]).filter((item)=>item.received_quantity<item.ordered_quantity).map((item)=>{const row=receipt[item.id]||{quantity:0,batch_code:'',expiration_date:''};return <div key={item.id} className="grid gap-2 rounded-xl border p-3 md:grid-cols-[1.4fr_.6fr_1fr_1fr]"><div><strong>{item.item_name}</strong><span className="block text-xs text-slate-500">Falta {item.ordered_quantity-item.received_quantity} {item.purchase_unit.toUpperCase()}</span></div><div><Label>Qtd.</Label><Input type="number" min="0" max={item.ordered_quantity-item.received_quantity} value={row.quantity} onChange={(e)=>setReceipt({...receipt,[item.id]:{...row,quantity:number(e.target.value)}})}/></div><div><Label>Lote</Label><Input value={row.batch_code} onChange={(e)=>setReceipt({...receipt,[item.id]:{...row,batch_code:e.target.value}})}/></div><div><Label>Validade</Label><Input type="date" value={row.expiration_date} onChange={(e)=>setReceipt({...receipt,[item.id]:{...row,expiration_date:e.target.value}})}/></div></div>;})}</div><DialogFooter><Button variant="outline" onClick={()=>setReceiveOrder(null)}>Cancelar</Button><Button disabled={saving} onClick={()=>void confirmReceipt()}><PackageCheck className="mr-2 h-4 w-4"/>Confirmar recebimento</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
