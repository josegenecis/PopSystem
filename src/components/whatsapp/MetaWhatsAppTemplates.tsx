import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, FileText, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

type MetaTemplate = {
  id?: string | null;
  name: string;
  status?: string | null;
  category?: string | null;
  language?: string | null;
  rejected_reason?: string | null;
  components?: Array<{ type?: string; text?: string }>;
  text?: string;
};

type Props = {
  enabled: boolean;
  storeId?: string | null;
};

const statusStyle: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  REJECTED: 'bg-red-100 text-red-800',
  PAUSED: 'bg-slate-100 text-slate-700',
  DISABLED: 'bg-slate-100 text-slate-700',
};

const statusLabel: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING: 'Em análise',
  REJECTED: 'Rejeitado',
  PAUSED: 'Pausado',
  DISABLED: 'Desativado',
};

const bodyText = (template: MetaTemplate) => template.text
  || template.components?.find((component) => component.type === 'BODY')?.text
  || '';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

const MetaWhatsAppTemplates: React.FC<Props> = ({ enabled, storeId }) => {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('confirmacao_pedido_teste');
  const [category, setCategory] = useState('UTILITY');
  const [language, setLanguage] = useState('pt_BR');
  const [text, setText] = useState('Olá, {{1}}! Seu pedido {{2}} foi recebido e está sendo preparado.');

  const loadTemplates = useCallback(async () => {
    if (!enabled) return;
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('whatsapp-meta-templates', {
        body: { action: 'list', _storeId: storeId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Não foi possível carregar os modelos.');
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
    } catch (error) {
      toast({
        title: 'Modelos indisponíveis',
        description: getErrorMessage(error, 'Tente atualizar novamente.'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [enabled, storeId, toast]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const createTemplate = async () => {
    try {
      setCreating(true);
      const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      const { data, error } = await supabase.functions.invoke('whatsapp-meta-templates', {
        body: { action: 'create', name: normalizedName, category, language, text: text.trim(), _storeId: storeId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Não foi possível criar o modelo.');
      toast({ title: 'Modelo enviado à Meta', description: 'O modelo foi criado e já aparece com o status da análise.' });
      await loadTemplates();
    } catch (error) {
      toast({
        title: 'Erro ao criar modelo',
        description: getErrorMessage(error, 'Revise os campos e tente novamente.'),
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  if (!enabled) return null;

  return (
    <section className="space-y-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4" aria-labelledby="meta-template-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-violet-600 p-2 text-white"><FileText className="h-5 w-5" /></div>
          <div>
            <h3 id="meta-template-title" className="font-semibold text-violet-950">Modelos oficiais da Meta</h3>
            <p className="mt-1 text-xs leading-5 text-violet-800">Crie e acompanhe modelos usados fora da janela de atendimento de 24 horas.</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={loadTemplates} disabled={loading} className="border-violet-200 bg-white text-violet-900">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Atualizar status
        </Button>
      </div>

      <div className="grid gap-4 rounded-xl border border-violet-100 bg-white p-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="meta-template-name">Nome do modelo</Label>
          <Input id="meta-template-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="confirmacao_pedido_teste" />
          <p className="text-[11px] text-slate-500">Use letras minúsculas, números e sublinhado.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Categoria do modelo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="UTILITY">Utilidade</SelectItem>
                <SelectItem value="MARKETING">Marketing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Idioma</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger aria-label="Idioma do modelo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pt_BR">Português (BR)</SelectItem>
                <SelectItem value="en_US">Inglês (EUA)</SelectItem>
                <SelectItem value="es">Espanhol</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="meta-template-text">Mensagem</Label>
          <Textarea id="meta-template-text" value={text} onChange={(event) => setText(event.target.value)} rows={4} placeholder="Olá, {{1}}! Seu pedido {{2}} foi recebido." />
          <p className="text-[11px] text-slate-500">Variáveis devem seguir a ordem: {'{{1}}'}, {'{{2}}'}, {'{{3}}'}.</p>
        </div>
        <Button type="button" onClick={createTemplate} disabled={creating || !name.trim() || text.trim().length < 10} className="bg-violet-700 hover:bg-violet-800 lg:col-span-2">
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Criar e enviar para análise
        </Button>
      </div>

      <div className="space-y-2">
        {templates.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-violet-200 bg-white p-4 text-center text-sm text-slate-500">Nenhum modelo encontrado nesta conta.</div>
        ) : templates.map((template) => {
          const status = String(template.status || 'PENDING').toUpperCase();
          return (
            <article key={template.id || `${template.name}-${template.language}`} className="rounded-lg border border-violet-100 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-violet-600" />
                  <strong className="text-sm text-slate-900">{template.name}</strong>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${statusStyle[status] || 'bg-slate-100 text-slate-700'}`}>
                  {statusLabel[status] || status}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{bodyText(template) || 'Conteúdo não retornado pela Meta.'}</p>
              <p className="mt-2 text-[11px] font-medium text-slate-500">{template.category || 'UTILITY'} · {template.language || 'pt_BR'}</p>
              {template.rejected_reason ? <p className="mt-2 text-xs font-medium text-red-700">Motivo: {template.rejected_reason}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default MetaWhatsAppTemplates;
