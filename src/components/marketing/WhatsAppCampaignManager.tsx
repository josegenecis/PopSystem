import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, ImageIcon, MessageCircle, Package, Pause, Play, RefreshCw, Send, ShieldCheck, Square, Upload, Users } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import AdjustableImageDialog from '@/components/media/AdjustableImageDialog';

type Campaign = {
  id: string;
  title: string;
  message: string;
  status: string;
  target_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  daily_limit: number;
  min_delay_seconds: number;
  max_delay_seconds: number;
  scheduled_at: string;
  created_at: string;
  audience_type?: string | null;
  product_name?: string | null;
  promo_image_url?: string | null;
  queued_count?: number;
  sending_count?: number;
  opted_out_count?: number;
  cancelled_count?: number;
  pending_count?: number;
  first_sent_at?: string | null;
  last_sent_at?: string | null;
  next_scheduled_at?: string | null;
  delivery_seconds?: number | null;
};

type ProductOption = {
  id: string;
  name: string;
  price: number;
  original_price?: number | null;
  discount_percentage?: number | null;
  image_url?: string | null;
};

type AudiencePreview = {
  count: number;
  activeWindowDays: number;
  cooldownDays: number;
  manual?: {
    requested: number;
    matched: number;
    blocked: number;
  } | null;
  sample?: Array<{ name: string; phone: string; lastActivity: string; daysSinceLastOrder?: number | null }>;
};

const statusLabels: Record<string, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Rodando',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

const statusClass: Record<string, string> = {
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  running: 'bg-amber-50 text-amber-700 border-amber-200',
  paused: 'bg-zinc-50 text-zinc-700 border-zinc-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
};

const defaultMessage = 'Olá {nome}! Oferta especial de hoje: {produto} por {preco}.\n\nPeça aqui: {cardapio}';

function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function progressOf(campaign: Campaign) {
  const total = Number(campaign.target_count || 0);
  if (!total) return 0;
  return Math.min(100, Math.round(((Number(campaign.sent_count || 0) + Number(campaign.failed_count || 0) + Number(campaign.skipped_count || 0)) / total) * 100));
}

function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours > 0) return restMinutes > 0 ? `${hours}h ${restMinutes}min` : `${hours}h`;
  return `${minutes}min`;
}

function formatInterval(campaign: Campaign) {
  const min = Math.round(Number(campaign.min_delay_seconds || 0) / 60);
  const max = Math.round(Number(campaign.max_delay_seconds || 0) / 60);
  if (!min && !max) return '-';
  if (min === max) return `${min}min`;
  return `${min}-${max}min`;
}

