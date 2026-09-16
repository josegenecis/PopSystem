import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BadgeCheck, Cloud, Loader2, QrCode, MessageCircle, Unplug } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import MetaWhatsAppTemplates from './MetaWhatsAppTemplates';

const defaultAutoMessages = {
  order_received: '🎉 Recebemos seu pedido #{order_number}! Acompanhe aqui: {track_link}',
  preparing: '👨‍🍳 Seu pedido #{order_number} está sendo preparado. Acompanhe aqui: {track_link}',
  ready: '✅ Seu pedido #{order_number} está pronto! Acompanhe aqui: {track_link}',
  out_for_delivery: '🚗 Seu pedido #{order_number} saiu para entrega. Acompanhe aqui: {track_link}',
  delivered: '📦 Seu pedido #{order_number} foi entregue. Obrigado pela preferência!',
  cancelled: '❌ Seu pedido #{order_number} foi cancelado. Se precisar, fale com a gente.',
  menu_link: 'Clique aqui e faça seu pedido: {menu_link}',
  welcome: 'Olá! 👋 Bem-vindo ao {restaurant_name}.\n\nClique aqui e faça seu pedido: {menu_link}'
};

type MetaLoginResponse = { authResponse?: { code?: string } };
type MetaSdk = {
  init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
  login: (callback: (response: MetaLoginResponse) => void, options: Record<string, unknown>) => void;
};
type MetaWindow = Window & { FB?: MetaSdk; fbAsyncInit?: () => void };

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

