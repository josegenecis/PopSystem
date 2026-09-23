/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '@/integrations/supabase/client';
import type { AttendanceOccurrence, AttendanceRules, CommissionRule, CommissionRuleType, EmployeeApp, EmployeeFormValue, TeamEmployee, TeamProductOption, TeamTableOption, TimeEntry, WorkSchedule } from '@/lib/team/types';
import { onlyDigits } from '@/lib/team/fieldMasks';

const db = supabase as any;

const rows = <T>(result: { data?: T[] | null }) => (Array.isArray(result.data) ? result.data : []);

export const defaultAttendanceRules: AttendanceRules = {
  overtimeToleranceMinutes: 10,
  lateToleranceMinutes: 5,
  overtimeHourMultiplier: 1,
  deductLateMinutes: false,
  deductUnjustifiedAbsences: false,
};

export async function loadTeamEmployees(restaurantId: string, includeSensitive = false): Promise<TeamEmployee[]> {
  const [employeesResult, compensationResult, rolesResult, permissionsResult, appsResult] = await Promise.all([db.from('employees').select('*').eq('restaurant_id', restaurantId).order('full_name'), includeSensitive ? db.from('employee_compensation').select('*').eq('restaurant_id', restaurantId) : Promise.resolve({ data: [], error: null }), db.from('employee_roles').select('employee_id, role_code').eq('restaurant_id', restaurantId), db.from('employee_permissions').select('employee_id, permission_code, allowed').eq('restaurant_id', restaurantId), db.from('employee_app_access').select('employee_id, app_code, enabled, configuration').eq('restaurant_id', restaurantId)]);
  const error = [employeesResult, compensationResult, rolesResult, permissionsResult, appsResult].find((result) => result.error)?.error;
  if (error) throw error;

  const compensationByEmployee = new Map(rows<any>(compensationResult).map((item) => [item.employee_id, item]));
  const rolesByEmployee = new Map<string, string[]>();
  const permissionsByEmployee = new Map<string, string[]>();
  const appsByEmployee = new Map<string, string[]>();
  const appConfigurationsByEmployee = new Map<string, Partial<Record<EmployeeApp, Record<string, unknown>>>>();
  for (const item of rows<any>(rolesResult)) rolesByEmployee.set(item.employee_id, [...(rolesByEmployee.get(item.employee_id) || []), item.role_code]);
  for (const item of rows<any>(permissionsResult)) if (item.allowed) permissionsByEmployee.set(item.employee_id, [...(permissionsByEmployee.get(item.employee_id) || []), item.permission_code]);
  for (const item of rows<any>(appsResult)) {
    if (item.enabled) appsByEmployee.set(item.employee_id, [...(appsByEmployee.get(item.employee_id) || []), item.app_code]);
    appConfigurationsByEmployee.set(item.employee_id, {
      ...(appConfigurationsByEmployee.get(item.employee_id) || {}),
      [item.app_code]: item.configuration && typeof item.configuration === 'object' ? item.configuration : {},
    });
  }

  return rows<any>(employeesResult).map((employee) => ({
    ...employee,
    weekly_hours: Number(employee.weekly_hours || 0),
    compensation: {
      salary_base: Number(compensationByEmployee.get(employee.id)?.salary_base || 0),
      hourly_rate: Number(compensationByEmployee.get(employee.id)?.hourly_rate || 0),
      remuneration_type: compensationByEmployee.get(employee.id)?.remuneration_type || 'fixed',
      default_bonus: Number(compensationByEmployee.get(employee.id)?.default_bonus || 0),
      pix_key: compensationByEmployee.get(employee.id)?.pix_key || null,
      bank_details: compensationByEmployee.get(employee.id)?.bank_details || {},
    },
    roles: rolesByEmployee.get(employee.id) || [],
    permissions: permissionsByEmployee.get(employee.id) || [],
    apps: appsByEmployee.get(employee.id) || [],
    app_configurations: appConfigurationsByEmployee.get(employee.id) || {},
  })) as TeamEmployee[];
}

