export type OperatorSession = {
  id: string
  name: string
  role?: 'admin' | 'cashier' | string
  permissions?: Record<string, unknown>
  user_id?: string
}

export const getLocalOperatorSession = (): OperatorSession | null => {
  try {
    // Operator identity is scoped to the current window/session. Keeping it in
    // localStorage would silently restore the previous employee after the PDV
    // or browser was closed.
    localStorage.removeItem('operator_session')
    localStorage.removeItem('waiter_session')
    const waiter = sessionStorage.getItem('waiter_session')
    if (waiter) return JSON.parse(waiter)
    const op = sessionStorage.getItem('operator_session')
    if (op) return JSON.parse(op)
    return null
  } catch {
    return null
  }
}

export const setLocalOperatorSession = (session: OperatorSession) => {
  sessionStorage.setItem('operator_session', JSON.stringify(session))
  sessionStorage.removeItem('waiter_session')
  localStorage.removeItem('operator_session')
  localStorage.removeItem('waiter_session')
}

export const clearLocalOperatorSession = () => {
  try {
    localStorage.removeItem('operator_session')
    localStorage.removeItem('waiter_session')
    sessionStorage.removeItem('operator_session')
    sessionStorage.removeItem('waiter_session')
  } catch {
    return
  }
}

export const isAdminOperator = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (session.role === 'admin') return true
  if (session.permissions?.admin === true) return true
  return false
}

export const canCancelOrder = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (isAdminOperator(session)) return true
  return session.permissions?.can_cancel_order === true
    || session.permissions?.orders_cancel === true
    || session.permissions?.orders_manage === true
}

export const isCashOperator = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (isAdminOperator(session)) return true
  return session.permissions?.can_open_cash === true || 
         session.permissions?.can_close_cash === true ||
         session.permissions?.pos_open_close === true
}

export const canOpenCash = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (isAdminOperator(session)) return true
  return session.permissions?.can_open_cash === true || session.permissions?.pos_open_close === true
}

export const canCloseCash = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (isAdminOperator(session)) return true
  return session.permissions?.can_close_cash === true || session.permissions?.pos_open_close === true
}

export const canMoveCash = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (isAdminOperator(session)) return true
  return session.permissions?.cash_movement === true
}

export const canGiveDiscount = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (isAdminOperator(session)) return true
  return session.permissions?.pos_discount === true
}

export const canManageMenu = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (isAdminOperator(session)) return true
  return session.permissions?.menu_manage === true
}

export const canViewFinancial = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (isAdminOperator(session)) return true
  return session.permissions?.financial_view === true
}

export const canManageSettings = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (isAdminOperator(session)) return true
  return session.permissions?.settings_manage === true
}

export const canManageUsers = (session: OperatorSession | null): boolean => {
  if (!session) return false
  if (isAdminOperator(session)) return true
  return session.permissions?.users_manage === true
}

export type OperatorArea =
  | 'dashboard'
  | 'pdv'
  | 'tables'
  | 'orders'
  | 'customers'
  | 'kds'
  | 'products'
  | 'stock'
  | 'cash'
  | 'finance'
  | 'expenses'
  | 'reports'
  | 'marketing'
  | 'whatsapp'
  | 'settings'
  | 'team'
  | 'timeclock'
  | 'delivery'
  | 'deliveryAreas'
  | 'deliveryTeam'
  | 'hardware'
  | 'integrations'
  | 'desktop'
  | 'agent'
  | 'security'
  | 'fiscal'
  | 'pix'

export const OPERATOR_AREA_PERMISSIONS: Record<OperatorArea, string[]> = {
  dashboard: ['dashboard_view'],
  pdv: ['pos_access'],
  tables: ['tables_access', 'pos_access', 'waiter_app'],
  orders: ['orders_manage'],
  kds: ['kds_access', 'orders_manage'],
  products: ['menu_manage'],
  stock: ['stock_manage'],
  cash: ['pos_open_close', 'can_open_cash', 'can_close_cash', 'cash_movement'],
  finance: ['financial_view'],
  expenses: ['expenses_manage', 'financial_view'],
  reports: ['reports_view', 'financial_view'],
  marketing: ['marketing_manage'],
  whatsapp: ['whatsapp_manage', 'marketing_manage'],
  settings: [
    'settings_manage',
    'delivery_areas_manage',
    'payments_manage',
    'whatsapp_manage',
    'hardware_manage',
    'ifood_manage',
    'users_manage',
  ],
  team: ['users_manage', 'timeclock_manage', 'schedule_manage', 'payroll_view', 'payroll_manage', 'commission_manage'],
  timeclock: ['timeclock_manage', 'users_manage'],
  // `delivery_manage` e `settings_manage` preservam operadores já cadastrados.
  delivery: ['delivery_manage', 'delivery_areas_manage', 'delivery_drivers_manage', 'settings_manage'],
  deliveryAreas: ['delivery_areas_manage', 'delivery_manage', 'settings_manage'],
  deliveryTeam: ['delivery_drivers_manage', 'delivery_manage', 'settings_manage'],
  hardware: ['hardware_manage', 'settings_manage'],
  integrations: ['ifood_manage', 'settings_manage'],
  desktop: ['desktop_access', 'settings_manage'],
  agent: ['agent_access', 'settings_manage'],
  security: ['security_view', 'settings_manage'],
  fiscal: ['fiscal_manage', 'settings_manage'],
  pix: ['payments_manage', 'financial_view', 'settings_manage'],
}