const WhatsAppIntegration: React.FC = () => {
  const [settings, setSettings] = useState({
    phone_number: '',
    connected: false,
    provider: 'evolution' as 'evolution' | 'meta_cloud',
    verified_name: '',
    quality_rating: '',
    qr_code_data: '',
    auto_messages: defaultAutoMessages
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [metaAvailable, setMetaAvailable] = useState(false);
  const [metaTestModeAvailable, setMetaTestModeAvailable] = useState(false);

  useEffect(() => {
    loadSettings();
    checkStatus();
    loadMetaConfig();
    // Recarrega somente quando a conta ativa muda; as funções usam esse mesmo id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const loadSettings = async () => {
    const saved = localStorage.getItem('whatsapp_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      setSettings(prev => ({
        ...prev,
        ...parsed,
        auto_messages: {
          ...defaultAutoMessages,
          ...(parsed?.auto_messages || {})
        }
      }));
    }

    if (!user?.id) return;

    const { data } = await supabase
      .from('whatsapp_settings')
      .select('phone_number, auto_responses, provider')
      .eq('user_id', user.id)
      .maybeSingle();

    if (data) {
      setSettings(prev => ({
        ...prev,
        phone_number: data.phone_number || prev.phone_number,
        provider: data.provider === 'meta_cloud' ? 'meta_cloud' : 'evolution',
        auto_messages: {
          ...defaultAutoMessages,
          ...(typeof data.auto_responses === 'object' && data.auto_responses ? data.auto_responses as Record<string, string> : {})
        }
      }));
    }
  };

  const loadMetaConfig = async () => {
    if (!user?.id) return;
    const { data } = await supabase.functions.invoke('whatsapp-meta-connect', {
      body: { action: 'config', _storeId: user.id }
    });
    setMetaAvailable(Boolean(data?.available));
    setMetaTestModeAvailable(Boolean(data?.testModeAvailable));
  };

  const checkStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-status', {
        body: { _storeId: user?.id }
      });
      if (data?.status === 'connected') {
        setSettings(prev => ({
          ...prev,
          connected: true,
          provider: data.provider === 'meta_cloud' ? 'meta_cloud' : 'evolution',
          phone_number: data.phone || prev.phone_number,
          verified_name: data.verifiedName || '',
          quality_rating: data.qualityRating || ''
        }));
      } else {
        setSettings(prev => ({ ...prev, connected: false, provider: data?.provider === 'meta_cloud' ? 'meta_cloud' : prev.provider }));
      }
    } catch (e) {
      console.error("Erro ao checar status inicial:", e);
    }
  };

  const saveSettings = async () => {
    try {
      setLoading(true);
      localStorage.setItem('whatsapp_settings', JSON.stringify(settings));      

      if (user?.id) {
        const payload = {
          user_id: user.id,
          phone_number: settings.phone_number || '',
          provider: settings.provider,
          default_message: settings.auto_messages.welcome || defaultAutoMessages.welcome,
          enabled: true,
          auto_responses: settings.auto_messages,
          updated_at: new Date().toISOString()
        };

        const { data: existing } = await supabase
          .from('whatsapp_settings')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (existing?.id) {
          const { error } = await supabase
            .from('whatsapp_settings')
            .update(payload)
            .eq('user_id', user.id);

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('whatsapp_settings')
            .insert(payload);

          if (error) throw error;
        }
      }

      toast({
        title: "Sucesso",
        description: "Configurações salvas com sucesso!",
      });
    } catch (error) {
      console.error('Erro ao salvar:', error);
      toast({
        title: "Erro",
        description: "Erro ao salvar configurações.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const ensureMetaSdk = async (appId: string, graphVersion = 'v23.0') => {
    const metaWindow = window as MetaWindow;
    if (metaWindow.FB) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let poll: number | undefined;
      const finish = () => {
        if (settled || !metaWindow.FB) return;
        settled = true;
        window.clearTimeout(timeout);
        if (poll) window.clearInterval(poll);
        metaWindow.FB?.init({ appId, cookie: true, xfbml: false, version: graphVersion });
        resolve();
      };
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (poll) window.clearInterval(poll);
        reject(new Error('O login da Meta demorou para carregar.'));
      }, 15000);
      metaWindow.fbAsyncInit = finish;
      const existing = document.getElementById('facebook-jssdk');
      if (existing) {
        poll = window.setInterval(finish, 100);
        finish();
        return;
      }
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
      script.onload = finish;
      script.onerror = () => {
        settled = true;
        window.clearTimeout(timeout);
        if (poll) window.clearInterval(poll);
        reject(new Error('Não foi possível carregar o login da Meta.'));
      };
      document.head.appendChild(script);
    });
  };

  const connectMeta = async () => {
    try {
      setLoading(true);
      const { data: config, error: configError } = await supabase.functions.invoke('whatsapp-meta-connect', {
        body: { action: 'config', _storeId: user?.id }
      });
      if (configError || !config?.available || !config?.appId || !config?.configId) {
        throw new Error('A conexão oficial ainda precisa das credenciais da Meta no servidor.');
      }
      await ensureMetaSdk(config.appId, config.graphVersion || 'v23.0');

      let sessionInfo: { wabaId?: string; phoneNumberId?: string } = {};
      const sessionListener = (event: MessageEvent) => {
        if (!String(event.origin || '').endsWith('facebook.com')) return;
        let payload: unknown = event.data;
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload); } catch { return; }
        }
        if (!payload || typeof payload !== 'object' || !('type' in payload) || payload.type !== 'WA_EMBEDDED_SIGNUP') return;
        const data = 'data' in payload && payload.data && typeof payload.data === 'object'
          ? payload.data as Record<string, unknown>
          : {};
        sessionInfo = {
          wabaId: String(data.waba_id || data.wabaId || ''),
          phoneNumberId: String(data.phone_number_id || data.phoneNumberId || '')
        };
      };
      window.addEventListener('message', sessionListener);

      const authResponse = await new Promise<{ code: string }>((resolve, reject) => {
        const metaSdk = (window as MetaWindow).FB;
        if (!metaSdk) {
          reject(new Error('O SDK da Meta não foi inicializado.'));
          return;
        }
        metaSdk.login((response: MetaLoginResponse) => {
          if (response?.authResponse?.code) resolve(response.authResponse);
          else reject(new Error('Conexão cancelada ou não autorizada na Meta.'));
        }, {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }
        });
      }).finally(() => window.setTimeout(() => window.removeEventListener('message', sessionListener), 5000));

      const deadline = Date.now() + 5000;
      while ((!sessionInfo.wabaId || !sessionInfo.phoneNumberId) && Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 150));
      }
      window.removeEventListener('message', sessionListener);

      const { data, error } = await supabase.functions.invoke('whatsapp-meta-connect', {
        body: {
          action: 'complete',
          code: authResponse.code,
          wabaId: sessionInfo.wabaId,
          phoneNumberId: sessionInfo.phoneNumberId,
          _storeId: user?.id
        }
      });
      if (error || data?.error) throw new Error(data?.error || 'Não foi possível concluir a conexão oficial.');
      setSettings(prev => ({
        ...prev,
        connected: true,
        provider: 'meta_cloud',
        phone_number: data.phone || prev.phone_number,
        verified_name: data.verifiedName || ''
      }));
      setQrCodeUrl(null);
      toast({ title: 'WhatsApp oficial conectado', description: 'As novas mensagens já usarão a Cloud API da Meta.' });
    } catch (error: unknown) {
      toast({ title: 'Não foi possível conectar à Meta', description: errorMessage(error, 'Tente novamente.'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const disconnectMeta = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('whatsapp-meta-connect', {
        body: { action: 'disconnect', _storeId: user?.id }
      });
      if (error || data?.error) throw new Error(data?.error || 'Não foi possível desconectar.');
      setSettings(prev => ({ ...prev, connected: false, provider: 'evolution', verified_name: '', quality_rating: '' }));
      toast({ title: 'Conexão oficial desativada', description: 'A conexão por QR Code continua disponível.' });
      await checkStatus();
    } catch (error: unknown) {
      toast({ title: 'Erro ao desconectar', description: errorMessage(error, 'Tente novamente.'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const activateMetaTest = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('whatsapp-meta-connect', {
        body: { action: 'activate_test', _storeId: user?.id }
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Não foi possível ativar o ambiente de teste.');
      setSettings(prev => ({
        ...prev,
        connected: true,
        provider: 'meta_cloud',
        phone_number: data.phone || prev.phone_number,
        verified_name: data.verifiedName || 'Meta Test Number'
      }));
      setQrCodeUrl(null);
      toast({ title: 'Ambiente de homologação ativo', description: 'O número de teste oficial da Meta foi conectado ao PopSystem.' });
    } catch (error: unknown) {
      toast({ title: 'Não foi possível ativar o teste', description: errorMessage(error, 'Tente novamente.'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const startPolling = () => {
    const checkInterval = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('whatsapp-status', {
          body: { _storeId: user?.id }
        });
        
        if (data?.status === 'connected') {
          clearInterval(checkInterval);
          setSettings(prev => ({ ...prev, connected: true, phone_number: data.phone || prev.phone_number }));
          setQrCodeUrl(null);
          toast({ title: "Conectado!", description: "WhatsApp conectado com sucesso." });
        }
      } catch (e) {
        console.error("Erro no polling:", e);
      }
    }, 3000);

    // Limpar interval após 2 minutos
    setTimeout(() => clearInterval(checkInterval), 120000);
  };

  const generateQRCode = async () => {
    try {
      setLoading(true);
      setQrCodeUrl(null);
      setSettings(prev => ({ ...prev, qr_code_data: '' }));

      console.log("Conectando na EvoGo...");

      const { data: connectData, error: connectError } = await supabase.functions.invoke('whatsapp-connect', {
        body: { _storeId: user?.id }
      });

      if (connectError) throw new Error('O serviço de conexão do WhatsApp não respondeu. Aguarde alguns segundos e tente novamente.');
      if (connectData?.error) {
        console.error("Detalhes do erro na EvoGo (Connect):", connectData);
        const status = Number(connectData.status || 0);
        if (status === 401 || status === 403) throw new Error('A integração do WhatsApp recusou a autenticação. A equipe técnica precisa renovar a chave da Evolution API.');
        if (status === 404) throw new Error('A instância do WhatsApp não foi encontrada. Clique novamente para o sistema recriá-la.');
        if (status >= 500) throw new Error('A Evolution API está temporariamente indisponível. Aguarde alguns segundos e tente novamente.');
        throw new Error(connectData.message || 'Não foi possível preparar a conexão do WhatsApp.');
      }

      if (connectData?.connected || connectData?.status === 'connected') {
        setSettings(prev => ({
          ...prev,
          connected: true,
          phone_number: connectData.phone || prev.phone_number,
          qr_code_data: ''
        }));
        toast({ title: "Conectado!", description: "A instância já estava conectada." });
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      const { data: qrData, error: qrError } = await supabase.functions.invoke('whatsapp-qrcode', {
        body: { _storeId: user?.id }
      });

      if (qrError) throw new Error('O serviço demorou para gerar o QR Code. Aguarde alguns segundos e tente novamente.');
      if (qrData?.error) {
        console.error("Detalhes do erro na EvoGo (QR):", qrData);
        throw new Error(qrData.message === 'QR Code ainda não disponível'
          ? 'A conexão foi iniciada, mas o QR Code ainda não ficou disponível. Aguarde alguns segundos e clique novamente.'
          : (qrData.message || 'Não foi possível gerar o QR Code do WhatsApp.'));
      }

      if (qrData?.connected) {
        setSettings(prev => ({ ...prev, connected: true, qr_code_data: '' }));
        setQrCodeUrl(null);
        toast({ title: "Conectado!", description: "A instância já estava ativa e pronta para uso." });
        return;
      }

      if (qrData?.qrcode) {
         setQrCodeUrl(qrData.qrcode); 
         setSettings(prev => ({ ...prev, qr_code_data: qrData.qrcode }));   
         toast({ title: "QR Code gerado", description: "Escaneie o QR Code no seu WhatsApp para conectar." });
         startPolling();
      } else {
         throw new Error('Não foi possível gerar o QR Code. Aguarde alguns segundos e tente novamente.');       
      }

    } catch (error: unknown) {
      console.error('Erro ao gerar QR Code:', error);
      toast({
        title: "Erro de Conexão",
        description: errorMessage(error, "Verifique se a API está online."),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5" />
            Integração WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(metaAvailable || settings.provider === 'meta_cloud') && <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-emerald-600 p-2 text-white"><Cloud className="h-5 w-5" /></div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-emerald-950">WhatsApp oficial da Meta</strong>
                    {settings.provider === 'meta_cloud' && settings.connected ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white"><BadgeCheck className="h-3 w-3" />Ativo</span> : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-emerald-800">Conexão estável, mensagens instantâneas e webhook oficial. A conexão atual por QR Code permanece disponível.</p>
                  {settings.verified_name ? <p className="mt-1 text-xs font-semibold text-emerald-950">{settings.verified_name} · {settings.phone_number}</p> : null}
                </div>
              </div>
              {settings.provider === 'meta_cloud' && settings.connected ? (
                <Button type="button" variant="outline" onClick={disconnectMeta} disabled={loading} className="border-emerald-300 bg-white text-emerald-900"><Unplug className="mr-2 h-4 w-4" />Desconectar</Button>
              ) : (
                <Button type="button" onClick={metaTestModeAvailable ? activateMetaTest : connectMeta} disabled={loading || !metaAvailable} className="bg-emerald-700 hover:bg-emerald-800">
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
                  {metaAvailable ? (metaTestModeAvailable ? 'Ativar homologação Meta' : 'Conectar com a Meta') : 'Configuração pendente'}
                </Button>
              )}
            </div>
          </div>}
          <MetaWhatsAppTemplates
            enabled={settings.provider === 'meta_cloud' && settings.connected}
            storeId={user?.id}
          />
          <div className="space-y-2">
            <Label htmlFor="phone">Número do WhatsApp</Label>
            <div className="flex gap-2">
              <Input
                id="phone"
                value={settings.phone_number}
                onChange={(e) => setSettings(prev => ({ ...prev, phone_number: e.target.value }))}
                placeholder="(11) 99999-9999 (Opcional para o QR)"
                disabled={settings.connected}
              />
              {!settings.connected && (
                <Button onClick={generateQRCode} disabled={loading}>
                  <QrCode className="w-4 h-4 mr-2" />
                  Conectar WhatsApp
                </Button>
              )}
              {settings.connected && (
                <Button variant="outline" disabled className="text-green-600 border-green-600">
                  <MessageCircle className="w-4 h-4 mr-2" />
                  WhatsApp Conectado
                </Button>
              )}
            </div>
          </div>

          {(qrCodeUrl || (!settings.connected && settings.qr_code_data)) && !settings.connected && (
            <div className="p-4 border rounded-lg text-center bg-white shadow-sm">
              <div className="mx-auto mb-4 flex items-center justify-center">
                 {qrCodeUrl ? (
                   <img src={qrCodeUrl.includes('base64') ? qrCodeUrl : `data:image/png;base64,${qrCodeUrl}`} alt="QR Code WhatsApp" className="w-64 h-64 border-4 border-white shadow-md rounded-lg" />
                 ) : (
                   <div className="w-64 h-64 bg-gray-100 rounded-lg flex items-center justify-center">
                     <QrCode className="w-16 h-16 text-gray-400 animate-pulse" />
                   </div>
                 )}
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">
                Escaneie com o WhatsApp
              </p>
              <p className="text-xs text-gray-500 mb-4">
                Abra o WhatsApp {'>'} Configurações {'>'} Aparelhos conectados {'>'} Conectar aparelho
              </p>

              <div className="flex items-center justify-center gap-2 mt-4 p-2 bg-gray-50 rounded-full w-fit mx-auto">
                <div className={`w-3 h-3 rounded-full ${settings.connected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
                <span className="text-sm font-medium text-gray-700">
                  {settings.connected ? 'Conectado com sucesso!' : 'Aguardando leitura do QR Code...'}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-lg font-medium">Mensagens Automáticas</h3>     

            <div className="space-y-2">
              <Label>Pedido Recebido</Label>
              <Textarea
                value={settings.auto_messages.order_received}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  auto_messages: { ...prev.auto_messages, order_received: e.target.value }
                }))}
                placeholder="🎉 Pedido recebido! Número: {order_number}. Tempo estimado: {estimated_time}"
              />
            </div>

            <div className="space-y-2">
              <Label>Em Preparo</Label>
              <Textarea
                value={settings.auto_messages.preparing}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  auto_messages: { ...prev.auto_messages, preparing: e.target.value }
                }))}
                placeholder="👨‍🍳 Seu pedido #{order_number} está sendo preparado!"
              />
            </div>

            <div className="space-y-2">
              <Label>Pronto</Label>
              <Textarea
                value={settings.auto_messages.ready}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  auto_messages: { ...prev.auto_messages, ready: e.target.value }
                }))}
                placeholder="✅ Pedido #{order_number} pronto para retirada!"  
              />
            </div>

            <div className="space-y-2">
              <Label>Saiu para Entrega</Label>
              <Textarea
                value={settings.auto_messages.out_for_delivery}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  auto_messages: { ...prev.auto_messages, out_for_delivery: e.target.value }
                }))}
                placeholder="🚗 Pedido #{order_number} saiu para entrega!"    
              />
            </div>

            <div className="space-y-2">
              <Label>Entregue</Label>
              <Textarea
                value={settings.auto_messages.delivered}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  auto_messages: { ...prev.auto_messages, delivered: e.target.value }
                }))}
                placeholder="✅ Pedido #{order_number} foi entregue!"
              />
            </div>

            <div className="space-y-2">
              <Label>Cancelado</Label>
              <Textarea
                value={settings.auto_messages.cancelled}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  auto_messages: { ...prev.auto_messages, cancelled: e.target.value }
                }))}
                placeholder="❌ Seu pedido #{order_number} foi cancelado. Se precisar, fale com a gente."
              />
            </div>

            <div className="space-y-2">
              <Label>Link do Cardápio</Label>
              <Textarea
                value={settings.auto_messages.menu_link}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  auto_messages: { ...prev.auto_messages, menu_link: e.target.value }
                }))}
                placeholder="Clique aqui e faça seu pedido: {menu_link}"
              />
            </div>

            <div className="space-y-2">
              <Label>Mensagem de Boas-vindas</Label>
              <Textarea
                value={settings.auto_messages.welcome}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  auto_messages: { ...prev.auto_messages, welcome: e.target.value }
                }))}
                placeholder="Olá! 👋 Bem-vindo ao {restaurant_name}.\n\nClique aqui e faça seu pedido: {menu_link}"
              />
            </div>

            <Button onClick={saveSettings} disabled={loading} className="w-full">
              Salvar Configurações
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default WhatsAppIntegration;
