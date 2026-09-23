import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, Save, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { formatCpfInput, formatPhoneInput, formatVehiclePlateInput } from '@/lib/team/fieldMasks';
import type { EmployeeApp, EmployeeFormValue, EmployeeRole, TeamEmployee, TeamTableOption } from '@/lib/team/types';
import { APP_OPTIONS, EMPLOYMENT_TYPE_LABELS, PERMISSION_GROUPS, REMUNERATION_TYPE_LABELS, ROLE_OPTIONS, TIME_CLOCK_PUNCH_PERMISSIONS, WEEKDAYS } from './teamOptions';

const emptyForm: EmployeeFormValue = {
  full_name: '',
  display_name: '',
  photo_url: '',
  cpf: '',
  phone: '',
  email: '',
  birth_date: '',
  address: '',
  hire_date: '',
  job_title: '',
  department: '',
  unit_name: '',
  employment_status: 'active',
  employment_type: 'monthly',
  weekly_hours: 44,
  default_day_off: null,
  notes: '',
  salary_base: 0,
  hourly_rate: 0,
  remuneration_type: 'fixed',
  default_bonus: 0,
  pix_key: '',
  bank_details: '',
  roles: [],
  permissions: [],
  apps: [],
  pin: '',
  waiter_password: '',
  waiter_table_access_mode: 'all',
  waiter_table_ids: [],
  driver_password: '',
  driver_vehicle_type: 'Moto',
  driver_vehicle_plate: '',
};

const employeeToForm = (employee: TeamEmployee): EmployeeFormValue => {
  const waiterConfiguration = employee.app_configurations?.waiter || {};
  const configuredTableIds = Array.isArray(waiterConfiguration.table_ids)
    ? waiterConfiguration.table_ids.map(String)
    : [];

  return {
    id: employee.id,
    full_name: employee.full_name,
    display_name: employee.display_name || '',
    photo_url: employee.photo_url || '',
    cpf: employee.cpf || '',
    phone: employee.phone || '',
    email: employee.email || '',
    birth_date: employee.birth_date || '',
    address: employee.address || '',
    hire_date: employee.hire_date || '',
    job_title: employee.job_title || '',
    department: employee.department || '',
    unit_name: employee.unit_name || '',
    employment_status: employee.employment_status,
    employment_type: employee.employment_type,
    weekly_hours: employee.weekly_hours,
    default_day_off: employee.default_day_off,
    notes: employee.notes || '',
    salary_base: employee.compensation.salary_base,
    hourly_rate: employee.compensation.hourly_rate,
    remuneration_type: employee.compensation.remuneration_type,
    default_bonus: employee.compensation.default_bonus,
    pix_key: employee.compensation.pix_key || '',
    bank_details: String(employee.compensation.bank_details?.description || ''),
    roles: employee.roles,
    permissions: employee.apps.includes('time_clock') ? [...new Set([...employee.permissions, ...TIME_CLOCK_PUNCH_PERMISSIONS])] : employee.permissions,
    apps: employee.apps,
    pin: '',
    waiter_password: '',
    waiter_table_access_mode: waiterConfiguration.table_access_mode === 'assigned' ? 'assigned' : 'all',
    waiter_table_ids: configuredTableIds,
    driver_password: '',
    driver_vehicle_type: 'Moto',
    driver_vehicle_plate: '',
  };
};

const operationalApps: EmployeeApp[] = ['popsystem', 'pdv', 'waiter', 'time_clock', 'kds', 'finance', 'stock', 'administration'];

