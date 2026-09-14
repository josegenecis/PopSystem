import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, ArrowLeft, CheckCircle2, Database, Download, FileSpreadsheet, HardDrive, Link2, Loader2, Server, UploadCloud } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { convertFirebirdToImportFile, convertSqliteToImportFile, detectOfflineDatabaseEngine, type FirebirdConnectionOptions } from '@/utils/offlineDatabaseImport';

type DatasetType = 'products' | 'customers' | 'orders' | 'order_items' | 'sales' | 'unknown' | 'ignore';

type DatasetPreview = {
  name: string;
  detectedType: DatasetType;
  detectedLabel: string;
  rowCount: number;
  columns: string[];
  preview: Array<Record<string, unknown>>;
};

type MigrationJob = {
  id: string;
  source_name: string;
  source_system: string;
  status: string;
  analysis: {
    datasets: DatasetPreview[];
    totals?: Record<string, number>;
  };
};

type MigrationResult = {
  categoriesCreated: number;
  productsCreated: number;
  productsReused: number;
  customersCreated: number;
  customersReused: number;
  ordersCreated: number;
  ordersSkipped: number;
  rowsIgnored: number;
  warnings?: string[];
};

interface DataMigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
  initialFile?: File | null;
}

const DATASET_OPTIONS: Array<{ value: DatasetType; label: string }> = [
  { value: 'products', label: 'Produtos' },
  { value: 'customers', label: 'Clientes' },
  { value: 'orders', label: 'Vendas' },
  { value: 'order_items', label: 'Itens das vendas' },
  { value: 'sales', label: 'Vendas com itens na mesma planilha' },
  { value: 'ignore', label: 'Ignorar esta planilha' },
];

const safeFilename = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'dados';

const downloadTestFile = () => {
  const sample = {
    produtos: [
      { id: 'PROD-001', nome: 'Açaí 500 ml', descricao: 'Produto de teste', preco: 18.9, categoria: 'Açaí', ativo: true, ncm: '21069090' },
      { id: 'PROD-002', nome: 'Água mineral', preco: 4, categoria: 'Bebidas', ativo: true, ncm: '22011000' },
    ],
    clientes: [
      { id: 'CLI-001', nome: 'Cliente de Teste', telefone: '85999999999', endereco: 'Rua de Teste, 100', bairro: 'Centro' },
    ],
    vendas: [
      { venda_id: 'TESTE-MIGRACAO-001', numero_venda: 'MIG-001', data_hora: '2026-08-04 12:30:00', cliente_id: 'CLI-001', cliente: 'Cliente de Teste', telefone: '85999999999', forma_pagamento: 'PIX', total: 22.9, tipo: 'balcao' },
    ],
    itens_venda: [
      { venda_id: 'TESTE-MIGRACAO-001', produto_id: 'PROD-001', produto: 'Açaí 500 ml', quantidade: 1, preco_unitario: 18.9, subtotal: 18.9 },
      { venda_id: 'TESTE-MIGRACAO-001', produto_id: 'PROD-002', produto: 'Água mineral', quantidade: 1, preco_unitario: 4, subtotal: 4 },
    ],
  };
  const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = 'modelo-migracao-popsystem.json';
  anchor.click();
  URL.revokeObjectURL(href);
};

