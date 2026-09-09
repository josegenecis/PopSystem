import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, Copy, FileText, Mail, MapPin, RefreshCw, Send, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { getLocalOperatorSession } from '@/services/operatorAuth';
import { BiometricTimeClockPanel } from '@/components/timeclock/BiometricTimeClockPanel';

type TimeClockSettings = {
  enabled: boolean;
  require_location: boolean;
  require_face_liveness: boolean;
  require_device_binding: boolean;
  allow_outside_radius: boolean;
  restaurant_latitude: number | null;
  restaurant_longitude: number | null;
  allowed_radius_meters: number;
  standard_daily_minutes: number;
  standard_weekly_minutes: number;
  minimum_break_minutes: number;
  overtime_tolerance_minutes: number;
  workdays: number[];
  face_provider: string;
  face_liveness_mode: 'manual_review' | 'provider_webhook' | 'faceio' | 'simple_liveness';
  face_min_score: number;
  face_store_evidence: boolean;
  face_policy_version: string;
  policy_notice: string | null;
};

type AutomationSettings = {
  hr_email: string;
  accounting_email: string;
  send_time_clock_monthly: boolean;
  send_nfce_xml_monthly: boolean;
  report_day: number;
};

type TimeClockEvent = {
  id: string;
  waiter_id: string;
  event_type: string;
  status: string;
  occurred_at: string;
  distance_meters: number | null;
  within_geofence: boolean | null;
  face_status: string;
  face_score?: number | null;
  face_liveness_passed?: boolean | null;
  face_challenge_prompt?: string | null;
  face_evidence?: Record<string, unknown> | null;
  review_reason: string | null;
  waiter?: { name?: string | null; role?: string | null } | null;
};

type WaiterRow = {
  id: string;
  name?: string | null;
  role?: string | null;
  cpf?: string | null;
};

type OccurrenceRow = {
  id: string;
  waiter_id: string;
  occurrence_type: string;
  start_date: string;
  end_date: string;
  paid: boolean;
  affects_expected_hours: boolean;
  notes: string | null;
  status: string;
  waiter?: { name?: string | null; role?: string | null } | null;
};

const defaultSettings: TimeClockSettings = {
  enabled: true,
  require_location: true,
  require_face_liveness: true,
  require_device_binding: true,
  allow_outside_radius: false,
  restaurant_latitude: null,
  restaurant_longitude: null,
  allowed_radius_meters: 120,
  standard_daily_minutes: 480,
  standard_weekly_minutes: 2640,
  minimum_break_minutes: 60,
  overtime_tolerance_minutes: 10,
  workdays: [1, 2, 3, 4, 5, 6],
  face_provider: 'simple_liveness',
  face_liveness_mode: 'simple_liveness',
  face_min_score: 0.75,
  face_store_evidence: false,
  face_policy_version: '2026-05-lgpd-v1',
  policy_notice: 'O ponto registra horário, localização, aparelho e reconhecimento facial somente para controle de jornada.',
};

const defaultAutomationSettings: AutomationSettings = {
  hr_email: '',
  accounting_email: '',
  send_time_clock_monthly: true,
  send_nfce_xml_monthly: true,
  report_day: 1,
};

const eventLabels: Record<string, string> = {
  clock_in: 'Entrada',
  break_start: 'Intervalo',
  break_end: 'Retorno',
  clock_out: 'Saída',
};

