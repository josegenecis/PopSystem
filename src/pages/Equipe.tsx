/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CircleDollarSign, Clock3, Settings2, UserRoundCog, UsersRound, WalletCards } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { TeamCollaborators } from '@/components/team/TeamCollaborators';
import { TeamCommissions } from '@/components/team/TeamCommissions';
import { TeamOverview } from '@/components/team/TeamOverview';
import { TeamPayroll } from '@/components/team/TeamPayroll';
import { TeamSchedules } from '@/components/team/TeamSchedules';
import { TeamSettings } from '@/components/team/TeamSettings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { buildPayrollPreview, calculateAttendance } from '@/lib/team/attendanceEngine';
import type { AttendanceRules, AttendanceSummary, CommissionRule, EmployeeFormValue, PayrollPreviewRow, TeamEmployee, TeamProductOption, TeamTableOption, WorkSchedule } from '@/lib/team/types';
import ControlePonto from '@/pages/ControlePonto';
import { getLocalOperatorSession, isAdminOperator } from '@/services/operatorAuth';
import { defaultAttendanceRules, generatePayrollPayables, loadAttendanceData, loadCommissionConfiguration, loadMonthlyFinancialInputs, loadSchedules, loadTeamAlerts, loadTeamEmployees, loadTeamTables, registerAdvance, registerCommission, registerPayrollAdjustment, saveCommissionRule, savePayrollPreview, savePayrollSettings, saveSchedule, saveTeamEmployee, setClosingStatus, updateEmployeeStatus } from '@/services/teamService';

const validTabs = ['overview', 'collaborators', 'schedules', 'timeclock', 'payroll', 'commissions', 'settings'];
const currentCompetence = () => new Date().toLocaleDateString('sv-SE', { year: 'numeric', month: '2-digit' });
const monthPeriod = (competence: string) => {
  const [year, month] = competence.split('-').map(Number);
  const startDate = `${competence}-01`;
  const finalDate = new Date(year, month, 0).toLocaleDateString('sv-SE');
  const today = new Date().toLocaleDateString('sv-SE');
  return {
    startDate,
    endDate: competence === currentCompetence() && today < finalDate ? today : finalDate,
  };
};

