import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Copy, Download, ExternalLink, Printer, QrCode, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { buildPublicMenuUrl } from '@/utils/publicUrl';
import { supabase } from '@/integrations/supabase/client';

type TableQrRow = {
  id: string;
  table_number: number;
  location?: string | null;
  qr_token: string;
  qr_ordering_enabled: boolean;
};

type QrMode = 'ordering' | 'view_only';

const DEFAULT_MESSAGE = 'Escaneie para ver o cardápio e fazer seu pedido.';

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = url;
});

const drawCenteredText = (context: CanvasRenderingContext2D, text: string, y: number, maxWidth: number, lineHeight: number) => {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((value, index) => context.fillText(value, 600, y + index * lineHeight));
};

const QRCodeGenerator = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  const [tables, setTables] = useState<TableQrRow[]>([]);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [restaurantName, setRestaurantName] = useState('Restaurante');
  const [logoUrl, setLogoUrl] = useState('');
  const [mode, setMode] = useState<QrMode>('ordering');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) || tables[0] || null,
    [selectedTableId, tables],
  );
  const menuUrl = selectedTable && user?.id
    ? `${buildPublicMenuUrl(user.id)}?table=${encodeURIComponent(selectedTable.qr_token)}`
    : '';

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const [{ data: profile, error: profileError }, { data: tableRows, error: tableError }, { data: settings, error: settingsError }] = await Promise.all([
          (supabase.from('profiles') as any).select('restaurant_name,logo_url').eq('id', user.id).maybeSingle(),
          (supabase.from('tables') as any).select('id,table_number,location,qr_token,qr_ordering_enabled').eq('user_id', user.id).is('archived_at', null).order('table_number'),
          (supabase.from('table_qr_settings') as any).select('mode,message').eq('user_id', user.id).maybeSingle(),
        ]);
        if (profileError) throw profileError;
        if (tableError) throw tableError;
        if (settingsError && settingsError.code !== 'PGRST116') throw settingsError;
        if (!active) return;
        setRestaurantName(String(profile?.restaurant_name || 'Restaurante'));
        setLogoUrl(String(profile?.logo_url || ''));
        const nextTables = (tableRows || []) as TableQrRow[];
        setTables(nextTables);
        setSelectedTableId((current) => current || nextTables[0]?.id || '');
        setMode(settings?.mode === 'view_only' ? 'view_only' : 'ordering');
        setMessage(String(settings?.message || DEFAULT_MESSAGE));
      } catch (error: any) {
        toast({ title: 'Não foi possível carregar os QR Codes', description: error?.message || 'Atualize a página e tente novamente.', variant: 'destructive' });
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [toast, user?.id]);

  const saveSettings = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const { error } = await (supabase.from('table_qr_settings') as any).upsert({
        user_id: user.id,
        mode,
        message: message.trim() || DEFAULT_MESSAGE,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast({ title: 'Configuração salva', description: mode === 'ordering' ? 'Os QR Codes permitem pedidos nas mesas habilitadas.' : 'Os QR Codes ficaram somente para visualização.' });
    } catch (error: any) {
      toast({ title: 'Não foi possível salvar', description: error?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const toggleTableOrdering = async (table: TableQrRow, checked: boolean) => {
    const previous = tables;
    setTables((rows) => rows.map((row) => row.id === table.id ? { ...row, qr_ordering_enabled: checked } : row));
    const { error } = await (supabase.from('tables') as any).update({ qr_ordering_enabled: checked }).eq('id', table.id);
    if (error) {
      setTables(previous);
      toast({ title: 'Não foi possível atualizar a mesa', description: error.message, variant: 'destructive' });
    }
  };

  const renderCard = async (table: TableQrRow) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Navegador sem suporte à geração da arte.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#003223';
    context.fillRect(0, 0, canvas.width, 330);
    context.fillStyle = '#85C441';
    context.fillRect(0, 330, canvas.width, 18);
    if (logoUrl) {
      try {
        const logo = await loadImage(logoUrl);
        context.save();
        context.beginPath();
        context.roundRect(525, 45, 150, 150, 28);
        context.clip();
        context.fillStyle = '#ffffff';
        context.fillRect(525, 45, 150, 150);
        context.drawImage(logo, 525, 45, 150, 150);
        context.restore();
      } catch { /* Arte continua sem logo quando a origem bloqueia CORS. */ }
    }
    context.textAlign = 'center';
    context.fillStyle = '#ffffff';
    context.font = '700 42px Arial';
    context.fillText(restaurantName, 600, 260);
    context.fillStyle = '#003223';
    context.font = '900 92px Arial';
    context.fillText(`MESA ${table.table_number}`, 600, 470);
    if (table.location) {
      context.font = '500 30px Arial';
      context.fillStyle = '#52605b';
      context.fillText(table.location, 600, 520);
    }
    if (!qrRef.current) throw new Error('QR Code ainda não foi gerado.');
    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(0,0,0,.14)';
    context.shadowBlur = 30;
    context.fillRect(250, 575, 700, 700);
    context.shadowBlur = 0;
    context.drawImage(qrRef.current, 300, 625, 600, 600);
    context.fillStyle = '#003223';
    context.font = '700 38px Arial';
    drawCenteredText(context, message.trim() || DEFAULT_MESSAGE, 1360, 920, 48);
    context.fillStyle = '#ef6c20';
    context.font = '700 25px Arial';
    context.fillText(mode === 'view_only' || !table.qr_ordering_enabled ? 'CARDÁPIO DIGITAL' : 'CARDÁPIO E PEDIDOS', 600, 1530);
    return canvas.toDataURL('image/png');
  };

  const downloadSelected = async () => {
    if (!selectedTable) return;
    try {
      const dataUrl = await renderCard(selectedTable);
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `qr-mesa-${selectedTable.table_number}.png`;
      link.click();
      toast({ title: 'Arte gerada', description: `QR Code personalizado da Mesa ${selectedTable.table_number} baixado.` });
    } catch (error: any) {
      toast({ title: 'Não foi possível gerar a arte', description: error?.message, variant: 'destructive' });
    }
  };

  const printSelected = async () => {
    if (!selectedTable) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({ title: 'Pop-up bloqueado', description: 'Libere pop-ups para abrir a impressão.', variant: 'destructive' });
      return;
    }
    const dataUrl = await renderCard(selectedTable);
    printWindow.document.write(`<html><head><title>QR Mesa ${selectedTable.table_number}</title><style>@page{size:A5;margin:8mm}body{margin:0;display:grid;place-items:center}img{width:100%;max-height:95vh;object-fit:contain}</style></head><body><img src="${dataUrl}" onload="window.print()"></body></html>`);
    printWindow.document.close();
  };

  const copyLink = async () => {
    if (!menuUrl) return;
    await navigator.clipboard.writeText(menuUrl);
    toast({ title: 'Link copiado', description: `Link exclusivo da Mesa ${selectedTable?.table_number}.` });
  };

  if (loading) return <div className="py-10 text-center text-sm text-muted-foreground">Carregando QR Codes das mesas…</div>;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-emerald-200">
        <CardHeader className="bg-[#003223] text-white">
          <CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> Cardápio por QR Code nas mesas</CardTitle>
          <p className="text-sm text-white/75">Cada mesa possui um link exclusivo e seguro. O cliente nunca precisa digitar o número da mesa.</p>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Funcionamento dos QR Codes</Label>
              <Select value={mode} onValueChange={(value: QrMode) => setMode(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ordering">Visualizar e fazer pedidos</SelectItem>
                  <SelectItem value="view_only">Somente visualizar o cardápio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mensagem da arte</Label>
              <Input value={message} maxLength={120} onChange={(event) => setMessage(event.target.value)} placeholder={DEFAULT_MESSAGE} />
            </div>
          </div>
          <div className="flex justify-end"><Button onClick={saveSettings} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? 'Salvando…' : 'Salvar configuração'}</Button></div>
        </CardContent>
      </Card>

      {tables.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Cadastre as mesas primeiro para gerar os QR Codes.</CardContent></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader><CardTitle className="text-lg">Mesas habilitadas</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {tables.map((table) => (
                <div key={table.id} className={`flex items-center justify-between rounded-xl border p-3 ${selectedTable?.id === table.id ? 'border-emerald-400 bg-emerald-50/60' : ''}`}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedTableId(table.id)}>
                    <div className="font-semibold text-[#003223]">Mesa {table.table_number}</div>
                    <div className="truncate text-xs text-muted-foreground">{table.location || 'Sem localização informada'}</div>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="hidden text-xs text-muted-foreground sm:inline">Aceitar pedidos</span>
                    <Switch checked={table.qr_ordering_enabled} disabled={mode === 'view_only'} onCheckedChange={(checked) => void toggleTableOrdering(table, checked)} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardContent className="space-y-4 p-5">
              <div className="text-center">
                <div className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">{restaurantName}</div>
                <div className="mt-1 text-3xl font-black text-[#003223]">Mesa {selectedTable?.table_number}</div>
              </div>
              {menuUrl && <div className="mx-auto w-fit rounded-2xl border bg-white p-4 shadow-sm"><QRCodeCanvas ref={qrRef} value={menuUrl} size={260} level="H" marginSize={2} /></div>}
              <p className="text-center text-sm text-slate-600">{message || DEFAULT_MESSAGE}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={downloadSelected}><Download className="mr-2 h-4 w-4" />Baixar</Button>
                <Button variant="outline" onClick={printSelected}><Printer className="mr-2 h-4 w-4" />Imprimir</Button>
                <Button variant="outline" onClick={copyLink}><Copy className="mr-2 h-4 w-4" />Copiar link</Button>
                <Button variant="outline" onClick={() => window.open(menuUrl, '_blank', 'noopener,noreferrer')}><ExternalLink className="mr-2 h-4 w-4" />Abrir</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default QRCodeGenerator;