export function EmployeeDialog(props: { open: boolean; employee: TeamEmployee | null; tableOptions: TeamTableOption[]; canViewSensitive: boolean; saving: boolean; onOpenChange: (open: boolean) => void; onSave: (value: EmployeeFormValue) => Promise<boolean> }) {
  const [form, setForm] = useState<EmployeeFormValue>(emptyForm);
  const [showSecrets, setShowSecrets] = useState(false);
  useEffect(() => {
    if (props.open) setForm(props.employee ? employeeToForm(props.employee) : { ...emptyForm });
  }, [props.employee, props.open]);
  const requiresPin = useMemo(() => form.apps.some((app) => operationalApps.includes(app)), [form.apps]);
  const hasInvalidWaiterTableAccess = form.apps.includes('waiter') && form.waiter_table_access_mode === 'assigned' && form.waiter_table_ids.length === 0;
  const visiblePermissionGroups = useMemo(() => PERMISSION_GROUPS.filter((group) => group.apps.some((app) => form.apps.includes(app))), [form.apps]);

  const update = <K extends keyof EmployeeFormValue>(key: K, value: EmployeeFormValue[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggleRole = (role: EmployeeRole) => update('roles', form.roles.includes(role) ? form.roles.filter((item) => item !== role) : [...form.roles, role]);
  const toggleApp = (app: EmployeeApp) =>
    setForm((current) => {
      const enabling = !current.apps.includes(app);
      const apps = enabling ? [...current.apps, app] : current.apps.filter((item) => item !== app);
      if (app !== 'time_clock') return { ...current, apps };
      const permissions = enabling ? [...new Set([...current.permissions, ...TIME_CLOCK_PUNCH_PERMISSIONS])] : current.permissions.filter((item) => !TIME_CLOCK_PUNCH_PERMISSIONS.includes(item as (typeof TIME_CLOCK_PUNCH_PERMISSIONS)[number]));
      return { ...current, apps, permissions };
    });
  const togglePermission = (permission: string) => update('permissions', form.permissions.includes(permission) ? form.permissions.filter((item) => item !== permission) : [...form.permissions, permission]);
  const toggleWaiterTable = (tableId: string) => update(
    'waiter_table_ids',
    form.waiter_table_ids.includes(tableId)
      ? form.waiter_table_ids.filter((id) => id !== tableId)
      : [...form.waiter_table_ids, tableId],
  );
  const togglePermissionGroup = (items: readonly (readonly [string, string])[]) => {
    const codes = items.map(([code]) => code);
    const allSelected = codes.every((code) => form.permissions.includes(code));
    update('permissions', allSelected ? form.permissions.filter((permission) => !codes.includes(permission)) : [...new Set([...form.permissions, ...codes])]);
  };
  const submit = async () => {
    if (form.full_name.trim().length < 2) return;
    if (!form.id && requiresPin && form.pin.trim().length < 4) return;
    if (hasInvalidWaiterTableAccess) return;
    await props.onSave(form);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl text-emerald-950">
            <UserRound className="h-5 w-5 text-orange-500" />
            {form.id ? 'Editar colaborador' : 'Novo colaborador'}
          </DialogTitle>
          <DialogDescription>Um único cadastro para função, jornada, ponto, remuneração e aplicativos.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="profile" className="mt-2">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-emerald-50 p-1 md:grid-cols-4">
            <TabsTrigger value="profile">Cadastro</TabsTrigger>
            <TabsTrigger value="work">Trabalho</TabsTrigger>
            <TabsTrigger value="access">Acessos</TabsTrigger>
            <TabsTrigger value="finance">Financeiro</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="grid gap-4 pt-4 md:grid-cols-2">
            <Field label="Nome completo *">
              <Input value={form.full_name} onChange={(e) => update('full_name', e.target.value)} autoFocus />
            </Field>
            <Field label="Nome de exibição">
              <Input value={form.display_name} onChange={(e) => update('display_name', e.target.value)} />
            </Field>
            <Field label="Foto (URL)" className="md:col-span-2">
              <div className="flex items-center gap-3">
                {form.photo_url && <img src={form.photo_url} alt="Foto do colaborador" className="h-14 w-14 rounded-full border object-cover" />}
                <Input value={form.photo_url} onChange={(e) => update('photo_url', e.target.value)} placeholder="https://..." />
              </div>
            </Field>
            <Field label="CPF">
              <Input value={formatCpfInput(form.cpf)} onChange={(e) => update('cpf', formatCpfInput(e.target.value))} inputMode="numeric" placeholder="000.000.000-00" maxLength={14} />
            </Field>
            <Field label="Telefone">
              <Input value={formatPhoneInput(form.phone)} onChange={(e) => update('phone', formatPhoneInput(e.target.value))} inputMode="tel" placeholder="(00) 00000-0000" maxLength={15} />
            </Field>
            <Field label="E-mail">
              <Input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
            </Field>
            <Field label="Nascimento">
              <Input type="date" value={form.birth_date} onChange={(e) => update('birth_date', e.target.value)} />
            </Field>
            <Field label="Endereço" className="md:col-span-2">
              <Input value={form.address} onChange={(e) => update('address', e.target.value)} />
            </Field>
            <Field label="Status">
              <Select value={form.employment_status} onValueChange={(value: EmployeeFormValue['employment_status']) => update('employment_status', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="leave">Afastado</SelectItem>
                  <SelectItem value="vacation">Férias</SelectItem>
                  <SelectItem value="terminated">Desligado</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Observações">
              <Textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} />
            </Field>
          </TabsContent>
          <TabsContent value="work" className="space-y-5 pt-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Data de admissão">
                <Input type="date" value={form.hire_date} onChange={(e) => update('hire_date', e.target.value)} />
              </Field>
              <Field label="Cargo">
                <Input value={form.job_title} onChange={(e) => update('job_title', e.target.value)} />
              </Field>
              <Field label="Setor">
                <Input value={form.department} onChange={(e) => update('department', e.target.value)} />
              </Field>
              <Field label="Unidade">
                <Input value={form.unit_name} onChange={(e) => update('unit_name', e.target.value)} />
              </Field>
              <Field label="Tipo de vínculo">
                <Select value={form.employment_type} onValueChange={(value: EmployeeFormValue['employment_type']) => update('employment_type', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Carga semanal">
                <Input type="number" min={0} max={168} value={form.weekly_hours} onChange={(e) => update('weekly_hours', Number(e.target.value))} />
              </Field>
              <Field label="Folga padrão">
                <Select value={form.default_day_off === null ? 'none' : String(form.default_day_off)} onValueChange={(value) => update('default_day_off', value === 'none' ? null : Number(value))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Definir na escala</SelectItem>
                    {WEEKDAYS.map((day, index) => (
                      <SelectItem key={day} value={String(index)}>
                        {day}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <section>
              <Label className="mb-3 block">Perfis (pode selecionar vários)</Label>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {ROLE_OPTIONS.map((role) => (
                  <CheckTile key={role.value} checked={form.roles.includes(role.value)} label={role.label} onChange={() => toggleRole(role.value)} />
                ))}
              </div>
              {form.roles.includes('custom') && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <Field label="Cargo personalizado *">
                    <Input
                      value={form.job_title}
                      onChange={(event) => update('job_title', event.target.value)}
                      placeholder="Ex.: Líder de atendimento"
                    />
                  </Field>
                  <p className="mt-2 text-xs text-emerald-800">Esse cargo aparecerá no cadastro e nos relatórios do colaborador.</p>
                </div>
              )}
            </section>
          </TabsContent>
          <TabsContent value="access" className="space-y-5 pt-4">
            <div className="grid gap-3 md:grid-cols-3">
              {APP_OPTIONS.map((app) => (
                <label key={app.value} className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <span>
                    <strong className="block text-sm text-emerald-950">{app.label}</strong>
                    <small className="text-slate-500">{app.description}</small>
                  </span>
                  <Switch checked={form.apps.includes(app.value)} onCheckedChange={() => toggleApp(app.value)} />
                </label>
              ))}
            </div>
            {requiresPin && (
              <div className="grid gap-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 md:grid-cols-3">
                <Field label={form.id ? 'Novo PIN (opcional)' : 'PIN do operador *'}>
                  <Input type={showSecrets ? 'text' : 'password'} inputMode="numeric" value={form.pin} onChange={(e) => update('pin', e.target.value.replace(/\D/g, '').slice(0, 8))} />
                </Field>
                {form.apps.includes('waiter') && (
                  <Field label="Nova senha App Garçom">
                    <Input type={showSecrets ? 'text' : 'password'} value={form.waiter_password} onChange={(e) => update('waiter_password', e.target.value)} />
                  </Field>
                )}
                {form.apps.includes('driver') && (
                  <Field label="Nova senha App Motoboy">
                    <Input type={showSecrets ? 'text' : 'password'} value={form.driver_password} onChange={(e) => update('driver_password', e.target.value)} />
                  </Field>
                )}
                <Button type="button" variant="ghost" className="self-end" onClick={() => setShowSecrets((value) => !value)}>
                  {showSecrets ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                  Mostrar credenciais
                </Button>
              </div>
            )}
            {form.apps.includes('driver') && (
              <div className="grid gap-4 rounded-xl border p-4 md:grid-cols-2">
                <Field label="Veículo">
                  <Input value={form.driver_vehicle_type} onChange={(e) => update('driver_vehicle_type', e.target.value)} />
                </Field>
                <Field label="Placa">
                  <Input value={formatVehiclePlateInput(form.driver_vehicle_plate)} onChange={(e) => update('driver_vehicle_plate', formatVehiclePlateInput(e.target.value))} placeholder="ABC1D23" maxLength={7} />
                </Field>
              </div>
            )}
            {form.apps.includes('waiter') && (
              <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <div>
                  <Label className="text-emerald-950">Mesas disponíveis no App Garçom</Label>
                  <p className="mt-1 text-xs text-emerald-800">A restrição também é validada no servidor para impedir acesso por link direto.</p>
                </div>
                <Select
                  value={form.waiter_table_access_mode}
                  onValueChange={(value: EmployeeFormValue['waiter_table_access_mode']) => update('waiter_table_access_mode', value)}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as mesas</SelectItem>
                    <SelectItem value="assigned">Somente mesas selecionadas</SelectItem>
                  </SelectContent>
                </Select>
                {form.waiter_table_access_mode === 'assigned' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => update('waiter_table_ids', props.tableOptions.map((table) => table.id))}>
                        Selecionar todas
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => update('waiter_table_ids', [])}>
                        Limpar seleção
                      </Button>
                    </div>
                    <div className="grid max-h-56 gap-2 overflow-y-auto rounded-xl border bg-white p-3 sm:grid-cols-2 md:grid-cols-3">
                      {props.tableOptions.map((table) => (
                        <label key={table.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                          <Checkbox checked={form.waiter_table_ids.includes(table.id)} onCheckedChange={() => toggleWaiterTable(table.id)} />
                          <span>Mesa {table.number}{table.location ? ` · ${table.location}` : ''}</span>
                        </label>
                      ))}
                      {!props.tableOptions.length && <p className="text-sm text-slate-500">Nenhuma mesa cadastrada.</p>}
                    </div>
                    <p className={hasInvalidWaiterTableAccess ? 'text-xs font-medium text-red-600' : 'text-xs text-slate-500'}>
                      {hasInvalidWaiterTableAccess ? 'Selecione pelo menos uma mesa.' : `${form.waiter_table_ids.length} mesa(s) selecionada(s).`}
                    </p>
                  </div>
                )}
              </div>
            )}
            {form.apps.includes('time_clock') && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <strong>Registro de ponto completo habilitado.</strong>
                <span className="mt-1 block text-emerald-800">Quem pode bater ponto já recebe automaticamente entrada, início e retorno do intervalo e saída.</span>
              </div>
            )}
            <div className="space-y-4">
              {visiblePermissionGroups.map((group) => {
                const selectedCount = group.items.filter(([code]) => form.permissions.includes(code)).length;
                const groupChecked = selectedCount === group.items.length ? true : selectedCount > 0 ? 'indeterminate' : false;
                return (
                  <section key={group.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="flex items-center gap-2 font-semibold text-emerald-950">
                          <ShieldCheck className="h-4 w-4 text-orange-500" />
                          {group.label}
                        </h4>
                        <p className="mt-1 text-xs text-slate-500">{group.description}</p>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 self-start rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
                        <Checkbox checked={groupChecked} onCheckedChange={() => togglePermissionGroup(group.items)} />
                        <span>{selectedCount === group.items.length ? 'Desmarcar categoria' : 'Selecionar categoria'}</span>
                      </label>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {group.items.map(([code, label]) => (
                        <CheckTile key={code} checked={form.permissions.includes(code)} label={label} onChange={() => togglePermission(code)} />
                      ))}
                    </div>
                  </section>
                );
              })}
              {!visiblePermissionGroups.length && <p className="rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">Habilite um acesso acima para configurar suas permissões.</p>}
            </div>
          </TabsContent>
          <TabsContent value="finance" className="pt-4">
            {!props.canViewSensitive ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                <LockKeyhole className="mb-2 h-5 w-5" />
                Seu perfil não possui permissão para visualizar remuneração e dados bancários.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Tipo de remuneração">
                  <Select value={form.remuneration_type} onValueChange={(value: EmployeeFormValue['remuneration_type']) => update('remuneration_type', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(REMUNERATION_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Salário base">
                  <CurrencyInput value={form.salary_base} onValueChange={(value) => update('salary_base', value)} />
                </Field>
                <Field label="Valor hora">
                  <CurrencyInput value={form.hourly_rate} onValueChange={(value) => update('hourly_rate', value)} />
                </Field>
                <Field label="Bonificação padrão">
                  <CurrencyInput value={form.default_bonus} onValueChange={(value) => update('default_bonus', value)} />
                </Field>
                <Field label="Chave Pix">
                  <Input value={form.pix_key} onChange={(e) => update('pix_key', e.target.value)} />
                </Field>
                <Field label="Conta bancária">
                  <Textarea value={form.bank_details} onChange={(e) => update('bank_details', e.target.value)} placeholder="Banco, agência e conta" />
                </Field>
              </div>
            )}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="bg-orange-500 hover:bg-orange-600" disabled={props.saving || hasInvalidWaiterTableAccess || form.full_name.trim().length < 2 || (!form.id && requiresPin && form.pin.length < 4)} onClick={submit}>
            <Save className="mr-2 h-4 w-4" />
            {props.saving ? 'Salvando...' : 'Salvar colaborador'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`space-y-1.5 ${className}`}>
      <Label>{label}</Label>
      {children}
    </label>
  );
}
function CheckTile({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-emerald-50">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span>{label}</span>
    </label>
  );
}
