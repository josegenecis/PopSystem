import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Loader2, Pencil, Plus, Search, UserRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

export type FiscalCustomer = {
  id: string;
  name: string;
  phone: string;
  cpf_cnpj?: string | null;
  state_registration?: string | null;
  state_registration_indicator?: number | null;
  email?: string | null;
  address?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  city_code?: string | null;
  country_code?: string | null;
  country_name?: string | null;
  final_consumer_default?: boolean | null;
  fiscal_profile_enabled?: boolean | null;
};

type FiscalRecipientsManagerProps = {
  onRecipientSelected?: (customer: FiscalCustomer) => void;
  mode?: 'fiscal' | 'customers';
};

type CnpjStateRegistration = { ativo?: boolean; uf?: string; inscricao_estadual?: string };
type CnpjLookupResponse = {
  razao_social?: string; nome?: string; ddd_telefone_1?: string; telefone?: string; email?: string;
  logradouro?: string; numero?: string; complemento?: string; bairro?: string; municipio?: string;
  uf?: string; cep?: string; codigo_municipio_ibge?: string | number; codigo_municipio?: string | number;
  descricao_situacao_cadastral?: string; situacao_cadastral?: string | number;
  inscricoes_estaduais?: CnpjStateRegistration[];
};

type CnpjStateRegistration = { ativo?: boolean; uf?: string; inscricao_estadual?: string };
type CnpjLookupResponse = {
  razao_social?: string; nome?: string; ddd_telefone_1?: string; telefone?: string; email?: string;
  logradouro?: string; numero?: string; complemento?: string; bairro?: string; municipio?: string;
  uf?: string; cep?: string; codigo_municipio_ibge?: string | number; codigo_municipio?: string | number;
  descricao_situacao_cadastral?: string; situacao_cadastral?: string | number;
  inscricoes_estaduais?: CnpjStateRegistration[];
};

const emptyCustomer: FiscalCustomer = {
  id: '', name: '', phone: '', cpf_cnpj: '', state_registration: '', state_registration_indicator: 9,
  email: '', address: '', address_number: '', address_complement: '', neighborhood: '', city: '',
  state: '', postal_code: '', city_code: '', country_code: '1058', country_name: 'BRASIL', final_consumer_default: true, fiscal_profile_enabled: true,
};

const digits = (value?: string | null) => String(value || '').replace(/\D/g, '');
const formatDocument = (value?: string | null) => {
  const raw = digits(value);
  if (raw.length === 11) return raw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (raw.length === 14) return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return raw;
};

const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

