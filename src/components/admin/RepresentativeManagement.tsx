import { useMemo, useState } from 'react';
import { BadgeCheck, ExternalLink, KeyRound, MapPin, PhoneCall, Route, UserPlus, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import type { AdminMember, CommercialLead } from '@/pages/SystemAdminDashboard';

const stageLabels: Record<string, string> = {
  new: 'Novos', contacting: 'Em contato', demo_scheduled: 'Demonstração', proposal: 'Proposta', won: 'Convertidos', lost: 'Perdidos',
};

export default function RepresentativeManagement({ token, members, leads, onRefresh }: {
  token: string;
  members: AdminMember[];
  leads: CommercialLead[];
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const representatives = useMemo(() => members.filter((member) => member.role === 'representative'), [members]);
  const leadsByRepresentative = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((lead) => counts.set(lead.representative_member_id, (counts.get(lead.representative_member_id) || 0) + 1));
    return counts;
  }, [leads]);
  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((lead) => counts.set(lead.commercial_stage, (counts.get(lead.commercial_stage) || 0) + 1));
    return Array.from(counts.entries()).map(([stage, value]) => ({ stage, value })).sort((a, b) => b.value - a.value);
  }, [leads]);
  const maxStage = Math.max(1, ...stageCounts.map((item) => item.value));

  const createRepresentative = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-dashboard', {
        body: { action: 'create_representative', token, name: name.trim(), email: email.trim(), password },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Representante não criado.');
      setName(''); setEmail(''); setPassword('');
      await onRefresh();
      toast.success(data?.linkedExistingAccount
        ? 'Conta existente vinculada. O representante deve usar a senha que já possuía.'
        : 'Representante criado. O acesso já está disponível em /representante.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar o representante.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <Card className="overflow-hidden border-0 shadow-lg shadow-violet-950/5">
        <div className="h-1.5 bg-gradient-to-r from-violet-600 to-orange-500" />
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-100 text-violet-700"><UserPlus className="h-5 w-5" /></div><div><CardTitle>Novo representante</CardTitle><p className="text-sm text-slate-500">Crie um acesso individual para a equipe de campo.</p></div></div><a href="/representante" target="_blank" rel="noreferrer"><Button type="button" size="sm" variant="outline"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Abrir portal</Button></a></div></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={createRepresentative}>
            <div className="space-y-2"><Label htmlFor="new-representative-name">Nome</Label><Input id="new-representative-name" required minLength={2} value={name} onChange={(event) => setName(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="new-representative-email">E-mail de acesso</Label><Input id="new-representative-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="new-representative-password">Senha inicial</Label><div className="relative"><KeyRound className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input id="new-representative-password" className="pl-9" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></div></div>
            <Button className="w-full bg-violet-700 font-bold hover:bg-violet-800" disabled={saving}>{saving ? 'Criando acesso…' : 'Criar representante'}</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-lg shadow-emerald-950/5">
        <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Route className="h-5 w-5 text-orange-600" />Funil de visitas</CardTitle><p className="mt-1 text-sm text-slate-500">Contatos captados em campo e autorizados para relacionamento.</p></div><Badge className="bg-emerald-100 text-emerald-800">{leads.filter((lead) => lead.marketing_consent).length} com marketing autorizado</Badge></div></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-emerald-700 p-4 text-white"><Users className="h-5 w-5 text-emerald-200" /><p className="mt-3 text-3xl font-black">{representatives.length}</p><p className="text-xs font-bold text-emerald-100">Representantes</p></div><div className="rounded-2xl bg-violet-700 p-4 text-white"><Route className="h-5 w-5 text-violet-200" /><p className="mt-3 text-3xl font-black">{leads.length}</p><p className="text-xs font-bold text-violet-100">Leads visitados</p></div><div className="rounded-2xl bg-orange-500 p-4 text-white"><BadgeCheck className="h-5 w-5 text-orange-100" /><p className="mt-3 text-3xl font-black">{leads.filter((lead) => lead.commercial_stage === 'won').length}</p><p className="text-xs font-bold text-orange-50">Convertidos</p></div></div>
          <div className="space-y-3">{stageCounts.map((item, index) => <div key={item.stage}><div className="mb-1.5 flex justify-between text-sm font-semibold"><span>{stageLabels[item.stage] || item.stage}</span><span>{item.value}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${index % 3 === 0 ? 'bg-emerald-500' : index % 3 === 1 ? 'bg-violet-500' : 'bg-orange-500'}`} style={{ width: `${Math.max(8, (item.value / maxStage) * 100)}%` }} /></div></div>)}</div>
          {!stageCounts.length ? <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">Os leads aparecerão aqui após a primeira visita registrada.</div> : null}
          <div className="grid gap-2 sm:grid-cols-2">{representatives.map((member) => <div key={member.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><strong className="block text-sm">{member.display_name}</strong><span className="text-xs text-slate-500">{member.email}</span><p className="mt-2 text-xs font-bold text-violet-700"><MapPin className="mr-1 inline h-3 w-3" />{leadsByRepresentative.get(member.id) || 0} contato(s)</p></div>)}</div>
          {leads.length ? <div className="space-y-2 border-t border-slate-100 pt-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Contatos mais recentes</p>{leads.slice(0, 6).map((lead) => <div key={lead.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><div><strong className="block text-sm">{lead.restaurant_name}</strong><span className="text-xs text-slate-500">{lead.city}/{lead.state} · {lead.internal_admin_members?.display_name || 'Representante'}</span></div><a href={`https://wa.me/${lead.owner_phone}`} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="border-emerald-200 text-emerald-800"><PhoneCall className="mr-1.5 h-3.5 w-3.5" />WhatsApp</Button></a></div>)}</div> : null}
        </CardContent>
      </Card>
    </section>
  );
}
