import { useDeferredValue, useMemo, useState } from 'react';
import { CalendarClock, Download, ExternalLink, Search, UserRoundCog } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import type { AdminClientRow } from '@/pages/SystemAdminDashboard';
import { filterInternalClients } from '@/lib/internalCustomerOperations';

type AdminMember = { id: string; email: string; display_name: string; role: string };
type DetailData = {
  notes: Array<{ id: string; category: string; content: string; created_by_email: string; created_at: string }>;
  tasks: Array<{ id: string; title: string; type: string; priority: string; status: string; due_at?: string | null; created_at: string }>;
  tickets: Array<{ id: string; subject: string; priority: string; status: string; created_at: string }>;
  invoices: Array<{ id: string; status: string; amount: number; due_date?: string | null; paid_at?: string | null; billing_type?: string | null; invoice_url?: string | null }>;
  accessEvents: Array<{ id: string; event_type: string; actor?: string | null; created_at: string }>;
  activity: Array<{ event_type: string; source: string; occurred_at: string }>;
  audit: Array<{ id: string; action: string; actor_email: string; created_at: string }>;
};

const money = (value?: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const date = (value?: string | null) => value ? new Date(value).toLocaleString('pt-BR') : 'Sem registro';
const labels: Record<string, string> = {
  paid: 'Pago', paid_period: 'Período pago', pending: 'Pendente', overdue: 'Vencido', refunded: 'Estornado', chargeback: 'Chargeback', unknown: 'Sem cobrança',
  healthy: 'Saudável', attention: 'Atenção', risk: 'Risco', critical: 'Crítico', allowed: 'Liberado', temporary_release: 'Cortesia', blocked: 'Bloqueado',
};

function tone(value?: string) {
  if (['paid', 'paid_period', 'healthy', 'allowed', 'done'].includes(String(value))) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (['pending', 'attention', 'temporary_release', 'in_progress'].includes(String(value))) return 'border-amber-200 bg-amber-50 text-amber-800';
  if (['overdue', 'chargeback', 'risk', 'critical', 'blocked'].includes(String(value))) return 'border-red-200 bg-red-50 text-red-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export default function ClientOperationsWorkspace({ token, clients, members, onRefresh, onRelease24h }: {
  token: string;
  clients: AdminClientRow[];
  members: AdminMember[];
  onRefresh: () => Promise<void>;
  onRelease24h: (client: AdminClientRow) => void;
}) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [financialFilter, setFinancialFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const [selected, setSelected] = useState<AdminClientRow | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState('');
  const [noteCategory, setNoteCategory] = useState('general');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskPriority, setTaskPriority] = useState('normal');
  const [saving, setSaving] = useState(false);

  const visible = useMemo(() => filterInternalClients(clients, {
    search: deferredSearch,
    financial: financialFilter,
    health: healthFilter,
    access: accessFilter,
  }), [accessFilter, clients, deferredSearch, financialFilter, healthFilter]);

  const invoke = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('admin-dashboard', { body: { ...body, token } });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Operação não concluída.');
    return data;
  };

  const loadDetail = async (client: AdminClientRow) => {
    setSelected(client);
    setDetail(null);
    setDetailLoading(true);
    try {
      const response = await invoke({ action: 'get_client_detail', restaurantId: client.id });
      setDetail(response.detail as DetailData);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível abrir o cliente.');
    } finally {
      setDetailLoading(false);
    }
  };

  const reloadSelected = async () => {
    if (selected) await loadDetail(selected);
    await onRefresh();
  };

  const addNote = async () => {
    if (!selected || !note.trim()) return;
    setSaving(true);
    try {
      await invoke({ action: 'add_client_note', restaurantId: selected.id, content: note.trim(), category: noteCategory });
      setNote('');
      await reloadSelected();
      toast.success('Nota interna registrada.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Nota não salva.'); }
    finally { setSaving(false); }
  };

  const createTask = async () => {
    if (!selected || !taskTitle.trim()) return;
    setSaving(true);
    try {
      await invoke({ action: 'create_client_task', restaurantId: selected.id, title: taskTitle.trim(), priority: taskPriority, dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : null });
      setTaskTitle(''); setTaskDueAt('');
      await reloadSelected();
      toast.success('Tarefa criada.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Tarefa não criada.'); }
    finally { setSaving(false); }
  };

  const updateTask = async (taskId: string, status: string) => {
    try { await invoke({ action: 'update_client_task', taskId, status }); await reloadSelected(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Tarefa não atualizada.'); }
  };

  const assignOwner = async (ownerMemberId: string) => {
    if (!selected) return;
    try {
      await invoke({ action: 'assign_client', restaurantId: selected.id, ownerMemberId, commercialStage: selected.commercialStage, onboardingStage: selected.onboardingStage, priority: selected.priority });
      await onRefresh();
      toast.success('Responsável atualizado.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Responsável não atualizado.'); }
  };

  const exportPortfolio = () => {
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [['Restaurante', 'Email', 'Telefone', 'Financeiro', 'Acesso', 'Saude', 'Score', 'Plano', 'Valor', 'Pedidos', 'Responsavel'], ...visible.map((client) => [client.restaurantName, client.email, client.phone, client.financialStatus, client.accessStatus, client.healthClassification, client.healthScore, client.planName, client.billingAmount, client.ordersMonth, client.ownerName])];
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(escape).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `carteira-popsystem-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="rounded-lg border-slate-200 shadow-sm">
      <CardHeader className="gap-4 border-b border-slate-100 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><UserRoundCog className="h-5 w-5 text-emerald-700" />Carteira operacional</CardTitle><p className="mt-1 text-sm text-slate-500">Todos os clientes, priorizados por risco real e situação financeira.</p></div><Button type="button" variant="outline" onClick={exportPortfolio}><Download className="mr-2 h-4 w-4" />Exportar CSV</Button></div>
        <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_180px_160px_160px]">
          <label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Nome, e-mail, telefone, cidade..." /></label>
          <select value={financialFilter} onChange={(event) => setFinancialFilter(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm"><option value="all">Todos os pagamentos</option><option value="paid">Pagos</option><option value="pending">Pendentes</option><option value="overdue">Vencidos</option><option value="chargeback">Chargeback</option></select>
          <select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm"><option value="all">Toda saúde</option><option value="healthy">Saudável</option><option value="attention">Atenção</option><option value="risk">Risco</option><option value="critical">Crítico</option></select>
          <select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm"><option value="all">Todo acesso</option><option value="allowed">Liberado</option><option value="temporary_release">Cortesia</option><option value="blocked">Bloqueado</option></select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[720px] overflow-auto [content-visibility:auto]">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="sticky top-0 z-10 border-b bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Cliente</th><th>Financeiro</th><th>Acesso</th><th>Saúde</th><th>Plano/valor</th><th>Uso</th><th>Responsável</th><th>Próxima ação</th><th className="pr-3 text-right">Ação</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{visible.map((client) => <tr key={client.id} className="hover:bg-slate-50">
              <td className="p-3"><button type="button" onClick={() => void loadDetail(client)} className="text-left"><strong className="block text-slate-950">{client.restaurantName}</strong><span className="text-xs text-slate-500">{client.email || client.phone || 'Sem contato'} · {client.city}/{client.state}</span></button></td>
              <td><Badge variant="outline" className={tone(client.financialStatus)}>{labels[client.financialStatus || 'unknown'] || client.financialStatus}{client.overdueDays ? ` · ${client.overdueDays}d` : ''}</Badge></td>
              <td><Badge variant="outline" className={tone(client.accessStatus)}>{labels[client.accessStatus || ''] || client.accessStatus}</Badge></td>
              <td><div className="flex items-center gap-2"><span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-black ${tone(client.healthClassification)}`}>{client.healthScore}</span><span>{labels[client.healthClassification || ''] || '-'}</span></div></td>
              <td><strong>{client.planName}</strong><span className="block text-xs text-slate-500">{money(client.billingAmount)}/contrato</span></td>
              <td><span>{client.ordersMonth || 0} pedidos</span><span className="block text-xs text-slate-500">Último acesso: {date(client.lastAccessAt)}</span></td>
              <td>{client.ownerName || 'Não atribuído'}</td><td>{client.nextAction || '—'}{client.nextActionAt ? <span className="block text-xs text-slate-500">{date(client.nextActionAt)}</span> : null}</td>
              <td className="pr-3 text-right"><Button size="sm" variant="outline" onClick={() => void loadDetail(client)}>Abrir 360°</Button></td>
            </tr>)}</tbody>
          </table>
          {!visible.length ? <p className="p-8 text-center text-sm text-slate-500">Nenhum cliente corresponde aos filtros.</p> : null}
        </div>
      </CardContent>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) { setSelected(null); setDetail(null); } }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle>{selected?.restaurantName}</DialogTitle><DialogDescription>Visão 360° financeira, operacional e de relacionamento.</DialogDescription></DialogHeader>
          {detailLoading || !selected ? <div className="p-12 text-center text-sm text-slate-500">Carregando dados do cliente...</div> : <Tabs defaultValue="overview">
            <TabsList className="grid h-auto grid-cols-3 md:grid-cols-6"><TabsTrigger value="overview">Resumo</TabsTrigger><TabsTrigger value="billing">Financeiro</TabsTrigger><TabsTrigger value="tasks">Tarefas</TabsTrigger><TabsTrigger value="support">Suporte</TabsTrigger><TabsTrigger value="activity">Atividade</TabsTrigger><TabsTrigger value="audit">Auditoria</TabsTrigger></TabsList>
            <TabsContent value="overview" className="space-y-4"><div className="grid gap-3 md:grid-cols-4">{[["Saúde", `${selected.healthScore} · ${labels[selected.healthClassification || ''] || '-'}`],["Financeiro", labels[selected.financialStatus || 'unknown']],["Acesso", labels[selected.accessStatus || '']],["Pedidos no mês", String(selected.ordersMonth || 0)]].map(([label,value]) => <div key={label} className="rounded-lg border p-3"><span className="text-xs font-semibold uppercase text-slate-500">{label}</span><strong className="mt-1 block">{value}</strong></div>)}</div><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2 rounded-lg border p-4"><Label>Responsável interno</Label><select value={members.find((member) => member.email === selected.ownerEmail)?.id || ''} onChange={(event) => void assignOwner(event.target.value)} className="h-10 w-full rounded-md border bg-white px-3"><option value="">Não atribuído</option>{members.map((member) => <option key={member.id} value={member.id}>{member.display_name} · {member.role}</option>)}</select><p className="text-xs text-slate-500">{selected.email}<br />{selected.phone}<br />{selected.address}</p></div><div className="rounded-lg border p-4"><Label>Nota interna</Label><div className="mt-2 flex gap-2"><select value={noteCategory} onChange={(event) => setNoteCategory(event.target.value)} className="rounded-md border bg-white px-2 text-sm"><option value="general">Geral</option><option value="financial">Financeiro</option><option value="success">Sucesso</option><option value="support">Suporte</option><option value="technical">Técnico</option></select><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Registre contexto para a equipe" /></div><Button className="mt-2" disabled={saving || !note.trim()} onClick={() => void addNote()}>Salvar nota</Button></div></div><div className="space-y-2">{detail?.notes.map((item) => <div key={item.id} className="rounded-lg bg-amber-50 p-3 text-sm"><Badge variant="outline">{item.category}</Badge><p className="mt-2">{item.content}</p><span className="text-xs text-slate-500">{item.created_by_email} · {date(item.created_at)}</span></div>)}</div></TabsContent>
            <TabsContent value="billing" className="space-y-3"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => onRelease24h(selected)} disabled={selected.accessAllowed}><CalendarClock className="mr-2 h-4 w-4" />Liberar 24h</Button>{selected.latestInvoice?.invoice_url ? <a href={selected.latestInvoice.invoice_url} target="_blank" rel="noreferrer"><Button><ExternalLink className="mr-2 h-4 w-4" />Abrir cobrança</Button></a> : null}</div>{detail?.invoices.length ? detail.invoices.map((invoice) => <div key={invoice.id} className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-5"><strong>{money(invoice.amount)}</strong><Badge variant="outline" className={tone(invoice.status)}>{invoice.status}</Badge><span>Vence: {date(invoice.due_date)}</span><span>Pago: {date(invoice.paid_at)}</span>{invoice.invoice_url ? <a className="text-emerald-700 underline" href={invoice.invoice_url} target="_blank" rel="noreferrer">Cobrança</a> : <span />}</div>) : <p className="rounded-lg border border-dashed p-5 text-sm text-slate-500">As faturas aparecerão conforme os webhooks do Asaas forem normalizados.</p>}</TabsContent>
            <TabsContent value="tasks" className="space-y-3"><div className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_160px_220px_auto]"><Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Nova tarefa" /><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)} className="rounded-md border bg-white px-2"><option value="normal">Normal</option><option value="high">Alta</option><option value="critical">Crítica</option></select><Input type="datetime-local" value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} /><Button disabled={saving || !taskTitle.trim()} onClick={() => void createTask()}>Criar</Button></div>{detail?.tasks.map((task) => <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><strong>{task.title}</strong><p className="text-xs text-slate-500">{task.type} · prazo {date(task.due_at)}</p></div><select value={task.status} onChange={(event) => void updateTask(task.id, event.target.value)} className="h-9 rounded-md border bg-white px-2 text-sm"><option value="open">Aberta</option><option value="in_progress">Em andamento</option><option value="done">Concluída</option><option value="cancelled">Cancelada</option></select></div>)}</TabsContent>
            <TabsContent value="support" className="space-y-2">{detail?.tickets.length ? detail.tickets.map((ticket) => <div key={ticket.id} className="flex items-center justify-between rounded-lg border p-3"><div><strong>{ticket.subject}</strong><p className="text-xs text-slate-500">{date(ticket.created_at)}</p></div><Badge className={tone(ticket.status)}>{ticket.priority} · {ticket.status}</Badge></div>) : <p className="p-5 text-sm text-slate-500">Nenhum chamado registrado.</p>}</TabsContent>
            <TabsContent value="activity" className="space-y-2">{detail?.activity.length ? detail.activity.map((item, index) => <div key={`${item.occurred_at}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm"><span>{item.event_type} · {item.source}</span><span className="text-slate-500">{date(item.occurred_at)}</span></div>) : <p className="p-5 text-sm text-slate-500">A telemetria real começará a preencher esta área após a publicação.</p>}</TabsContent>
            <TabsContent value="audit" className="space-y-2">{[...(detail?.audit || []), ...(detail?.accessEvents || [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((item) => <div key={`${item.id}-${'action' in item ? item.action : item.event_type}`} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>{'action' in item ? item.action : item.event_type}</span><span className="text-slate-500">{'actor_email' in item ? item.actor_email : item.actor || 'sistema'} · {date(item.created_at)}</span></div>)}</TabsContent>
          </Tabs>}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
