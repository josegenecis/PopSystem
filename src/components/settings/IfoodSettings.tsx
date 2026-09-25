/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MapPin,
  PauseCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';
import { IfoodLogo } from '@/components/icons/IfoodLogo';

type MerchantOption = {
  id: string;
  name: string;
  corporateName?: string;
};

type MerchantInterruption = {
  id: string;
  description: string;
  start: string;
  end: string;
};

type DayKey = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';
type ShiftEditor = { start: string; end: string };

const days: Array<{ key: DayKey; label: string }> = [
  { key: 'MONDAY', label: 'Segunda-feira' },
  { key: 'TUESDAY', label: 'Terça-feira' },
  { key: 'WEDNESDAY', label: 'Quarta-feira' },
  { key: 'THURSDAY', label: 'Quinta-feira' },
  { key: 'FRIDAY', label: 'Sexta-feira' },
  { key: 'SATURDAY', label: 'Sábado' },
  { key: 'SUNDAY', label: 'Domingo' },
];

const emptyWeek = (): Record<DayKey, ShiftEditor[]> => ({
  MONDAY: [], TUESDAY: [], WEDNESDAY: [], THURSDAY: [],
  FRIDAY: [], SATURDAY: [], SUNDAY: [],
});

const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? (hours * 60) + minutes : 0;
};

const minutesToTime = (minutes: number) => {
  const normalized = Math.max(0, Math.min(24 * 60 - 1, minutes));
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};

const normalizeOpeningHours = (raw: any): Record<DayKey, ShiftEditor[]> => {
  const week = emptyWeek();
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.shifts) ? raw.shifts : [];
  const shifts = source.flatMap((item: any) => Array.isArray(item?.shifts) ? item.shifts : [item]);
  shifts.forEach((shift: any) => {
    const day = String(shift?.dayOfWeek || '').toUpperCase() as DayKey;
    if (!Object.prototype.hasOwnProperty.call(week, day)) return;
    const start = String(shift?.start || '').slice(0, 5);
    const duration = Number(shift?.duration || 0);
    if (!/^\d{2}:\d{2}$/.test(start) || duration <= 0) return;
    week[day].push({ start, end: minutesToTime(timeToMinutes(start) + duration) });
  });
  days.forEach(({ key }) => week[key].sort((left, right) => left.start.localeCompare(right.start)));
  return week;
};

const toLocalDateTimeInput = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const formatApiError = (error: unknown) => {
  const value = String(error || 'Não foi possível concluir a operação.');
  if (/InterruptionOverlap/i.test(value)) return 'Já existe uma pausa nesse período. Ajuste o horário e tente novamente.';
  if (/invalid_interruption_period/i.test(value)) return 'A pausa deve durar entre 1 minuto e 7 dias.';
  if (/invalid_opening_hours/i.test(value)) return 'Revise os horários. O encerramento precisa ser posterior à abertura e não pode haver sobreposição.';
  return value;
};

type IfoodSettingsData = {
  merchant_id: string;
  merchant_name: string;
  merchant_state: string;
  merchant_enabled: boolean;
  status: 'online' | 'offline' | 'paused';
  client_id: string;
  client_secret_configured: boolean;
  access_token_configured: boolean;
  access_token_expires_at: string | null;
  webhook_url: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
};

const emptySettings: IfoodSettingsData = {
  merchant_id: '',
  merchant_name: '',
  merchant_state: 'offline',
  merchant_enabled: false,
  status: 'offline',
  client_id: '',
  client_secret_configured: false,
  access_token_configured: false,
  access_token_expires_at: null,
  webhook_url: '',
  last_sync_at: null,
  last_sync_status: null,
  last_sync_message: null,
};

