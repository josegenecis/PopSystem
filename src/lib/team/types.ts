export type EmploymentStatus = 'active' | 'leave' | 'vacation' | 'terminated';
export type EmploymentType = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'clt' | 'freelance' | 'partner' | 'intern' | 'other';
export type RemunerationType = 'fixed' | 'hourly' | 'daily' | 'weekly' | 'commission' | 'mixed' | 'other';

export type EmployeeRole =
  | 'administrator'
  | 'manager'
  | 'cashier'
  | 'waiter'
  | 'kitchen'
  | 'driver'
  | 'stockkeeper'
  | 'finance'
  | 'hr'
  | 'custom';

export type EmployeeApp =
  | 'popsystem'
  | 'pdv'
  | 'waiter'
  | 'driver'
  | 'time_clock'
  | 'kds'
  | 'finance'
  | 'stock'
  | 'administration';

export interface EmployeeCompensation {
  salary_base: number;
  hourly_rate: number;
  remuneration_type: RemunerationType;
  default_bonus: number;
  pix_key: string | null;
  bank_details: Record<string, unknown>;
}

export interface TeamEmployee {
  id: string;
  restaurant_id: string;
  full_name: string;
  display_name: string | null;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  address: string | null;
  hire_date: string | null;
  job_title: string | null;
  department: string | null;
  unit_name: string | null;
  employment_status: EmploymentStatus;
  employment_type: EmploymentType;
  weekly_hours: number;
  default_day_off: number | null;
  notes: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
  compensation: EmployeeCompensation;
  roles: EmployeeRole[];
  permissions: string[];
  apps: EmployeeApp[];
  app_configurations: Partial<Record<EmployeeApp, Record<string, unknown>>>;
}

export interface TeamTableOption {
  id: string;
  number: number;
  location: string | null;
}

export interface EmployeeFormValue {
  id?: string;
  full_name: string;
  display_name: string;
  photo_url: string;
  cpf: string;
  phone: string;
  email: string;
  birth_date: string;
  address: string;
  hire_date: string;
  job_title: string;
  department: string;
  unit_name: string;
  employment_status: EmploymentStatus;
  employment_type: EmploymentType;
  weekly_hours: number;
  default_day_off: number | null;
  notes: string;
  salary_base: number;
  hourly_rate: number;
  remuneration_type: RemunerationType;
  default_bonus: number;
  pix_key: string;
  bank_details: string;
  roles: EmployeeRole[];
  permissions: string[];
  apps: EmployeeApp[];
  pin: string;
  waiter_password: string;
  waiter_table_access_mode: 'all' | 'assigned';
  waiter_table_ids: string[];
  driver_password: string;
  driver_vehicle_type: string;
  driver_vehicle_plate: string;
}

export interface WorkSchedule {
  id?: string;
  employee_id: string;
  weekday: number;
  first_start: string | null;
  first_end: string | null;
  second_start: string | null;
  second_end: string | null;
  is_day_off: boolean;
  schedule_type: 'fixed' | 'variable';
  effective_from: string;
  effective_until: string | null;
}

export interface TimeEntry {
  id: string;
  employee_id: string;
  event_type: 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
  occurred_at: string;
  status: 'approved' | 'pending_review' | 'rejected';
}

export interface AttendanceOccurrence {
  employee_id: string;
  occurrence_type: string;
  start_date: string;
  end_date: string;
  affects_expected_hours: boolean;
  paid: boolean;
  status: string;
}

export interface AttendanceRules {
  overtimeToleranceMinutes: number;
  lateToleranceMinutes: number;
  overtimeHourMultiplier: number;
  deductLateMinutes: boolean;
  deductUnjustifiedAbsences: boolean;
}

export interface AttendanceDay {
  date: string;
  expectedMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  bankMinutes: number;
  occurrence: string | null;
  incomplete: boolean;
  isDayOff: boolean;
  isAbsence: boolean;
}

export interface AttendanceSummary {
  employeeId: string;
  expectedMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  bankMinutes: number;
  absenceDays: number;
  workedDays: number;
  daysOff: number;
  incompleteDays: number;
  days: AttendanceDay[];
}

export interface PayrollPreviewRow extends AttendanceSummary {
  employee: TeamEmployee;
  baseSalary: number;
  overtimeAmount: number;
  commissions: number;
  bonuses: number;
  advances: number;
  absenceDeductions: number;
  lateDeductions: number;
  otherEarnings: number;
  otherDeductions: number;
  totalEarnings: number;
  totalDeductions: number;
  netAmount: number;
  status: string;
}

export type CommissionRuleType = 'sale_percentage' | 'fixed_per_sale' | 'product_percentage' | 'product_fixed';

export interface CommissionRule {
  id: string;
  employee_id: string;
  rule_type: CommissionRuleType;
  percentage: number | null;
  fixed_amount: number | null;
  product_id: string | null;
  active: boolean;
  starts_at: string;
  ends_at: string | null;
}

export interface TeamProductOption {
  id: string;
  name: string;
}
