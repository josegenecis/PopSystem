import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import { supabase } from '@/integrations/supabase/client';
import { UserPlus, Trash2, Key, Shield, Eye, EyeOff, Check, User, Lock, Mail, CreditCard, Box, FileText, Settings, BadgePercent } from 'lucide-react';

interface Waiter {
  id: string;
  name: string;
  email?: string;
  cpf?: string;
  password?: string;
  pin: string;
  active: boolean;
  role: 'admin' | 'cashier';
  permissions: Record<string, boolean>;
  waiter_access?: boolean;
  employment_type?: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'clt' | 'freelance';
  salary_amount?: number | null;
  hourly_rate?: number | null;
  weekly_hours?: number | null;
  hire_date?: string | null;
  job_title?: string | null;
}

const WAITER_ACCESS_SCHEMA_MESSAGE =
  'O banco publicado ainda nao tem todas as colunas do acesso do app garcom. Aplique a migration mais recente de equipe/garcom no Supabase e tente novamente.';

const PERMISSIONS_GROUPS = [
  {
    id: 'sales',
    label: 'Vendas e PDV',
    icon: <CreditCard className="w-4 h-4" />,
    permissions: [
      { id: 'dashboard_view', label: 'Ver Painel Inicial', description: 'Pode acessar apenas os indicadores operacionais do início' },
      { id: 'pos_access', label: 'Acessar PDV', description: 'Pode entrar na tela de vendas' },
      { id: 'tables_access', label: 'Acessar Mesas', description: 'Pode abrir mesas e lançar produtos' },
      { id: 'pos_discount', label: 'Aplicar Descontos', description: 'Pode dar descontos manuais' },
      { id: 'pos_cancel_item', label: 'Cancelar Itens', description: 'Pode remover itens do pedido' },
    ]
  },
  {
    id: 'cashier',
    label: 'Caixa',
    icon: <Lock className="w-4 h-4" />,
    permissions: [
      { id: 'pos_open_close', label: 'Abrir/Fechar Caixa', description: 'Gestão de turnos' },
      { id: 'cash_movement', label: 'Sangria/Suprimento', description: 'Movimentar dinheiro do caixa' },
    ]
  },
  {
    id: 'management',
    label: 'Pedidos e produção',
    icon: <Box className="w-4 h-4" />,
    permissions: [
      { id: 'orders_manage', label: 'Gerenciar Pedidos', description: 'Ver e editar pedidos ativos' },
      { id: 'customers_manage', label: 'Gerenciar Clientes', description: 'Cadastrar e atualizar clientes do PDV, delivery e fiscal' },
      { id: 'orders_cancel', label: 'Cancelar Pedidos e Vendas', description: 'Pode cancelar pedidos e vendas já lançados' },
      { id: 'kds_access', label: 'Ver KDS', description: 'Acessar a tela de preparo da cozinha' },
      { id: 'menu_manage', label: 'Gerenciar Cardápio', description: 'Criar/Editar produtos' },
      { id: 'stock_manage', label: 'Gerenciar Estoque', description: 'Ajustar quantidades' },
    ]
  },
  {
    id: 'delivery',
    label: 'Delivery',
    icon: <FileText className="w-4 h-4" />,
    permissions: [
      { id: 'delivery_areas_manage', label: 'Áreas e Taxas de Entrega', description: 'Configurar bairros, áreas atendidas, taxas e prazos' },
      { id: 'delivery_drivers_manage', label: 'Gerenciar Motoboys', description: 'Cadastrar e administrar entregadores e entregas' },
    ]
  },
  {
    id: 'financial',
    label: 'Financeiro',
    icon: <CreditCard className="w-4 h-4" />,
    permissions: [
      { id: 'financial_view', label: 'Ver Financeiro', description: 'Acessar visão financeira e contas a receber' },
      { id: 'expenses_manage', label: 'Gerenciar Despesas', description: 'Cadastrar e editar contas a pagar' },
      { id: 'reports_view', label: 'Ver Relatórios', description: 'Acessar relatórios gerais e históricos' },
      { id: 'payments_manage', label: 'Formas de Pagamento e PIX', description: 'Configurar pagamentos, PIX e integrações financeiras' },
    ]
  },
  {
    id: 'communication',
    label: 'Comunicação e integrações',
    icon: <Mail className="w-4 h-4" />,
    permissions: [
      { id: 'whatsapp_manage', label: 'Gerenciar WhatsApp', description: 'Conectar, configurar e operar o WhatsApp Bot' },
      { id: 'marketing_manage', label: 'Marketing', description: 'Campanhas, ofertas e disparos autorizados' },
      { id: 'ifood_manage', label: 'Gerenciar iFood', description: 'Configurar e operar a integração com o iFood' },
    ]
  },
  {
    id: 'admin',
    label: 'Administrativo',
    icon: <Settings className="w-4 h-4" />,
    permissions: [
      { id: 'fiscal_manage', label: 'Fiscal/NFC-e', description: 'Configurações fiscais e emissão de documentos' },
      { id: 'users_manage', label: 'Gerenciar Equipe', description: 'Criar e editar usuários' },
      { id: 'timeclock_manage', label: 'Controle de Ponto', description: 'Acessar e administrar o ponto da equipe' },
      { id: 'hardware_manage', label: 'Impressoras, Balanças e Leitores', description: 'Configurar dispositivos e impressão' },
      { id: 'desktop_access', label: 'Aplicativo Desktop', description: 'Acessar e baixar o aplicativo desktop' },
      { id: 'agent_access', label: 'Pop Agente', description: 'Acessar o assistente inteligente' },
      { id: 'security_view', label: 'Segurança', description: 'Acessar o painel de segurança' },
      { id: 'settings_manage', label: 'Todas as Configurações', description: 'Acesso administrativo completo às configurações do sistema' },
    ]
  }
];

