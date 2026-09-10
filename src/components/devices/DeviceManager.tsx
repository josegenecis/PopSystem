
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Scale, Printer, Bluetooth, Wifi, Usb, Search, Power, PowerOff, Link as LinkIcon, ScanBarcode, ArchiveRestore } from 'lucide-react';
import { useDeviceIntegration, Device } from '@/hooks/useDeviceIntegration';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { loadPrinterConfig, savePrinterConfig } from '@/services/printerConfig';
import { discoverBridgeWebsocketUrl } from '@/services/bridgeDiscovery';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { createPrintAgentToken, enqueuePrintJob } from '@/services/printRelay';
import { supabase } from '@/integrations/supabase/client';
import { getLatestBridgeWindowsExe } from '@/services/bridgeDownload';
import { PrinterService as PdvPrinterService } from '@/utils/printerService';

const DeviceManager = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { 
    devices, 
    isScanning, 
    scanForDevices, 
    connectDevice, 
    disconnectDevice,
    getScaleReading,
    printReceipt,
    bridgeConfig,
    bridgeConnected,
    setBridgeConfig,
    connectBridgePrinter
  } = useDeviceIntegration();

  const [autoPrintKds, setAutoPrintKds] = React.useState(() => loadPrinterConfig().autoPrintKds);
  const [detectingBridge, setDetectingBridge] = React.useState(false);
  const [tokenName, setTokenName] = React.useState('Computador do caixa');
  const [generatedToken, setGeneratedToken] = React.useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = React.useState(false);
  const [cloudPrinters, setCloudPrinters] = React.useState<Array<{ agent_id: string; printer_id: string; name: string; transport: string; address?: string }>>([]);
  const [fetchingCloudPrinters, setFetchingCloudPrinters] = React.useState(false);
  const [selectedCloudPrinterId, setSelectedCloudPrinterId] = React.useState<string>(() => loadPrinterConfig().relay?.selectedPrinter?.printerId || '');
  const [downloadingBridge, setDownloadingBridge] = React.useState(false);
  const [scaleReading, setScaleReading] = React.useState<string>('');
  const [webUsbPrinterConnected, setWebUsbPrinterConnected] = React.useState(false);
  const [openingDrawer, setOpeningDrawer] = React.useState(false);

  React.useEffect(() => {
    if (!user?.id) return;

    let active = true;
    const loadKitchenTicketSetting = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('printer_settings')
          .select('print_kitchen_ticket')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;

        if (!active) return;

        const enabled = Boolean((data as any)?.print_kitchen_ticket);
        setAutoPrintKds(enabled);
        const cfg = loadPrinterConfig();
        savePrinterConfig({ ...cfg, autoPrintKds: enabled });
      } catch (error) {
        console.error('Erro ao carregar configuração da cozinha:', error);
      }
    };

    void loadKitchenTicketSetting();

    return () => {
      active = false;
    };
  }, [user?.id]);

  const persistKitchenTicketSetting = async (checked: boolean) => {
    const previous = autoPrintKds;
    setAutoPrintKds(checked);

    const cfg = loadPrinterConfig();
    savePrinterConfig({
      ...cfg,
      autoPrintKds: checked,
      bridge: { ...cfg.bridge, websocketUrl: bridgeConfig.websocketUrl, transport: bridgeConfig.transport as any, address: bridgeConfig.address || '' }
    });

    if (!user?.id) return;

    try {
      const { error } = await (supabase as any)
        .from('printer_settings')
        .upsert({
          user_id: user.id,
          print_kitchen_ticket: checked,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;
    } catch (error: any) {
      setAutoPrintKds(previous);
      const rollbackConfig = loadPrinterConfig();
      savePrinterConfig({
        ...rollbackConfig,
        autoPrintKds: previous,
        bridge: { ...rollbackConfig.bridge, websocketUrl: bridgeConfig.websocketUrl, transport: bridgeConfig.transport as any, address: bridgeConfig.address || '' }
      });
      toast({ title: 'Falha ao salvar', description: error?.message || 'Não foi possível atualizar a impressão da cozinha.', variant: 'destructive' });
    }
  };

  const getDeviceIcon = (type: Device['type']) => {
    switch (type) {
      case 'scale': return <Scale size={20} />;
      case 'printer': return <Printer size={20} />;
      default: return null;
    }
  };

  const getConnectionIcon = (connectionType: Device['connectionType']) => {
    switch (connectionType) {
      case 'bluetooth': return <Bluetooth size={16} />;
      case 'wifi': return <Wifi size={16} />;
      case 'usb': return <Usb size={16} />;
      default: return null;
    }
  };

  const getStatusBadge = (status: Device['status']) => {
    switch (status) {
      case 'connected':
        return <Badge className="bg-green-500 text-white">Conectado</Badge>;
      case 'connecting':
        return <Badge className="bg-yellow-500 text-white">Conectando...</Badge>;
      case 'disconnected':
        return <Badge variant="outline">Desconectado</Badge>;
      default:
        return <Badge variant="destructive">Offline</Badge>;
    }
  };

  const scales = devices.filter(d => d.type === 'scale');
  const printers = devices.filter(d => d.type === 'printer');
  const connectedPrinter = printers.find(d => d.status === 'connected');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Gerenciamento de Dispositivos</h2>
        <Button 
          onClick={scanForDevices} 
          disabled={isScanning}
          className="flex items-center gap-2"
        >
          <Search size={16} />
          {isScanning ? 'Escaneando...' : 'Escanear Dispositivos'}
        </Button>
      </div>

      {isScanning && (
        <div className="text-sm text-muted-foreground">Procurando dispositivos…</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Balanças */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale size={24} />
              Balanças
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No Chrome ou Edge instalado como PWA, conecte a porta USB/serial da balança. A autorização fica salva no navegador.
              </p>
              {scales.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  Nenhuma balança encontrada
                </p>
              ) : (
                scales.map((device) => (
                  <div key={device.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {getDeviceIcon(device.type)}
                      <div>
                        <p className="font-medium">{device.name}</p>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          {getConnectionIcon(device.connectionType)}
                          <span className="capitalize">{device.connectionType}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(device.status)}
                      {device.status === 'connected' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => disconnectDevice(device.id)}
                          className="flex items-center gap-1"
                        >
                          <PowerOff size={14} />
                          Desconectar
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => connectDevice(device.id)}
                          disabled={device.status === 'connecting'}
                          className="flex items-center gap-1"
                        >
                          <Power size={14} />
                          Conectar
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
              {scales.some(device => device.status === 'connected') && (
                <div className="flex items-center gap-3 rounded-lg border bg-emerald-50 p-3">
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground">Leitura atual</div>
                    <div className="text-2xl font-bold text-emerald-800">{scaleReading || '—'}</div>
                  </div>
                  <Button variant="outline" onClick={async () => {
                    try {
                      const reading = await getScaleReading();
                      const kg = reading.unit === 'g' ? reading.weight / 1000 : reading.weight;
                      setScaleReading(`${kg.toFixed(3)} kg`);
                    } catch (error: any) {
                      toast({ title: 'Sem leitura da balança', description: error?.message || 'Verifique o cabo e o protocolo.', variant: 'destructive' });
                    }
                  }}>Testar peso</Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Impressoras */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Printer size={24} />
              Impressoras
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {'usb' in navigator && (
                <div className="rounded-lg border bg-blue-50 p-3">
                  <div className="mb-2 font-medium">Impressora USB direta no PWA</div>
                  <p className="mb-3 text-sm text-muted-foreground">Pareia uma impressora térmica compatível com ESC/POS sem instalar programa adicional.</p>
                  <Button size="sm" variant="outline" onClick={async () => {
                    const connected = await PdvPrinterService.connectUsb();
                    setWebUsbPrinterConnected(connected);
                    toast({
                      title: connected ? 'Impressora USB conectada' : 'Não foi possível conectar',
                      description: connected ? 'As próximas impressões usarão a conexão direta do PWA.' : 'Confirme a permissão e se a impressora é compatível com WebUSB.',
                      variant: connected ? 'default' : 'destructive',
                    });
                  }}>{webUsbPrinterConnected ? 'USB conectada' : 'Conectar impressora USB'}</Button>
                </div>
              )}
              {/* Compatibilidade local avançada do Pop Connect */}
              <details className="rounded-lg border bg-slate-50/70 p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">Configuração avançada da conexão local</summary>
                <div className="mt-3">
                <div className="flex items-center gap-2 mb-2">
                  <LinkIcon size={18} />
                  <span className="text-sm">Conexão local do Pop Connect</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-3">
                    <Input
                      placeholder="ws://localhost:8766 (ou ws://IP_DA_REDE:8766)"
                      value={bridgeConfig.websocketUrl}
                      onChange={(e) => setBridgeConfig(prev => ({ ...prev, websocketUrl: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Select value={['network','usb','bluetooth','system'].includes(bridgeConfig.transport as any) ? (bridgeConfig.transport as any) : 'network'} onValueChange={(v) => setBridgeConfig(prev => ({ ...prev, transport: v as any }))}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Transporte" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="network">Rede (IP)</SelectItem>
                        <SelectItem value="usb">USB</SelectItem>
                        <SelectItem value="bluetooth">Bluetooth</SelectItem>
                        <SelectItem value="system">Sistema (OS)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Input placeholder="Endereço/IP (ex.: 192.168.0.50)" value={bridgeConfig.address || ''} onChange={(e) => setBridgeConfig(prev => ({ ...prev, address: e.target.value }))} />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 border-t pt-3">
                  <div className="text-sm">
                    <div className="font-medium">Comanda da cozinha</div>
                    <div className="text-muted-foreground">Imprime um segundo cupom separado, sem preços e sem endereço.</div>
                  </div>
                  <Switch
                    checked={autoPrintKds}
                    onCheckedChange={(checked) => { void persistKitchenTicketSetting(checked); }}
                  />
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={detectingBridge}
                    onClick={async () => {
                      try {
                        setDetectingBridge(true);
                        const found = await discoverBridgeWebsocketUrl({ timeoutMs: 900 });
                        if (found) {
                          setBridgeConfig(prev => ({ ...prev, websocketUrl: found }));
                        }
                      } finally {
                        setDetectingBridge(false);
                      }
                    }}
                  >
                    {detectingBridge ? 'Detectando…' : 'Detectar Pop Connect'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => connectBridgePrinter({ websocketUrl: bridgeConfig.websocketUrl, transport: bridgeConfig.transport as any, address: bridgeConfig.address })}>Conectar</Button>
                </div>
                </div>
              </details>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="mb-1 flex items-center gap-2 text-base font-semibold text-emerald-950">
                  <LinkIcon size={18} /> Pop Connect
                </div>
                <div className="mb-3 text-sm text-emerald-900/70">
                  Instale no computador do caixa. O aplicativo encontra impressoras, balanças e ajuda a testar o leitor de código de barras.
                </div>
                <div className="mb-3 flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={openingDrawer}
                    onClick={async () => {
                      setOpeningDrawer(true);
                      try {
                        const result = await PdvPrinterService.openCashDrawer();
                        toast({
                          title: result?.success ? 'Gaveta aberta' : 'Não foi possível abrir a gaveta',
                          description: result?.success ? 'Comando enviado pela impressora configurada.' : result?.error,
                          variant: result?.success ? 'default' : 'destructive',
                        });
                      } finally {
                        setOpeningDrawer(false);
                      }
                    }}
                  >
                    <ArchiveRestore className="mr-2 h-4 w-4" />
                    {openingDrawer ? 'Abrindo…' : 'Abrir gaveta'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={downloadingBridge}
                    onClick={async () => {
                      try {
                        setDownloadingBridge(true);
                        const exe = await getLatestBridgeWindowsExe();
                        if (exe?.url) {
                          window.open(exe.url, '_blank', 'noopener,noreferrer');
                        } else {
                          window.open('https://github.com/josegenecis/PopSystem/releases', '_blank', 'noopener,noreferrer');
                        }
                      } finally {
                        setDownloadingBridge(false);
                      }
                    }}
                  >
                    {downloadingBridge ? 'Abrindo…' : 'Baixar Pop Connect para Windows'}
                  </Button>
                </div>
                <div className={`mb-3 rounded-lg border p-3 text-sm ${bridgeConnected ? 'border-emerald-300 bg-emerald-100 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
                  <div className="font-medium">{bridgeConnected ? 'Pop Connect reconhecido automaticamente' : 'Aguardando o Pop Connect'}</div>
                  <div className="mt-1 text-xs opacity-75">{bridgeConnected ? 'O PWA já pode usar os dispositivos deste computador. Nenhum código é necessário.' : 'Abra o Pop Connect neste computador. O PWA fará a conexão sozinho.'}</div>
                </div>
                <details className="mt-3 rounded-lg border bg-white/70 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Opções de suporte técnico</summary>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2">
                    <Input value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="Nome do token (ex.: Caixa 1)" />
                  </div>
                  <div className="sm:col-span-1">
                    <Button
                      className="w-full"
                      disabled={generatingToken || !user?.id}
                      onClick={async () => {
                        try {
                          setGeneratingToken(true);
                          const { token } = await createPrintAgentToken({ restaurantUserId: user?.id || '', name: tokenName });
                          setGeneratedToken(token);
                          toast({ title: 'Token gerado', description: 'Use apenas com orientação do suporte PopSystem.' });
                        } catch (e: any) {
                          toast({ title: 'Falha ao gerar token', description: e?.message || 'Erro desconhecido', variant: 'destructive' });
                        } finally {
                          setGeneratingToken(false);
                        }
                      }}
                    >
                      {generatingToken ? 'Gerando…' : 'Gerar token'}
                    </Button>
                  </div>
                </div>
                {generatedToken && (
                  <div className="mt-3">
                    <Input readOnly value={generatedToken} />
                    <div className="flex justify-end mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(generatedToken);
                            toast({ title: 'Copiado', description: 'Token copiado para a área de transferência.' });
                          } catch {
                            toast({ title: 'Não foi possível copiar', description: 'Copie manualmente o token.', variant: 'destructive' });
                          }
                        }}
                      >
                        Copiar token
                      </Button>
                    </div>
                  </div>
                )}
                </details>
                <div className="mt-4 border-t pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">Impressoras disponíveis</div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={fetchingCloudPrinters || !user?.id}
                      onClick={async () => {
                        try {
                          setFetchingCloudPrinters(true);
                          const { data, error } = await supabase
                            .from('print_agent_printers' as any)
                            .select('agent_id, printer_id, name, transport, address, updated_at')
                            .eq('restaurant_user_id', user?.id || '')
                            .order('updated_at', { ascending: false })
                            .limit(50);
                          if (error) throw error;
                          setCloudPrinters((data || []) as any);
                        } catch (e: any) {
                          toast({ title: 'Falha ao buscar impressoras', description: e?.message || 'Erro desconhecido', variant: 'destructive' });
                        } finally {
                          setFetchingCloudPrinters(false);
                        }
                      }}
                    >
                      {fetchingCloudPrinters ? 'Buscando…' : 'Buscar impressoras'}
                    </Button>
                  </div>

                  {cloudPrinters.length > 0 ? (
                    <Select
                      value={selectedCloudPrinterId}
                      onValueChange={(v) => {
                        setSelectedCloudPrinterId(v);
                        const p = cloudPrinters.find(x => x.printer_id === v);
                        if (p) {
                          const cfg = loadPrinterConfig();
                          savePrinterConfig({
                            ...cfg,
                            relay: {
                              ...cfg.relay,
                              selectedPrinter: {
                                printerId: p.printer_id,
                                name: p.name,
                                transport: p.transport as any,
                                address: p.address || '',
                              }
                            }
                          });
                          toast({ title: 'Impressora selecionada', description: p.name });
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione uma impressora" />
                      </SelectTrigger>
                      <SelectContent>
                        {cloudPrinters.map((p) => (
                          <SelectItem key={`${p.agent_id}:${p.printer_id}`} value={p.printer_id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Abra o Pop Connect e clique em “Buscar impressoras”. A conexão local não exige código.
                    </div>
                  )}
                </div>
              </div>
              {printers.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  Nenhuma impressora encontrada
                </p>
              ) : (
                printers.map((device) => (
                  <div key={device.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {getDeviceIcon(device.type)}
                      <div>
                        <p className="font-medium">{device.name}</p>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          {getConnectionIcon(device.connectionType)}
                          <span className="capitalize">{device.connectionType}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(device.status)}
                      {device.status === 'connected' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => disconnectDevice(device.id)}
                          className="flex items-center gap-1"
                        >
                          <PowerOff size={14} />
                          Desconectar
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => connectDevice(device.id)}
                          disabled={device.status === 'connecting'}
                          className="flex items-center gap-1"
                        >
                          <Power size={14} />
                          Conectar
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
             {connectedPrinter && (
               <div className="flex justify-end gap-2">
                 <Button
                   variant="default"
                   size="sm"
                   className="flex items-center gap-2"
                    onClick={() => printReceipt({ order_number: 'TESTE', customer_name: 'Teste', items: [{ quantity: 1, product_name: 'Item', subtotal: 0 }], total: 0 }, { transport: bridgeConfig.transport, address: bridgeConfig.address })}
                  >
                    Imprimir teste
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!user?.id}
                    onClick={async () => {
                      try {
                        await enqueuePrintJob({
                          restaurantUserId: user?.id || '',
                          jobType: 'test_receipt',
                          payload: { order_number: 'TESTE', customer_name: 'Teste', items: [{ quantity: 1, product_name: 'Item', subtotal: 0 }], total: 0, date: new Date().toISOString() }
                        })
                        toast({ title: 'Enfileirado', description: 'Job enviado para a fila (cloud relay).' })
                      } catch (e: any) {
                        toast({ title: 'Falha ao enfileirar', description: e?.message || 'Erro desconhecido', variant: 'destructive' })
                      }
                    }}
                  >
                    Enviar teste (fila)
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ScanBarcode size={22} /> Leitor de código de barras</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Badge className="bg-green-600">Pronto para uso</Badge>
          <p className="text-muted-foreground">
            Leitores USB que funcionam como teclado não precisam de pareamento: conecte, leia o código e finalize com Enter. O PDV identifica produtos e comandas automaticamente.
          </p>
          <p className="text-xs text-muted-foreground">Configure o leitor para enviar Enter após cada leitura e layout numérico padrão.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default DeviceManager;
