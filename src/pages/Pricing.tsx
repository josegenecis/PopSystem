import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check, ChevronLeft, Clock3, Pencil, Plus, ShieldCheck, Tags, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

type PriceTable = {
  id: string;
  name: string;
  kind: 'promotion' | 'happy_hour' | 'channel' | 'custom';
  channel: string;
  channels?: string[] | null;
  active: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  start_time: string | null;
  end_time: string | null;
  days_of_week: number[] | null;
  item_count?: number;
};

type PriceTableItem = {
  id: string;
  product_id: string | null;
  category_id: string | null;
  adjustment_type: string;
  adjustment_value: number;
};

type Product = { id: string; name: string; price: number; category_id: string | null };
type Category = { id: string; name: string };

const kindLabels: Record<string, string> = {
  promotion: 'Promoção', happy_hour: 'Happy hour', channel: 'Canal de venda', custom: 'Personalizada',
};
const channelLabels: Record<string, string> = {
  all: 'Todos os canais', pdv: 'PDV', delivery: 'Cardápio digital', waiter: 'App Garçom', totem: 'Totem', whatsapp: 'WhatsApp', dine_in: 'Consumo local', pickup: 'Retirada',
};
const channelOptions = ['pdv', 'delivery', 'waiter', 'totem', 'whatsapp'] as const;
const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const tableChannels = (table: PriceTable) => table.channels?.length ? table.channels : [table.channel || 'all'];
const toDateTimeLocal = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function Pricing() {
  const { user, session } = useAuth();
  const userId = user?.id || session?.user?.id || '';
  const { toast } = useToast();
  const [tables, setTables] = useState<PriceTable[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('tables');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PriceTable['kind']>('promotion');
  const [channels, setChannels] = useState<string[]>(['pdv']);
  const [priority, setPriority] = useState('100');
  const [targetType, setTargetType] = useState<'product' | 'category' | 'all'>('product');
  const [targetId, setTargetId] = useState('');
  const [adjustmentType, setAdjustmentType] = useState('percentage_discount');
  const [value, setValue] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [days, setDays] = useState<number[]>([]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [tablesResult, productsResult, categoriesResult, itemsResult] = await Promise.all([
      (supabase as any).from('price_tables').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      (supabase as any).from('products').select('id,name,price,category_id').eq('user_id', userId).order('name'),
      (supabase as any).from('product_categories').select('id,name').eq('user_id', userId).order('name'),
      (supabase as any).from('price_table_items').select('price_table_id').eq('user_id', userId),
    ]);
    const counts = new Map<string, number>();
    for (const item of itemsResult.data || []) counts.set(item.price_table_id, (counts.get(item.price_table_id) || 0) + 1);
    setTables((tablesResult.data || []).map((table: PriceTable) => ({ ...table, item_count: counts.get(table.id) || 0 })));
    setProducts(productsResult.data || []);
    setCategories(categoriesResult.data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const activeCount = useMemo(() => tables.filter((table) => table.active).length, [tables]);
  const scheduledCount = useMemo(() => tables.filter((table) => table.starts_at || table.start_time).length, [tables]);

  const resetForm = () => {
    setEditingId(null);
    setEditingItemId(null);
    setName('');
    setKind('promotion');
    setChannels(['pdv']);
    setPriority('100');
    setTargetType('product');
    setTargetId('');
    setAdjustmentType('percentage_discount');
    setValue('');
    setStartsAt('');
    setEndsAt('');
    setStartTime('');
    setEndTime('');
    setDays([]);
  };

  const openEdit = async (table: PriceTable) => {
    const { data: item, error } = await (supabase as any)
      .from('price_table_items')
      .select('id,product_id,category_id,adjustment_type,adjustment_value')
      .eq('price_table_id', table.id)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !item) {
      toast({ title: 'Não foi possível editar', description: error?.message || 'A regra de preço não foi encontrada.', variant: 'destructive' });
      return;
    }

    const rule = item as PriceTableItem;
    setEditingId(table.id);
    setEditingItemId(rule.id);
    setName(table.name);
    setKind(table.kind);
    setChannels(tableChannels(table));
    setPriority(String(table.priority));
    if (rule.product_id) {
      setTargetType('product');
      setTargetId(rule.product_id);
    } else if (rule.category_id) {
      setTargetType('category');
      setTargetId(rule.category_id);
    } else {
      setTargetType('all');
      setTargetId('');
    }
    setAdjustmentType(rule.adjustment_type);
    setValue(String(rule.adjustment_value).replace('.', ','));
    setStartsAt(toDateTimeLocal(table.starts_at));
    setEndsAt(toDateTimeLocal(table.ends_at));
    setStartTime(table.start_time?.slice(0, 5) || '');
    setEndTime(table.end_time?.slice(0, 5) || '');
    setDays(table.days_of_week || []);
    setActiveTab('new');
  };

  const saveTable = async () => {
    const numericValue = Number(String(value).replace(',', '.'));
    const numericPriority = Number(priority);
    if (!name.trim() || channels.length === 0 || (targetType !== 'all' && !targetId) || !Number.isFinite(numericValue) || numericValue < 0 || (adjustmentType === 'percentage_discount' && numericValue > 100) || !Number.isInteger(numericPriority) || numericPriority < 0 || numericPriority > 10000) {
      toast({ title: 'Revise os dados', description: 'Informe nome, canais, produto/categoria e um valor válido.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const normalizedChannels = channels.includes('all') ? ['all'] : channels;
    const legacyChannel = normalizedChannels.length === 1 && normalizedChannels[0] !== 'waiter'
      ? normalizedChannels[0]
      : 'all';
    const tablePayload = {
      user_id: userId,
      name: name.trim(),
      kind,
      channel: legacyChannel,
      channels: normalizedChannels,
      priority: numericPriority,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      start_time: startTime || null,
      end_time: endTime || null,
      days_of_week: days.length ? days : null,
    };
    const itemPayload = {
      user_id: userId,
      product_id: targetType === 'product' ? targetId : null,
      category_id: targetType === 'category' ? targetId : null,
      adjustment_type: adjustmentType,
      adjustment_value: numericValue,
    };

    let table: PriceTable | null = null;
    let error: any = null;
    if (editingId) {
      const result = await (supabase as any).from('price_tables').update(tablePayload).eq('id', editingId).eq('user_id', userId).select('*').single();
      table = result.data;
      error = result.error;
    } else {
      const result = await (supabase as any).from('price_tables').insert({ ...tablePayload, active: false, created_by: userId }).select('*').single();
      table = result.data;
      error = result.error;
    }
    if (error || !table) {
      setSaving(false);
      toast({ title: editingId ? 'Não foi possível salvar' : 'Não foi possível criar', description: error?.message || 'Tente novamente.', variant: 'destructive' });
      return;
    }

    const itemResult = editingId && editingItemId
      ? await (supabase as any).from('price_table_items').update(itemPayload).eq('id', editingItemId).eq('price_table_id', editingId).eq('user_id', userId)
      : await (supabase as any).from('price_table_items').insert({ ...itemPayload, price_table_id: table.id });
    const itemError = itemResult.error;
    if (itemError) {
      if (!editingId) await (supabase as any).from('price_tables').delete().eq('id', table.id);
      setSaving(false);
      toast({ title: 'Não foi possível salvar a regra', description: itemError.message, variant: 'destructive' });
      return;
    }
    await (supabase as any).from('price_change_audit').insert({ user_id: userId, actor_id: userId, entity_type: 'price_table', entity_id: table.id, action: editingId ? 'updated' : 'created', after_data: { ...table, rule: itemPayload } });
    const wasEditing = Boolean(editingId);
    resetForm();
    setActiveTab('tables');
    setSaving(false);
    toast({ title: wasEditing ? 'Regra atualizada' : 'Tabela criada com segurança', description: wasEditing ? 'Os novos dados já serão usados nos canais selecionados.' : 'Ela permanece inativa até você revisar e ativar.' });
    await load();
  };

  const toggleTable = async (table: PriceTable) => {
    const { error } = await (supabase as any).from('price_tables').update({ active: !table.active }).eq('id', table.id).eq('user_id', userId);
    if (error) {
      toast({ title: 'Não foi possível alterar', description: error.message, variant: 'destructive' });
      return;
    }
    await (supabase as any).from('price_change_audit').insert({ user_id: userId, actor_id: userId, entity_type: 'price_table', entity_id: table.id, action: table.active ? 'deactivated' : 'activated', before_data: table, after_data: { ...table, active: !table.active } });
    setTables((current) => current.map((item) => item.id === table.id ? { ...item, active: !item.active } : item));
    toast({ title: table.active ? 'Tabela pausada' : 'Tabela ativada', description: table.active ? 'O preço base voltou a valer.' : 'As regras passam a valer somente no período e canal configurados.' });
  };

  return (
    <div className="space-y-5 pb-10">
      <section className="overflow-hidden rounded-[28px] bg-[#003D2B] px-6 py-7 text-white shadow-sm">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div>
            <Link to="/produtos" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-white/70 hover:text-white"><ChevronLeft className="h-4 w-4" /> Produtos</Link>
            <div className="flex items-center gap-3"><div className="rounded-2xl bg-white/10 p-3"><Tags className="h-6 w-6 text-[#95D236]" /></div><div><h1 className="text-3xl font-black tracking-tight">Preços e promoções</h1><p className="mt-1 text-white/70">Tabelas, happy hour e campanhas agendadas sem alterar o preço-base.</p></div></div>
          </div>
          <Badge className="w-fit border-white/15 bg-white/10 px-4 py-2 text-white hover:bg-white/10"><ShieldCheck className="mr-2 h-4 w-4 text-[#95D236]" /> Histórico de vendas protegido</Badge>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl border-[#003D2B]/10"><CardContent className="flex items-center gap-4 p-5"><div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Zap /></div><div><p className="text-sm text-muted-foreground">Ativas agora</p><p className="text-2xl font-black text-[#003D2B]">{activeCount}</p></div></CardContent></Card>
        <Card className="rounded-2xl border-[#003D2B]/10"><CardContent className="flex items-center gap-4 p-5"><div className="rounded-xl bg-orange-50 p-3 text-orange-600"><CalendarClock /></div><div><p className="text-sm text-muted-foreground">Agendadas</p><p className="text-2xl font-black text-[#003D2B]">{scheduledCount}</p></div></CardContent></Card>
        <Card className="rounded-2xl border-[#003D2B]/10"><CardContent className="flex items-center gap-4 p-5"><div className="rounded-xl bg-slate-100 p-3 text-slate-600"><Tags /></div><div><p className="text-sm text-muted-foreground">Tabelas criadas</p><p className="text-2xl font-black text-[#003D2B]">{tables.length}</p></div></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={(next) => { setActiveTab(next); if (next === 'tables' && editingId) resetForm(); }} className="space-y-4">
        <TabsList className="h-12 rounded-2xl bg-[#EEECE6] p-1"><TabsTrigger value="tables" className="rounded-xl px-6">Tabelas</TabsTrigger><TabsTrigger value="new" className="rounded-xl px-6">{editingId ? 'Editar regra' : 'Criar regra'}</TabsTrigger></TabsList>
        <TabsContent value="tables" className="space-y-3">
          {loading ? <Card className="rounded-2xl"><CardContent className="p-8 text-center text-muted-foreground">Carregando tabelas…</CardContent></Card> : tables.length === 0 ? (
            <Card className="rounded-2xl border-dashed"><CardContent className="flex flex-col items-center p-10 text-center"><Clock3 className="mb-3 h-9 w-9 text-[#8CC850]" /><h2 className="text-xl font-bold text-[#003D2B]">Seu preço atual continua valendo</h2><p className="mt-1 max-w-lg text-muted-foreground">Crie uma promoção somente quando precisar. Nada é ativado automaticamente.</p></CardContent></Card>
          ) : tables.map((table) => (
            <Card key={table.id} className="rounded-2xl border-[#003D2B]/10"><CardContent className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-[#003D2B]">{table.name}</h3><Badge variant="outline">{kindLabels[table.kind]}</Badge>{tableChannels(table).map((item) => <Badge key={item} variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">{channelLabels[item] || item}</Badge>)}</div><p className="mt-2 text-sm text-muted-foreground">{table.item_count} regra(s){table.start_time ? ` • ${table.start_time.slice(0,5)}–${table.end_time?.slice(0,5)}` : ''}{table.days_of_week?.length ? ` • ${table.days_of_week.map((d) => dayLabels[d]).join(', ')}` : ''}</p></div><div className="flex items-center gap-3"><Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void openEdit(table)}><Pencil className="mr-2 h-4 w-4" />Editar</Button><span className={`text-sm font-semibold ${table.active ? 'text-emerald-700' : 'text-muted-foreground'}`}>{table.active ? 'Ativa' : 'Pausada'}</span><Switch checked={table.active} onCheckedChange={() => void toggleTable(table)} /></div></CardContent></Card>
          ))}
        </TabsContent>
        <TabsContent value="new">
          <Card className="rounded-[24px] border-[#003D2B]/10"><CardContent className="space-y-6 p-6"><div><h2 className="text-xl font-black text-[#003D2B]">{editingId ? 'Editar regra de preço' : 'Nova tabela de preço'}</h2><p className="text-sm text-muted-foreground">{editingId ? 'Altere os dados e salve sem precisar recriar a promoção.' : 'Ela será criada pausada para você revisar antes de aplicar.'}</p></div>
            <div className="grid gap-4 md:grid-cols-4"><div className="space-y-2 md:col-span-2"><Label>Nome da tabela</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Happy hour de sexta" /></div><div className="space-y-2"><Label>Tipo</Label><Select value={kind} onValueChange={(v) => setKind(v as PriceTable['kind'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(kindLabels).map(([key,label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Prioridade</Label><Input type="number" min="0" max="10000" value={priority} onChange={(e) => setPriority(e.target.value)} /><p className="text-xs text-muted-foreground">Maior vence em caso de conflito.</p></div></div>
            <div className="space-y-3 rounded-2xl border border-[#003D2B]/10 bg-[#F7FAF7] p-4"><div><Label className="text-base font-bold text-[#003D2B]">Onde esta promoção será aplicada?</Label><p className="mt-1 text-sm text-muted-foreground">Você pode escolher um ou vários canais. Ex.: somente PDV, ou Cardápio digital + PDV + App Garçom.</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant={channels.includes('all') ? 'default' : 'outline'} className={channels.includes('all') ? 'bg-[#003D2B] hover:bg-[#003D2B]/90' : ''} onClick={() => setChannels(['all'])}>{channels.includes('all') && <Check className="mr-2 h-4 w-4" />}Todos os canais</Button>{channelOptions.map((item) => { const selected = channels.includes(item); return <Button key={item} type="button" variant={selected ? 'default' : 'outline'} className={selected ? 'bg-[#003D2B] hover:bg-[#003D2B]/90' : ''} onClick={() => setChannels((current) => { const withoutAll = current.filter((value) => value !== 'all'); if (withoutAll.includes(item)) return withoutAll.length > 1 ? withoutAll.filter((value) => value !== item) : withoutAll; return [...withoutAll, item]; })}>{selected && <Check className="mr-2 h-4 w-4" />}{channelLabels[item]}</Button>; })}</div></div>
            <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label>Aplicar em</Label><Select value={targetType} onValueChange={(v) => { setTargetType(v as 'product' | 'category' | 'all'); setTargetId(''); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="product">Um produto</SelectItem><SelectItem value="category">Categoria inteira</SelectItem><SelectItem value="all">Todos os produtos</SelectItem></SelectContent></Select></div>{targetType === 'all' ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><strong>Catálogo completo</strong><br />Inclui também os produtos criados futuramente.</div> : <div className="space-y-2"><Label>{targetType === 'product' ? 'Produto' : 'Categoria'}</Label><Select value={targetId} onValueChange={setTargetId}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{(targetType === 'product' ? products : categories).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{'price' in item ? ` • R$ ${Number(item.price).toFixed(2)}` : ''}</SelectItem>)}</SelectContent></Select></div>}</div>
            <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label>Regra de preço</Label><Select value={adjustmentType} onValueChange={setAdjustmentType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percentage_discount">Desconto percentual</SelectItem><SelectItem value="fixed_price">Preço fixo</SelectItem><SelectItem value="amount_discount">Desconto em reais</SelectItem><SelectItem value="percentage_markup">Acréscimo percentual</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>{adjustmentType.includes('percentage') ? 'Percentual (%)' : 'Valor (R$)'}</Label><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" /></div></div>
            <div className="rounded-2xl border border-[#003D2B]/10 bg-[#F7FAF7] p-4"><h3 className="mb-4 font-bold text-[#003D2B]">Agendamento opcional</h3><div className="grid gap-4 md:grid-cols-4"><div className="space-y-2"><Label>Começa em</Label><Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div><div className="space-y-2"><Label>Termina em</Label><Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div><div className="space-y-2"><Label>Horário inicial</Label><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div><div className="space-y-2"><Label>Horário final</Label><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div></div><div className="mt-4 flex flex-wrap gap-2">{dayLabels.map((label, day) => <Button key={label} type="button" size="sm" variant={days.includes(day) ? 'default' : 'outline'} className={days.includes(day) ? 'bg-[#003D2B] hover:bg-[#003D2B]/90' : ''} onClick={() => setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])}>{label}</Button>)}</div></div>
            <div className="flex justify-end gap-2">{editingId && <Button type="button" variant="outline" className="h-11 rounded-xl px-6" disabled={saving} onClick={() => { resetForm(); setActiveTab('tables'); }}>Cancelar</Button>}<Button disabled={saving} onClick={() => void saveTable()} className="h-11 rounded-xl bg-[#8CC850] px-6 font-bold hover:bg-[#79B541]">{editingId ? <Pencil className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}{saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Criar tabela pausada'}</Button></div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