export async function loadTeamTables(restaurantId: string): Promise<TeamTableOption[]> {
  const { data, error } = await db
    .from('tables')
    .select('id,table_number,location')
    .eq('user_id', restaurantId)
    .order('table_number');
  if (error) throw error;
  return rows<any>({ data }).map((table) => ({
    id: String(table.id),
    number: Number(table.table_number),
    location: table.location ? String(table.location) : null,
  }));
}

export async function saveTeamEmployee(restaurantId: string, form: EmployeeFormValue) {
  let bankDetails: Record<string, unknown> = {};
  if (form.bank_details.trim()) {
    bankDetails = { description: form.bank_details.trim() };
  }
  const { data, error } = await db.rpc('save_team_employee', {
    p_restaurant_id: restaurantId,
    p_employee_id: form.id || null,
    p_profile: {
      full_name: form.full_name,
      display_name: form.display_name,
      photo_url: form.photo_url,
      cpf: onlyDigits(form.cpf),
      phone: onlyDigits(form.phone),
      email: form.email,
      birth_date: form.birth_date || null,
      address: form.address,
      hire_date: form.hire_date || null,
      job_title: form.job_title,
      department: form.department,
      unit_name: form.unit_name,
      employment_status: form.employment_status,
      employment_type: form.employment_type,
      weekly_hours: form.weekly_hours,
      default_day_off: form.default_day_off,
      notes: form.notes,
    },
    p_compensation: {
      salary_base: form.salary_base,
      hourly_rate: form.hourly_rate,
      remuneration_type: form.remuneration_type,
      default_bonus: form.default_bonus,
      pix_key: form.pix_key,
      bank_details: bankDetails,
    },
    p_roles: form.roles,
    p_permissions: form.permissions,
    p_apps: form.apps,
    p_pin: form.pin || null,
    p_waiter_password: form.waiter_password || null,
    p_driver_password: form.driver_password || null,
    p_app_configuration: {
      waiter: {
        table_access_mode: form.waiter_table_access_mode,
        table_ids: form.waiter_table_access_mode === 'assigned' ? form.waiter_table_ids : [],
      },
      driver: {
        vehicle_type: form.driver_vehicle_type,
        vehicle_plate: form.driver_vehicle_plate,
      },
    },
  });
  if (error) throw error;
  return String(data);
}

export async function updateEmployeeStatus(employeeId: string, status: TeamEmployee['employment_status']) {
  const { error } = await db.from('employees').update({ employment_status: status, updated_at: new Date().toISOString() }).eq('id', employeeId);
  if (error) throw error;
}

export async function loadSchedules(restaurantId: string): Promise<WorkSchedule[]> {
  const { data, error } = await db.from('employee_work_schedules').select('*').eq('restaurant_id', restaurantId).order('weekday');
  if (error) throw error;
  return rows<any>({ data }).map((item) => ({
    ...item,
    first_start: item.first_start?.slice(0, 5) || null,
    first_end: item.first_end?.slice(0, 5) || null,
    second_start: item.second_start?.slice(0, 5) || null,
    second_end: item.second_end?.slice(0, 5) || null,
  }));
}

export async function saveSchedule(restaurantId: string, schedule: WorkSchedule) {
  const payload = {
    ...schedule,
    restaurant_id: restaurantId,
    updated_at: new Date().toISOString(),
  };
  const result = schedule.id ? await db.from('employee_work_schedules').update(payload).eq('id', schedule.id).eq('restaurant_id', restaurantId) : await db.from('employee_work_schedules').upsert(payload, { onConflict: 'employee_id,weekday,effective_from' });
  const { error } = result;
  if (error) throw error;
}