const DataMigrationModal: React.FC<DataMigrationModalProps> = ({ isOpen, onClose, onImportComplete, initialFile = null }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sourceMode, setSourceMode] = useState<'upload' | 'url' | 'offline'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [sourceSystem, setSourceSystem] = useState('');
  const [job, setJob] = useState<MigrationJob | null>(null);
  const [mapping, setMapping] = useState<Record<string, DatasetType>>({});
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [offlineEngine, setOfflineEngine] = useState<'sqlite' | 'firebird'>('sqlite');
  const [firebirdFile, setFirebirdFile] = useState<{ path: string; name: string } | null>(null);
  const [firebird, setFirebird] = useState<FirebirdConnectionOptions>({
    host: '127.0.0.1', port: 3050, database: '', user: 'SYSDBA', password: '', charset: 'UTF8',
  });
  const desktopFirebirdAvailable = Boolean(window.electronAPI?.isElectron && window.electronAPI?.selectFirebirdDatabase && window.electronAPI?.analyzeFirebirdDatabase);

  useEffect(() => {
    if (isOpen) return;
    setFile(null);
    setUrl('');
    setSourceSystem('');
    setJob(null);
    setMapping({});
    setResult(null);
    setBusy(false);
    setStatusText('');
    setOfflineEngine('sqlite');
    setFirebirdFile(null);
    setFirebird({ host: '127.0.0.1', port: 3050, database: '', user: 'SYSDBA', password: '', charset: 'UTF8' });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !initialFile || job) return;
    setFile(initialFile);
    const engine = detectOfflineDatabaseEngine(initialFile.name);
    setSourceMode(engine === 'sqlite' || engine === 'firebird' ? 'offline' : 'upload');
    if (engine === 'sqlite' || engine === 'firebird') setOfflineEngine(engine);
    setSourceSystem((current) => current || initialFile.name.replace(/\.[^.]+$/, ''));
  }, [initialFile, isOpen, job]);

  const selectedTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    (job?.analysis?.datasets || []).forEach((dataset) => {
      const type = mapping[dataset.name] || dataset.detectedType;
      if (type !== 'ignore' && type !== 'unknown') totals[type] = (totals[type] || 0) + dataset.rowCount;
    });
    return totals;
  }, [job, mapping]);

  const analyze = async () => {
    if (!user?.id) return;
    if (sourceMode === 'upload' && !file) {
      toast({ title: 'Selecione o arquivo', description: 'Envie um CSV, Excel ou JSON.', variant: 'destructive' });
      return;
    }
    if (sourceMode === 'offline' && offlineEngine === 'sqlite' && !file) {
      toast({ title: 'Selecione o banco SQLite', description: 'Envie um arquivo .sqlite, .sqlite3, .db ou .db3.', variant: 'destructive' });
      return;
    }
    if (sourceMode === 'offline' && offlineEngine === 'firebird' && !desktopFirebirdAvailable) {
      toast({ title: 'Abra no PopSystem Desktop', description: 'O navegador não consegue acessar o servidor Firebird instalado neste computador.', variant: 'destructive' });
      return;
    }
    if (sourceMode === 'offline' && offlineEngine === 'firebird' && !firebird.database) {
      toast({ title: 'Selecione o banco Firebird', description: 'Escolha o arquivo .FDB ou .GDB pelo botão desta tela.', variant: 'destructive' });
      return;
    }
    if (sourceMode === 'url' && !/^https?:\/\//i.test(url.trim())) {
      toast({ title: 'Link inválido', description: 'Cole um link público direto para o arquivo de exportação.', variant: 'destructive' });
      return;
    }
    if (file && file.size > 50 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'Nesta versão de teste, o limite é 50 MB.', variant: 'destructive' });
      return;
    }

    setBusy(true);
    setStatusText(sourceMode === 'offline' ? 'Lendo o banco local com segurança...' : sourceMode === 'upload' ? 'Enviando arquivo com segurança...' : 'Baixando dados do link...');
    try {
      let source: Record<string, string>;
      if (sourceMode === 'upload' || sourceMode === 'offline') {
        let uploadFile: File;
        if (sourceMode === 'offline') {
          if (offlineEngine === 'firebird') {
            const converted = await convertFirebirdToImportFile(firebird);
            uploadFile = converted.file;
            setStatusText(`${converted.tableCount} tabelas e ${converted.rowCount.toLocaleString('pt-BR')} registros encontrados.${converted.compressed ? ' Dados compactados automaticamente.' : ''} Enviando para análise...`);
          } else {
            if (!file) throw new Error('Selecione o banco SQLite.');
            const engine = detectOfflineDatabaseEngine(file.name);
            if (engine !== 'sqlite') throw new Error('Selecione um banco SQLite (.sqlite, .sqlite3, .db ou .db3).');
            const converted = await convertSqliteToImportFile(file);
            uploadFile = converted.file;
            setStatusText(`${converted.tableCount} tabelas e ${converted.rowCount.toLocaleString('pt-BR')} registros encontrados. Enviando para análise...`);
          }
        } else {
          if (!file) throw new Error('Selecione o arquivo de importação.');
          uploadFile = file;
        }
        if (uploadFile.size > 50 * 1024 * 1024) throw new Error('Mesmo após a compactação, os dados ultrapassam 50 MB. Este volume precisa de importação assistida.');
        const path = `${user.id}/${crypto.randomUUID()}/${safeFilename(uploadFile.name)}`;
        const { error } = await supabase.storage.from('data-imports').upload(path, uploadFile, { contentType: uploadFile.type || 'application/octet-stream', upsert: false });
        if (error) throw error;
        source = { type: 'upload', path, name: uploadFile.name };
      } else {
        source = { type: 'url', url: url.trim() };
      }
      setStatusText('Identificando produtos, clientes e vendas...');
      const response = await invokeEdgeFunction<{ success?: boolean; job?: MigrationJob; error?: string }>('data-migration', {
        action: 'analyze', source, sourceSystem: sourceSystem.trim() || undefined,
      }, { timeoutMs: 180000 });
      if (response.status >= 400 || !response.data?.success || !response.data.job) throw new Error(response.data?.error || 'Não foi possível analisar os dados.');
      const analyzedJob = response.data.job;
      setJob(analyzedJob);
      setSourceSystem(analyzedJob.source_system);
      setMapping(Object.fromEntries((analyzedJob.analysis?.datasets || []).map((dataset) => [dataset.name, dataset.detectedType === 'unknown' ? 'ignore' : dataset.detectedType])));
    } catch (error: any) {
      toast({ title: 'Não foi possível analisar', description: error?.message || 'Confira o arquivo e tente novamente.', variant: 'destructive' });
    } finally {
      setBusy(false);
      setStatusText('');
    }
  };

  const selectFirebirdDatabase = async () => {
    try {
      const response = await window.electronAPI?.selectFirebirdDatabase();
      if (!response || response.canceled) return;
      if (!response.success || !response.path || !response.name) throw new Error(response.error || 'Não foi possível selecionar o banco.');
      setFirebirdFile({ path: response.path, name: response.name });
      setFirebird((current) => ({ ...current, database: response.path }));
      setSourceSystem((current) => current || response.name!.replace(/\.[^.]+$/, ''));
    } catch (error: any) {
      toast({ title: 'Não foi possível selecionar', description: error?.message || 'Tente novamente.', variant: 'destructive' });
    }
  };

  const runImport = async () => {
    if (!job) return;
    if (!Object.values(mapping).some((type) => type !== 'ignore' && type !== 'unknown')) {
      toast({ title: 'Nada selecionado', description: 'Escolha ao menos uma planilha para importar.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    setStatusText('Importando e conferindo duplicidades...');
    try {
      const response = await invokeEdgeFunction<{ success?: boolean; result?: MigrationResult; error?: string }>('data-migration', {
        action: 'import', jobId: job.id, mapping,
      }, { timeoutMs: 300000 });
      if (response.status >= 400 || !response.data?.success || !response.data.result) throw new Error(response.data?.error || 'Não foi possível concluir a migração.');
      setResult(response.data.result);
      onImportComplete();
    } catch (error: any) {
      toast({ title: 'Migração não concluída', description: error?.message || 'Revise o arquivo e tente novamente.', variant: 'destructive' });
    } finally {
      setBusy(false);
      setStatusText('');
    }
  };

  const finish = () => {
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#003223]">
            <Database className="h-5 w-5 text-[#8CC850]" />
            Migrar dados de outro sistema
          </DialogTitle>
          <DialogDescription>
            Traga produtos, clientes e histórico de vendas para o PopSystem com prévia e proteção contra duplicidades.
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-[#003223]/10 bg-[#F7FBF5] p-8 text-center">
            <Loader2 className="mb-4 h-10 w-10 animate-spin text-[#8CC850]" />
            <p className="font-bold text-[#003223]">{statusText}</p>
            <p className="mt-2 text-sm text-slate-500">Não feche esta janela enquanto o processamento estiver em andamento.</p>
          </div>
        ) : result ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
                <div><p className="font-bold text-emerald-950">Migração concluída</p><p className="text-sm text-emerald-800">Os registros foram vinculados ao restaurante selecionado.</p></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Produtos criados', result.productsCreated], ['Produtos existentes', result.productsReused],
                ['Clientes criados', result.customersCreated], ['Clientes existentes', result.customersReused],
                ['Vendas importadas', result.ordersCreated], ['Vendas já importadas', result.ordersSkipped],
                ['Categorias criadas', result.categoriesCreated], ['Linhas ignoradas', result.rowsIgnored],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl border bg-white p-3"><p className="text-2xl font-black text-[#003223]">{value}</p><p className="text-xs text-slate-500">{label}</p></div>)}
            </div>
            {result.warnings?.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="mb-2 font-bold">Atenções</p>{result.warnings.slice(0, 8).map((warning) => <p key={warning}>• {warning}</p>)}</div> : null}
          </div>
        ) : job ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-slate-50 p-4">
              <div><p className="font-bold text-[#003223]">{job.source_name}</p><p className="text-xs text-slate-500">Origem: {job.source_system}</p></div>
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Pronto para importar</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-[#F7FBF5] p-3"><p className="text-2xl font-black text-[#003223]">{selectedTotals.products || 0}</p><p className="text-xs text-slate-500">produtos</p></div>
              <div className="rounded-xl bg-[#F7FBF5] p-3"><p className="text-2xl font-black text-[#003223]">{selectedTotals.customers || 0}</p><p className="text-xs text-slate-500">clientes</p></div>
              <div className="rounded-xl bg-[#F7FBF5] p-3"><p className="text-2xl font-black text-[#003223]">{(selectedTotals.orders || 0) + (selectedTotals.sales || 0)}</p><p className="text-xs text-slate-500">vendas ou linhas de venda</p></div>
            </div>
            <div className="space-y-3">
              {job.analysis.datasets.map((dataset) => (
                <div key={dataset.name} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div><p className="font-bold text-[#003223]">{dataset.name}</p><p className="text-xs text-slate-500">{dataset.rowCount.toLocaleString('pt-BR')} linhas • {dataset.columns.slice(0, 5).join(', ')}</p></div>
                    <Select value={mapping[dataset.name] || 'ignore'} onValueChange={(value) => setMapping((current) => ({ ...current, [dataset.name]: value as DatasetType }))}>
                      <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                      <SelectContent>{DATASET_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {dataset.preview[0] ? <div className="mt-3 overflow-hidden rounded-lg bg-slate-50 p-2 text-xs text-slate-500"><p className="truncate">Exemplo: {Object.entries(dataset.preview[0]).slice(0, 4).map(([column, value]) => `${column}: ${String(value ?? '')}`).join(' • ')}</p></div> : null}
                </div>
              ))}
            </div>
            <div className="flex gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>Vendas antigas entram como histórico concluído. Documentos fiscais não são reemitidos. Repetir esta importação não duplicará registros com o mesmo identificador.</p></div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2"><Label>Nome do sistema anterior</Label><Input value={sourceSystem} onChange={(event) => setSourceSystem(event.target.value)} placeholder="Ex.: Consumer, Saipos, sistema próprio..." /><p className="text-xs text-slate-500">Usamos este nome para reconhecer importações repetidas do mesmo sistema.</p></div>
            <Tabs value={sourceMode} onValueChange={(value) => setSourceMode(value as 'upload' | 'url' | 'offline')}>
              <TabsList className="grid w-full grid-cols-3"><TabsTrigger value="upload"><FileSpreadsheet className="mr-2 h-4 w-4" />Planilha</TabsTrigger><TabsTrigger value="url"><Link2 className="mr-2 h-4 w-4" />Link</TabsTrigger><TabsTrigger value="offline"><HardDrive className="mr-2 h-4 w-4" />Banco offline</TabsTrigger></TabsList>
              <TabsContent value="upload" className="pt-4">
                <label className="relative flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#8CC850]/50 bg-[#F7FBF5] p-6 text-center hover:border-[#8CC850]">
                  <UploadCloud className="mb-3 h-9 w-9 text-[#8CC850]" />
                  <p className="font-bold text-[#003223]">{file ? file.name : 'Clique para escolher o backup exportado'}</p>
                  <p className="mt-1 text-sm text-slate-500">CSV, Excel (.xlsx/.xls) ou JSON • até 50 MB</p>
                  <input type="file" accept=".csv,.xlsx,.xls,.json,text/csv,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="absolute inset-0 cursor-pointer opacity-0" onChange={(event) => { const selected = event.target.files?.[0] || null; setFile(selected); if (selected && !sourceSystem) setSourceSystem(selected.name.replace(/\.[^.]+$/, '')); }} />
                </label>
                <Button type="button" variant="link" className="mt-2 h-auto px-0 text-[#006B4A]" onClick={downloadTestFile}>
                  <Download className="mr-2 h-4 w-4" />Baixar arquivo modelo para teste
                </Button>
              </TabsContent>
              <TabsContent value="url" className="space-y-3 pt-4"><Label>Link público do arquivo ou da API</Label><Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://sistema-antigo.com/exportacao/vendas.xlsx" /><div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-900">O link precisa abrir diretamente um CSV, Excel ou JSON. Links que exigem login ainda precisam ser baixados e enviados como arquivo.</div></TabsContent>
              <TabsContent value="offline" className="space-y-3 pt-4">
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                  <Button type="button" variant="ghost" className={offlineEngine === 'sqlite' ? 'bg-white text-[#003223] shadow-sm hover:bg-white' : 'text-slate-500'} onClick={() => { setOfflineEngine('sqlite'); setFile(null); }}><Database className="mr-2 h-4 w-4" />SQLite</Button>
                  <Button type="button" variant="ghost" className={offlineEngine === 'firebird' ? 'bg-white text-[#003223] shadow-sm hover:bg-white' : 'text-slate-500'} onClick={() => { setOfflineEngine('firebird'); setFile(null); }}><Server className="mr-2 h-4 w-4" />Firebird</Button>
                </div>
                {offlineEngine === 'sqlite' ? (
                  <label className="relative flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#006B4A]/35 bg-emerald-50/50 p-6 text-center hover:border-[#006B4A]">
                    <HardDrive className="mb-3 h-9 w-9 text-[#006B4A]" />
                    <p className="font-bold text-[#003223]">{file ? file.name : 'Selecione o banco SQLite'}</p>
                    <p className="mt-1 text-sm text-slate-500">.sqlite, .sqlite3, .db ou .db3 • até 50 MB</p>
                    <input type="file" accept=".sqlite,.sqlite3,.db,.db3" className="absolute inset-0 cursor-pointer opacity-0" onChange={(event) => { const selected = event.target.files?.[0] || null; setFile(selected); if (selected && !sourceSystem) setSourceSystem(selected.name.replace(/\.[^.]+$/, '')); }} />
                  </label>
                ) : desktopFirebirdAvailable ? (
                  <div className="space-y-4 rounded-2xl border border-[#006B4A]/20 bg-emerald-50/40 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div><p className="font-bold text-[#003223]">{firebirdFile?.name || 'Banco Firebird não selecionado'}</p><p className="text-xs text-slate-500">A leitura é local, somente leitura, e o arquivo original não será alterado.</p></div>
                      <Button type="button" variant="outline" onClick={selectFirebirdDatabase}><HardDrive className="mr-2 h-4 w-4" />Selecionar .FDB</Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5"><Label>Servidor</Label><Input value={firebird.host} onChange={(event) => setFirebird((current) => ({ ...current, host: event.target.value }))} placeholder="127.0.0.1" /></div>
                      <div className="space-y-1.5"><Label>Porta</Label><Input type="number" min={1} max={65535} value={firebird.port} onChange={(event) => setFirebird((current) => ({ ...current, port: Number(event.target.value) }))} /></div>
                      <div className="space-y-1.5"><Label>Usuário</Label><Input value={firebird.user} onChange={(event) => setFirebird((current) => ({ ...current, user: event.target.value }))} placeholder="SYSDBA" autoComplete="off" /></div>
                      <div className="space-y-1.5"><Label>Senha</Label><Input type="password" value={firebird.password} onChange={(event) => setFirebird((current) => ({ ...current, password: event.target.value }))} placeholder="Senha usada pelo sistema antigo" autoComplete="new-password" /></div>
                    </div>
                    <div className="space-y-1.5"><Label>Codificação do banco</Label><Select value={firebird.charset} onValueChange={(value) => setFirebird((current) => ({ ...current, charset: value as FirebirdConnectionOptions['charset'] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UTF8">UTF-8 (padrão)</SelectItem><SelectItem value="WIN1252">Windows 1252</SelectItem><SelectItem value="ISO8859_1">ISO-8859-1</SelectItem><SelectItem value="NONE">Sem conversão (NONE)</SelectItem></SelectContent></Select></div>
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">O serviço Firebird do sistema antigo precisa estar aberto. Na maioria das instalações, servidor e porta são <strong>127.0.0.1:3050</strong>.</div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
                    <p className="font-bold">Firebird precisa do PopSystem Desktop atualizado</p>
                    <p className="mt-1 text-sm">O navegador não pode acessar o arquivo pelo servidor local. Abra esta mesma tela no aplicativo desktop para selecionar o .FDB e informar as credenciais.</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
            <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600"><p className="font-bold text-slate-800">Importação protegida</p><p className="mt-1">Primeiro o PopSystem mostra uma prévia das tabelas e identifica produtos, clientes e vendas. Nenhum dado é gravado antes de você confirmar a importação.</p></div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {job && !result && !busy ? <Button variant="outline" onClick={() => { setJob(null); setMapping({}); }}><ArrowLeft className="mr-2 h-4 w-4" />Trocar origem</Button> : null}
          <Button variant="outline" onClick={result ? finish : onClose} disabled={busy}>{result ? 'Fechar' : 'Cancelar'}</Button>
          {!job && !result ? <Button onClick={analyze} disabled={busy} className="bg-[#8CC850] text-white hover:bg-[#79b541]"><Database className="mr-2 h-4 w-4" />Analisar dados</Button> : null}
          {job && !result && !busy ? <Button onClick={runImport} className="bg-[#8CC850] text-white hover:bg-[#79b541]"><CheckCircle2 className="mr-2 h-4 w-4" />Confirmar importação</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DataMigrationModal;