const IfoodSettings = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [settings, setSettings] = useState<IfoodSettingsData>(emptySettings);
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [merchantStatus, setMerchantStatus] = useState<any>(null);
  const [merchantDetails, setMerchantDetails] = useState<any>(null);
  const [merchantLoading, setMerchantLoading] = useState(false);
  const [interruptions, setInterruptions] = useState<MerchantInterruption[]>([]);
  const [interruptionLoading, setInterruptionLoading] = useState(false);
  const [openingHoursLoading, setOpeningHoursLoading] = useState(false);
  const [week, setWeek] = useState<Record<DayKey, ShiftEditor[]>>(emptyWeek);
  const [evidenceNow, setEvidenceNow] = useState(new Date());
  const initialPauseStart = new Date(Date.now() + 60_000);
  const initialPauseEnd = new Date(Date.now() + 61 * 60_000);
  const [pauseForm, setPauseForm] = useState({
    description: 'Pausa de homologação',
    start: toLocalDateTimeInput(initialPauseStart),
    end: toLocalDateTimeInput(initialPauseEnd),
  });
  const [formData, setFormData] = useState({
    clientId: '',
    clientSecret: '',
    merchantId: '',
  });

  useEffect(() => {
    const timer = window.setInterval(() => setEvidenceNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadMerchantWorkspace = async (merchantId: string) => {
    if (!merchantId) return;
    try {
      setMerchantLoading(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'merchant_details', merchantId,
      });
      if (status >= 400 || !data?.ok) throw new Error(String(data?.message || data?.error || 'Falha ao consultar a loja'));
      setMerchantDetails(data.merchant || null);
      setMerchantStatus(data.merchantStatus || null);
    } catch (error: any) {
      toast({ title: 'Erro ao consultar loja', description: formatApiError(error?.message || error), variant: 'destructive' });
    } finally {
      setMerchantLoading(false);
    }
  };

  const loadInterruptions = async (merchantId = formData.merchantId || settings.merchant_id) => {
    if (!merchantId) return;
    try {
      setInterruptionLoading(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'list_interruptions', merchantId,
      });
      if (status >= 400 || !data?.ok) throw new Error(String(data?.message || data?.error || 'Falha ao listar pausas'));
      setInterruptions(Array.isArray(data.interruptions) ? data.interruptions : []);
    } catch (error: any) {
      toast({ title: 'Erro ao listar pausas', description: formatApiError(error?.message || error), variant: 'destructive' });
    } finally {
      setInterruptionLoading(false);
    }
  };

  const loadOpeningHours = async (merchantId = formData.merchantId || settings.merchant_id) => {
    if (!merchantId) return;
    try {
      setOpeningHoursLoading(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'get_opening_hours', merchantId,
      });
      if (status >= 400 || !data?.ok) throw new Error(String(data?.message || data?.error || 'Falha ao consultar horários'));
      setWeek(normalizeOpeningHours(data.openingHours));
    } catch (error: any) {
      toast({ title: 'Erro ao consultar horários', description: formatApiError(error?.message || error), variant: 'destructive' });
    } finally {
      setOpeningHoursLoading(false);
    }
  };

  const loadOverview = async () => {
    try {
      setLoading(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', { action: 'overview' });
      if (status >= 400 || !data?.ok) {
        throw new Error(String(data?.message || data?.error || 'Não foi possível carregar iFood'));
      }

      const nextSettings = { ...emptySettings, ...(data.settings || {}) };
      setSettings(nextSettings);
      setMerchants(Array.isArray(data.merchants) ? data.merchants : []);
      setMerchantStatus(data.merchantStatus || null);
      setFormData((prev) => ({
        clientId: nextSettings.client_id || prev.clientId,
        clientSecret: '',
        merchantId: nextSettings.merchant_id || prev.merchantId,
      }));
      if (nextSettings.merchant_id) {
        await Promise.all([
          loadMerchantWorkspace(nextSettings.merchant_id),
          loadInterruptions(nextSettings.merchant_id),
          loadOpeningHours(nextSettings.merchant_id),
        ]);
      }
    } catch (error: any) {
      toast({
        title: 'Erro ao carregar iFood',
        description: String(error?.message || error),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
    // A carga inicial deve ocorrer uma única vez; as atualizações seguintes são explícitas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveCredentials = async () => {
    try {
      setLoading(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'save_credentials',
        clientId: formData.clientId,
        clientSecret: formData.clientSecret,
        merchantId: formData.merchantId,
        merchantEnabled: settings.merchant_enabled,
      });

      if (status >= 400 || !data?.ok) {
        throw new Error(String(data?.message || data?.error || 'Falha ao validar credenciais'));
      }

      toast({
        title: 'iFood conectado',
        description: 'Credenciais validadas e merchants carregados com sucesso.',
      });

      setFormData((prev) => ({ ...prev, clientSecret: '', merchantId: data?.settings?.merchant_id || prev.merchantId }));
      await loadOverview();
    } catch (error: any) {
      toast({
        title: 'Falha na conexão',
        description: String(error?.message || error),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMerchant = async (merchantId: string) => {
    setFormData((prev) => ({ ...prev, merchantId }));
    if (!merchantId) return;

    try {
      setLoading(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'select_merchant',
        merchantId,
      });

      if (status >= 400 || !data?.ok) {
        throw new Error(String(data?.message || data?.error || 'Falha ao selecionar merchant'));
      }

      toast({
        title: 'Loja vinculada',
        description: 'Merchant iFood vinculado ao PopSystem.',
      });
      await loadOverview();
    } catch (error: any) {
      toast({
        title: 'Erro ao vincular loja',
        description: String(error?.message || error),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInterruption = async () => {
    const merchantId = formData.merchantId || settings.merchant_id;
    if (!merchantId) return;
    try {
      setInterruptionLoading(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'create_interruption',
        merchantId,
        description: pauseForm.description,
        start: new Date(pauseForm.start).toISOString(),
        end: new Date(pauseForm.end).toISOString(),
      });
      if (status >= 400 || !data?.ok) throw new Error(String(data?.message || data?.error || 'Falha ao criar pausa'));
      toast({ title: 'Pausa criada no iFood', description: 'Aguarde alguns segundos para a atualização aparecer no Portal do Parceiro.' });
      await Promise.all([loadInterruptions(merchantId), loadMerchantWorkspace(merchantId)]);
    } catch (error: any) {
      toast({ title: 'Não foi possível criar a pausa', description: formatApiError(error?.message || error), variant: 'destructive' });
    } finally {
      setInterruptionLoading(false);
    }
  };

  const handleDeleteInterruption = async (interruptionId: string) => {
    const merchantId = formData.merchantId || settings.merchant_id;
    if (!merchantId || !interruptionId) return;
    try {
      setInterruptionLoading(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'delete_interruption', merchantId, interruptionId,
      });
      if (status >= 400 || !data?.ok) throw new Error(String(data?.message || data?.error || 'Falha ao remover pausa'));
      toast({ title: 'Pausa removida do iFood', description: 'A loja será reavaliada pelo iFood em alguns segundos.' });
      await Promise.all([loadInterruptions(merchantId), loadMerchantWorkspace(merchantId)]);
    } catch (error: any) {
      toast({ title: 'Não foi possível remover a pausa', description: formatApiError(error?.message || error), variant: 'destructive' });
    } finally {
      setInterruptionLoading(false);
    }
  };

  const updateShift = (day: DayKey, index: number, field: keyof ShiftEditor, value: string) => {
    setWeek((current) => ({
      ...current,
      [day]: current[day].map((shift, shiftIndex) => shiftIndex === index ? { ...shift, [field]: value } : shift),
    }));
  };

  const addShift = (day: DayKey) => {
    setWeek((current) => ({ ...current, [day]: [...current[day], { start: '09:00', end: '18:00' }] }));
  };

  const removeShift = (day: DayKey, index: number) => {
    setWeek((current) => ({ ...current, [day]: current[day].filter((_, shiftIndex) => shiftIndex !== index) }));
  };

  const fillHomologationSchedule = () => {
    setWeek((current) => ({
      ...current,
      SATURDAY: [{ start: '10:00', end: '19:00' }],
      SUNDAY: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '16:00' },
        { start: '17:00', end: '23:00' },
      ],
    }));
    toast({ title: 'Cenário preenchido', description: 'Sábado e domingo foram preparados. Os demais dias foram preservados.' });
  };

  const handleSaveOpeningHours = async () => {
    const merchantId = formData.merchantId || settings.merchant_id;
    if (!merchantId) return;
    const shifts = days.flatMap(({ key }) => week[key].map((shift) => ({ dayOfWeek: key, ...shift })));
    const hasInvalid = shifts.some((shift) => timeToMinutes(shift.end) <= timeToMinutes(shift.start));
    const hasOverlap = days.some(({ key }) => {
      const ordered = week[key].map((shift) => ({ start: timeToMinutes(shift.start), end: timeToMinutes(shift.end) }))
        .sort((left, right) => left.start - right.start);
      return ordered.some((shift, index) => index > 0 && shift.start < ordered[index - 1].end);
    });
    if (hasInvalid || hasOverlap) {
      toast({ title: 'Revise os horários', description: 'O fechamento deve ser posterior à abertura e os turnos não podem se sobrepor.', variant: 'destructive' });
      return;
    }

    try {
      setOpeningHoursLoading(true);
      const payload = shifts.map((shift) => ({
        dayOfWeek: shift.dayOfWeek,
        start: `${shift.start}:00`,
        duration: timeToMinutes(shift.end) - timeToMinutes(shift.start),
      }));
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'update_opening_hours', merchantId, shifts: payload,
      });
      if (status >= 400 || !data?.ok) throw new Error(String(data?.message || data?.error || 'Falha ao atualizar horários'));
      toast({ title: 'Horários atualizados no iFood', description: 'A grade completa foi salva. Consulte novamente para validar o retorno.' });
      await Promise.all([loadOpeningHours(merchantId), loadMerchantWorkspace(merchantId)]);
    } catch (error: any) {
      toast({ title: 'Não foi possível atualizar os horários', description: formatApiError(error?.message || error), variant: 'destructive' });
    } finally {
      setOpeningHoursLoading(false);
    }
  };

  const handleToggleEnabled = async (checked: boolean) => {
    try {
      setLoading(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'toggle_enabled',
        enabled: checked,
      });

      if (status >= 400 || !data?.ok) {
        throw new Error(String(data?.message || data?.error || 'Falha ao alternar integração'));
      }

      setSettings((prev) => ({
        ...prev,
        ...(data.settings || {}),
      }));
      toast({
        title: checked ? 'Integração ativada' : 'Integração pausada',
        description: checked
          ? 'O PopSystem está pronto para receber pedidos do iFood.'
          : 'O PopSystem parou de processar pedidos do iFood.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao alterar status',
        description: String(error?.message || error),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSyncEvents = async () => {
    try {
      setSyncing(true);
      const { data, status } = await invokeEdgeFunction('ifood-manager', {
        action: 'sync_events',
      });

      if (status >= 400 || !data?.ok) {
        throw new Error(String(data?.message || data?.error || 'Falha ao sincronizar eventos'));
      }

      toast({
        title: 'Sincronização concluída',
        description: `${data?.summary?.processed || 0} evento(s) processado(s).`,
      });
      await loadOverview();
    } catch (error: any) {
      toast({
        title: 'Erro na sincronização',
        description: String(error?.message || error),
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const formatDateTime = (value: string | null) => {
    if (!value) return 'Ainda não sincronizado';
    try {
      return new Date(value).toLocaleString('pt-BR');
    } catch {
      return value;
    }
  };

  const statusTone =
    settings.status === 'online'
      ? 'bg-green-100 text-green-700 border-green-200'
      : 'bg-slate-100 text-slate-700 border-slate-200';

  const selectedMerchantId = formData.merchantId || settings.merchant_id;
  const merchantAddress = merchantDetails?.address || {};
  const addressText = [
    merchantAddress?.streetName || merchantAddress?.street,
    merchantAddress?.streetNumber || merchantAddress?.number,
    merchantAddress?.neighborhood,
    merchantAddress?.city,
    merchantAddress?.state,
    merchantAddress?.postalCode || merchantAddress?.zipCode,
  ].filter(Boolean).join(', ');
  const merchantOperations = Array.isArray(merchantDetails?.operations) ? merchantDetails.operations : [];
  const statusValidations = Array.isArray(merchantStatus?.validations) ? merchantStatus.validations : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IfoodLogo className="h-8 w-auto" />
            <span>Integração iFood</span>
          </CardTitle>
          <CardDescription>
            Conecte o aplicativo oficial, vincule a loja e deixe o PopSystem pronto para homologação do módulo de pedidos.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Badge variant="outline" className={statusTone}>
              {settings.status === 'online' ? 'Online' : 'Offline'}
            </Badge>
            <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
              {settings.merchant_name || 'Nenhum merchant selecionado'}
            </Badge>
            {merchantStatus?.state ? (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                Loja iFood: {String(merchantStatus.state)}
              </Badge>
            ) : null}
          </div>

          <div className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="flex items-center gap-2 font-semibold text-blue-950">
                <ShieldCheck className="h-4 w-4" /> Evidência da homologação
              </div>
              <p className="mt-1 text-sm text-blue-800">
                Data e hora: <strong>{evidenceNow.toLocaleString('pt-BR')}</strong>
              </p>
            </div>
            <div className="rounded-lg border border-blue-200 bg-white px-3 py-2 font-mono text-xs text-blue-950">
              client_id: {settings.client_id || 'não configurado'}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Building2 className="h-4 w-4 text-red-600" /> Lojas vinculadas ao aplicativo
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Consulte cada loja para exibir os dados e a disponibilidade exigidos pelo iFood.</p>
              </div>
              <Badge variant="outline">{merchants.length} loja(s)</Badge>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {merchants.map((merchant) => (
                <button
                  key={merchant.id}
                  type="button"
                  onClick={() => handleSelectMerchant(merchant.id)}
                  className={`rounded-xl border p-3 text-left transition hover:border-red-300 hover:bg-red-50 ${selectedMerchantId === merchant.id ? 'border-red-300 bg-red-50 ring-1 ring-red-200' : 'bg-white'}`}
                >
                  <span className="block font-semibold text-slate-900">{merchant.name || merchant.corporateName || 'Loja iFood'}</span>
                  <span className="mt-1 block break-all font-mono text-xs text-slate-500">{merchant.id}</span>
                </button>
              ))}
              {!loading && merchants.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Valide as credenciais para listar as lojas.</div>
              ) : null}
            </div>

            {selectedMerchantId ? (
              <div className="grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Loja</div>
                  <div className="mt-1 font-semibold text-slate-900">{merchantDetails?.name || merchantDetails?.corporateName || settings.merchant_name || '—'}</div>
                  <div className="break-all text-xs text-slate-500">{selectedMerchantId}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Razão social / documento</div>
                  <div className="mt-1 text-sm text-slate-800">{merchantDetails?.corporateName || '—'}</div>
                  <div className="text-xs text-slate-500">{merchantDetails?.document || merchantDetails?.taxPayerIdentificationNumber || 'Documento não informado'}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500"><MapPin className="h-3 w-3" /> Endereço</div>
                  <div className="mt-1 text-sm text-slate-800">{addressText || merchantAddress?.formattedAddress || 'Endereço não informado'}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Disponibilidade</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge className={merchantStatus?.available ? 'bg-emerald-600' : 'bg-slate-600'}>{merchantStatus?.available ? 'Disponível' : 'Indisponível'}</Badge>
                    <Badge variant="outline">{merchantStatus?.state || 'Sem status'}</Badge>
                  </div>
                </div>
                <div className="md:col-span-2 xl:col-span-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Operações e validações</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {merchantOperations.map((operation: any, index: number) => (
                      <Badge key={`${operation?.type || operation?.id || 'operation'}-${index}`} variant="outline">
                        {String(operation?.type || operation?.name || operation?.id || 'Operação')}
                      </Badge>
                    ))}
                    {statusValidations.map((validation: any, index: number) => (
                      <Badge key={`${validation?.id || validation?.code || 'validation'}-${index}`} variant="outline" className={String(validation?.state || '').toUpperCase() === 'OK' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>
                        {String(validation?.id || validation?.code || validation?.name || 'Validação')}: {String(validation?.state || validation?.status || '—')}
                      </Badge>
                    ))}
                    {!merchantOperations.length && !statusValidations.length ? <span className="text-sm text-slate-500">Nenhuma operação ou validação retornada.</span> : null}
                  </div>
                </div>
                <div className="md:col-span-2 xl:col-span-4">
                  <Button type="button" variant="outline" size="sm" onClick={() => loadMerchantWorkspace(selectedMerchantId)} disabled={merchantLoading}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${merchantLoading ? 'animate-spin' : ''}`} /> Consultar detalhes e disponibilidade
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between rounded-xl border px-4 py-3">
            <div className="space-y-1">
              <div className="font-medium">Receber pedidos do iFood</div>
              <div className="text-sm text-muted-foreground">
                Ative só quando as credenciais e a loja já estiverem validadas.
              </div>
            </div>
            <Switch
              checked={settings.merchant_enabled}
              onCheckedChange={handleToggleEnabled}
              disabled={loading || !settings.client_secret_configured || !settings.merchant_id}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ifood-client-id">Client ID</Label>
              <Input
                id="ifood-client-id"
                placeholder="Cole o clientId do app iFood"
                value={formData.clientId}
                onChange={(e) => setFormData((prev) => ({ ...prev, clientId: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ifood-client-secret">Client Secret</Label>
              <Input
                id="ifood-client-secret"
                type="password"
                placeholder={settings.client_secret_configured ? 'Já configurado. Preencha só para trocar.' : 'Cole o clientSecret'}
                value={formData.clientSecret}
                onChange={(e) => setFormData((prev) => ({ ...prev, clientSecret: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
            <div className="space-y-2">
              <Label htmlFor="ifood-merchant">Loja iFood</Label>
              <select
                id="ifood-merchant"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={formData.merchantId}
                onChange={(e) => handleSelectMerchant(e.target.value)}
                disabled={loading || merchants.length === 0}
              >
                <option value="">Selecione uma loja</option>
                {merchants.map((merchant) => (
                  <option key={merchant.id} value={merchant.id}>
                    {merchant.name || merchant.corporateName || merchant.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Último sync</Label>
              <div className="flex h-10 items-center rounded-md border bg-slate-50 px-3 text-sm text-slate-600">
                {formatDateTime(settings.last_sync_at)}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Webhook homologável
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Configure esta URL no Developer Portal. O PopSystem valida a assinatura <code className="rounded bg-white px-1 py-0.5 text-xs">X-IFood-Signature</code> com HMAC SHA-256 usando o mesmo client secret do app.
            </p>
            <div className="mt-3 flex flex-col gap-2 rounded-lg bg-white p-3 text-sm">
              <span className="break-all font-mono text-xs text-slate-700">
                {settings.webhook_url || 'Será gerada após conectar o app'}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => window.open('https://developer.ifood.com.br', '_blank')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir Developer Portal
              </Button>
            </div>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Checklist de homologação coberto por esta base</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>Token centralizado com renovação controlada.</p>
              <p>Webhook com assinatura obrigatória do iFood.</p>
              <p>Polling manual para auditoria e recuperação.</p>
              <p>Persistência e descarte de eventos duplicados.</p>
              <p>Entrada de pedido, confirmação, pronto, despacho e cancelamento com motivo.</p>
            </AlertDescription>
          </Alert>

          {settings.last_sync_message ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Último retorno do módulo</AlertTitle>
              <AlertDescription>
                <span className="font-medium">{settings.last_sync_status || 'status'}</span>
                {' · '}
                {settings.last_sync_message}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>

        <CardFooter className="flex flex-wrap gap-3">
          <Button
            onClick={handleSaveCredentials}
            disabled={loading || !formData.clientId.trim() || (!formData.clientSecret.trim() && !settings.client_secret_configured)}
          >
            {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Validar credenciais
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleSyncEvents}
            disabled={syncing || !settings.merchant_id || !settings.client_secret_configured}
          >
            {syncing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sincronizar eventos
          </Button>

          <Button type="button" variant="ghost" onClick={loadOverview} disabled={loading}>
            Recarregar
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PauseCircle className="h-5 w-5 text-amber-600" /> Interrupções da loja</CardTitle>
          <CardDescription>Crie, consulte e remova pausas diretamente no iFood. As alterações aparecem no Portal do Parceiro.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_220px_220px_auto] lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="ifood-pause-description">Motivo da pausa</Label>
              <Input id="ifood-pause-description" maxLength={255} value={pauseForm.description} onChange={(event) => setPauseForm((current) => ({ ...current, description: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ifood-pause-start">Início</Label>
              <Input id="ifood-pause-start" type="datetime-local" value={pauseForm.start} onChange={(event) => setPauseForm((current) => ({ ...current, start: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ifood-pause-end">Fim</Label>
              <Input id="ifood-pause-end" type="datetime-local" value={pauseForm.end} onChange={(event) => setPauseForm((current) => ({ ...current, end: event.target.value }))} />
            </div>
            <Button type="button" onClick={handleCreateInterruption} disabled={interruptionLoading || !selectedMerchantId || !pauseForm.description.trim() || !pauseForm.start || !pauseForm.end}>
              {interruptionLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <PauseCircle className="mr-2 h-4 w-4" />} Criar pausa no iFood
            </Button>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-slate-900">Pausas ativas ou futuras</div>
              <Button type="button" variant="outline" size="sm" onClick={() => loadInterruptions()} disabled={interruptionLoading || !selectedMerchantId}>
                <RefreshCw className={`mr-2 h-4 w-4 ${interruptionLoading ? 'animate-spin' : ''}`} /> Consultar pausas
              </Button>
            </div>
            {interruptions.length ? interruptions.map((interruption) => (
              <div key={interruption.id} className="flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 md:flex-row md:items-center">
                <div>
                  <div className="font-semibold text-amber-950">{interruption.description || 'Pausa iFood'}</div>
                  <div className="mt-1 text-sm text-amber-900">
                    {new Date(interruption.start).toLocaleString('pt-BR')} até {new Date(interruption.end).toLocaleString('pt-BR')}
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-amber-700">ID: {interruption.id}</div>
                </div>
                <Button type="button" variant="destructive" size="sm" onClick={() => handleDeleteInterruption(interruption.id)} disabled={interruptionLoading}>
                  <Trash2 className="mr-2 h-4 w-4" /> Remover pausa
                </Button>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Nenhuma pausa ativa ou futura retornada pelo iFood.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-emerald-700" /> Horário de funcionamento no iFood</CardTitle>
              <CardDescription className="mt-2">A atualização substitui a grade completa do iFood. O PopSystem consulta primeiro os horários atuais para preservar os demais dias.</CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={fillHomologationSchedule} disabled={!selectedMerchantId}>
              <Clock3 className="mr-2 h-4 w-4" /> Preencher cenário da homologação
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {days.map(({ key, label }) => (
            <div key={key} className="grid gap-3 rounded-xl border p-4 lg:grid-cols-[180px_1fr_auto] lg:items-start">
              <div className="flex items-center gap-2 pt-2 font-semibold text-slate-900"><Store className="h-4 w-4 text-emerald-700" /> {label}</div>
              <div className="space-y-2">
                {week[key].length ? week[key].map((shift, index) => (
                  <div key={`${key}-${index}`} className="flex flex-wrap items-center gap-2">
                    <Input aria-label={`Abertura ${label}`} type="time" className="w-36" value={shift.start} onChange={(event) => updateShift(key, index, 'start', event.target.value)} />
                    <span className="text-sm text-muted-foreground">até</span>
                    <Input aria-label={`Fechamento ${label}`} type="time" className="w-36" value={shift.end} onChange={(event) => updateShift(key, index, 'end', event.target.value)} />
                    <Button type="button" variant="ghost" size="icon" className="text-red-600" aria-label={`Remover turno de ${label}`} onClick={() => removeShift(key, index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )) : <div className="pt-2 text-sm text-muted-foreground">Fechado</div>}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => addShift(key)}>
                <Plus className="mr-2 h-4 w-4" /> Adicionar turno
              </Button>
            </div>
          ))}

          <div className="flex flex-wrap justify-end gap-3 pt-3">
            <Button type="button" variant="outline" onClick={() => loadOpeningHours()} disabled={openingHoursLoading || !selectedMerchantId}>
              <RefreshCw className={`mr-2 h-4 w-4 ${openingHoursLoading ? 'animate-spin' : ''}`} /> Consultar horários
            </Button>
            <Button type="button" onClick={handleSaveOpeningHours} disabled={openingHoursLoading || !selectedMerchantId}>
              {openingHoursLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Salvar horários no iFood
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default IfoodSettings;