export default function Equipe() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get('tab') || 'overview';
  const activeTab = validTabs.includes(queryTab) ? queryTab : 'overview';
  const [employees, setEmployees] = useState<TeamEmployee[]>([]);
  const [tableOptions, setTableOptions] = useState<TeamTableOption[]>([]);
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [attendance, setAttendance] = useState<AttendanceSummary[]>([]);
  const [rules, setRules] = useState<AttendanceRules>(defaultAttendanceRules);
  const [financial, setFinancial] = useState<{
    commissions: any[];
    advances: any[];
    closings: any[];
    accounts: any[];
    adjustments: any[];
  }>({
    commissions: [],
    advances: [],
    closings: [],
    accounts: [],
    adjustments: [],
  });
  const [commissionConfig, setCommissionConfig] = useState<{
    rules: CommissionRule[];
    products: TeamProductOption[];
  }>({ rules: [], products: [] });
  const [alerts, setAlerts] = useState<any[]>([]);
  const [competence, setCompetence] = useState(currentCompetence);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const operator = useMemo(() => getLocalOperatorSession(), []);
  const can = (permission: string) => isAdminOperator(operator) || operator?.permissions?.[permission] === true;
  const canManageEmployees = can('users_manage');
  const canManageSchedules = can('schedule_manage') || canManageEmployees;
  const canManageTimeclock = can('timeclock_manage') || canManageEmployees;
  const canViewSensitive = can('compensation_view') || can('compensation_manage') || can('payroll_view') || can('payroll_manage');
  const canViewPayroll = canViewSensitive && (can('payroll_view') || can('payroll_manage'));
  const canManageCommissions = canViewSensitive && (can('commission_manage') || can('advance_manage') || can('payroll_manage'));
  const canConfigure = can('payroll_manage') || can('settings_manage');

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const period = monthPeriod(competence);
      const [employeeRows, scheduleRows, attendanceData, financialData, alertRows, commissionData, tables] = await Promise.all([
        loadTeamEmployees(user.id, canViewSensitive),
        loadSchedules(user.id),
        loadAttendanceData(user.id, period.startDate, period.endDate),
        canViewSensitive
          ? loadMonthlyFinancialInputs(user.id, period.startDate, period.endDate)
          : Promise.resolve({
              commissions: [],
              advances: [],
              closings: [],
              accounts: [],
              adjustments: [],
            }),
        loadTeamAlerts(user.id),
        canManageCommissions ? loadCommissionConfiguration(user.id) : Promise.resolve({ rules: [], products: [] }),
        loadTeamTables(user.id),
      ]);
      setEmployees(employeeRows);
      setTableOptions(tables);
      setSchedules(scheduleRows);
      setRules(attendanceData.rules);
      setFinancial(financialData);
      setAlerts(alertRows);
      setCommissionConfig(commissionData);
      setAttendance(
        employeeRows.map((employee) =>
          calculateAttendance({
            employeeId: employee.id,
            startDate: period.startDate,
            endDate: period.endDate,
            schedules: scheduleRows,
            entries: attendanceData.entries,
            occurrences: attendanceData.occurrences,
            rules: attendanceData.rules,
          }),
        ),
      );
    } catch (error: any) {
      toast({
        title: 'Não foi possível carregar a Central da Equipe',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [canManageCommissions, canViewSensitive, competence, toast, user?.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const closing = financial.closings.find((item) => String(item.competence_date).startsWith(competence)) || null;
  const previewRows = useMemo<PayrollPreviewRow[]>(
    () =>
      employees
        .filter((employee) => employee.employment_status !== 'terminated')
        .map((employee) => {
          const summary = attendance.find((item) => item.employeeId === employee.id) || {
            employeeId: employee.id,
            expectedMinutes: 0,
            workedMinutes: 0,
            breakMinutes: 0,
            overtimeMinutes: 0,
            lateMinutes: 0,
            earlyLeaveMinutes: 0,
            bankMinutes: 0,
            absenceDays: 0,
            workedDays: 0,
            daysOff: 0,
            incompleteDays: 0,
            days: [],
          };
          const commissions = financial.commissions.filter((item) => item.employee_id === employee.id && item.source_type !== 'bonus').reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const manualBonuses = financial.commissions.filter((item) => item.employee_id === employee.id && item.source_type === 'bonus').reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const advances = financial.advances.filter((item) => item.employee_id === employee.id).reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const adjustments = financial.adjustments.filter((item) => item.employee_id === employee.id && item.closing_id === closing?.id);
          const otherEarnings = adjustments.filter((item) => item.adjustment_type === 'earning').reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const otherDeductions = adjustments.filter((item) => item.adjustment_type === 'deduction').reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const amounts = buildPayrollPreview({
            attendance: summary,
            salaryBase: employee.compensation.salary_base,
            hourlyRate: employee.compensation.hourly_rate,
            overtimeMultiplier: rules.overtimeHourMultiplier,
            commissions,
            bonuses: employee.compensation.default_bonus + manualBonuses,
            advances,
            otherEarnings,
            otherDeductions,
            deductLateMinutes: rules.deductLateMinutes,
            deductAbsences: rules.deductUnjustifiedAbsences,
          });
          const saved = closing?.employee_payroll_items?.find((item: any) => item.employee_id === employee.id);
          if (saved && ['approved', 'generated_financial', 'paid'].includes(closing.status))
            return {
              ...summary,
              employee,
              baseSalary: Number(saved.base_salary),
              overtimeAmount: Number(saved.calculation_details?.overtime_amount || 0),
              commissions: Number(saved.commissions),
              bonuses: Number(saved.bonuses),
              advances: Number(saved.advances),
              absenceDeductions: Number(saved.absence_deductions),
              lateDeductions: Number(saved.late_deductions),
              otherEarnings: Number(saved.other_earnings),
              otherDeductions: Number(saved.other_deductions),
              totalEarnings: Number(saved.total_earnings),
              totalDeductions: Number(saved.total_deductions),
              netAmount: Number(saved.net_amount),
              status: closing.status,
            };
          return {
            ...summary,
            employee,
            ...amounts,
            status: closing?.status || 'review',
          };
        }),
    [attendance, closing, employees, financial.adjustments, financial.advances, financial.commissions, rules],
  );
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast({ title: success });
      await load();
    } catch (error: any) {
      toast({
        title: 'Não foi possível concluir',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const saveEmployee = async (form: EmployeeFormValue) => {
    if (!user?.id) return false;
    setBusy(true);
    try {
      await saveTeamEmployee(user.id, form);
      toast({ title: 'Colaborador salvo em um único cadastro' });
      await load();
      return true;
    } catch (error: any) {
      const rawMessage = String(error?.message || '');
      const schemaUnavailable = error?.code === 'PGRST202' || error?.code === 'PGRST205' || rawMessage.includes('save_team_employee') || rawMessage.includes("'employees'");
      toast({
        title: 'Não foi possível salvar o colaborador',
        description: schemaUnavailable ? 'A atualização do banco da Central da Equipe ainda não foi concluída neste ambiente. Seus dados continuam no formulário; tente novamente após a liberação.' : rawMessage,
        variant: 'destructive',
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const toggleStatus = async (employee: TeamEmployee) => run(() => updateEmployeeStatus(employee.id, employee.employment_status === 'terminated' ? 'active' : 'terminated'), employee.employment_status === 'terminated' ? 'Colaborador reativado' : 'Colaborador desligado sem apagar o histórico');
  const saveSchedules = async (items: WorkSchedule[]) =>
    run(async () => {
      if (!user?.id) return;
      await Promise.all(items.map((item) => saveSchedule(user.id, item)));
    }, 'Escala atualizada');
  const savePreview = async () =>
    run(async () => {
      if (!user?.id) return;
      await savePayrollPreview({
        restaurantId: user.id,
        competenceDate: `${competence}-01`,
        items: previewRows.map((row) => ({
          employee_id: row.employeeId,
          base_salary: row.baseSalary,
          expected_minutes: row.expectedMinutes,
          worked_minutes: row.workedMinutes,
          overtime_minutes: row.overtimeMinutes,
          late_minutes: row.lateMinutes,
          early_leave_minutes: row.earlyLeaveMinutes,
          absence_days: row.absenceDays,
          days_off: row.daysOff,
          worked_days: row.workedDays,
          commissions: row.commissions,
          bonuses: row.bonuses,
          advances: row.advances,
          other_earnings: row.otherEarnings,
          absence_deductions: row.absenceDeductions,
          late_deductions: row.lateDeductions,
          other_deductions: row.otherDeductions,
          total_earnings: row.totalEarnings,
          total_deductions: row.totalDeductions,
          net_amount: row.netAmount,
          calculation_details: {
            overtime_amount: row.overtimeAmount,
            bank_minutes: row.bankMinutes,
            incomplete_days: row.incompleteDays,
          },
        })),
        snapshot: { rules, generated_at: new Date().toISOString() },
      });
    }, 'Prévia mensal salva para revisão');
  const tabItems = (
    [
      ['overview', 'Visão Geral', UsersRound, true],
      ['collaborators', 'Colaboradores', UserRoundCog, canManageEmployees],
      ['schedules', 'Escalas e Folgas', CalendarDays, canManageSchedules],
      ['timeclock', 'Controle de Ponto', Clock3, canManageTimeclock],
      ['payroll', 'Fechamento Mensal', WalletCards, canViewPayroll],
      ['commissions', 'Comissões', CircleDollarSign, canManageCommissions],
      ['settings', 'Configurações', Settings2, canConfigure],
    ] as const
  ).filter((item) => item[3]);
  return (
    <div className="min-h-full space-y-6 bg-white pb-10">
      <header className="overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-700 px-6 py-7 text-white shadow-lg">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-orange-300">Gestão integrada de pessoas</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Central da Equipe</h1>
        <p className="mt-2 max-w-3xl text-sm text-emerald-100">Cadastro, acessos, jornada, ponto, comissões, adiantamentos e fechamento mensal em um só lugar.</p>
      </header>
      <Tabs value={tabItems.some((item) => item[0] === activeTab) ? activeTab : 'overview'} onValueChange={(value) => setSearchParams({ tab: value })} className="space-y-5">
        <div className="overflow-x-auto pb-1">
          <TabsList className="inline-flex h-auto min-w-max gap-1 bg-slate-100 p-1.5">
            {tabItems.map(([value, label, Icon]) => (
              <TabsTrigger key={value} value={value} className="gap-2 px-4 py-2.5">
                <Icon className="h-4 w-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <TeamOverview employees={employees} attendance={attendance} commissions={financial.commissions.reduce((sum, item) => sum + Number(item.amount || 0), 0)} pendingClosings={financial.closings.filter((item) => ['calculating', 'review'].includes(item.status)).length} alerts={alerts} loading={loading} />
        </TabsContent>
        {canManageEmployees && (
          <TabsContent value="collaborators">
            <TeamCollaborators employees={employees} tableOptions={tableOptions} loading={loading} saving={busy} canViewSensitive={canViewSensitive} onSave={saveEmployee} onStatusChange={toggleStatus} />
          </TabsContent>
        )}
        {canManageSchedules && (
          <TabsContent value="schedules">
            <TeamSchedules employees={employees} schedules={schedules} saving={busy} onSave={saveSchedules} />
          </TabsContent>
        )}
        {canManageTimeclock && (
          <TabsContent value="timeclock">
            <ControlePonto />
          </TabsContent>
        )}
        {canViewPayroll && (
          <TabsContent value="payroll">
            <TeamPayroll
              rows={previewRows}
              competence={competence}
              restaurantName={profile?.restaurant_name || 'Restaurante'}
              responsible={operator?.name || user?.email || 'Administrador'}
              closing={closing}
              busy={busy}
              canApprove={can('payroll_approve')}
              canReopen={can('payroll_reopen')}
              onCompetenceChange={setCompetence}
              onSavePreview={savePreview}
              onApprove={() => run(() => setClosingStatus(closing.id, 'approved', operator?.id), 'Fechamento aprovado e protegido contra recálculo')}
              onReopen={(reason) => run(() => setClosingStatus(closing.id, 'review', operator?.id, reason), 'Fechamento reaberto com auditoria')}
              onGeneratePayables={(dueDate) => run(() => generatePayrollPayables(closing.id, dueDate, operator?.id).then(() => undefined), 'Obrigações individuais geradas em Contas a Pagar')}
              onAdjustment={(value) =>
                run(
                  () =>
                    registerPayrollAdjustment({
                      ...value,
                      closingId: closing.id,
                      operatorId: operator?.id,
                    }),
                  'Ajuste registrado; recalcule a prévia para consolidar',
                )
              }
            />
          </TabsContent>
        )}
        {canManageCommissions && (
          <TabsContent value="commissions">
            <TeamCommissions
              employees={employees}
              accounts={financial.accounts}
              rules={commissionConfig.rules}
              products={commissionConfig.products}
              busy={busy}
              onCommission={(value) =>
                run(
                  () =>
                    registerCommission({
                      ...value,
                      competenceDate: value.date,
                      operatorId: operator?.id,
                    }),
                  'Crédito registrado no fechamento',
                )
              }
              onAdvance={(value) => run(() => registerAdvance({ ...value, operatorId: operator?.id }), 'Adiantamento e movimentação financeira registrados')}
              onRule={(value) =>
                run(
                  () =>
                    saveCommissionRule({
                      restaurantId: user!.id,
                      ...value,
                      operatorId: operator?.id,
                    }),
                  'Regra de comissão salva',
                )
              }
            />
          </TabsContent>
        )}
        {canConfigure && (
          <TabsContent value="settings">
            <TeamSettings
              rules={rules}
              saving={busy}
              onSave={(value) =>
                run(async () => {
                  await savePayrollSettings(user!.id, value);
                  setRules(value);
                }, 'Parâmetros de apuração salvos')
              }
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