type ServiceChargeSettings = {
  enabled: boolean;
  percentage: number;
  taxWithholdPercent: number;
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  hourly: 'Por hora',
  daily: 'Diária',
  weekly: 'Semanal',
  monthly: 'Mensal fixo',
  clt: 'CLT',
  freelance: 'Freelancer',
};

const formatMoney = (value?: number | null) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numeric);
};

const Garcons = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirmDialog();
  
  // Data State
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [loading, setLoading] = useState(false);
  const [serviceChargeSettings, setServiceChargeSettings] = useState<ServiceChargeSettings>({
    enabled: true,
    percentage: 10,
    taxWithholdPercent: 0,
  });
  const [savingServiceCharge, setSavingServiceCharge] = useState(false);
  
  // Modal State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'data' | 'permissions'>('data');
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // Form State
  const [formData, setFormData] = useState<Partial<Waiter>>({
    name: '',
    email: '',
    cpf: '',
    password: '',
    pin: '',
    role: 'cashier',
    active: true,
    permissions: {},
    waiter_access: false,
    employment_type: 'monthly',
    salary_amount: 0,
    hourly_rate: 0,
    weekly_hours: 44,
    hire_date: '',
    job_title: ''
  });

  const hasMissingColumnError = (error: any, columnName: string) => {
    const message = String(error?.message || '').toLowerCase();
    return message.includes(`could not find the '${columnName.toLowerCase()}' column`) || message.includes(`column "${columnName.toLowerCase()}"`);
  };

  const getSchemaRepairMessage = (error: any) => {
    const requiredColumns = ['cpf', 'password', 'permissions', 'role'];
    return requiredColumns.some((column) => hasMissingColumnError(error, column))
      ? WAITER_ACCESS_SCHEMA_MESSAGE
      : null;
  };

  const getWaiterAppAccess = (waiter?: Partial<Waiter>) => {
    if (!waiter) return false;
    return Boolean(waiter.waiter_access ?? waiter.permissions?.waiter_app);
  };

  const buildPermissions = () => {
    const basePermissions = formData.role === 'admin'
      ? PERMISSIONS_GROUPS.flatMap(g => g.permissions).reduce((acc, p) => ({ ...acc, [p.id]: true }), { admin: true } as Record<string, boolean>)
      : (formData.permissions || {});

    return {
      ...basePermissions,
      waiter_app: Boolean(formData.waiter_access)
    };
  };

  const isActiveAdmin = (waiter?: Partial<Waiter>) => Boolean(
    waiter
    && waiter.active !== false
    && (waiter.role === 'admin' || waiter.permissions?.admin === true)
  );

  const isLastActiveAdmin = (waiter?: Partial<Waiter>) => Boolean(
    waiter?.id
    && isActiveAdmin(waiter)
    && waiters.filter(isActiveAdmin).length === 1
  );

  useEffect(() => {
    if (user) {
      loadWaiters();
      loadServiceChargeSettings();
    }
  }, [user]);

  const loadWaiters = async () => {
    try {
      const { data, error } = await supabase
        .from('waiters')
        .select('*')
        .eq('user_id', user?.id)
        .order('name');
      
      if (error) throw error;
      setWaiters((data as any) || []);
    } catch (e: any) {
      console.error('Erro ao carregar:', e);
    }
  };

  const loadServiceChargeSettings = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await (supabase as any)
        .from('waiter_service_charge_settings')
        .select('enabled, percentage, tax_withhold_percent')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return;

      setServiceChargeSettings({
        enabled: data.enabled !== false,
        percentage: Number(data.percentage ?? 10),
        taxWithholdPercent: Number(data.tax_withhold_percent ?? 0),
      });
    } catch (error: any) {
      console.warn('Service charge settings unavailable:', error?.message || error);
    }
  };

  const saveServiceChargeSettings = async () => {
    if (!user?.id) return;

    const percentage = Math.min(30, Math.max(0, Number(serviceChargeSettings.percentage || 0)));
    const taxWithholdPercent = Math.min(100, Math.max(0, Number(serviceChargeSettings.taxWithholdPercent || 0)));

    try {
      setSavingServiceCharge(true);
      const { error } = await (supabase as any)
        .from('waiter_service_charge_settings')
        .upsert({
          user_id: user.id,
          enabled: Boolean(serviceChargeSettings.enabled),
          percentage,
          tax_withhold_percent: taxWithholdPercent,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) throw error;
      setServiceChargeSettings({ enabled: Boolean(serviceChargeSettings.enabled), percentage, taxWithholdPercent });
      toast({ title: 'Taxa do garçom salva', description: 'A regra já vale no app do garçom.' });
    } catch (error: any) {
      toast({ title: 'Erro ao salvar taxa', description: error?.message || 'Nao foi possivel salvar a configuracao.', variant: 'destructive' });
    } finally {
      setSavingServiceCharge(false);
    }
  };

  const handleOpenDialog = (waiter?: Waiter) => {
    if (waiter) {
      setFormData({ ...waiter, active: waiter.active !== false, password: '', waiter_access: getWaiterAppAccess(waiter) });
    } else {
      setFormData({
        name: '',
        email: '',
        cpf: '',
        password: '',
        pin: '',
        role: 'cashier',
        active: true,
        permissions: { pos_access: true },
        waiter_access: false,
        employment_type: 'monthly',
        salary_amount: 0,
        hourly_rate: 0,
        weekly_hours: 44,
        hire_date: '',
        job_title: ''
      });
    }
    setActiveTab('data');
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const normalizedCpf = String(formData.cpf || '').replace(/\D/g, '');
    if (!formData.name?.trim() || !formData.pin?.trim() || normalizedCpf.length !== 11) {
      toast({ title: 'Campos obrigatórios', description: 'Nome, PIN e CPF válido são obrigatórios.', variant: 'destructive' });
      return;
    }

    try {
      setLoading(true);
      const permissions = buildPermissions();

      const emailValue = String(formData.email || '').trim();
      const basePayload = {
        user_id: user?.id,
        name: formData.name,
        cpf: normalizedCpf,
        pin: formData.pin,
        role: formData.role,
        active: formData.active,
        permissions,
        employment_type: formData.employment_type || 'monthly',
        salary_amount: Number(formData.salary_amount || 0),
        hourly_rate: Number(formData.hourly_rate || 0),
        weekly_hours: Number(formData.weekly_hours || 44),
        hire_date: formData.hire_date || null,
        job_title: String(formData.job_title || '').trim() || null,
        // Only include password if it was typed (for edits) or is new
        ...(formData.password ? { password: formData.password } : {})
      };

      const savePayload = async (includeEmail: boolean) => {
        const payload = includeEmail && emailValue
          ? { ...basePayload, email: emailValue }
          : basePayload;

        if (formData.id) {
          return supabase
            .from('waiters')
            .update(payload)
            .eq('id', formData.id);
        }

        return supabase
          .from('waiters')
          .insert(payload);
      };

      let { error } = await savePayload(true);

      if (error && hasMissingColumnError(error, 'email')) {
        const retry = await savePayload(false);
        error = retry.error;
        if (!error) {
          toast({
            title: 'Usuário salvo',
            description: 'O acesso foi criado sem gravar o e-mail, porque essa coluna ainda não existe no banco.',
          });
        }
      }

      if (error) throw error;

      if (!(emailValue && false)) {
        if (!hasMissingColumnError(undefined, 'email')) {
        }
      }
      if (!(emailValue && false)) {
        toast({ title: 'Sucesso!', description: 'Usuário salvo com sucesso.' });
      }
      setIsDialogOpen(false);
      loadWaiters();
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveUser = async () => {
    const normalizedCpf = String(formData.cpf || '').replace(/\D/g, '');
    const wantsWaiterAccess = Boolean(formData.waiter_access);
    const rawPassword = String(formData.password || '').trim();
    const shouldValidateCpf = wantsWaiterAccess || normalizedCpf.length > 0;

    if (!formData.name?.trim() || !formData.pin?.trim()) {
      toast({ title: 'Campos obrigatorios', description: 'Nome e PIN sao obrigatorios.', variant: 'destructive' });
      return;
    }

    if (shouldValidateCpf && normalizedCpf.length !== 11) {
      toast({
        title: 'CPF invalido',
        description: 'Informe um CPF valido para liberar o login do app garcom.',
        variant: 'destructive',
      });
      return;
    }

    if (wantsWaiterAccess && !formData.id && !rawPassword) {
      toast({
        title: 'Senha obrigatoria',
        description: 'Defina uma senha para liberar o acesso ao app garcom.',
        variant: 'destructive',
      });
      return;
    }

    const originalWaiter = waiters.find((waiter) => waiter.id === formData.id);
    if (isLastActiveAdmin(originalWaiter) && (formData.active === false || formData.role !== 'admin')) {
      toast({
        title: 'Administrador obrigatório',
        description: 'Ative ou crie outro administrador antes de inativar ou alterar o perfil deste usuário.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const permissions = buildPermissions();
      const emailValue = String(formData.email || '').trim();
      const hasEmail = Boolean(emailValue);
      const basePayload = {
        user_id: user?.id,
        name: formData.name?.trim(),
        ...(normalizedCpf ? { cpf: normalizedCpf } : {}),
        pin: formData.pin?.trim(),
        role: formData.role,
        active: formData.active !== false,
        permissions,
        employment_type: formData.employment_type || 'monthly',
        salary_amount: Number(formData.salary_amount || 0),
        hourly_rate: Number(formData.hourly_rate || 0),
        weekly_hours: Number(formData.weekly_hours || 44),
        hire_date: formData.hire_date || null,
        job_title: String(formData.job_title || '').trim() || null,
        ...(rawPassword ? { password: rawPassword } : {}),
      };

      const savePayload = async (includeEmail: boolean) => {
        const payload = includeEmail && emailValue
          ? { ...basePayload, email: emailValue }
          : basePayload;

        if (formData.id) {
          return supabase.from('waiters').update(payload).eq('id', formData.id);
        }

        return supabase.from('waiters').insert(payload);
      };

      let { error } = await savePayload(true);

      if (error && hasMissingColumnError(error, 'email')) {
        const retry = await savePayload(false);
        error = retry.error;
      }

      if (error) {
        const repairMessage = getSchemaRepairMessage(error);
        if (repairMessage) {
          throw new Error(repairMessage);
        }
        throw error;
      }

      toast({
        title: 'Sucesso!',
        description: hasEmail
          ? 'Usuario salvo com sucesso.'
          : 'Usuario salvo com sucesso. Voce pode adicionar um email depois, se quiser.',
      });
      setIsDialogOpen(false);
      loadWaiters();
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const waiter = waiters.find((item) => item.id === id);
    if (isLastActiveAdmin(waiter)) {
      toast({
        title: 'Administrador obrigatório',
        description: 'Não é possível remover o último administrador ativo da loja.',
        variant: 'destructive',
      });
      return;
    }
    const ok = await confirm({
      title: 'Remover usuário',
      description: 'Tem certeza que deseja remover este usuário?',
      confirmText: 'Remover',
      cancelText: 'Cancelar',
      variant: 'destructive',
    });
    if (!ok) return;
    
    try {
      const { error } = await supabase.from('waiters').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Usuário removido' });
      loadWaiters();
    } catch (e: any) {
      toast({ title: 'Erro ao remover', description: e.message, variant: 'destructive' });
    }
  };

  const togglePermission = (permId: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [permId]: !prev.permissions?.[permId]
      }
    }));
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Gerenciar Equipe</h1>
          <p className="text-muted-foreground mt-1">Controle de acesso, usuários e permissões do sistema.</p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="bg-primary hover:bg-primary/90">
          <UserPlus className="mr-2 h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BadgePercent className="h-5 w-5 text-primary" />
            Taxa opcional do garçom
          </CardTitle>
          <CardDescription>
            Configure a cobrança sugerida no app do garçom e o percentual retido para cobrir impostos/encargos do restaurante.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1.2fr,0.8fr,0.8fr,auto] md:items-end">
          <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
            <div>
              <Label className="text-base font-semibold">Permitir perguntar os 10%</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                O garçom decide no fechamento se o cliente autorizou a taxa.
              </p>
            </div>
            <Switch
              checked={serviceChargeSettings.enabled}
              onCheckedChange={(checked) => setServiceChargeSettings((current) => ({ ...current, enabled: checked }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Percentual cobrado</Label>
            <Input
              type="number"
              min="0"
              max="30"
              step="0.1"
              value={serviceChargeSettings.percentage}
              onChange={(event) => setServiceChargeSettings((current) => ({ ...current, percentage: Number(event.target.value) }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Retenção fiscal (%)</Label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={serviceChargeSettings.taxWithholdPercent}
              onChange={(event) => setServiceChargeSettings((current) => ({ ...current, taxWithholdPercent: Number(event.target.value) }))}
            />
          </div>
          <Button onClick={saveServiceChargeSettings} disabled={savingServiceCharge}>
            {savingServiceCharge ? 'Salvando...' : 'Salvar taxa'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50">
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>CPF</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Contrato</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {waiters.map((waiter) => (
                <TableRow key={waiter.id} className="hover:bg-gray-50/50 transition-colors">
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {waiter.name.charAt(0).toUpperCase()}
                      </div>
                      {waiter.name}
                    </div>
                  </TableCell>
                  <TableCell>{waiter.email || '-'}</TableCell>
                  <TableCell>{waiter.cpf ? waiter.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : '-'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        waiter.role === 'admin' 
                          ? 'bg-purple-100 text-purple-800' 
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {waiter.role === 'admin' ? 'Administrador' : 'Operador'}
                      </span>
                      {getWaiterAppAccess(waiter) ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                          Garçom App
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="text-sm font-semibold text-gray-900">
                        {EMPLOYMENT_LABELS[waiter.employment_type || 'monthly'] || 'Mensal fixo'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {waiter.employment_type === 'hourly'
                          ? `${formatMoney(waiter.hourly_rate)}/h`
                          : formatMoney(waiter.salary_amount)}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      waiter.active !== false
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${waiter.active !== false ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {waiter.active !== false ? 'Ativo' : 'Inativo'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(waiter)}>
                        <Settings className="h-4 w-4 text-gray-500" />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={isLastActiveAdmin(waiter)} title={isLastActiveAdmin(waiter) ? 'A loja precisa manter pelo menos um administrador ativo' : 'Remover usuário'} onClick={() => handleDelete(waiter.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {waiters.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Nenhum usuário encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="flex max-h-[92dvh] max-w-2xl flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle>{formData.id ? 'Editar Usuário' : 'Novo Usuário'}</DialogTitle>
            <DialogDescription>
              Preencha os dados abaixo para {formData.id ? 'editar' : 'criar'} o acesso.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-4">
            <div className="mb-6 flex border-b">
              <button
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'data' 
                    ? 'border-primary text-primary' 
                    : 'border-transparent text-muted-foreground hover:text-gray-700'
                }`}
                onClick={() => setActiveTab('data')}
              >
                Dados Pessoais
              </button>
              <button
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'permissions' 
                    ? 'border-primary text-primary' 
                    : 'border-transparent text-muted-foreground hover:text-gray-700'
                }`}
                onClick={() => setActiveTab('permissions')}
              >
                Permissões de Acesso
              </button>
            </div>

            {activeTab === 'data' ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome Completo *</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input 
                        id="name" 
                        className="pl-9" 
                        placeholder="Ex: João Silva"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email (Opcional)</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input 
                        id="email" 
                        className="pl-9" 
                        placeholder="joao@email.com"
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cpf">CPF para login do app garcom</Label>
                      <Input
                        id="cpf"
                        placeholder="000.000.000-00"
                        value={String(formData.cpf || '')
                          .replace(/\D/g, '')
                          .slice(0, 11)
                          .replace(/^(\d{3})(\d)/, '$1.$2')
                          .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
                          .replace(/\.(\d{3})(\d)/, '.$1-$2')}
                        onChange={e => setFormData({ ...formData, cpf: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pin">PIN de Acesso (PDV) *</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input 
                        id="pin" 
                        type={showPin ? "text" : "password"}
                        className="pl-9 pr-9" 
                        placeholder="Ex: 1234"
                        maxLength={6}
                        value={formData.pin}
                        onChange={e => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '') })}
                      />
                      <button 
                        type="button"
                        onClick={() => setShowPin(!showPin)}
                        className="absolute right-3 top-3 text-muted-foreground hover:text-gray-700"
                      >
                        {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Senha do app garcom</Label>
                    <div className="relative">
                      <Key className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input 
                        id="password" 
                        type={showPassword ? "text" : "password"}
                        className="pl-9 pr-9" 
                        placeholder={formData.id ? "Deixe em branco para manter" : "Senha para o app garcom"}
                        value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                      />
                      <button 
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-3 text-muted-foreground hover:text-gray-700"
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 pt-2 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Perfil de Acesso</Label>
                    <Select 
                      value={formData.role} 
                      onValueChange={(v: any) => setFormData({ ...formData, role: v })}
                      disabled={isLastActiveAdmin(waiters.find((waiter) => waiter.id === formData.id))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cashier">Operador (Básico)</SelectItem>
                        <SelectItem value="admin">Administrador (Total)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Administradores têm acesso irrestrito a todas as funções.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Status da Conta</Label>
                    <div className="flex items-center space-x-2 border p-2 rounded-md">
                      <Switch 
                        checked={formData.active !== false}
                        onCheckedChange={(c) => setFormData({ ...formData, active: c })}
                        disabled={isLastActiveAdmin(waiters.find((waiter) => waiter.id === formData.id))}
                      />
                      <span className="text-sm font-medium">
                        {formData.active !== false ? 'Ativo - Pode acessar' : 'Inativo - Acesso bloqueado'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border bg-slate-50/70 p-4">
                  <div className="mb-4">
                    <h3 className="font-semibold text-gray-900">Contrato e pagamento</h3>
                    <p className="text-xs text-muted-foreground">
                      Use para controlar custo da equipe, ponto e fechamento de salário.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Cargo/Função</Label>
                      <Input
                        placeholder="Ex: Garçom, caixa, cozinha"
                        value={formData.job_title || ''}
                        onChange={(event) => setFormData({ ...formData, job_title: event.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo de contratação</Label>
                      <Select
                        value={formData.employment_type || 'monthly'}
                        onValueChange={(value: any) => setFormData({ ...formData, employment_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Mensal fixo</SelectItem>
                          <SelectItem value="hourly">Por hora</SelectItem>
                          <SelectItem value="daily">Diária</SelectItem>
                          <SelectItem value="weekly">Semanal</SelectItem>
                          <SelectItem value="clt">CLT</SelectItem>
                          <SelectItem value="freelance">Freelancer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Salário/valor combinado</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.salary_amount ?? 0}
                        onChange={(event) => setFormData({ ...formData, salary_amount: Number(event.target.value || 0) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Valor por hora</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.hourly_rate ?? 0}
                        onChange={(event) => setFormData({ ...formData, hourly_rate: Number(event.target.value || 0) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Horas por semana</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.5"
                        value={formData.weekly_hours ?? 44}
                        onChange={(event) => setFormData({ ...formData, weekly_hours: Number(event.target.value || 0) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Data de admissão</Label>
                      <Input
                        type="date"
                        value={formData.hire_date || ''}
                        onChange={(event) => setFormData({ ...formData, hire_date: event.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Acesso ao App Garçom</Label>
                  <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                    <div>
                      <div className="font-medium text-sm text-gray-900">Permitir login no app garçom</div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Quando ativado, este membro poderá entrar com CPF e senha no app do garçom.
                      </p>
                    </div>
                    <Switch
                      checked={Boolean(formData.waiter_access)}
                      onCheckedChange={(checked) => setFormData({ ...formData, waiter_access: checked })}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                {formData.role === 'admin' && (
                  <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-md flex items-start gap-3">
                    <Shield className="w-5 h-5 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-sm">Acesso de Administrador</h4>
                      <p className="text-sm mt-1">
                        Usuários com perfil Administrador possuem todas as permissões habilitadas automaticamente. 
                        Para personalizar, altere o perfil para "Operador".
                      </p>
                    </div>
                  </div>
                )}

                <div className={formData.role === 'admin' ? 'opacity-50 pointer-events-none grayscale' : ''}>
                  {PERMISSIONS_GROUPS.map((group) => (
                    <div key={group.id} className="mb-6">
                      <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                        <div className="p-1.5 bg-primary/10 rounded-md text-primary">
                          {group.icon}
                        </div>
                        <h3 className="font-semibold text-gray-900">{group.label}</h3>
                      </div>
                      <div className="space-y-3">
                        {group.permissions.map((perm) => (
                          <div key={perm.id} className="flex items-center justify-between p-3 rounded-lg border bg-white hover:bg-gray-50 transition-colors">
                            <div className="space-y-0.5">
                              <Label htmlFor={perm.id} className="text-base font-medium cursor-pointer">
                                {perm.label}
                              </Label>
                              <p className="text-sm text-muted-foreground">
                                {perm.description}
                              </p>
                            </div>
                            <Switch
                              id={perm.id}
                              checked={formData.permissions?.[perm.id] === true}
                              onCheckedChange={() => togglePermission(perm.id)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveUser} disabled={loading} className="min-w-[120px]">
              {loading ? 'Salvando...' : 'Salvar Usuário'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Garcons;
