/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase types are generated after the homologation migration is applied. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, Fingerprint, Loader2, MonitorSmartphone, ShieldAlert, ShieldCheck, Trash2, UserRoundCheck, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  enrollBiometric,
  getBiometricBridgeStatus,
  identifyBiometric,
  removeBiometric,
  type BiometricBridgeStatus,
} from '@/services/biometricBridge';

type WaiterRow = { id: string; name?: string | null; role?: string | null; cpf?: string | null };

type LegalSettings = {
  biometric_enabled: boolean;
  rep_mode: 'internal' | 'rep_p';
  legal_activation_status: 'draft' | 'technical_review' | 'ready';
  inpi_registration: string;
  employer_name: string;
  employer_document: string;
  caepf: string;
  cno: string;
  establishment_address: string;
  legal_timezone: string;
  biometric_policy_version: string;
  biometric_retention_days: number;
  biometric_legal_basis: string;
};

type CollectorRow = {
  id: string;
  device_id: string;
  label: string;
  provider: string;
  model?: string | null;
  enabled: boolean;
  last_seen_at?: string | null;
};

type EnrollmentRow = {
  id: string;
  waiter_id: string;
  collector_id?: string | null;
  provider: string;
  provider_reference: string;
  template_hash: string;
  finger_position: string;
  quality_score?: number | null;
  status: string;
  enrolled_at: string;
};

type LegalMark = {
  id: string;
  waiter_id: string;
  event_type: string;
  occurred_at: string;
  nsr?: number | null;
  mark_hash?: string | null;
  source?: string | null;
};

const defaultLegalSettings: LegalSettings = {
  biometric_enabled: false,
  rep_mode: 'internal',
  legal_activation_status: 'draft',
  inpi_registration: '',
  employer_name: '',
  employer_document: '',
  caepf: '',
  cno: '',
  establishment_address: '',
  legal_timezone: 'America/Fortaleza',
  biometric_policy_version: '2026-09-biometria-v1',
  biometric_retention_days: 1825,
  biometric_legal_basis: 'obrigacao_legal_regulatoria',
};

const fingerLabels: Record<string, string> = {
  right_index: 'Indicador direito',
  left_index: 'Indicador esquerdo',
  right_thumb: 'Polegar direito',
  left_thumb: 'Polegar esquerdo',
};

const eventLabels: Record<string, string> = {
  clock_in: 'Entrada',
  break_start: 'Início do intervalo',
  break_end: 'Retorno do intervalo',
  clock_out: 'Saída',
};

const onlyDigits = (value: string) => value.replace(/\D/g, '');
const maskDocument = (value: string) => {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 11) return digits.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return digits.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

