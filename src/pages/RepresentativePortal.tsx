import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ClipboardPlus,
  LogOut,
  MapPin,
  RefreshCw,
  Route,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { formatOwnerPhoneInput, normalizeOwnerPhone } from '@/schemas/authSchemas';

type Representative = { id: string; email: string; display_name: string };
type CommercialLead = {
  id: string;
  restaurant_name: string;
  owner_name: string;
  owner_phone: string;
  email?: string | null;
  postal_code: string;
  city: string;
  state: string;
  interest_level: string;
  commercial_stage: string;
  marketing_consent: boolean;
  last_visit_at: string;
};
type RepresentativeVisit = { id: string; lead_id: string; visited_at: string; outcome: string; notes?: string | null };
type PostalLocation = { postalCode: string; city: string; state: string; neighborhood?: string; street?: string };

const initialForm = {
  restaurantName: '', ownerName: '', ownerPhone: '', email: '', postalCode: '',
  streetNumber: '', complement: '', notes: '', interestLevel: 'warm', outcome: 'registered', marketingConsent: false,
};

const stageLabels: Record<string, string> = {
  new: 'Novo', contacting: 'Em contato', demo_scheduled: 'Demonstração', proposal: 'Proposta', won: 'Convertido', lost: 'Perdido',
};
const interestLabels: Record<string, string> = { cold: 'Baixo', warm: 'Médio', hot: 'Alto' };
const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export default function RepresentativePortal() {
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [representative, setRepresentative] = useState<Representative | null>(null);
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [visits, setVisits] = useState<RepresentativeVisit[]>([]);
  const [form, setForm] = useState(initialForm);
  const [location, setLocation] = useState<PostalLocation | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lookingUpPostalCode, setLookingUpPostalCode] = useState(false);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('representative-portal', { body });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Operação não concluída.');
    return data;
  }, []);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    try {
      const response = await invoke({ action: 'list' });
      setRepresentative(response.representative as Representative);
      setLeads((response.leads || []) as CommercialLead[]);
      setVisits((response.visits || []) as RepresentativeVisit[]);
      setAuthenticated(true);
    } catch {
      setAuthenticated(false);
      setRepresentative(null);
    } finally {
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void loadPortal();
      else setLoading(false);
    });
  }, [loadPortal]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPassword });
      if (error) throw error;
      await loadPortal();
      setLoginPassword('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível entrar.');
      setAuthenticated(false);
      setLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setAuthenticated(false);
    setRepresentative(null);
    setLeads([]);
  };

  const lookupPostalCode = async () => {
    const postalCode = form.postalCode.replace(/\D/g, '');
    if (postalCode.length !== 8) {
      setLocation(null);
      toast.error('Informe um CEP válido com 8 números.');
      return;
    }
    setLookingUpPostalCode(true);
    try {
      const response = await invoke({ action: 'lookup_postal_code', postalCode });
      setLocation(response.location as PostalLocation);
      setForm((current) => ({ ...current, postalCode }));
    } catch (error) {
      setLocation(null);
      toast.error(error instanceof Error ? error.message : 'CEP não encontrado.');
    } finally {
      setLookingUpPostalCode(false);
    }
  };

  const registerVisit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!location || location.postalCode !== form.postalCode.replace(/\D/g, '')) {
      toast.error('Consulte e confirme o CEP antes de salvar a visita.');
      return;
    }
    setSaving(true);
    try {
      await invoke({
        action: 'register_visit',
        ...form,
        ownerPhone: normalizeOwnerPhone(form.ownerPhone),
      });
      setForm(initialForm);
      setLocation(null);
      await loadPortal();
      toast.success('Visita registrada e contato enviado ao funil comercial.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível registrar a visita.');
    } finally {
      setSaving(false);
    }
  };

  const visibleLeads = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    if (!query) return leads;
    return leads.filter((lead) => `${lead.restaurant_name} ${lead.owner_name} ${lead.owner_phone} ${lead.city} ${lead.state}`.toLocaleLowerCase('pt-BR').includes(query));
  }, [leads, search]);

  const visitCountByLead = useMemo(() => {
    const counts = new Map<string, number>();
    visits.forEach((visit) => counts.set(visit.lead_id, (counts.get(visit.lead_id) || 0) + 1));
    return counts;
  }, [visits]);

  if (loading && !authenticated) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 text-white"><RefreshCw className="h-8 w-8 animate-spin text-orange-400" aria-label="Carregando" /></main>;
  }

  if (!authenticated) {
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#071b16] px-4 py-10">
        <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-orange-500/20 blur-3xl" />
        <Card className="relative w-full max-w-md border-white/10 bg-white shadow-2xl">
          <CardHeader className="space-y-4 p-7">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-violet-600 text-white"><Route className="h-6 w-6" /></div>
            <div><p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">PopSystem em campo</p><CardTitle className="mt-2 text-3xl text-slate-950">Portal do representante</CardTitle><p className="mt-2 text-sm text-slate-500">Registre visitas e acompanhe somente os contatos da sua carteira.</p></div>
          </CardHeader>
          <CardContent className="p-7 pt-0">
            <form className="space-y-4" onSubmit={handleLogin}>
              <div className="space-y-2"><Label htmlFor="representative-email">E-mail</Label><Input id="representative-email" type="email" autoComplete="email" required value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="representative-password">Senha</Label><Input id="representative-password" type="password" autoComplete="current-password" required value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /></div>
              <Button className="h-12 w-full bg-gradient-to-r from-orange-500 to-orange-600 font-bold hover:from-orange-600 hover:to-orange-700" disabled={loading}>{loading ? 'Entrando…' : 'Acessar minha carteira'}</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f5fb] text-slate-950">
      <header className="bg-gradient-to-r from-[#063f31] via-[#174c3d] to-[#4c1d95] text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-6 lg:px-8">
          <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-orange-300">PopSystem em campo</p><h1 className="mt-1 text-2xl font-black">Olá, {representative?.display_name}</h1><p className="text-sm text-emerald-100">Sua ficha de visitas e carteira comercial.</p></div>
          <Button variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => void logout()}><LogOut className="mr-2 h-4 w-4" />Sair</Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:px-8">
        <Card className="h-fit overflow-hidden border-0 shadow-xl shadow-violet-950/5">
          <div className="h-2 bg-gradient-to-r from-orange-500 via-violet-600 to-emerald-500" />
          <CardHeader><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-100 text-orange-700"><ClipboardPlus className="h-5 w-5" /></div><div><CardTitle>Registrar visita</CardTitle><p className="text-sm text-slate-500">O contato entra automaticamente no funil.</p></div></div></CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={registerVisit}>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="lead-restaurant">Restaurante *</Label><Input id="lead-restaurant" required value={form.restaurantName} onChange={(event) => setForm((current) => ({ ...current, restaurantName: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="lead-owner">Proprietário *</Label><Input id="lead-owner" required value={form.ownerName} onChange={(event) => setForm((current) => ({ ...current, ownerName: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="lead-phone">WhatsApp *</Label><Input id="lead-phone" type="tel" required placeholder="(85) 99999-9999" value={form.ownerPhone} onChange={(event) => setForm((current) => ({ ...current, ownerPhone: formatOwnerPhoneInput(event.target.value) }))} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="lead-email">E-mail</Label><Input id="lead-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="lead-postal">CEP *</Label><div className="flex gap-2"><Input id="lead-postal" inputMode="numeric" maxLength={9} required value={form.postalCode} onChange={(event) => { setLocation(null); setForm((current) => ({ ...current, postalCode: event.target.value.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2') })); }} /><Button type="button" variant="outline" onClick={() => void lookupPostalCode()} disabled={lookingUpPostalCode}>{lookingUpPostalCode ? 'Buscando…' : 'Consultar'}</Button></div></div>
              <div className="space-y-2"><Label htmlFor="lead-number">Número</Label><Input id="lead-number" value={form.streetNumber} onChange={(event) => setForm((current) => ({ ...current, streetNumber: event.target.value }))} /></div>
              {location ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 sm:col-span-2"><MapPin className="mr-1 inline h-4 w-4" />{location.street ? `${location.street}, ` : ''}{location.neighborhood ? `${location.neighborhood} · ` : ''}{location.city}/{location.state}</div> : null}
              <div className="space-y-2"><Label>Nível de interesse</Label><Select value={form.interestLevel} onValueChange={(value) => setForm((current) => ({ ...current, interestLevel: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cold">Baixo</SelectItem><SelectItem value="warm">Médio</SelectItem><SelectItem value="hot">Alto</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Resultado da visita</Label><Select value={form.outcome} onValueChange={(value) => setForm((current) => ({ ...current, outcome: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="registered">Contato cadastrado</SelectItem><SelectItem value="interested">Interessado</SelectItem><SelectItem value="demo_scheduled">Demonstração agendada</SelectItem><SelectItem value="follow_up">Retornar contato</SelectItem><SelectItem value="not_interested">Sem interesse agora</SelectItem><SelectItem value="closed">Venda fechada</SelectItem></SelectContent></Select></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="lead-notes">Observações da visita</Label><Textarea id="lead-notes" rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></div>
              <label className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950 sm:col-span-2"><Checkbox className="mt-0.5" checked={form.marketingConsent} onCheckedChange={(checked) => setForm((current) => ({ ...current, marketingConsent: checked === true }))} /><span><strong className="block">Autorização para relacionamento</strong>O proprietário autorizou receber conteúdos, novidades e contato comercial da PopSystem.</span></label>
              <Button className="h-12 bg-gradient-to-r from-orange-500 to-violet-600 font-bold hover:opacity-90 sm:col-span-2" disabled={saving}>{saving ? 'Salvando visita…' : 'Salvar visita no funil'}</Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <section className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-emerald-700 p-4 text-white shadow-lg"><Users className="h-5 w-5 text-emerald-200" /><p className="mt-4 text-3xl font-black">{leads.length}</p><p className="text-xs font-semibold text-emerald-100">Contatos</p></div>
            <div className="rounded-2xl bg-violet-700 p-4 text-white shadow-lg"><Route className="h-5 w-5 text-violet-200" /><p className="mt-4 text-3xl font-black">{visits.length}</p><p className="text-xs font-semibold text-violet-100">Visitas</p></div>
            <div className="rounded-2xl bg-orange-500 p-4 text-white shadow-lg"><Sparkles className="h-5 w-5 text-orange-100" /><p className="mt-4 text-3xl font-black">{leads.filter((lead) => lead.interest_level === 'hot').length}</p><p className="text-xs font-semibold text-orange-50">Alta intenção</p></div>
          </section>

          <Card className="border-0 shadow-xl shadow-violet-950/5">
            <CardHeader className="gap-4"><div><CardTitle>Minha carteira</CardTitle><p className="text-sm text-slate-500">Somente os restaurantes cadastrados por você.</p></div><label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Buscar restaurante, cidade ou contato" value={search} onChange={(event) => setSearch(event.target.value)} /></label></CardHeader>
            <CardContent className="max-h-[760px] space-y-3 overflow-auto [content-visibility:auto]">
              {visibleLeads.map((lead) => (
                <article key={lead.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-slate-950">{lead.restaurant_name}</h3><p className="text-sm text-slate-500">{lead.owner_name} · {lead.owner_phone}</p></div><Badge className={lead.interest_level === 'hot' ? 'bg-orange-100 text-orange-800' : lead.interest_level === 'warm' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700'}>{interestLabels[lead.interest_level]}</Badge></div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800"><MapPin className="mr-1 inline h-3 w-3" />{lead.city}/{lead.state}</span><span className="rounded-full bg-violet-50 px-2.5 py-1 font-semibold text-violet-800">{stageLabels[lead.commercial_stage] || lead.commercial_stage}</span><span className="rounded-full bg-orange-50 px-2.5 py-1 font-semibold text-orange-800">{visitCountByLead.get(lead.id) || 0} visita(s)</span>{lead.marketing_consent ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800"><CheckCircle2 className="mr-1 inline h-3 w-3" />Marketing autorizado</span> : null}</div>
                  <p className="mt-3 text-xs text-slate-400">Última visita: {dateTime(lead.last_visit_at)}</p>
                </article>
              ))}
              {!visibleLeads.length ? <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500"><Building2 className="mx-auto mb-3 h-8 w-8 text-slate-300" />Nenhum contato encontrado.</div> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