export default function FiscalRecipientsManager({ onRecipientSelected }: FiscalRecipientsManagerProps = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const storeId = activeStoreId || user?.id;
  const fiscalMode = mode === 'fiscal' || Boolean(onRecipientSelected);
  const [customers, setCustomers] = useState<FiscalCustomer[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<FiscalCustomer | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [consultingCnpj, setConsultingCnpj] = useState(false);

  const loadCustomers = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).from('customers').select('*').eq('user_id', storeId).order('name');
      if (error) throw error;
      setCustomers((data || []) as FiscalCustomer[]);
    } catch (error: any) {
      toast({ title: 'Erro ao carregar clientes', description: error?.message || 'Não foi possível carregar os destinatários.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [storeId, toast]);

  useEffect(() => { void loadCustomers(); }, [loadCustomers]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return customers;
    return customers.filter((customer) => `${customer.name} ${customer.phone} ${customer.cpf_cnpj || ''}`.toLowerCase().includes(term));
  }, [customers, search]);
  const fiscalFieldsRequired = fiscalMode || editing?.fiscal_profile_enabled === true;

  const update = (patch: Partial<FiscalCustomer>) => setEditing((current) => current ? { ...current, ...patch } : current);

  const consultCnpj = async () => {
    const cnpj = digits(editing?.cpf_cnpj);
    if (cnpj.length !== 14) {
      toast({ title: 'CNPJ incompleto', description: 'Informe os 14 dígitos antes de consultar.', variant: 'destructive' });
      return;
    }

    setConsultingCnpj(true);
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      if (!response.ok) {
        if (response.status === 404) throw new Error('CNPJ não encontrado na base cadastral.');
        throw new Error('A consulta cadastral está temporariamente indisponível.');
      }

      const data = await response.json() as CnpjLookupResponse;
      const stateRegistrations = Array.isArray(data?.inscricoes_estaduais) ? data.inscricoes_estaduais : [];
      const activeStateRegistration = stateRegistrations.find((item) => item?.ativo !== false && (!data?.uf || item?.uf === data.uf))
        || stateRegistrations.find((item) => item?.ativo !== false)
        || stateRegistrations[0];
      const situation = String(data?.descricao_situacao_cadastral || data?.situacao_cadastral || '').trim();

      update({
        name: data?.razao_social || data?.nome || editing?.name || '',
        phone: data?.ddd_telefone_1 || data?.telefone || editing?.phone || '',
        email: data?.email || editing?.email || '',
        address: data?.logradouro || editing?.address || '',
        address_number: data?.numero || editing?.address_number || '',
        address_complement: data?.complemento || editing?.address_complement || '',
        neighborhood: data?.bairro || editing?.neighborhood || '',
        city: data?.municipio || editing?.city || '',
        state: data?.uf || editing?.state || '',
        postal_code: digits(data?.cep) || editing?.postal_code || '',
        city_code: digits(data?.codigo_municipio_ibge || data?.codigo_municipio) || editing?.city_code || '',
        state_registration: activeStateRegistration?.inscricao_estadual || editing?.state_registration || '',
      });

      const inactive = situation && !/ATIVA/i.test(situation);
      toast({
        title: inactive ? `Atenção: situação ${situation}` : 'Dados do CNPJ encontrados',
        description: inactive
          ? 'Confira a situação cadastral antes de emitir. Os dados foram preenchidos para revisão.'
          : 'Cadastro preenchido. Revise telefone, endereço e Inscrição Estadual antes de salvar.',
        variant: inactive ? 'destructive' : 'default',
      });
    } catch (error: unknown) {
      toast({ title: 'Não foi possível consultar o CNPJ', description: error instanceof Error ? error.message : 'Tente novamente em alguns instantes.', variant: 'destructive' });
    } finally {
      setConsultingCnpj(false);
    }
  };

  const save = async () => {
    if (!editing || !storeId) return;
    const document = digits(editing.cpf_cnpj);
    const postalCode = digits(editing.postal_code);
    const cityCode = digits(editing.city_code);
    const requiredAddress = [editing.address, editing.address_number, editing.neighborhood, editing.city, editing.state];
    const fiscalProfileEnabled = fiscalMode || editing.fiscal_profile_enabled === true;
    if (!editing.name.trim() || !editing.phone.trim()) {
      toast({ title: 'Dados obrigatórios', description: 'Informe nome e telefone do cliente.', variant: 'destructive' }); return;
    }
    if (document && ![11, 14].includes(document.length)) {
      toast({ title: 'CPF/CNPJ inválido', description: 'Informe um CPF com 11 ou CNPJ com 14 dígitos.', variant: 'destructive' }); return;
    }
    if (fiscalProfileEnabled && ![11, 14].includes(document.length)) {
      toast({ title: 'CPF/CNPJ obrigatório', description: 'Para habilitar o cliente para NF-e, informe CPF ou CNPJ.', variant: 'destructive' }); return;
    }
    if (fiscalProfileEnabled && (requiredAddress.some((value) => !String(value || '').trim()) || postalCode.length !== 8 || cityCode.length !== 7)) {
      toast({ title: 'Endereço fiscal incompleto', description: 'Preencha logradouro, número, bairro, município, UF, CEP e código IBGE.', variant: 'destructive' }); return;
    }
    if (fiscalProfileEnabled && Number(editing.state_registration_indicator) === 1 && !digits(editing.state_registration)) {
      toast({ title: 'Inscrição Estadual obrigatória', description: 'Informe a IE do destinatário contribuinte do ICMS.', variant: 'destructive' }); return;
    }

    setSaving(true);
    try {
      const payload = {
        user_id: storeId,
        name: editing.name.trim(), phone: editing.phone.trim(), cpf_cnpj: document || null,
        state_registration: Number(editing.state_registration_indicator) === 1 ? digits(editing.state_registration) : null,
        state_registration_indicator: Number(editing.state_registration_indicator || 9),
        email: editing.email?.trim() || null, address: editing.address?.trim() || null,
        address_number: editing.address_number?.trim() || null, address_complement: editing.address_complement?.trim() || null,
        neighborhood: editing.neighborhood?.trim() || null, city: editing.city?.trim() || null, state: editing.state?.trim().toUpperCase() || null,
        postal_code: postalCode || null, city_code: cityCode || null, country_code: '1058', country_name: 'BRASIL',
        final_consumer_default: editing.final_consumer_default !== false, fiscal_profile_enabled: fiscalProfileEnabled,
        updated_at: new Date().toISOString(),
      };
      const query = editing.id
        ? (supabase as any).from('customers').update(payload).eq('id', editing.id).eq('user_id', storeId)
        : (supabase as any).from('customers').insert(payload);
      const { data: saved, error } = await query.select('*').single();
      if (error) throw error;
      toast({
        title: fiscalProfileEnabled ? 'Cliente fiscal salvo' : 'Cliente salvo',
        description: fiscalProfileEnabled ? 'O cliente está pronto para ser selecionado na NF-e modelo 55.' : 'O cadastro já está disponível no PDV e nos pedidos.',
      });
      setEditing(null);
      if (saved && onRecipientSelected) onRecipientSelected(saved as FiscalCustomer);
      await loadCustomers();
    } catch (error: any) {
      const duplicate = error?.code === '23505' ? 'Já existe um cliente com este CPF/CNPJ.' : error?.message;
      toast({ title: fiscalMode ? 'Erro ao salvar destinatário' : 'Erro ao salvar cliente', description: duplicate || 'Não foi possível salvar o cadastro.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="border-b bg-emerald-50/60">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><CardTitle className="flex items-center gap-2 text-emerald-950"><Building2 className="h-5 w-5" />{onRecipientSelected ? 'Cliente da NF-e' : fiscalMode ? 'Destinatários fiscais' : 'Clientes'}</CardTitle><CardDescription>{onRecipientSelected ? 'Selecione um cliente pronto ou complete o cadastro fiscal sem sair da venda.' : fiscalMode ? 'Complete os dados dos clientes que receberão NF-e modelo 55.' : 'Cadastre e mantenha os clientes usados no PDV, delivery e documentos fiscais.'}</CardDescription></div>
          <Button onClick={() => setEditing({ ...emptyCustomer, fiscal_profile_enabled: fiscalMode })}><Plus className="mr-2 h-4 w-4" />{fiscalMode ? 'Novo destinatário' : 'Novo cliente'}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, telefone, CPF ou CNPJ" /></div>
        {loading ? <div className="py-10 text-center text-muted-foreground">Carregando clientes…</div> : filtered.length === 0 ? <div className="rounded-2xl border border-dashed py-10 text-center text-muted-foreground"><UserRound className="mx-auto mb-2 h-9 w-9 opacity-50" />Nenhum cliente encontrado.</div> : (
          <div className="grid gap-3 lg:grid-cols-2">{filtered.map((customer) => {
            const ready = customer.fiscal_profile_enabled && [11, 14].includes(digits(customer.cpf_cnpj).length) && customer.city_code && customer.state && customer.postal_code;
            return <div key={customer.id} className="flex items-center justify-between gap-4 rounded-2xl border p-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="truncate">{customer.name}</strong><Badge className={ready ? 'bg-emerald-700' : fiscalMode ? 'bg-amber-100 text-amber-900 hover:bg-amber-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-100'}>{ready ? <><CheckCircle2 className="mr-1 h-3 w-3" />Pronto para NF-e</> : fiscalMode ? 'Completar cadastro fiscal' : 'Cadastro básico'}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{customer.cpf_cnpj ? formatDocument(customer.cpf_cnpj) : 'CPF/CNPJ não informado'} · {customer.phone}</p><p className="truncate text-xs text-muted-foreground">{[customer.address, customer.address_number, customer.city, customer.state].filter(Boolean).join(', ') || 'Endereço não informado'}</p></div><div className="flex shrink-0 gap-2">{onRecipientSelected && ready && <Button size="sm" onClick={() => onRecipientSelected(customer)}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Usar na NF-e</Button>}<Button variant="outline" size="sm" onClick={() => setEditing({ ...customer })}><Pencil className="mr-1.5 h-3.5 w-3.5" />{fiscalMode && !ready ? 'Completar' : 'Editar'}</Button></div></div>;
          })}</div>
        )}
      </CardContent>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? `Editar ${fiscalMode ? 'destinatário fiscal' : 'cliente'}` : `Novo ${fiscalMode ? 'destinatário fiscal' : 'cliente'}`}</DialogTitle><DialogDescription>{fiscalMode ? 'Os dados serão vinculados ao cadastro do cliente e reutilizados nas emissões fiscais.' : 'Nome e telefone são suficientes. Os dados fiscais podem ser preenchidos quando o cliente precisar de NF-e.'}</DialogDescription></DialogHeader>
          {editing && <div className="grid gap-4 sm:grid-cols-2">
            {!fiscalMode && <div className="flex items-center justify-between rounded-xl border bg-emerald-50/50 p-3 sm:col-span-2"><div><Label>Habilitar cadastro para NF-e</Label><p className="text-xs text-muted-foreground">Exige CPF/CNPJ e endereço fiscal completo.</p></div><Switch checked={editing.fiscal_profile_enabled === true} onCheckedChange={(checked) => update({ fiscal_profile_enabled: checked })} /></div>}
            <div className="space-y-2"><Label>Nome / razão social *</Label><Input value={editing.name} onChange={(e) => update({ name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Telefone *</Label><Input value={editing.phone} onChange={(e) => update({ phone: e.target.value })} /></div>
            <div className="space-y-2 sm:col-span-2">
              <Label>CPF/CNPJ *</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={editing.cpf_cnpj || ''} onChange={(e) => update({ cpf_cnpj: e.target.value })} placeholder="Digite o CPF ou CNPJ" />
                <Button type="button" variant="outline" className="shrink-0" onClick={() => void consultCnpj()} disabled={consultingCnpj || digits(editing.cpf_cnpj).length !== 14}>
                  {consultingCnpj ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  Consultar CNPJ
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">A consulta preenche os dados cadastrais. Revise a Inscrição Estadual antes da emissão.</p>
            </div>
            <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={editing.email || ''} onChange={(e) => update({ email: e.target.value })} /></div>
            <div className="space-y-2"><Label>Indicador da IE{fiscalFieldsRequired ? ' *' : ''}</Label><Select value={String(editing.state_registration_indicator || 9)} onValueChange={(value) => update({ state_registration_indicator: Number(value), state_registration: value === '1' ? editing.state_registration : '' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Contribuinte do ICMS</SelectItem><SelectItem value="2">Contribuinte isento</SelectItem><SelectItem value="9">Não contribuinte</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Inscrição Estadual</Label><Input disabled={Number(editing.state_registration_indicator) !== 1} value={editing.state_registration || ''} onChange={(e) => update({ state_registration: e.target.value })} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Logradouro{fiscalFieldsRequired ? ' *' : ''}</Label><Input value={editing.address || ''} onChange={(e) => update({ address: e.target.value })} /></div>
            <div className="space-y-2"><Label>Número{fiscalFieldsRequired ? ' *' : ''}</Label><Input value={editing.address_number || ''} onChange={(e) => update({ address_number: e.target.value })} /></div>
            <div className="space-y-2"><Label>Complemento</Label><Input value={editing.address_complement || ''} onChange={(e) => update({ address_complement: e.target.value })} /></div>
            <div className="space-y-2"><Label>Bairro *</Label><Input value={editing.neighborhood || ''} onChange={(e) => update({ neighborhood: e.target.value })} /></div>
            <div className="space-y-2"><Label>Município *</Label><Input value={editing.city || ''} onChange={(e) => update({ city: e.target.value })} /></div>
            <div className="space-y-2"><Label>UF *</Label><Select value={editing.state || ''} onValueChange={(value) => update({ state: value })}><SelectTrigger><SelectValue placeholder="Selecione a UF" /></SelectTrigger><SelectContent>{BRAZILIAN_STATES.map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>CEP *</Label><Input value={editing.postal_code || ''} onChange={(e) => update({ postal_code: e.target.value })} /></div>
            <div className="space-y-2"><Label>Código IBGE do município *</Label><Input maxLength={7} value={editing.city_code || ''} onChange={(e) => update({ city_code: e.target.value })} /></div>
            <div className="flex items-center justify-between rounded-xl border p-3 sm:col-span-2"><div><Label>Consumidor final por padrão</Label><p className="text-xs text-muted-foreground">Pode ser alterado conforme a natureza de cada operação.</p></div><Switch checked={editing.final_consumer_default !== false} onCheckedChange={(checked) => update({ final_consumer_default: checked })} /></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Salvando…' : fiscalMode ? 'Salvar destinatário fiscal' : 'Salvar cliente'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