const statusTone: Record<string, string> = {
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending_review: 'bg-amber-50 text-amber-700 border-amber-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

const occurrenceLabels: Record<string, string> = {
  vacation: 'Férias',
  medical_certificate: 'Atestado',
  paid_leave: 'Licença remunerada',
  day_off: 'Folga',
  holiday: 'Feriado',
  justified_absence: 'Falta justificada',
  unjustified_absence: 'Falta não justificada',
  manual_adjustment: 'Ajuste manual',
  suspension: 'Suspensão',
  other: 'Outro',
};

const weekdayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const todayIso = () => new Date().toISOString().slice(0, 10);

const minutesToHourInput = (minutes: number) => {
  const hours = Math.floor(Number(minutes || 0) / 60);
  const mins = Number(minutes || 0) % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const hourInputToMinutes = (value: string, fallback: number) => {
  const [hoursRaw, minutesRaw] = String(value || '').split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return Math.max(0, hours * 60 + minutes);
};

export default function ControlePonto() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<TimeClockSettings>(defaultSettings);
  const [automationSettings, setAutomationSettings] = useState<AutomationSettings>(defaultAutomationSettings);
  const [events, setEvents] = useState<TimeClockEvent[]>([]);
  const [waiters, setWaiters] = useState<WaiterRow[]>([]);
  const [occurrences, setOccurrences] = useState<OccurrenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [sendingXml, setSendingXml] = useState(false);
  const [reviewingEventId, setReviewingEventId] = useState<string | null>(null);
  const [savingOccurrence, setSavingOccurrence] = useState(false);
  const [occurrenceForm, setOccurrenceForm] = useState({
    waiter_id: '',
    occurrence_type: 'medical_certificate',
    start_date: todayIso(),
    end_date: todayIso(),
    notes: '',
    paid: true,
    affects_expected_hours: true,
  });
  const employeeAppUrl = `${window.location.origin}/funcionario-login`;

  const todayEvents = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return events.filter((event) => new Date(event.occurred_at).getTime() >= start.getTime());
  }, [events]);

  const presentCount = useMemo(() => {
    const lastByWaiter = new Map<string, TimeClockEvent>();
    todayEvents
      .slice()
      .sort((left, right) => new Date(left.occurred_at).getTime() - new Date(right.occurred_at).getTime())
      .forEach((event) => lastByWaiter.set(event.waiter_id, event));
    return Array.from(lastByWaiter.values()).filter((event) => event.event_type !== 'clock_out' && event.status !== 'rejected').length;
  }, [todayEvents]);

  const loadData = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [settingsResult, eventsResult] = await Promise.all([
        supabase
          .from('employee_time_clock_settings' as any)
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('employee_time_clock_events' as any)
          .select('*')
          .eq('user_id', user.id)
          .order('occurred_at', { ascending: false })
          .limit(80),
      ]);

      if (settingsResult.error) throw settingsResult.error;
      if (eventsResult.error) throw eventsResult.error;

      const { data: waiterRows, error: waiterError } = await supabase
        .from('waiters' as any)
        .select('id, name, role, cpf')
        .eq('user_id', user.id)
        .order('name', { ascending: true });
      if (waiterError) throw waiterError;

      const waitersById = new Map(((waiterRows || []) as WaiterRow[]).map((waiter) => [waiter.id, waiter]));

      const { data: occurrenceRows, error: occurrenceError } = await supabase
        .from('employee_time_clock_occurrences' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('start_date', { ascending: false })
        .limit(60);
      if (occurrenceError) throw occurrenceError;

      const { data: automationData, error: automationError } = await supabase
        .from('business_email_automation_settings' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (automationError) throw automationError;

      setSettings({
        ...defaultSettings,
        ...(settingsResult.data || {}),
        workdays: Array.isArray((settingsResult.data as any)?.workdays) ? (settingsResult.data as any).workdays : defaultSettings.workdays,
      } as TimeClockSettings);
      setAutomationSettings({ ...defaultAutomationSettings, ...(automationData || {}) } as AutomationSettings);
      setWaiters((waiterRows || []) as WaiterRow[]);
      setOccurrences(((occurrenceRows || []) as OccurrenceRow[]).map((occurrence) => ({
        ...occurrence,
        waiter: waitersById.get(occurrence.waiter_id) || null,
      })));
      setOccurrenceForm((current) => ({
        ...current,
        waiter_id: current.waiter_id || ((waiterRows || []) as WaiterRow[])[0]?.id || '',
      }));
      setEvents(((eventsResult.data || []) as TimeClockEvent[]).map((event) => ({
        ...event,
        waiter: waitersById.get(event.waiter_id) || null,
      })));
    } catch (error: any) {
      toast({
        title: 'Erro ao carregar ponto',
        description: error?.message || 'Nao foi possivel carregar o controle de ponto.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [user?.id]);

  const saveSettings = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const payload = {
        ...settings,
        user_id: user.id,
        allowed_radius_meters: Math.max(20, Number(settings.allowed_radius_meters || 120)),
        standard_daily_minutes: Math.max(0, Number(settings.standard_daily_minutes || 480)),
        standard_weekly_minutes: Math.max(0, Number(settings.standard_weekly_minutes || 2640)),
        minimum_break_minutes: Math.max(0, Number(settings.minimum_break_minutes || 60)),
        overtime_tolerance_minutes: Math.max(0, Number(settings.overtime_tolerance_minutes || 10)),
        face_min_score: Math.max(0.1, Math.min(0.99, Number(settings.face_min_score || 0.75))),
        face_liveness_mode: settings.face_liveness_mode || 'simple_liveness',
        face_provider: settings.face_provider || (settings.face_liveness_mode === 'provider_webhook' ? 'provider_webhook' : 'simple_liveness'),
        face_policy_version: settings.face_policy_version || '2026-05-lgpd-v1',
        workdays: Array.isArray(settings.workdays) && settings.workdays.length > 0 ? settings.workdays : defaultSettings.workdays,
        restaurant_latitude: settings.restaurant_latitude === null ? null : Number(settings.restaurant_latitude),
        restaurant_longitude: settings.restaurant_longitude === null ? null : Number(settings.restaurant_longitude),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('employee_time_clock_settings' as any)
        .upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;

      const automationPayload = {
        ...automationSettings,
        user_id: user.id,
        report_day: Math.max(1, Math.min(28, Number(automationSettings.report_day || 1))),
        updated_at: new Date().toISOString(),
      };
      const { error: automationSaveError } = await supabase
        .from('business_email_automation_settings' as any)
        .upsert(automationPayload, { onConflict: 'user_id' });
      if (automationSaveError) throw automationSaveError;

      toast({ title: 'Controle de ponto salvo', description: 'As regras e automacoes ja valem para a equipe.' });
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Erro ao salvar',
        description: error?.message || 'Nao foi possivel salvar as regras.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const copyEmployeeLink = async () => {
    await navigator.clipboard.writeText(employeeAppUrl);
    toast({ title: 'Link copiado', description: 'Envie este link para os funcionarios baterem ponto pelo celular.' });
  };

  const formatEventDate = (value: string) => new Date(value).toLocaleDateString('pt-BR');
  const formatEventTime = (value: string) => new Date(value).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const reviewEvent = async (eventId: string, nextStatus: 'approved' | 'rejected') => {
    setReviewingEventId(eventId);
    try {
      const { error } = await supabase
        .from('employee_time_clock_events' as any)
        .update({
          status: nextStatus,
          reviewed_at: new Date().toISOString(),
          review_reason: nextStatus === 'approved'
            ? 'Registro aprovado manualmente pelo responsavel.'
            : 'Registro rejeitado manualmente pelo responsavel.',
          face_status: nextStatus === 'approved' ? 'verified' : 'failed',
        })
        .eq('id', eventId)
        .eq('user_id', user?.id);
      if (error) throw error;

      toast({
        title: nextStatus === 'approved' ? 'Ponto aprovado' : 'Ponto rejeitado',
        description: 'A revisão foi salva no histórico do controle de ponto.',
      });
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Erro na revisão',
        description: error?.message || 'Nao foi possivel revisar este ponto.',
        variant: 'destructive',
      });
    } finally {
      setReviewingEventId(null);
    }
  };

  const correctEvent = async (event: TimeClockEvent) => {
    const current = new Date(event.occurred_at);
    const localValue = new Date(current.getTime() - current.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    const nextValue = window.prompt('Nova data e hora (AAAA-MM-DDTHH:mm):', localValue);
    if (!nextValue) return;
    const reason = window.prompt('Motivo da correção (obrigatório):', 'Correção solicitada pelo responsável');
    if (!reason) return;
    setReviewingEventId(event.id);
    try {
      const operator = getLocalOperatorSession();
      const { error } = await (supabase.rpc as any)('correct_employee_time_entry', {
        p_event_id: event.id,
        p_occurred_at: new Date(nextValue).toISOString(),
        p_reason: reason,
        p_operator_id: operator?.id || null,
      });
      if (error) throw error;
      toast({ title: 'Ponto corrigido com auditoria', description: 'O original foi preservado e vinculado ao novo registro.' });
      await loadData();
    } catch (error: any) {
      toast({ title: 'Erro na correção', description: error?.message || 'Não foi possível corrigir o ponto.', variant: 'destructive' });
    } finally {
      setReviewingEventId(null);
    }
  };

  const toggleWorkday = (day: number) => {
    setSettings((current) => {
      const currentDays = Array.isArray(current.workdays) ? current.workdays : [];
      const nextDays = currentDays.includes(day)
        ? currentDays.filter((item) => item !== day)
        : [...currentDays, day].sort((left, right) => left - right);
      return { ...current, workdays: nextDays.length > 0 ? nextDays : currentDays };
    });
  };

  const saveOccurrence = async () => {
    if (!user?.id || !occurrenceForm.waiter_id) {
      toast({
        title: 'Informe o funcionário',
        description: 'Selecione quem receberá a ocorrência.',
        variant: 'destructive',
      });
      return;
    }
    setSavingOccurrence(true);
    try {
      const payload = {
        user_id: user.id,
        waiter_id: occurrenceForm.waiter_id,
        occurrence_type: occurrenceForm.occurrence_type,
        start_date: occurrenceForm.start_date,
        end_date: occurrenceForm.end_date || occurrenceForm.start_date,
        paid: occurrenceForm.paid,
        affects_expected_hours: occurrenceForm.affects_expected_hours,
        notes: occurrenceForm.notes.trim() || null,
        created_by: user.id,
        status: 'approved',
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('employee_time_clock_occurrences' as any).insert([payload]);
      if (error) throw error;

      toast({ title: 'Ocorrência registrada', description: 'O relatório do RH já passa a considerar esse lançamento.' });
      setOccurrenceForm((current) => ({ ...current, start_date: todayIso(), end_date: todayIso(), notes: '' }));
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Erro ao registrar ocorrência',
        description: error?.message || 'Nao foi possivel salvar férias, atestado ou ajuste.',
        variant: 'destructive',
      });
    } finally {
      setSavingOccurrence(false);
    }
  };

  const deleteOccurrence = async (occurrenceId: string) => {
    try {
      const { error } = await supabase
        .from('employee_time_clock_occurrences' as any)
        .delete()
        .eq('id', occurrenceId)
        .eq('user_id', user?.id);
      if (error) throw error;
      toast({ title: 'Ocorrência removida', description: 'O lançamento saiu do histórico do ponto.' });
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Erro ao remover',
        description: error?.message || 'Nao foi possivel remover a ocorrência.',
        variant: 'destructive',
      });
    }
  };

  const persistAutomationSettings = async () => {
    if (!user?.id) throw new Error('Usuario nao autenticado.');
    const automationPayload = {
      ...automationSettings,
      user_id: user.id,
      hr_email: automationSettings.hr_email.trim(),
      accounting_email: automationSettings.accounting_email.trim(),
      report_day: Math.max(1, Math.min(28, Number(automationSettings.report_day || 1))),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('business_email_automation_settings' as any)
      .upsert(automationPayload, { onConflict: 'user_id' });
    if (error) throw error;
  };

  const sendAutomationNow = async (operation: 'send_time_clock_monthly_report' | 'send_nfce_xml_monthly') => {
    const isTimeClock = operation === 'send_time_clock_monthly_report';
    if (isTimeClock) setSendingReport(true);
    else setSendingXml(true);

    try {
      await persistAutomationSettings();
      const { data, error } = await supabase.functions.invoke('business-automations', {
        body: { operation, mode: 'manual' },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error(String((data as any).error));
      toast({
        title: isTimeClock ? 'Relatório enviado' : 'XML enviado',
        description: (data as any)?.message || 'Automação executada com sucesso.',
      });
    } catch (error: any) {
      toast({
        title: isTimeClock ? 'Erro ao enviar relatório' : 'Erro ao enviar XML',
        description: error?.message || 'Confira o email configurado e tente novamente.',
        variant: 'destructive',
      });
    } finally {
      if (isTimeClock) setSendingReport(false);
      else setSendingXml(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFDF7] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-[28px] bg-[#063B2A] p-6 text-white shadow-[0_20px_60px_-40px_rgba(0,50,35,0.65)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#D9FF9B]">
                <Clock3 className="h-4 w-4" />
                Ponto inteligente
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-tight">Controle de ponto da equipe</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/72">
                Controle a entrada e saída dos funcionários com localização, aparelho autorizado e validação facial.
              </p>
            </div>
            <Button className="rounded-2xl bg-[#FF6400] hover:bg-[#E25A00]" onClick={() => void loadData()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>
        </div>

        <Card className="rounded-[24px] border-[#E6E0D5]">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-bold text-[#063B2A]">Link do app de ponto do funcionário</div>
              <div className="mt-1 break-all text-sm text-slate-500">{employeeAppUrl}</div>
            </div>
            <Button variant="outline" className="rounded-2xl" onClick={() => void copyEmployeeLink()}>
              <Copy className="mr-2 h-4 w-4" />
              Copiar link
            </Button>
          </CardContent>
        </Card>

        {user?.id && (
          <BiometricTimeClockPanel
            userId={user.id}
            waiters={waiters}
            onRegistered={loadData}
          />
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-[22px] border-[#E6E0D5]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-600"><Users className="h-4 w-4" /> Funcionários trabalhando</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-[#063B2A]">{presentCount}</CardContent>
          </Card>
          <Card className="rounded-[22px] border-[#E6E0D5]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-600"><ShieldCheck className="h-4 w-4" /> Pontos para revisar</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-amber-600">{events.filter((event) => event.status === 'pending_review').length}</CardContent>
          </Card>
          <Card className="rounded-[22px] border-[#E6E0D5]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4" /> Distância permitida</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-[#063B2A]">{settings.allowed_radius_meters}m</CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.4fr]">
          <Card className="rounded-[26px] border-[#E6E0D5]">
            <CardHeader>
              <CardTitle>Regras do ponto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {[
                ['enabled', 'Ativar controle de ponto'],
                ['require_location', 'Exigir localização ao bater ponto'],
                ['require_face_liveness', 'Exigir reconhecimento facial'],
                ['require_device_binding', 'Vincular aparelho do funcionário'],
                ['allow_outside_radius', 'Permitir ponto fora do raio com revisão'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
                  <Label className="text-sm font-semibold text-[#063B2A]">{label}</Label>
                  <Switch
                    checked={Boolean((settings as any)[key])}
                    onCheckedChange={(checked) => setSettings((current) => ({ ...current, [key]: checked }))}
                  />
                </div>
              ))}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Latitude do restaurante</Label>
                  <Input
                    value={settings.restaurant_latitude ?? ''}
                    onChange={(event) => setSettings((current) => ({ ...current, restaurant_latitude: event.target.value ? Number(event.target.value) : null }))}
                    placeholder="-3.7319"
                    className="h-11 rounded-2xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Longitude do restaurante</Label>
                  <Input
                    value={settings.restaurant_longitude ?? ''}
                    onChange={(event) => setSettings((current) => ({ ...current, restaurant_longitude: event.target.value ? Number(event.target.value) : null }))}
                    placeholder="-38.5267"
                    className="h-11 rounded-2xl"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Raio permitido em metros</Label>
                  <Input
                    type="number"
                    min={20}
                    value={settings.allowed_radius_meters}
                    onChange={(event) => setSettings((current) => ({ ...current, allowed_radius_meters: Number(event.target.value || 120) }))}
                    className="h-11 rounded-2xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Como validar o rosto</Label>
                  <Select
                    value={settings.face_liveness_mode}
                    onValueChange={(value) => setSettings((current) => ({
                      ...current,
                      face_liveness_mode: value as TimeClockSettings['face_liveness_mode'],
                      face_provider: value === 'provider_webhook' ? 'provider_webhook' : value === 'simple_liveness' ? 'simple_liveness' : 'manual_review',
                    }))}
                  >
                    <SelectTrigger className="h-11 rounded-2xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple_liveness">Cadastro facial simples</SelectItem>
                      <SelectItem value="manual_review">Revisão manual</SelectItem>
                      <SelectItem value="provider_webhook">Validação facial externa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-2xl border border-[#E6E0D5] bg-white p-4">
                <div className="mb-3 flex items-center gap-2 font-semibold text-[#063B2A]">
                  <ShieldCheck className="h-4 w-4 text-[#FF6400]" />
                  Reconhecimento facial e LGPD
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Provedor facial</Label>
                    <Input
                      value={settings.face_provider}
                      onChange={(event) => setSettings((current) => ({ ...current, face_provider: event.target.value || 'simple_liveness' }))}
                      placeholder="simple_liveness ou provider_webhook"
                      className="h-11 rounded-2xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Score mínimo da API</Label>
                    <Input
                      type="number"
                      min={0.1}
                      max={0.99}
                      step={0.01}
                      value={settings.face_min_score}
                      onChange={(event) => setSettings((current) => ({
                        ...current,
                        face_min_score: Math.max(0.1, Math.min(0.99, Number(event.target.value || 0.75))),
                      }))}
                      className="h-11 rounded-2xl"
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
                  <div>
                    <Label className="text-sm font-semibold text-[#063B2A]">Guardar imagem bruta como evidência</Label>
                    <p className="mt-1 text-xs leading-4 text-slate-500">
                      Recomendado deixar desligado. O sistema guarda hashes, desafio, score e metadados mínimos.
                    </p>
                  </div>
                  <Switch
                    checked={settings.face_store_evidence}
                    onCheckedChange={(checked) => setSettings((current) => ({ ...current, face_store_evidence: checked }))}
                  />
                </div>
                <div className="mt-3 space-y-2">
                  <Label>Termo exibido ao funcionário</Label>
                  <Textarea
                    value={settings.policy_notice || ''}
                    onChange={(event) => setSettings((current) => ({ ...current, policy_notice: event.target.value }))}
                    className="min-h-[96px] rounded-2xl"
                    placeholder="Informe de forma clara o uso de câmera, localização, finalidade e retenção."
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-[#E6E0D5] bg-white p-4">
                <div className="mb-3 flex items-center gap-2 font-semibold text-[#063B2A]">
                  <CalendarDays className="h-4 w-4 text-[#FF6400]" />
                  Jornada e banco de horas
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Jornada diária</Label>
                    <Input
                      type="time"
                      value={minutesToHourInput(settings.standard_daily_minutes)}
                      onChange={(event) => setSettings((current) => ({
                        ...current,
                        standard_daily_minutes: hourInputToMinutes(event.target.value, current.standard_daily_minutes),
                      }))}
                      className="h-11 rounded-2xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Jornada semanal</Label>
                    <Input
                      type="text"
                      value={minutesToHourInput(settings.standard_weekly_minutes)}
                      placeholder="44:00"
                      onChange={(event) => setSettings((current) => ({
                        ...current,
                        standard_weekly_minutes: hourInputToMinutes(event.target.value, current.standard_weekly_minutes),
                      }))}
                      className="h-11 rounded-2xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Intervalo mínimo</Label>
                    <Input
                      type="time"
                      value={minutesToHourInput(settings.minimum_break_minutes)}
                      onChange={(event) => setSettings((current) => ({
                        ...current,
                        minimum_break_minutes: hourInputToMinutes(event.target.value, current.minimum_break_minutes),
                      }))}
                      className="h-11 rounded-2xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tolerância extra/atraso em min</Label>
                    <Input
                      type="number"
                      min={0}
                      value={settings.overtime_tolerance_minutes}
                      onChange={(event) => setSettings((current) => ({
                        ...current,
                        overtime_tolerance_minutes: Math.max(0, Number(event.target.value || 0)),
                      }))}
                      className="h-11 rounded-2xl"
                    />
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <Label>Dias previstos de trabalho</Label>
                  <div className="grid grid-cols-7 gap-2">
                    {weekdayLabels.map((label, index) => (
                      <Button
                        key={label}
                        type="button"
                        variant={settings.workdays?.includes(index) ? 'default' : 'outline'}
                        className={`h-10 rounded-xl px-0 text-xs ${settings.workdays?.includes(index) ? 'bg-[#063B2A] hover:bg-[#04291D]' : ''}`}
                        onClick={() => toggleWorkday(index)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <Button className="w-full rounded-2xl bg-[#063B2A] hover:bg-[#04291D]" onClick={() => void saveSettings()} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar regras'}
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-[26px] border-[#E6E0D5]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-[#FF6400]" />
                Envio automático para RH e contador
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Email do RH</Label>
                  <Input
                    type="email"
                    value={automationSettings.hr_email}
                    onChange={(event) => setAutomationSettings((current) => ({ ...current, hr_email: event.target.value }))}
                    placeholder="rh@empresa.com"
                    className="h-11 rounded-2xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email do contador</Label>
                  <Input
                    type="email"
                    value={automationSettings.accounting_email}
                    onChange={(event) => setAutomationSettings((current) => ({ ...current, accounting_email: event.target.value }))}
                    placeholder="contador@contabilidade.com"
                    className="h-11 rounded-2xl"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="font-semibold text-[#063B2A]">Envio mensal automático</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    O sistema fica preparado para enviar no dia configurado. O disparo usa a Edge Function de automações.
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Dia do mês</Label>
                  <Input
                    type="number"
                    min={1}
                    max={28}
                    value={automationSettings.report_day}
                    onChange={(event) => setAutomationSettings((current) => ({ ...current, report_day: Number(event.target.value || 1) }))}
                    className="h-11 rounded-2xl"
                  />
                </div>
              </div>

              {[
                ['send_time_clock_monthly', 'Enviar relatório mensal de ponto para RH'],
                ['send_nfce_xml_monthly', 'Enviar XML mensal NFC-e para contabilidade'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
                  <Label className="text-sm font-semibold text-[#063B2A]">{label}</Label>
                  <Switch
                    checked={Boolean((automationSettings as any)[key])}
                    onCheckedChange={(checked) => setAutomationSettings((current) => ({ ...current, [key]: checked }))}
                  />
                </div>
              ))}

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => void sendAutomationNow('send_time_clock_monthly_report')}
                  disabled={sendingReport}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {sendingReport ? 'Enviando...' : 'Enviar ponto agora'}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => void sendAutomationNow('send_nfce_xml_monthly')}
                  disabled={sendingXml}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {sendingXml ? 'Enviando...' : 'Enviar XML agora'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-[26px] border-[#E6E0D5]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#FF6400]" />
              Ocorrências trabalhistas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr_1fr_1fr]">
              <div className="space-y-2">
                <Label>Funcionário</Label>
                <Select
                  value={occurrenceForm.waiter_id}
                  onValueChange={(value) => setOccurrenceForm((current) => ({ ...current, waiter_id: value }))}
                >
                  <SelectTrigger className="h-11 rounded-2xl">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {waiters.map((waiter) => (
                      <SelectItem key={waiter.id} value={waiter.id}>{waiter.name || 'Funcionário'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={occurrenceForm.occurrence_type}
                  onValueChange={(value) => setOccurrenceForm((current) => ({
                    ...current,
                    occurrence_type: value,
                    affects_expected_hours: !['unjustified_absence', 'suspension'].includes(value),
                    paid: !['unjustified_absence', 'suspension'].includes(value),
                  }))}
                >
                  <SelectTrigger className="h-11 rounded-2xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(occurrenceLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Início</Label>
                <Input
                  type="date"
                  value={occurrenceForm.start_date}
                  onChange={(event) => setOccurrenceForm((current) => ({
                    ...current,
                    start_date: event.target.value,
                    end_date: current.end_date || event.target.value,
                  }))}
                  className="h-11 rounded-2xl"
                />
              </div>
              <div className="space-y-2">
                <Label>Fim</Label>
                <Input
                  type="date"
                  value={occurrenceForm.end_date}
                  onChange={(event) => setOccurrenceForm((current) => ({ ...current, end_date: event.target.value }))}
                  className="h-11 rounded-2xl"
                />
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
              <div className="space-y-2">
                <Label>Observação</Label>
                <Textarea
                  value={occurrenceForm.notes}
                  onChange={(event) => setOccurrenceForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="CID, número do atestado, decisão do RH, ajuste autorizado..."
                  className="min-h-[92px] rounded-2xl"
                />
              </div>
              <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-semibold text-[#063B2A]">Abona horas</Label>
                  <Switch
                    checked={occurrenceForm.affects_expected_hours}
                    onCheckedChange={(checked) => setOccurrenceForm((current) => ({ ...current, affects_expected_hours: checked }))}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-semibold text-[#063B2A]">Remunerado</Label>
                  <Switch
                    checked={occurrenceForm.paid}
                    onCheckedChange={(checked) => setOccurrenceForm((current) => ({ ...current, paid: checked }))}
                  />
                </div>
              </div>
              <Button
                className="h-full min-h-[92px] rounded-2xl bg-[#FF6400] hover:bg-[#E25A00]"
                onClick={() => void saveOccurrence()}
                disabled={savingOccurrence || waiters.length === 0}
              >
                {savingOccurrence ? 'Salvando...' : 'Registrar ocorrência'}
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funcionário</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Regra</TableHead>
                  <TableHead>Observação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {occurrences.map((occurrence) => (
                  <TableRow key={occurrence.id}>
                    <TableCell className="font-medium">{occurrence.waiter?.name || 'Funcionário'}</TableCell>
                    <TableCell>{occurrenceLabels[occurrence.occurrence_type] || occurrence.occurrence_type}</TableCell>
                    <TableCell>
                      {new Date(`${occurrence.start_date}T00:00:00`).toLocaleDateString('pt-BR')}
                      {' até '}
                      {new Date(`${occurrence.end_date}T00:00:00`).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{occurrence.affects_expected_hours ? 'Abona horas' : 'Não abona'}</Badge>
                        <Badge variant="outline">{occurrence.paid ? 'Remunerado' : 'Não remunerado'}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[360px] text-sm text-slate-500">{occurrence.notes || '-'}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl border-red-200 text-red-700 hover:bg-red-50"
                        onClick={() => void deleteOccurrence(occurrence.id)}
                      >
                        Remover
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {occurrences.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                      Nenhuma ocorrência lançada. Use este espaço para férias, atestados, folgas, feriados e ajustes do RH.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1fr]">
          <Card className="rounded-[26px] border-[#E6E0D5]">
            <CardHeader>
              <CardTitle>Últimos pontos</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Funcionário</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>GPS</TableHead>
                    <TableHead>Facial</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Hora</TableHead>
                    <TableHead className="text-right">Revisão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{event.waiter?.name || 'Funcionário'}</TableCell>
                      <TableCell>{eventLabels[event.event_type] || event.event_type}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="outline" className={statusTone[event.status] || 'bg-slate-50 text-slate-700'}>
                            {event.status === 'approved' ? 'Aprovado' : event.status === 'rejected' ? 'Rejeitado' : 'Revisão'}
                          </Badge>
                          {event.review_reason && (
                            <div className="max-w-[260px] text-xs leading-4 text-slate-500">{event.review_reason}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{event.distance_meters != null ? `${Math.round(Number(event.distance_meters))}m` : '-'}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="outline" className={
                            event.face_status === 'verified'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : event.face_status === 'failed'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : event.face_status === 'pending_review'
                                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                                  : 'border-slate-200 bg-slate-50 text-slate-600'
                          }>
                            {event.face_status === 'verified'
                              ? 'Verificada'
                              : event.face_status === 'failed'
                                ? 'Falhou'
                                : event.face_status === 'pending_review'
                                  ? 'Revisão'
                                  : 'Não exigida'}
                          </Badge>
                          {event.face_score != null && (
                            <div className="text-xs text-slate-500">Score {(Number(event.face_score) * 100).toFixed(0)}%</div>
                          )}
                          {event.face_challenge_prompt && (
                            <div className="max-w-[220px] text-xs leading-4 text-slate-500">{event.face_challenge_prompt}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{formatEventDate(event.occurred_at)}</TableCell>
                      <TableCell>{formatEventTime(event.occurred_at)}</TableCell>
                      <TableCell className="text-right">
                        {event.status === 'pending_review' ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 rounded-xl border-red-200 text-red-700 hover:bg-red-50"
                              onClick={() => void reviewEvent(event.id, 'rejected')}
                              disabled={reviewingEventId === event.id}
                            >
                              Rejeitar
                            </Button>
                            <Button
                              size="sm"
                              className="h-9 rounded-xl bg-[#063B2A] hover:bg-[#04291D]"
                              onClick={() => void reviewEvent(event.id, 'approved')}
                              disabled={reviewingEventId === event.id}
                            >
                              Aprovar
                            </Button>
                          </div>
                        ) : event.status !== 'rejected' ? (
                          <Button size="sm" variant="outline" disabled={reviewingEventId === event.id} onClick={() => void correctEvent(event)}>Corrigir</Button>
                        ) : <span className="text-sm text-slate-400">Substituído/rejeitado</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {events.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-slate-500">
                        Nenhum ponto registrado ainda.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