export async function loadAttendanceData(restaurantId: string, startDate: string, endDate: string) {
  const start = `${startDate}T00:00:00`;
  const end = `${endDate}T23:59:59.999`;
  const [entriesResult, occurrencesResult, settingsResult] = await Promise.all([db.from('employee_time_clock_events').select('id,employee_id,waiter_id,event_type,occurred_at,status').eq('user_id', restaurantId).gte('occurred_at', start).lte('occurred_at', end), db.from('employee_time_clock_occurrences').select('employee_id,waiter_id,occurrence_type,start_date,end_date,affects_expected_hours,paid,status').eq('user_id', restaurantId).lte('start_date', endDate).gte('end_date', startDate), db.from('employee_payroll_settings').select('*').eq('restaurant_id', restaurantId).maybeSingle()]);
  const error = [entriesResult, occurrencesResult, settingsResult].find((result) => result.error)?.error;
  if (error) throw error;
  const rules: AttendanceRules = settingsResult.data
    ? {
        overtimeToleranceMinutes: Number(settingsResult.data.overtime_tolerance_minutes || 0),
        lateToleranceMinutes: Number(settingsResult.data.late_tolerance_minutes || 0),
        overtimeHourMultiplier: Number(settingsResult.data.overtime_hour_multiplier || 1),
        deductLateMinutes: Boolean(settingsResult.data.deduct_late_minutes),
        deductUnjustifiedAbsences: Boolean(settingsResult.data.deduct_unjustified_absences),
      }
    : defaultAttendanceRules;
  return {
    entries: rows<any>(entriesResult).filter((item) => item.employee_id) as TimeEntry[],
    occurrences: rows<any>(occurrencesResult).filter((item) => item.employee_id) as AttendanceOccurrence[],
    rules,
  };
}

export async function loadTeamAlerts(restaurantId: string) {
  const refresh = await db.rpc('refresh_employee_team_alerts', {
    p_restaurant_id: restaurantId,
  });
  if (refresh.error) throw refresh.error;
  const { data, error } = await db.from('employee_alerts').select('*').eq('restaurant_id', restaurantId).eq('status', 'open').order('severity').order('reference_date', { ascending: false }).limit(30);
  if (error) throw error;
  return rows<any>({ data });
}

export async function loadMonthlyFinancialInputs(restaurantId: string, startDate: string, endDate: string) {
  const refreshResult = await db.rpc('refresh_employee_commissions', {
    p_restaurant_id: restaurantId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (refreshResult.error) throw refreshResult.error;
  const [commissionsResult, advancesResult, closingsResult, accountsResult] = await Promise.all([db.from('employee_commissions').select('*').eq('restaurant_id', restaurantId).gte('competence_date', startDate).lte('competence_date', endDate).neq('status', 'cancelled'), db.from('employee_advances').select('*').eq('restaurant_id', restaurantId).gte('advance_date', startDate).lte('advance_date', endDate).neq('status', 'reversed'), db.from('employee_payroll_closings').select('*,employee_payroll_items(*)').eq('restaurant_id', restaurantId).gte('competence_date', startDate).lte('competence_date', endDate).order('created_at', { ascending: false }), db.rpc('ensure_default_financial_accounts')]);
  const error = [commissionsResult, advancesResult, closingsResult, accountsResult].find((result) => result.error)?.error;
  if (error) throw error;
  const closingIds = rows<any>(closingsResult).map((item) => item.id);
  const adjustmentsResult = closingIds.length ? await db.from('employee_payroll_adjustments').select('*').in('closing_id', closingIds).order('created_at') : { data: [], error: null };
  if (adjustmentsResult.error) throw adjustmentsResult.error;
  return {
    commissions: rows<any>(commissionsResult),
    advances: rows<any>(advancesResult),
    closings: rows<any>(closingsResult),
    accounts: rows<any>(accountsResult),
    adjustments: rows<any>(adjustmentsResult),
  };
}

export async function registerCommission(params: { employeeId: string; amount: number; description: string; competenceDate: string; type?: 'manual' | 'bonus'; operatorId?: string | null }) {
  const { error } = await db.rpc('record_employee_commission', {
    p_employee_id: params.employeeId,
    p_amount: params.amount,
    p_competence_date: params.competenceDate,
    p_description: params.description,
    p_source_type: params.type || 'manual',
    p_operator_id: params.operatorId || null,
  });
  if (error) throw error;
}

export async function loadCommissionConfiguration(restaurantId: string): Promise<{ rules: CommissionRule[]; products: TeamProductOption[] }> {
  const [rulesResult, productsResult] = await Promise.all([db.from('employee_commission_rules').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }), db.from('products').select('id,name').eq('user_id', restaurantId).order('name')]);
  const error = rulesResult.error || productsResult.error;
  if (error) throw error;
  return {
    rules: rows<any>(rulesResult).map((item) => ({
      ...item,
      percentage: item.percentage === null ? null : Number(item.percentage),
      fixed_amount: item.fixed_amount === null ? null : Number(item.fixed_amount),
    })),
    products: rows<any>(productsResult),
  };
}