export default function WhatsAppCampaignManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState(defaultMessage);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(40);
  const [minDelayMinutes, setMinDelayMinutes] = useState(3);
  const [maxDelayMinutes, setMaxDelayMinutes] = useState(12);
  const [scheduledAt, setScheduledAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [audience, setAudience] = useState<AudiencePreview | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('none');
  const [promoImageUrl, setPromoImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [pendingPromoImageFile, setPendingPromoImageFile] = useState<File | null>(null);
  const [audienceType, setAudienceType] = useState<'active' | 'manual' | 'inactive_range'>('active');
  const [manualPhones, setManualPhones] = useState('');
  const [activeWindowDays, setActiveWindowDays] = useState(30);
  const [inactiveMinDays, setInactiveMinDays] = useState(15);
  const [inactiveMaxDays, setInactiveMaxDays] = useState(0);
  const [immediateManualTest, setImmediateManualTest] = useState(true);

  const minDelaySeconds = useMemo(() => Math.max(1, minDelayMinutes) * 60, [minDelayMinutes]);
  const maxDelaySeconds = useMemo(() => Math.max(minDelayMinutes, maxDelayMinutes) * 60, [maxDelayMinutes, minDelayMinutes]);

  useEffect(() => {
    const rawHandoff = sessionStorage.getItem('popsystem_whatsapp_campaign_handoff');
    if (!rawHandoff) return;
    sessionStorage.removeItem('popsystem_whatsapp_campaign_handoff');
    try {
      const handoff = JSON.parse(rawHandoff) as { message?: string; phones?: string[]; createdAt?: number };
      if (!handoff.createdAt || Date.now() - handoff.createdAt > 10 * 60 * 1000 || !handoff.phones?.length) return;
      setAudienceType('manual');
      setManualPhones(handoff.phones.join('\n'));
      setMessage(String(handoff.message || defaultMessage));
      setTitle(`Atendimento - ${new Date().toLocaleDateString('pt-BR')}`);
      setImmediateManualTest(handoff.phones.length <= 5);
      toast({
        title: 'Campanha preparada para revisão',
        description: 'Confira destinatários, limites e aviso de risco antes de confirmar o envio.',
      });
    } catch (error) {
      console.error('Handoff de campanha inválido:', error);
    }
  }, [toast]);

  useEffect(() => {
    if (!user?.id) return;
    fetchCampaigns();
    fetchProducts();
    previewAudience();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const timer = window.setTimeout(() => {
      previewAudience();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [user?.id, audienceType, manualPhones, activeWindowDays, inactiveMinDays, inactiveMaxDays]);

  useEffect(() => {
    if (!user?.id) return;
    const timer = window.setInterval(() => {
      processQueue(true);
    }, 60000);

    return () => window.clearInterval(timer);
  }, [user?.id]);

  const fetchCampaigns = async () => {
    if (!user?.id) return;
    const { data, error } = await (supabase as any)
      .from('whatsapp_marketing_campaigns')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error(error);
      return;
    }

    const rows = data || [];
    const ids = rows.map((item: Campaign) => item.id).filter(Boolean);
    let recipients: any[] = [];
    if (ids.length > 0) {
      const { data: recipientRows, error: recipientError } = await (supabase as any)
        .from('whatsapp_marketing_recipients')
        .select('campaign_id,status,scheduled_at,sent_at,last_error')
        .in('campaign_id', ids);

      if (recipientError) {
        console.error(recipientError);
      } else {
        recipients = recipientRows || [];
      }
    }

    const statsByCampaign = new Map<string, any>();
    for (const recipient of recipients) {
      const campaignId = String(recipient.campaign_id || '');
      if (!campaignId) continue;
      const stats = statsByCampaign.get(campaignId) || {
        queued_count: 0,
        sending_count: 0,
        sent_count: 0,
        failed_count: 0,
        skipped_count: 0,
        opted_out_count: 0,
        cancelled_count: 0,
        next_scheduled_at: null,
        first_sent_at: null,
        last_sent_at: null,
      };

      const status = String(recipient.status || '');
      const key = `${status}_count`;
      stats[key] = Number(stats[key] || 0) + 1;

      if (status === 'queued' && recipient.scheduled_at) {
        const currentNext = stats.next_scheduled_at ? new Date(stats.next_scheduled_at).getTime() : Infinity;
        const nextTime = new Date(recipient.scheduled_at).getTime();
        if (Number.isFinite(nextTime) && nextTime < currentNext) stats.next_scheduled_at = recipient.scheduled_at;
      }

      if (status === 'sent' && recipient.sent_at) {
        const sentTime = new Date(recipient.sent_at).getTime();
        const firstTime = stats.first_sent_at ? new Date(stats.first_sent_at).getTime() : Infinity;
        const lastTime = stats.last_sent_at ? new Date(stats.last_sent_at).getTime() : 0;
        if (Number.isFinite(sentTime) && sentTime < firstTime) stats.first_sent_at = recipient.sent_at;
        if (Number.isFinite(sentTime) && sentTime > lastTime) stats.last_sent_at = recipient.sent_at;
      }

      statsByCampaign.set(campaignId, stats);
    }

    setCampaigns(rows.map((campaign: Campaign) => {
      const stats = statsByCampaign.get(campaign.id) || {};
      const first = stats.first_sent_at ? new Date(stats.first_sent_at).getTime() : null;
      const last = stats.last_sent_at ? new Date(stats.last_sent_at).getTime() : null;
      return {
        ...campaign,
        ...stats,
        pending_count: Number(stats.queued_count || 0) + Number(stats.sending_count || 0),
        delivery_seconds: first && last && last >= first ? Math.round((last - first) / 1000) : null,
      };
    }));
  };

  const fetchProducts = async () => {
    if (!user?.id) return;
    const { data, error } = await (supabase as any)
      .from('products')
      .select('id,name,price,original_price,discount_percentage,image_url,available')
      .eq('user_id', user.id)
      .eq('available', true)
      .order('name', { ascending: true })
      .limit(250);

    if (error) {
      console.error(error);
      return;
    }

    setProducts((data || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      price: Number(item.price || 0),
      original_price: item.original_price,
      discount_percentage: item.discount_percentage,
      image_url: item.image_url,
    })));
  };

  const previewAudience = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-campaigns', {
        body: buildAudiencePayload('preview-audience'),
      });

      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setAudience((data as any).audience);
    } catch (error: any) {
      console.error('Erro ao pré-visualizar público:', error);
    }
  };

  const buildAudiencePayload = (action: string) => ({
    action,
    audienceType,
    manualPhones,
    activeWindowDays,
    inactiveMinDays: audienceType === 'inactive_range' ? inactiveMinDays : null,
    inactiveMaxDays: audienceType === 'inactive_range' && inactiveMaxDays > 0 ? inactiveMaxDays : null,
    immediateManualTest: audienceType === 'manual' ? immediateManualTest : false,
    allowRecentManualResend: audienceType === 'manual',
  });

  const createCampaign = async () => {
    if (!riskAccepted) {
      toast({
        title: 'Confirme o risco antes de enviar',
        description: 'O WhatsApp pode limitar ou bloquear número que dispara mensagem sem cuidado.',
        variant: 'destructive',
      });
      return;
    }

    if (audienceType === 'manual' && !manualPhones.replace(/\D/g, '').trim()) {
      toast({
        title: 'Informe os WhatsApps do teste',
        description: 'Cole pelo menos um número na lista manual ou troque o funil para outro público.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const selectedProduct = products.find((item) => item.id === selectedProductId) || null;
      const { data, error } = await supabase.functions.invoke('whatsapp-campaigns', {
        body: {
          ...buildAudiencePayload('create'),
          title,
          message,
          riskAcknowledged: riskAccepted,
          activeConversationsOnly: true,
          dailyLimit,
          minDelaySeconds,
          maxDelaySeconds,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : new Date().toISOString(),
          quietHoursStart: '21:00',
          quietHoursEnd: '09:00',
          timezone: 'America/Fortaleza',
          optOutText: '',
          productId: selectedProduct?.id || null,
          productName: selectedProduct?.name || null,
          productPrice: selectedProduct?.price ?? null,
          promoImageUrl: promoImageUrl || selectedProduct?.image_url || null,
        },
      });

      if (error) throw new Error((error as any)?.message || 'Falha ao chamar a função de campanhas.');
      if ((data as any)?.error) throw new Error((data as any).error);

      toast({
        title: 'Campanha criada',
        description: `${(data as any)?.targetCount || 0} cliente(s) conhecido(s) entraram na fila segura.`,
      });
      setTitle('');
      setRiskAccepted(false);
      setSelectedProductId('none');
      setPromoImageUrl('');
      await Promise.all([fetchCampaigns(), previewAudience()]);
      const selectedStart = scheduledAt ? new Date(scheduledAt) : new Date();
      const startsInFuture = Number.isFinite(selectedStart.getTime()) && selectedStart.getTime() > Date.now() + 30000;
      if (audienceType === 'manual' && immediateManualTest && !startsInFuture) {
        await processQueue(false);
      }
    } catch (error: any) {
      toast({
        title: 'Não foi possível criar a campanha',
        description: String(error?.message || error),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedProduct = useMemo(
    () => products.find((item) => item.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const displayPrice = (value?: number | null) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

  const chooseProduct = (productId: string) => {
    setSelectedProductId(productId);
    if (productId === 'none') return;
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    if (!title.trim()) setTitle(`Oferta: ${product.name}`);
    setMessage(`Olá {nome}! Oferta especial de hoje: ${product.name} por ${displayPrice(product.price)}.\n\nPeça aqui: {cardapio}`);
    if (product.image_url && !promoImageUrl) setPromoImageUrl(product.image_url);
  };

  const uploadPromotionImage = async (file?: File | null) => {
    if (!file || !user?.id) return;
    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const safeName = file.name.replace(/[^a-z0-9_.-]/gi, '-').toLowerCase();
      const path = `marketing-offers/${user.id}/${Date.now()}-${safeName || `offer.${ext}`}`;
      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type || `image/${ext}`,
        });

      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('product-images').getPublicUrl(path);
      setPromoImageUrl(data.publicUrl);
      toast({
        title: 'Imagem adicionada',
        description: 'A imagem será enviada junto com a oferta quando o WhatsApp aceitar mídia.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao subir imagem',
        description: String(error?.message || error),
        variant: 'destructive',
      });
    } finally {
      setUploadingImage(false);
    }
  };

  const handlePromotionImageSelected = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Arquivo inválido',
        description: 'Selecione uma imagem para a promoção.',
        variant: 'destructive',
      });
      return;
    }
    setPendingPromoImageFile(file);
  };

  const processQueue = async (silent = false) => {
    if (processing) return;
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-campaigns', {
        body: { action: 'process', batchSize: 5 },
      });

      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const processed = (data as any)?.processed || [];
      if (!silent) {
        toast({
          title: 'Fila processada',
          description: processed.length ? `${processed.length} mensagem(ns) avaliadas agora.` : 'Nenhuma mensagem estava pronta para envio.',
        });
      }
      await Promise.all([fetchCampaigns(), previewAudience()]);
    } catch (error: any) {
      if (!silent) {
        toast({
          title: 'Erro ao processar fila',
          description: String(error?.message || error),
          variant: 'destructive',
        });
      }
    } finally {
      setProcessing(false);
    }
  };

  const sendCampaignNow = async (campaignId: string) => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-campaigns', {
        body: { action: 'send-now', campaignId },
      });

      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const processed = (data as any)?.processed || [];
      toast({
        title: 'Envio de teste processado',
        description: processed.length ? `${processed.length} mensagem(ns) processadas agora.` : 'Nenhuma mensagem pendente para esta campanha.',
      });
      await fetchCampaigns();
    } catch (error: any) {
      toast({
        title: 'Não foi possível enviar agora',
        description: String(error?.message || error),
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const changeStatus = async (campaignId: string, action: 'pause' | 'resume' | 'cancel') => {
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-campaigns', {
        body: { action, campaignId },
      });

      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      await fetchCampaigns();
    } catch (error: any) {
      toast({
        title: 'Erro ao atualizar campanha',
        description: String(error?.message || error),
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6 rounded-[28px] bg-[radial-gradient(circle_at_top_left,rgba(255,111,0,0.14),transparent_32%),linear-gradient(135deg,#fff7ed_0%,#f0fdf4_42%,#ffffff_100%)] p-4 sm:p-6">
      <AdjustableImageDialog
        open={Boolean(pendingPromoImageFile)}
        file={pendingPromoImageFile}
        title="Ajustar imagem da promoção"
        aspectRatio={4 / 3}
        outputWidth={1200}
        outputHeight={900}
        onCancel={() => setPendingPromoImageFile(null)}
        onConfirm={(file) => {
          setPendingPromoImageFile(null);
          void uploadPromotionImage(file);
        }}
      />
      <div className="flex flex-col gap-3 rounded-2xl border border-orange-200/70 bg-white/80 p-5 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-orange-700">
            <MessageCircle className="h-3.5 w-3.5" />
            Marketing inteligente
          </div>
          <h2 className="mt-3 text-2xl font-black text-emerald-950 sm:text-3xl">Ofertas com imagem, funil e controle</h2>
          <p className="mt-1 max-w-3xl text-sm text-emerald-900/75">
            Crie campanhas para clientes conhecidos, teste em números específicos e acompanhe o envio sem disparos frios.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-emerald-900 px-4 py-3 text-white shadow-sm">
            <div className="text-2xl font-black">{audience?.count ?? '-'}</div>
            <div className="text-[11px] font-semibold uppercase text-emerald-100">Elegíveis</div>
          </div>
          <div className="rounded-xl bg-orange-500 px-4 py-3 text-white shadow-sm">
            <div className="text-2xl font-black">{campaigns.filter((item) => item.status === 'scheduled').length}</div>
            <div className="text-[11px] font-semibold uppercase text-orange-50">Na fila</div>
          </div>
          <div className="rounded-xl bg-lime-500 px-4 py-3 text-emerald-950 shadow-sm">
            <div className="text-2xl font-black">{campaigns.reduce((sum, item) => sum + Number(item.sent_count || 0), 0)}</div>
            <div className="text-[11px] font-semibold uppercase text-emerald-950/70">Enviadas</div>
          </div>
        </div>
      </div>

      <Alert className="border-amber-200 bg-white/90 text-amber-950 shadow-sm">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Envio com risco controlado, não disparo em massa</AlertTitle>
        <AlertDescription>
          O WhatsApp pode bloquear ou limitar o número se perceber comportamento de spam. Esta ferramenta só envia para clientes já conhecidos pelo restaurante, aplica intervalo aleatório e evita reenviar oferta para o mesmo telefone por 7 dias.
        </AlertDescription>
      </Alert>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card className="overflow-hidden border-orange-200/80 bg-white/95 shadow-lg shadow-orange-100/50">
          <div className="h-1.5 bg-gradient-to-r from-orange-500 via-lime-400 to-emerald-700" />
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <MessageCircle className="h-5 w-5 text-emerald-700" />
              Ofertas automáticas via WhatsApp
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="wa-campaign-title">Nome da campanha</Label>
                <Input
                  id="wa-campaign-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ex.: Oferta de sexta"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wa-schedule">Iniciar em</Label>
                <Input
                  id="wa-schedule"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="mb-3 flex items-center gap-2 font-semibold">
                <Users className="h-4 w-4 text-emerald-700" />
                Funil de destinatários
              </div>
              <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="space-y-2">
                  <Label>Quem deve receber</Label>
                  <Select value={audienceType} onValueChange={(value) => setAudienceType(value as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Lista manual para teste</SelectItem>
                      <SelectItem value="inactive_range">Sem pedido por dias</SelectItem>
                      <SelectItem value="active">Clientes recentes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {audienceType === 'manual' ? (
                  <div className="space-y-2">
                    <Label htmlFor="wa-manual-phones">WhatsApps permitidos</Label>
                    <Textarea
                      id="wa-manual-phones"
                      value={manualPhones}
                      onChange={(event) => setManualPhones(event.target.value)}
                      rows={3}
                      placeholder="Um por linha, ou separado por vírgula. Ex.: 85999990000"
                    />
                    <div className="text-xs text-muted-foreground">
                      O sistema só mantém números já conhecidos por conversa, pedido ou cadastro. A busca aceita com/sem 55 e com/sem nono dígito.
                    </div>
                    <div className="rounded-md border border-lime-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="wa-immediate-test"
                          checked={immediateManualTest}
                          onCheckedChange={(checked) => setImmediateManualTest(Boolean(checked))}
                          className="mt-0.5"
                        />
                        <Label htmlFor="wa-immediate-test" className="cursor-pointer text-sm leading-relaxed">
                      Enviar teste agora para esta lista manual, sem esperar intervalo. Limitado a 5 WhatsApps.
                        </Label>
                      </div>
                    </div>
                  </div>
                ) : audienceType === 'inactive_range' ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {[15, 30, 60, 90].map((days) => (
                        <Button
                          key={days}
                          type="button"
                          variant={inactiveMinDays === days && inactiveMaxDays === 0 ? 'default' : 'outline'}
                          size="sm"
                          className={inactiveMinDays === days && inactiveMaxDays === 0 ? 'bg-emerald-700 hover:bg-emerald-800' : ''}
                          onClick={() => {
                            setInactiveMinDays(days);
                            setInactiveMaxDays(0);
                          }}
                        >
                          +{days} dias sem pedir
                        </Button>
                      ))}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="wa-inactive-min">Sem pedir há pelo menos</Label>
                        <Input
                          id="wa-inactive-min"
                          type="number"
                          min={0}
                          value={inactiveMinDays}
                          onChange={(event) => setInactiveMinDays(Number(event.target.value || 0))}
                        />
                        <div className="text-xs text-muted-foreground">dias</div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="wa-inactive-max">E no máximo</Label>
                        <Input
                          id="wa-inactive-max"
                          type="number"
                          min={0}
                          value={inactiveMaxDays}
                          onChange={(event) => setInactiveMaxDays(Number(event.target.value || 0))}
                        />
                        <div className="text-xs text-muted-foreground">0 deixa sem limite máximo</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-md border border-emerald-100 bg-white p-3 text-sm text-muted-foreground shadow-sm">
                    <div className="flex flex-wrap gap-2">
                      {[7, 15, 30, 60].map((days) => (
                        <Button
                          key={days}
                          type="button"
                          variant={activeWindowDays === days ? 'default' : 'outline'}
                          size="sm"
                          className={activeWindowDays === days ? 'bg-emerald-700 hover:bg-emerald-800' : ''}
                          onClick={() => setActiveWindowDays(days)}
                        >
                          Últimos {days} dias
                        </Button>
                      ))}
                    </div>
                    <div>
                      Usa clientes conhecidos nos últimos {activeWindowDays} dias por conversa, pedido ou cadastro, sem opt-out e sem oferta nos últimos 7 dias.
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-2 rounded-2xl border border-orange-100 bg-orange-50/50 p-3">
                <Label>Produto em oferta</Label>
                <Select value={selectedProductId} onValueChange={chooseProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar produto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem produto vinculado</SelectItem>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} - {displayPrice(product.price)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-xs text-muted-foreground">
                  Quando vinculado, a campanha guarda o produto e pode usar {'{produto}'} e {'{preco}'} na mensagem.
                </div>
              </div>

              <div className="space-y-2 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3">
                <Label htmlFor="wa-promo-image">Imagem da promoção</Label>
                <div className="flex gap-2">
                  <Input
                    id="wa-promo-image"
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      handlePromotionImageSelected(event.target.files?.[0]);
                      event.currentTarget.value = '';
                    }}
                    disabled={uploadingImage}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={uploadingImage}
                    title="Subir imagem"
                  >
                    {uploadingImage ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            {(selectedProduct || promoImageUrl) && (
              <div className="grid gap-3 rounded-2xl border border-orange-200 bg-white p-3 shadow-sm md:grid-cols-[140px_minmax(0,1fr)]">
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-muted">
                  {promoImageUrl || selectedProduct?.image_url ? (
                    <img
                      src={promoImageUrl || selectedProduct?.image_url || ''}
                      alt={selectedProduct?.name || 'Imagem da promoção'}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Package className="h-4 w-4 text-emerald-700" />
                    {selectedProduct?.name || 'Imagem avulsa da promoção'}
                  </div>
                  {selectedProduct && (
                    <div className="text-2xl font-bold text-emerald-900">{displayPrice(selectedProduct.price)}</div>
                  )}
                  <Input
                    value={promoImageUrl}
                    onChange={(event) => setPromoImageUrl(event.target.value)}
                    placeholder="URL da imagem da promoção"
                  />
                  <div className="text-xs text-muted-foreground">
                    A imagem será enviada anexada ao WhatsApp com a mensagem como legenda.
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="wa-message">Mensagem</Label>
              <Textarea
                id="wa-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                className="resize-none"
              />
              <div className="text-xs text-muted-foreground">
                Variáveis disponíveis: {'{nome}'}, {'{cardapio}'}, {'{produto}'} e {'{preco}'}.
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="wa-limit">Limite diário</Label>
                <Input
                  id="wa-limit"
                  type="number"
                  min={1}
                  max={200}
                  value={dailyLimit}
                  onChange={(event) => setDailyLimit(Number(event.target.value || 1))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wa-min-delay">Intervalo mínimo</Label>
                <Input
                  id="wa-min-delay"
                  type="number"
                  min={1}
                  value={minDelayMinutes}
                  onChange={(event) => setMinDelayMinutes(Number(event.target.value || 1))}
                />
                <div className="text-xs text-muted-foreground">minutos entre mensagens</div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wa-max-delay">Intervalo máximo</Label>
                <Input
                  id="wa-max-delay"
                  type="number"
                  min={minDelayMinutes}
                  value={maxDelayMinutes}
                  onChange={(event) => setMaxDelayMinutes(Number(event.target.value || minDelayMinutes))}
                />
                <div className="text-xs text-muted-foreground">com sorteio aleatório</div>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="wa-risk"
                  checked={riskAccepted}
                  onCheckedChange={(checked) => setRiskAccepted(Boolean(checked))}
                  className="mt-0.5"
                />
                <Label htmlFor="wa-risk" className="cursor-pointer leading-relaxed">
                  Confirmo que entendi o risco de bloqueio do número e que as ofertas serão enviadas somente para clientes já conhecidos pelo restaurante.
                </Label>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={createCampaign} disabled={loading} className="gap-2 bg-orange-600 hover:bg-orange-700">
                <Send className="h-4 w-4" />
                Criar campanha segura
              </Button>
              <Button type="button" variant="outline" onClick={() => processQueue(false)} disabled={processing} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${processing ? 'animate-spin' : ''}`} />
                Processar fila agora
              </Button>
              <Button type="button" variant="ghost" onClick={previewAudience} className="gap-2">
                <Users className="h-4 w-4" />
                Atualizar público
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-emerald-200/80 bg-white/95 shadow-lg shadow-emerald-100/50">
          <div className="h-1.5 bg-gradient-to-r from-emerald-700 via-lime-400 to-orange-500" />
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              Público permitido
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-emerald-50 p-4">
              <div className="text-sm text-emerald-800">Clientes elegíveis</div>
              <div className="mt-1 text-4xl font-bold text-emerald-950">{audience?.count ?? '-'}</div>
              <div className="mt-2 text-xs text-emerald-800">
                Conhecidos por conversa, pedido ou cadastro nos últimos {audience?.activeWindowDays || 30} dias, sem opt-out e sem oferta nos últimos {audience?.cooldownDays || 7} dias.
              </div>
              {audience?.manual && (
                <div className="mt-3 rounded-md bg-white/70 p-2 text-xs text-emerald-900">
                  Lista manual: {audience.manual.matched} liberado(s) de {audience.manual.requested}. {audience.manual.blocked} fora por não ser cliente conhecido/elegível.
                </div>
              )}
            </div>

            {audience?.sample && audience.sample.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">Prévia do funil</div>
                <div className="space-y-2">
                  {audience.sample.map((item) => (
                    <div key={item.phone} className="rounded-md border bg-white p-2 text-xs">
                      <div className="font-semibold">{item.name}</div>
                      <div className="text-muted-foreground">
                        {item.phone}
                        {item.daysSinceLastOrder !== null && item.daysSinceLastOrder !== undefined
                          ? ` · ${item.daysSinceLastOrder} dia(s) sem pedir`
                          : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Envio permitido em qualquer horário, mantendo intervalo aleatório.
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                Lista fria/importada continua bloqueada nesta versão.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-orange-100 bg-white/95 shadow-lg shadow-orange-100/40">
        <CardHeader>
          <CardTitle>Campanhas recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progresso</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead>Agendada</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Nenhuma campanha criada ainda.
                  </TableCell>
                </TableRow>
              ) : campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {campaign.promo_image_url ? (
                        <img src={campaign.promo_image_url} alt="" className="h-12 w-12 rounded-md object-cover" />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold">{campaign.title}</div>
                        {campaign.product_name && (
                          <div className="text-xs font-medium text-emerald-700">{campaign.product_name}</div>
                        )}
                        <div className="line-clamp-1 text-xs text-muted-foreground">{campaign.message}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusClass[campaign.status] || ''}>
                      {statusLabels[campaign.status] || campaign.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-[220px]">
                    <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                      <span>{campaign.sent_count}/{campaign.target_count} enviados</span>
                      <span>{progressOf(campaign)}%</span>
                    </div>
                    <Progress value={progressOf(campaign)} />
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                      <span>Pendentes: {campaign.pending_count || 0}</span>
                      <span>Falhas: {campaign.failed_count || 0}</span>
                      <span>Ignorados: {(campaign.skipped_count || 0) + (campaign.opted_out_count || 0)}</span>
                      <span>Cancelados: {campaign.cancelled_count || 0}</span>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[190px] text-xs text-muted-foreground">
                    <div className="space-y-1">
                      <div>
                        <span className="font-semibold text-foreground">Intervalo:</span> {formatInterval(campaign)}
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Duração:</span> {formatDuration(campaign.delivery_seconds)}
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Próximo:</span> {campaign.next_scheduled_at ? formatDateTime(campaign.next_scheduled_at) : '-'}
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">Último envio:</span> {campaign.last_sent_at ? formatDateTime(campaign.last_sent_at) : '-'}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{formatDateTime(campaign.scheduled_at)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {campaign.status === 'paused' ? (
                        <Button size="icon" variant="outline" onClick={() => changeStatus(campaign.id, 'resume')} title="Retomar">
                          <Play className="h-4 w-4" />
                        </Button>
                      ) : campaign.status === 'scheduled' ? (
                        <Button size="icon" variant="outline" onClick={() => changeStatus(campaign.id, 'pause')} title="Pausar">
                          <Pause className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {campaign.status === 'scheduled' && campaign.audience_type === 'manual' && Number(campaign.sent_count || 0) < Number(campaign.target_count || 0) && (
                        <Button size="icon" variant="outline" onClick={() => sendCampaignNow(campaign.id)} title="Enviar teste agora">
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                      {['scheduled', 'paused'].includes(campaign.status) && (
                        <Button size="icon" variant="outline" onClick={() => changeStatus(campaign.id, 'cancel')} title="Cancelar">
                          <Square className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