export const canAccessOperatorArea = (session: OperatorSession | null, area?: OperatorArea): boolean => {
  if (!area) return true
  if (!session) return false
  if (isAdminOperator(session)) return true
  const permissions = session.permissions || {}

  return (OPERATOR_AREA_PERMISSIONS[area] || []).some((permission) => permissions[permission] === true)
}

const defaultOperatorRoutes: Array<{ area: OperatorArea; path: string }> = [
  { area: 'dashboard', path: '/dashboard' },
  { area: 'pdv', path: '/pdv' },
  { area: 'tables', path: '/mesas' },
  { area: 'orders', path: '/pedidos' },
  { area: 'customers', path: '/clientes' },
  { area: 'kds', path: '/cozinha' },
  { area: 'products', path: '/produtos' },
  { area: 'stock', path: '/estoque' },
  { area: 'cash', path: '/caixa' },
  { area: 'finance', path: '/financeiro' },
  { area: 'expenses', path: '/despesas' },
  { area: 'reports', path: '/relatorios' },
  { area: 'marketing', path: '/marketing' },
  { area: 'whatsapp', path: '/whatsapp-bot' },
  { area: 'team', path: '/equipe' },
  { area: 'timeclock', path: '/equipe?tab=timeclock' },
  { area: 'deliveryAreas', path: '/bairros-entrega' },
  { area: 'deliveryTeam', path: '/entregadores' },
  { area: 'settings', path: '/configuracoes' },
  { area: 'desktop', path: '/downloads' },
  { area: 'agent', path: '/agente' },
  { area: 'security', path: '/security' },
  { area: 'fiscal', path: '/fiscal' },
  { area: 'pix', path: '/pix' },
]

const pathOperatorAreas: Array<{ area: OperatorArea; paths: string[] }> = [
  { area: 'dashboard', paths: ['/dashboard'] },
  { area: 'pdv', paths: ['/pdv'] },
  { area: 'tables', paths: ['/mesas'] },
  { area: 'orders', paths: ['/pedidos', '/orders'] },
  { area: 'customers', paths: ['/clientes'] },
  { area: 'kds', paths: ['/cozinha'] },
  { area: 'products', paths: ['/produtos', '/cardapio'] },
  { area: 'stock', paths: ['/estoque', '/inteligencia/cmv', '/inteligencia/curva-abc'] },
  { area: 'cash', paths: ['/caixa'] },
  { area: 'finance', paths: ['/financeiro'] },
  { area: 'expenses', paths: ['/despesas'] },
  { area: 'reports', paths: ['/relatorios'] },
  { area: 'marketing', paths: ['/marketing', '/loyalty'] },
  { area: 'whatsapp', paths: ['/whatsapp-bot'] },
  { area: 'settings', paths: ['/configuracoes'] },
  { area: 'team', paths: ['/equipe', '/garcons'] },
  { area: 'timeclock', paths: ['/ponto'] },
  { area: 'deliveryAreas', paths: ['/bairros-entrega'] },
  { area: 'deliveryTeam', paths: ['/entregadores', '/motoboys'] },
  { area: 'desktop', paths: ['/desktop', '/downloads'] },
  { area: 'agent', paths: ['/agente'] },
  { area: 'security', paths: ['/security'] },
  { area: 'fiscal', paths: ['/fiscal', '/nfce'] },
  { area: 'pix', paths: ['/pix', '/pagamentos'] },
]

export const getOperatorAreaForPath = (pathname?: string): OperatorArea | null => {
  const path = String(pathname || '').split('?')[0]
  if (!path) return null
  return pathOperatorAreas.find((item) =>
    item.paths.some((candidate) => path === candidate || path.startsWith(`${candidate}/`))
  )?.area || null
}

export const getDefaultOperatorPath = (session: OperatorSession | null): string => {
  if (!session) return '/operator-login'
  if (isAdminOperator(session)) return '/dashboard'
  return defaultOperatorRoutes.find((route) => canAccessOperatorArea(session, route.area))?.path || '/operator-login'
}

export const getOperatorPathForRequestedPath = (session: OperatorSession | null, requestedPath?: string): string => {
  if (!session) return '/operator-login'
  const requested = String(requestedPath || '').trim()
  const requestedArea = getOperatorAreaForPath(requested)
  if (requested && requested !== '/operator-login' && (!requestedArea || canAccessOperatorArea(session, requestedArea))) {
    return requested
  }
  return getDefaultOperatorPath(session)
}
