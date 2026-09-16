import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardPlus,
  Headphones,
  LogOut,
  MapPin,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
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
  street: '', streetNumber: '', neighborhood: '', complement: '', notes: '', interestLevel: 'warm', outcome: 'registered', marketingConsent: false,
};

const stageLabels: Record<string, string> = {
  new: 'Novo', contacting: 'Em contato', demo_scheduled: 'Demonstração', proposal: 'Proposta', won: 'Convertido', lost: 'Perdido',
};
const interestLabels: Record<string, string> = { cold: 'Baixo', warm: 'Médio', hot: 'Alto' };
const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const brandAsset = (folder: string, fileName: string) => `${import.meta.env.BASE_URL}${folder}/${encodeURIComponent(fileName)}`;
const brandLogo = brandAsset('LOGOMARCA', 'Logo pop.png');
const brandMascot = brandAsset('CRIATIVOS', 'mascote-login-transparente.png');

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
    if (error) {
      let message = data?.error;
      const context = 'context' in error ? error.context : null;
      if (!message && context instanceof Response) {
        try {
          const responseBody = await context.clone().json();
          message = responseBody?.error;
        } catch {
          // A mensagem padrão abaixo cobre respostas sem corpo JSON.
        }
      }
      throw new Error(message || 'Não foi possível validar o acesso de representante.');
    }
    if (!data?.ok) throw new Error(data?.error || 'Operação não concluída.');
    return data;
  }, []);

  const loadPortal = useCallback(async (silent = false) => {
    setLoading(true);
    try {
      const response = await invoke({ action: 'list' });
      setRepresentative(response.representative as Representative);
      setLeads((response.leads || []) as CommercialLead[]);
      setVisits((response.visits || []) as RepresentativeVisit[]);
      setAuthenticated(true);
    } catch (error) {
      setAuthenticated(false);
      setRepresentative(null);
      if (!silent) throw error;
    } finally {
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void loadPortal(true);
      else setLoading(false);
    });
  }, [loadPortal]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPassword });
      if (error) throw error;
      await loadPortal(false);
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
      const resolvedLocation = response.location as PostalLocation;
      setLocation(resolvedLocation);
      setForm((current) => ({
        ...current,
        postalCode,
        street: resolvedLocation.street || current.street,
        neighborhood: resolvedLocation.neighborhood || current.neighborhood,
      }));
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
    return (
      <main className="grid min-h-screen place-items-center bg-[#033b2c] text-white">
        <div className="flex flex-col items-center gap-5">
          <div className="rounded-2xl bg-white px-5 py-3 shadow-xl"><img src={brandLogo} alt="PopSystem" className="h-9 w-auto" /></div>
          <RefreshCw className="h-7 w-7 animate-spin text-[#ff6a00]" aria-label="Carregando" />
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#eef3ed] px-4 py-6 sm:px-6 lg:px-8 lg:py-6">
        <div className="pointer-events-none absolute -left-32 top-1/4 h-80 w-80 rounded-full bg-[#8dcc3f]/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-[#ff6a00]/10 blur-3xl" />

        <div className="relative mx-auto w-full max-w-[460px] overflow-hidden rounded-[28px] border border-white bg-white shadow-[0_35px_100px_-48px_rgba(0,55,38,0.5)] lg:grid lg:min-h-[calc(100vh-3rem)] lg:max-w-[1240px] lg:grid-cols-[1.08fr_0.92fr]">
          <section className="relative isolate hidden min-h-[700px] overflow-hidden bg-[#033b2c] px-12 py-11 text-white lg:flex lg:flex-col xl:px-16">
            <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_85%_10%,rgba(74,196,82,0.22),transparent_30%),linear-gradient(145deg,#043e2e_0%,#013126_60%,#00271e_100%)]" />
            <div className="pointer-events-none absolute -bottom-28 -left-24 -z-10 h-72 w-[130%] -rotate-6 rounded-[50%] border-t-[12px] border-[#ff6a00] bg-[#07533c]" />

            <div className="w-fit rounded-2xl bg-white px-5 py-3 shadow-xl shadow-black/10">
              <img src={brandLogo} alt="PopSystem" className="h-9 w-auto xl:h-10" />
            </div>

            <div className="relative z-20 mt-12 max-w-[430px]">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[#b9ed72]">
                <BadgeCheck className="h-4 w-4" /> Time comercial PopSystem
              </span>
              <h1 className="mt-6 text-[40px] font-black leading-[1.04] tracking-[-0.04em] xl:text-[44px]">
                Sua presença em campo.<br /><span className="text-[#ff7a16]">Nosso crescimento.</span>
              </h1>
              <p className="mt-5 max-w-[440px] text-[15px] leading-7 text-emerald-50/80">
                Registre cada visita, organize seus contatos e acompanhe sua carteira em um só lugar.
              </p>
            </div>

            <div className="relative z-20 mt-8 grid max-w-[330px] gap-3">
              <div className="flex items-center gap-3 text-sm font-semibold text-white/90"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-[#a6df5c]"><Route className="h-4 w-4" /></span>Visitas organizadas por território</div>
              <div className="flex items-center gap-3 text-sm font-semibold text-white/90"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-[#a6df5c]"><ShieldCheck className="h-4 w-4" /></span>Carteira individual e protegida</div>
              <div className="flex items-center gap-3 text-sm font-semibold text-white/90"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-[#a6df5c]"><Headphones className="h-4 w-4" /></span>Contato direto com o time PopSystem</div>
            </div>

            <img src={brandMascot} alt="Mascote PopSystem" className="pointer-events-none absolute -bottom-5 -right-3 z-10 h-[315px] w-auto max-w-none object-contain xl:right-1 xl:h-[340px]" />
          </section>

          <section className="flex flex-col justify-center px-6 py-8 sm:px-10 sm:py-10 lg:min-h-0 lg:px-14 xl:px-20">
            <div className="mb-7 flex justify-center lg:hidden">
              <div className="rounded-2xl bg-white px-5 py-3 shadow-[0_12px_35px_-18px_rgba(0,55,38,0.45)] ring-1 ring-emerald-950/5">
                <img src={brandLogo} alt="PopSystem" className="h-9 w-auto" />
              </div>
            </div>
            <div className="mx-auto w-full max-w-[430px]">
              <div className="hidden h-12 w-12 place-items-center rounded-2xl bg-[#eaf6df] text-[#078844] lg:grid"><Route className="h-6 w-6" /></div>
              <p className="hidden text-xs font-extrabold uppercase tracking-[0.2em] text-[#ef5b0c] lg:mt-6 lg:block">PopSystem em campo</p>
              <h2 className="text-center text-[28px] font-black tracking-[-0.035em] text-[#082f26] sm:text-3xl lg:mt-2 lg:text-left lg:text-4xl">Portal do representante</h2>
              <p className="mt-3 text-center text-sm leading-6 text-slate-500 lg:text-left">Entre com seu acesso comercial para registrar visitas e acompanhar seus contatos.</p>

              <form className="mt-7 space-y-5 lg:mt-8" onSubmit={handleLogin}>
                <div className="space-y-2"><Label htmlFor="representative-email" className="font-bold text-[#164d3e]">E-mail</Label><Input className="h-12 rounded-xl border-slate-200 bg-slate-50 focus-visible:ring-[#109352]" id="representative-email" type="email" autoComplete="email" required value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="representative-password" className="font-bold text-[#164d3e]">Senha</Label><Input className="h-12 rounded-xl border-slate-200 bg-slate-50 focus-visible:ring-[#109352]" id="representative-password" type="password" autoComplete="current-password" required value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /></div>
                <Button className="h-12 w-full rounded-xl bg-[#ff650b] font-extrabold text-white shadow-lg shadow-orange-500/20 hover:bg-[#ea5700]" disabled={loading}>{loading ? 'Entrando…' : <span className="flex items-center gap-2">Acessar minha carteira <ArrowRight className="h-4 w-4" /></span>}</Button>
              </form>

              <div className="mt-7 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-center text-xs text-slate-400 lg:mt-8 lg:pt-6"><ShieldCheck className="h-4 w-4 shrink-0 text-[#169354]" />Acesso exclusivo para representantes autorizados</div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3f6f2] text-slate-950">
      <header className="border-b border-emerald-950/10 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-8">
          <img src={brandLogo} alt="PopSystem" className="h-9 w-auto sm:h-10" />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block"><p className="text-sm font-extrabold text-[#073d2e]">{representative?.display_name}</p><p className="text-xs text-slate-500">Representante PopSystem</p></div>
            <Button variant="outline" className="border-emerald-900/15 text-[#073d2e] hover:bg-emerald-50" onClick={() => void logout()}><LogOut className="mr-2 h-4 w-4" />Sair</Button>
          </div>
        </div>
      </header>

      <section className="relative isolate overflow-hidden bg-[#033b2c] text-white">
        <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_80%_0%,rgba(121,205,74,0.2),transparent_28%),linear-gradient(120deg,#033b2c_0%,#07513b_72%,#064331_100%)]" />
        <div className="pointer-events-none absolute -bottom-20 right-0 -z-10 h-32 w-[55%] -rotate-3 rounded-[50%] border-t-[8px] border-[#ff6a00] bg-[#07563e]" />
        <div className="mx-auto flex min-h-[218px] max-w-7xl items-center justify-between gap-6 px-4 py-8 lg:px-8">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.2em] text-[#b4e86c]"><BadgeCheck className="h-4 w-4" /> PopSystem em campo</p>
            <h1 className="mt-3 text-3xl font-black tracking-[-0.035em] sm:text-4xl">Olá, {representative?.display_name}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-emerald-50/80 sm:text-base">Transforme cada visita em oportunidade. Cadastre o estabelecimento e acompanhe sua carteira comercial.</p>
          </div>
          <img src={brandMascot} alt="Mascote PopSystem" className="pointer-events-none absolute -bottom-16 right-0 h-[190px] w-auto object-contain opacity-40 sm:opacity-60 md:static md:-mb-20 md:h-[280px] md:shrink-0 md:opacity-100" />
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-7 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:px-8">
        <Card className="h-fit overflow-hidden border-0 shadow-xl shadow-violet-950/5">
          <div className="h-2 bg-gradient-to-r from-orange-500 via-violet-600 to-emerald-500" />
          <CardHeader><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-100 text-orange-700"><ClipboardPlus className="h-5 w-5" /></div><div><CardTitle>Registrar visita</CardTitle><p className="text-sm text-slate-500">O contato entra automaticamente no funil.</p></div></div></CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={registerVisit}>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="lead-restaurant">Restaurante *</Label><Input id="lead-restaurant" required value={form.restaurantName} onChange={(event) => setForm((current) => ({ ...current, restaurantName: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="lead-owner">Proprietário *</Label><Input id="lead-owner" required value={form.ownerName} onChange={(event) => setForm((current) => ({ ...current, ownerName: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="lead-phone">WhatsApp *</Label><Input id="lead-phone" type="tel" required placeholder="(85) 99999-9999" value={form.ownerPhone} onChange={(event) => setForm((current) => ({ ...current, ownerPhone: formatOwnerPhoneInput(event.target.value) }))} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="lead-email">E-mail</Label><Input id="lead-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="lead-postal">CEP *</Label><div className="flex gap-2"><Input id="lead-postal" inputMode="numeric" maxLength={9} required value={form.postalCode} onChange={(event) => { setLocation(null); setForm((current) => ({ ...current, postalCode: event.target.value.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2'), street: '', neighborhood: '' })); }} /><Button type="button" variant="outline" onClick={() => void lookupPostalCode()} disabled={lookingUpPostalCode}>{lookingUpPostalCode ? 'Buscando…' : 'Consultar'}</Button></div></div>
              <div className="space-y-2"><Label htmlFor="lead-number">Número</Label><Input id="lead-number" value={form.streetNumber} onChange={(event) => setForm((current) => ({ ...current, streetNumber: event.target.value }))} /></div>
              {location ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 sm:col-span-2"><MapPin className="mr-1 inline h-4 w-4" />CEP confirmado em {location.city}/{location.state}{!location.street ? ' — CEP geral: informe o endereço abaixo.' : ''}</div> : null}
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="lead-street">Endereço / rua *</Label><Input id="lead-street" required placeholder="Digite a rua ou avenida" value={form.street} onChange={(event) => setForm((current) => ({ ...current, street: event.target.value }))} /><p className="text-xs text-slate-500">Preenchido pelo CEP quando disponível. Em CEP geral da cidade, digite o endereço.</p></div>
              <div className="space-y-2"><Label htmlFor="lead-neighborhood">Bairro</Label><Input id="lead-neighborhood" value={form.neighborhood} onChange={(event) => setForm((current) => ({ ...current, neighborhood: event.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="lead-complement">Complemento</Label><Input id="lead-complement" placeholder="Sala, loja, ponto de referência" value={form.complement} onChange={(event) => setForm((current) => ({ ...current, complement: event.target.value }))} /></div>
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