export async function saveCommissionRule(params: { restaurantId: string; ruleId?: string | null; employeeId: string; ruleType: CommissionRuleType; percentage?: number | null; fixedAmount?: number | null; productId?: string | null; active: boolean; startsAt: string; endsAt?: string | null; operatorId?: string | null }) {
  const { error } = await db.rpc('save_employee_commission_rule', {
    p_restaurant_id: params.restaurantId,
    p_rule_id: params.ruleId || null,
    p_employee_id: params.employeeId,
    p_rule_type: params.ruleType,
    p_percentage: params.percentage ?? null,
    p_fixed_amount: params.fixedAmount ?? null,
    p_product_id: params.productId || null,
    p_active: params.active,
    p_starts_at: params.startsAt,
    p_ends_at: params.endsAt || null,
    p_operator_id: params.operatorId || null,
  });
  if (error) throw error;
}

export async function registerPayrollAdjustment(params: { closingId: string; employeeId: string; type: 'earning' | 'deduction'; category: string; amount: number; description: string; operatorId?: string | null }) {
  const { error } = await db.rpc('register_employee_payroll_adjustment', {
    p_closing_id: params.closingId,
    p_employee_id: params.employeeId,
    p_adjustment_type: params.type,
    p_category: params.category,
    p_amount: params.amount,
    p_description: params.description,
    p_operator_id: params.operatorId || null,
  });
  if (error) throw error;
}

export async function registerAdvance(params: { employeeId: string; amount: number; date: string; method: string; accountId: string; note?: string; operatorId?: string | null }) {
  const { error } = await db.rpc('record_employee_advance', {
    p_employee_id: params.employeeId,
    p_amount: params.amount,
    p_advance_date: params.date,
    p_payment_method: params.method,
    p_financial_account_id: params.accountId,
    p_note: params.note || null,
    p_operator_id: params.operatorId || null,
  });
  if (error) throw error;
}

export async function savePayrollPreview(params: { restaurantId: string; competenceDate: string; unitName?: string; items: any[]; snapshot?: Record<string, unknown> }) {
  const { data, error } = await db.rpc('save_employee_payroll_preview', {
    p_restaurant_id: params.restaurantId,
    p_competence_date: params.competenceDate,
    p_unit_name: params.unitName || null,
    p_items: params.items,
    p_snapshot: params.snapshot || {},
  });
  if (error) throw error;
  return String(data);
}

export async function setClosingStatus(closingId: string, status: 'approved' | 'review', operatorId?: string | null, reason?: string) {
  const { error } = await db.rpc('set_employee_payroll_closing_status', {
    p_closing_id: closingId,
    p_status: status,
    p_operator_id: operatorId || null,
    p_reason: reason || null,
  });
  if (error) throw error;
}

export async function generatePayrollPayables(closingId: string, dueDate: string, operatorId?: string | null) {
  const { data, error } = await db.rpc('generate_employee_payroll_payables', {
    p_closing_id: closingId,
    p_due_date: dueDate,
    p_operator_id: operatorId || null,
  });
  if (error) throw error;
  return data;
}

export async function savePayrollSettings(restaurantId: string, rules: AttendanceRules) {
  const { error } = await db.from('employee_payroll_settings').upsert({
    restaurant_id: restaurantId,
    overtime_tolerance_minutes: rules.overtimeToleranceMinutes,
    late_tolerance_minutes: rules.lateToleranceMinutes,
    overtime_hour_multiplier: rules.overtimeHourMultiplier,
    deduct_late_minutes: rules.deductLateMinutes,
    deduct_unjustified_absences: rules.deductUnjustifiedAbsences,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