const downloadText = (filename: string, content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export function BiometricTimeClockPanel({
  userId,
  waiters,
  onRegistered,
}: {
  userId: string;
  waiters: WaiterRow[];
  onRegistered?: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<LegalSettings>(defaultLegalSettings);
  const [bridge, setBridge] = useState<BiometricBridgeStatus | null>(null);
  const [collectors, setCollectors] = useState<CollectorRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [marks, setMarks] = useState<LegalMark[]>([]);
  const [selectedWaiter, setSelectedWaiter] = useState('');
  const [fingerPosition, setFingerPosition] = useState('right_index');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [kioskOpen, setKioskOpen] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [kioskFeedback, setKioskFeedback] = useState<{ tone: 'idle' | 'success' | 'error'; title: string; detail: string }>({
    tone: 'idle',
    title: 'Aguardando a digital',
    detail: 'Encoste o dedo cadastrado no leitor.',
  });

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [settingsResult, collectorsResult, enrollmentsResult, marksResult] = await Promise.all([
        supabase.from('employee_time_clock_settings' as any).select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('employee_time_clock_collectors' as any).select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('employee_biometric_enrollments' as any).select('*').eq('user_id', userId).eq('status', 'active').order('enrolled_at', { ascending: false }),
        supabase.from('employee_time_clock_events' as any).select('id, waiter_id, event_type, occurred_at, nsr, mark_hash, source').eq('user_id', userId).not('nsr', 'is', null).order('nsr', { ascending: false }).limit(20),
      ]);
      if (settingsResult.error) throw settingsResult.error;
      if (collectorsResult.error) throw collectorsResult.error;
      if (enrollmentsResult.error) throw enrollmentsResult.error;
      if (marksResult.error) throw marksResult.error;
      setSettings({ ...defaultLegalSettings, ...(settingsResult.data || {}) } as LegalSettings);
      setCollectors((collectorsResult.data || []) as CollectorRow[]);
      setEnrollments((enrollmentsResult.data || []) as EnrollmentRow[]);
      setMarks((marksResult.data || []) as LegalMark[]);
      setSelectedWaiter((current) => current || waiters[0]?.id || '');
    } catch (error: any) {
      toast({ title: 'Biometria ainda não liberada', description: error?.message || 'A estrutura de homologação não está disponível.', variant: 'destructive' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [toast, userId, waiters]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    let mounted = true;
    getBiometricBridgeStatus()
      .then((status) => { if (mounted) setBridge(status); })
      .catch(() => { if (mounted) setBridge(null); });
    return () => { mounted = false; };
  }, []);

  const selectedEmployee = waiters.find((waiter) => waiter.id === selectedWaiter);
  const activeCollector = collectors.find((collector) => collector.enabled && collector.device_id === bridge?.deviceId)
    || collectors.find((collector) => collector.enabled)
    || null;

  const readiness = useMemo(() => [
    { label: 'Empregador identificado', ok: settings.employer_name.trim().length > 2 && [11, 14].includes(onlyDigits(settings.employer_document).length) },
    { label: 'Estabelecimento informado', ok: settings.establishment_address.trim().length > 8 },
    { label: 'Registro do programa no INPI', ok: onlyDigits(settings.inpi_registration).length >= 8 },
    { label: 'Coletor biométrico autorizado', ok: Boolean(activeCollector) },
    { label: 'Funcionários com biometria', ok: enrollments.length > 0 },
    { label: 'Assinatura PAdES/ICP-Brasil configurada', ok: settings.legal_activation_status === 'ready' },
  ], [activeCollector, enrollments.length, settings]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const basicReady = readiness.slice(0, 3).every((item) => item.ok);
      const payload = {
        user_id: userId,
        biometric_enabled: settings.biometric_enabled,
        rep_mode: basicReady ? 'rep_p' : 'internal',
        legal_activation_status: basicReady ? 'technical_review' : 'draft',
        inpi_registration: onlyDigits(settings.inpi_registration),
        employer_name: settings.employer_name.trim(),
        employer_document: onlyDigits(settings.employer_document),
        caepf: onlyDigits(settings.caepf),
        cno: onlyDigits(settings.cno),
        establishment_address: settings.establishment_address.trim(),
        legal_timezone: settings.legal_timezone,
        biometric_policy_version: settings.biometric_policy_version,
        biometric_retention_days: Math.max(30, Math.min(3650, Number(settings.biometric_retention_days || 1825))),
        biometric_legal_basis: settings.biometric_legal_basis,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('employee_time_clock_settings' as any).upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      toast({ title: 'Configuração biométrica salva', description: basicReady ? 'Cadastro enviado para revisão técnica REP-P.' : 'Salvo como controle interno até concluir os dados obrigatórios.' });
      await loadData();
    } catch (error: any) {
      toast({ title: 'Não foi possível salvar', description: error?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const detectReader = async () => {
    setDetecting(true);
    try {
      const status = await getBiometricBridgeStatus();
      setBridge(status);
      if (!status.configured || !status.deviceId) throw new Error('Configure o leitor no PopConnect e tente novamente.');
      const { data, error } = await supabase.from('employee_time_clock_collectors' as any).upsert({
        user_id: userId,
        device_id: status.deviceId,
        label: status.simulation ? 'Recepção — simulador de homologação' : 'Leitor da recepção',
        provider: status.provider,
        model: status.model || null,
        software_version: 'PopConnect biometric-v1',
        installation_location: 'Recepção',
        enabled: true,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,device_id' }).select('*').single();
      if (error) throw error;
      setCollectors((current) => [data as CollectorRow, ...current.filter((row) => row.id !== (data as any).id)]);
      toast({ title: 'Leitor encontrado', description: status.simulation ? 'Simulador de homologação conectado.' : `${status.model || 'Leitor biométrico'} pronto.` });
    } catch (error: any) {
      toast({ title: 'Leitor não encontrado', description: error?.message || 'Abra o PopConnect.', variant: 'destructive' });
    } finally {
      setDetecting(false);
    }
  };

  const enroll = async () => {
    if (!selectedEmployee || !activeCollector || !bridge) return;
    if (onlyDigits(selectedEmployee.cpf || '').length !== 11) {
      toast({ title: 'CPF obrigatório', description: 'Cadastre o CPF do funcionário antes da biometria.', variant: 'destructive' });
      return;
    }
    if (!privacyAccepted) {
      toast({ title: 'Ciência obrigatória', description: 'Confirme que o aviso de privacidade foi apresentado ao funcionário.', variant: 'destructive' });
      return;
    }
    setEnrolling(true);
    try {
      const result = await enrollBiometric(selectedEmployee.id, fingerPosition);
      const { error: replaceError } = await supabase.from('employee_biometric_enrollments' as any)
        .update({ status: 'replaced', revoked_at: new Date().toISOString(), revoked_by: userId, revocation_reason: 'Recadastro biométrico' })
        .eq('user_id', userId).eq('waiter_id', selectedEmployee.id).eq('finger_position', fingerPosition).eq('status', 'active');
      if (replaceError) throw replaceError;
      const { error } = await supabase.from('employee_biometric_enrollments' as any).insert({
        user_id: userId,
        waiter_id: selectedEmployee.id,
        collector_id: activeCollector.id,
        provider: bridge.provider,
        provider_reference: result.providerReference,
        template_hash: result.templateHash,
        finger_position: fingerPosition,
        quality_score: result.quality || null,
        status: 'active',
        policy_version: settings.biometric_policy_version,
        legal_basis: settings.biometric_legal_basis,
        privacy_notice_accepted_at: new Date().toISOString(),
        enrolled_by: userId,
        metadata: { simulated: Boolean(result.simulated), raw_biometric_stored_in_cloud: false },
      });
      if (error) throw error;
      setPrivacyAccepted(false);
      toast({ title: 'Biometria cadastrada', description: `${selectedEmployee.name || 'Funcionário'} — ${fingerLabels[fingerPosition]}.` });
      await loadData();
    } catch (error: any) {
      toast({ title: 'Falha no cadastro biométrico', description: error?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setEnrolling(false);
    }
  };

  const revokeEnrollment = async (enrollment: EnrollmentRow) => {
    try {
      await removeBiometric(enrollment.provider_reference);
      const { error } = await supabase.from('employee_biometric_enrollments' as any).update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoked_by: userId,
        revocation_reason: 'Revogada pelo administrador',
      }).eq('id', enrollment.id).eq('user_id', userId);
      if (error) throw error;
      toast({ title: 'Biometria revogada', description: 'O histórico foi preservado e a digital não pode mais registrar ponto.' });
      await loadData();
    } catch (error: any) {
      toast({ title: 'Não foi possível revogar', description: error?.message || 'Tente novamente.', variant: 'destructive' });
    }
  };

  const identifyAndPunch = useCallback(async () => {
    if (!activeCollector) {
      setKioskFeedback({ tone: 'error', title: 'Coletor não autorizado', detail: 'Detecte e autorize o leitor nesta tela.' });
      return;
    }
    setIdentifying(true);
    setKioskFeedback({ tone: 'idle', title: 'Aguardando a digital', detail: 'Encoste o dedo no leitor.' });
    try {
      const match = await identifyBiometric();
      const enrollment = enrollments.find((row) => row.provider_reference === match.providerReference && row.status === 'active');
      if (!enrollment) throw new Error('Digital reconhecida no leitor, mas não está ativa no PopSystem.');
      const { data, error } = await (supabase.rpc as any)('register_biometric_time_clock_event', {
        p_waiter_id: enrollment.waiter_id,
        p_collector_id: activeCollector.id,
        p_provider_reference: match.providerReference,
        p_offline_id: crypto.randomUUID(),
        p_occurred_at: null,
        p_metadata: { quality: match.quality || null, liveness_passed: match.livenessPassed ?? null, simulated: Boolean(match.simulated) },
      });
      if (error) throw error;
      const event = Array.isArray(data) ? data[0] : data;
      const employee = waiters.find((row) => row.id === enrollment.waiter_id);
      setKioskFeedback({
        tone: 'success',
        title: `${eventLabels[event?.event_type] || 'Ponto'} registrado`,
        detail: `${employee?.name || 'Funcionário'} · ${new Date(event?.occurred_at || Date.now()).toLocaleTimeString('pt-BR')} · NSR ${event?.nsr || '—'}`,
      });
      await loadData(true);
      await onRegistered?.();
    } catch (error: any) {
      setKioskFeedback({ tone: 'error', title: 'Ponto não registrado', detail: error?.message || 'Digital não reconhecida.' });
    } finally {
      setIdentifying(false);
    }
  }, [activeCollector, enrollments, loadData, onRegistered, waiters]);

  useEffect(() => {
    if (!kioskOpen || bridge?.simulation || !bridge?.configured || !activeCollector || enrollments.length === 0 || identifying) return;
    const delay = kioskFeedback.tone === 'idle' ? 300 : 2500;
    const timer = window.setTimeout(() => { void identifyAndPunch(); }, delay);
    return () => window.clearTimeout(timer);
  }, [activeCollector, bridge?.configured, bridge?.simulation, enrollments.length, identifying, identifyAndPunch, kioskFeedback.tone, kioskOpen]);

  const exportAudit = () => {
    const header = 'NSR;Funcionário;Evento;Data e hora;Origem;SHA-256';
    const lines = marks.map((mark) => {
      const employee = waiters.find((row) => row.id === mark.waiter_id);
      return [mark.nsr || '', employee?.name || '', eventLabels[mark.event_type] || mark.event_type, new Date(mark.occurred_at).toLocaleString('pt-BR'), mark.source || '', mark.mark_hash || ''].join(';');
    });
    downloadText(`ponto-auditoria-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...lines].join('\n'));
  };

  if (loading) {
    return <Card className="rounded-[26px] border-[#E6E0D5]"><CardContent className="flex items-center gap-3 p-6 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Preparando integração biométrica…</CardContent></Card>;
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden rounded-[26px] border-emerald-200 bg-gradient-to-br from-[#052F22] to-[#07543B] text-white">
        <CardContent className="grid gap-5 p-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <Badge className="border-white/20 bg-white/10 text-white hover:bg-white/10">BIOMETRIA FÍSICA + POPCONNECT</Badge>
            <h2 className="mt-4 text-2xl font-bold">Terminal de ponto na recepção</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50/85">Cadastre dois dedos por funcionário e registre entrada, intervalo, retorno e saída pelo leitor. A nuvem guarda somente referência e hash; nunca a imagem ou o template bruto da digital.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Button className="h-12 rounded-2xl bg-[#FF6400] hover:bg-[#e65a00]" onClick={() => void detectReader()} disabled={detecting}>
              {detecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MonitorSmartphone className="mr-2 h-4 w-4" />}
              Detectar PopConnect
            </Button>
            <Button variant="outline" className="h-12 rounded-2xl border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => setKioskOpen(true)} disabled={!bridge?.configured || !activeCollector || enrollments.length === 0 || !settings.biometric_enabled}>
              <Fingerprint className="mr-2 h-4 w-4" /> Abrir terminal de ponto
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-[26px] border-[#E6E0D5]">
          <CardHeader><CardTitle className="flex items-center gap-2"><Fingerprint className="h-5 w-5 text-[#FF6400]" /> Cadastro biométrico</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-5 text-amber-900">
              {bridge?.simulation ? 'Simulador de homologação ativo. Nenhuma digital real é coletada.' : bridge?.configured ? `Leitor conectado: ${bridge.model || bridge.deviceId}` : 'Abra o PopConnect, configure o driver do fabricante e clique em Detectar.'}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Funcionário</Label>
                <Select value={selectedWaiter} onValueChange={setSelectedWaiter}>
                  <SelectTrigger className="h-11 rounded-2xl"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{waiters.map((waiter) => <SelectItem key={waiter.id} value={waiter.id}>{waiter.name || 'Funcionário'}{waiter.cpf ? '' : ' · CPF pendente'}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Dedo</Label>
                <Select value={fingerPosition} onValueChange={setFingerPosition}>
                  <SelectTrigger className="h-11 rounded-2xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(fingerLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm leading-5 text-slate-600">
              <Checkbox checked={privacyAccepted} onCheckedChange={(checked) => setPrivacyAccepted(Boolean(checked))} className="mt-0.5" />
              <span>Confirmo que o funcionário recebeu o aviso de privacidade, finalidade, retenção e forma de revogação antes do cadastro.</span>
            </label>
            <Button className="w-full rounded-2xl bg-[#063B2A] hover:bg-[#04291D]" onClick={() => void enroll()} disabled={!bridge?.configured || !activeCollector || !selectedWaiter || enrolling}>
              {enrolling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Fingerprint className="mr-2 h-4 w-4" />}
              {enrolling ? 'Aguardando três leituras…' : 'Cadastrar digital'}
            </Button>

            <div className="space-y-2">
              {enrollments.length === 0 ? <div className="rounded-2xl border border-dashed p-5 text-center text-sm text-slate-500">Nenhuma digital cadastrada.</div> : enrollments.map((enrollment) => {
                const employee = waiters.find((waiter) => waiter.id === enrollment.waiter_id);
                return <div key={enrollment.id} className="flex items-center justify-between gap-3 rounded-2xl border p-3">
                  <div><div className="font-semibold text-[#063B2A]">{employee?.name || 'Funcionário'}</div><div className="text-xs text-slate-500">{fingerLabels[enrollment.finger_position] || enrollment.finger_position} · qualidade {Math.round(Number(enrollment.quality_score || 0) * 100)}%</div></div>
                  <Button size="icon" variant="ghost" aria-label="Revogar biometria" onClick={() => void revokeEnrollment(enrollment)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                </div>;
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[26px] border-[#E6E0D5]">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[#FF6400]" /> Preparação REP-P</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {readiness.map((item) => <div key={item.label} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm"><span className={item.ok ? 'text-emerald-600' : 'text-slate-400'}>{item.ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}</span><span className="font-medium text-slate-700">{item.label}</span></div>)}
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs leading-5 text-red-800"><strong>Bloqueio legal:</strong> o modo oficial permanece indisponível até existir registro do programa no INPI, certificado ICP-Brasil e validação da assinatura PAdES/AFD. A homologação não deve ser usada para jornada real.</div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-[26px] border-[#E6E0D5]">
        <CardHeader><CardTitle>Dados legais e privacidade</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-emerald-50 px-4 py-3"><div><Label className="font-semibold text-[#063B2A]">Ativar ponto biométrico</Label><p className="mt-1 text-xs text-slate-500">Libera o terminal somente para funcionários cadastrados.</p></div><Switch checked={settings.biometric_enabled} onCheckedChange={(checked) => setSettings((current) => ({ ...current, biometric_enabled: checked }))} /></div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2"><Label>Razão social / empregador</Label><Input className="h-11 rounded-2xl" value={settings.employer_name} onChange={(event) => setSettings((current) => ({ ...current, employer_name: event.target.value }))} /></div>
            <div className="space-y-2"><Label>CNPJ ou CPF</Label><Input className="h-11 rounded-2xl" inputMode="numeric" value={maskDocument(settings.employer_document)} onChange={(event) => setSettings((current) => ({ ...current, employer_document: onlyDigits(event.target.value).slice(0, 14) }))} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Endereço do estabelecimento</Label><Input className="h-11 rounded-2xl" value={settings.establishment_address} onChange={(event) => setSettings((current) => ({ ...current, establishment_address: event.target.value }))} placeholder="Rua, número, bairro, cidade e UF" /></div>
            <div className="space-y-2"><Label>Registro do programa no INPI</Label><Input className="h-11 rounded-2xl" inputMode="numeric" value={settings.inpi_registration} onChange={(event) => setSettings((current) => ({ ...current, inpi_registration: onlyDigits(event.target.value).slice(0, 20) }))} placeholder="Somente números" /></div>
            <div className="space-y-2"><Label>Fuso horário</Label><Select value={settings.legal_timezone} onValueChange={(value) => setSettings((current) => ({ ...current, legal_timezone: value }))}><SelectTrigger className="h-11 rounded-2xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="America/Fortaleza">Fortaleza / Brasília</SelectItem><SelectItem value="America/Sao_Paulo">São Paulo / Brasília</SelectItem><SelectItem value="America/Manaus">Manaus</SelectItem><SelectItem value="America/Rio_Branco">Rio Branco</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>CAEPF (opcional)</Label><Input className="h-11 rounded-2xl" inputMode="numeric" value={settings.caepf} onChange={(event) => setSettings((current) => ({ ...current, caepf: onlyDigits(event.target.value).slice(0, 14) }))} /></div>
            <div className="space-y-2"><Label>CNO (opcional)</Label><Input className="h-11 rounded-2xl" inputMode="numeric" value={settings.cno} onChange={(event) => setSettings((current) => ({ ...current, cno: onlyDigits(event.target.value).slice(0, 14) }))} /></div>
            <div className="space-y-2"><Label>Retenção da referência biométrica</Label><Select value={String(settings.biometric_retention_days)} onValueChange={(value) => setSettings((current) => ({ ...current, biometric_retention_days: Number(value) }))}><SelectTrigger className="h-11 rounded-2xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="365">1 ano</SelectItem><SelectItem value="730">2 anos</SelectItem><SelectItem value="1825">5 anos</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Base legal documentada</Label><Select value={settings.biometric_legal_basis} onValueChange={(value) => setSettings((current) => ({ ...current, biometric_legal_basis: value }))}><SelectTrigger className="h-11 rounded-2xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="obrigacao_legal_regulatoria">Obrigação legal ou regulatória</SelectItem><SelectItem value="exercicio_regular_direitos">Exercício regular de direitos</SelectItem></SelectContent></Select></div>
          </div>
          <Button className="rounded-2xl bg-[#063B2A] hover:bg-[#04291D]" onClick={() => void saveSettings()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{saving ? 'Salvando…' : 'Salvar configuração'}</Button>
        </CardContent>
      </Card>

      <Card className="rounded-[26px] border-[#E6E0D5]">
        <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="flex items-center gap-2"><UserRoundCheck className="h-5 w-5 text-[#FF6400]" /> Marcações biométricas auditáveis</CardTitle><Button variant="outline" size="sm" className="rounded-xl" onClick={exportAudit} disabled={marks.length === 0}><Download className="mr-2 h-4 w-4" /> Exportar auditoria</Button></CardHeader>
        <CardContent className="space-y-2">{marks.length === 0 ? <div className="rounded-2xl border border-dashed p-5 text-center text-sm text-slate-500">Nenhuma marcação biométrica na homologação.</div> : marks.map((mark) => { const employee = waiters.find((row) => row.id === mark.waiter_id); return <div key={mark.id} className="grid gap-2 rounded-2xl border p-3 text-sm sm:grid-cols-[90px_1fr_160px_180px] sm:items-center"><Badge variant="outline">NSR {mark.nsr}</Badge><span className="font-semibold text-[#063B2A]">{employee?.name || 'Funcionário'} · {eventLabels[mark.event_type] || mark.event_type}</span><span className="text-slate-500">{new Date(mark.occurred_at).toLocaleString('pt-BR')}</span><code className="truncate text-xs text-slate-400" title={mark.mark_hash || ''}>{mark.mark_hash || '—'}</code></div>; })}</CardContent>
      </Card>

      <Dialog open={kioskOpen} onOpenChange={setKioskOpen}>
        <DialogContent className="max-w-xl rounded-[28px] p-0" hideClose>
          <DialogHeader className="sr-only"><DialogTitle>Terminal biométrico</DialogTitle><DialogDescription>Registro de ponto por impressão digital</DialogDescription></DialogHeader>
          <div className="rounded-t-[28px] bg-[#063B2A] px-6 py-5 text-white"><div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">PopSystem · Ponto</div><div className="mt-1 text-2xl font-bold">Terminal da recepção</div><div className="mt-1 text-sm text-emerald-100">{new Date().toLocaleDateString('pt-BR')} · horário validado no servidor</div></div>
          <div className="space-y-5 p-6 text-center">
            <div className={`mx-auto flex h-28 w-28 items-center justify-center rounded-full ${kioskFeedback.tone === 'success' ? 'bg-emerald-100 text-emerald-600' : kioskFeedback.tone === 'error' ? 'bg-red-100 text-red-600' : 'bg-orange-50 text-[#FF6400]'}`}>{identifying ? <Loader2 className="h-14 w-14 animate-spin" /> : kioskFeedback.tone === 'success' ? <CheckCircle2 className="h-14 w-14" /> : kioskFeedback.tone === 'error' ? <ShieldAlert className="h-14 w-14" /> : <Fingerprint className="h-14 w-14" />}</div>
            <div><div className="text-2xl font-bold text-[#063B2A]">{kioskFeedback.title}</div><div className="mt-2 text-sm text-slate-500">{kioskFeedback.detail}</div></div>
            {bridge?.simulation ? (
              <Button className="h-12 w-full rounded-2xl bg-[#FF6400] hover:bg-[#e65a00]" onClick={() => void identifyAndPunch()} disabled={identifying}>{identifying ? 'Lendo digital…' : 'Simular leitura agora'}</Button>
            ) : (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Leitura contínua ativa — não é necessário tocar na tela.</div>
            )}
            <Button variant="ghost" className="w-full" onClick={() => setKioskOpen(false)}>Fechar terminal</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
