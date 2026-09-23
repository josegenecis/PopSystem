import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

export const ok = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: corsHeaders })

export const fail = (message: string, status = 400) =>
  ok({ error: message }, status)

export const getEnv = (...keys: string[]) => {
  for (const key of keys) {
    const value = Deno.env.get(key)
    if (value) return value
  }
  return ''
}

export const normalizeCpf = (value: string) => String(value || '').replace(/\D/g, '')
export const hasWaiterAppAccess = (permissions: unknown) =>
  Boolean(permissions && typeof permissions === 'object' && (permissions as Record<string, boolean>).waiter_app)

export const createServiceClient = () => {
  const url = getEnv('SUPABASE_URL', 'BORACUME_SUPABASE_URL')
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY', 'BORACUME_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('Ambiente do Supabase nao configurado para o app do garcom.')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

export const hashToken = async (value: string) => {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((chunk) => chunk.toString(16).padStart(2, '0'))
    .join('')
}

export const buildSessionToken = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')

type WaiterSessionWaiterRow = {
  id: string
  employee_id: string | null
  name: string
  role: string | null
  permissions: Record<string, boolean> | null
  cpf: string | null
  active: boolean | null
  faceio_facial_id: string | null
  local_face_enrolled_at: string | null
  local_face_profile: Record<string, unknown> | null
}

export type WaiterTableAccess = {
  mode: 'all' | 'assigned'
  tableIds: string[]
}

export async function getWaiterTableAccess(supabase: any, waiter: Pick<WaiterSessionWaiterRow, 'id' | 'employee_id' | 'role' | 'permissions'>): Promise<WaiterTableAccess> {
  const permissions = (waiter.permissions as Record<string, unknown>) || {}
  if (String(waiter.role || '').toLowerCase() === 'admin' || permissions.admin === true) {
    return { mode: 'all', tableIds: [] }
  }

  const employeeId = String(waiter.employee_id || '').trim()
  if (!employeeId) return { mode: 'all', tableIds: [] }

  const { data, error } = await supabase
    .from('employee_app_access')
    .select('configuration')
    .eq('employee_id', employeeId)
    .eq('app_code', 'waiter')
    .eq('enabled', true)
    .maybeSingle()

  if (error) throw error
  if (!data) return { mode: 'all', tableIds: [] }

  const configuration = data.configuration && typeof data.configuration === 'object'
    ? data.configuration as Record<string, unknown>
    : {}
  if (configuration.table_access_mode !== 'assigned') return { mode: 'all', tableIds: [] }

  const tableIds = Array.isArray(configuration.table_ids)
    ? [...new Set(configuration.table_ids.map(String).filter(Boolean))]
    : []
  return { mode: 'assigned', tableIds }
}

export async function getWaiterSession(req: Request) {
  const authHeader = req.headers.get('authorization') || ''
  const rawToken = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!rawToken) {
    throw new Error('Sessao do garcom nao informada.')
  }

  const supabase = createServiceClient()
  const tokenHash = await hashToken(rawToken)
  const { data, error } = await supabase
    .from('waiter_web_sessions')
    .select(`
      id,
      waiter_id,
      restaurant_id,
      expires_at,
      waiter:waiters!waiter_web_sessions_waiter_id_fkey(
        id,
        employee_id,
        name,
        role,
        permissions,
        cpf,
        active,
        faceio_facial_id,
        local_face_enrolled_at,
        local_face_profile
      )
    `)
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error || !data) {
    throw new Error('Sessao do garcom invalida.')
  }

  const waiter = (Array.isArray(data.waiter) ? data.waiter[0] : data.waiter) as WaiterSessionWaiterRow | null

  if (!waiter?.active) {
    await supabase.from('waiter_web_sessions').delete().eq('id', data.id)
    throw new Error('Garcom inativo.')
  }

  const permissions = (waiter.permissions as Record<string, boolean>) || {}
  if (!hasWaiterAppAccess(permissions)) {
    await supabase.from('waiter_web_sessions').delete().eq('id', data.id)
    throw new Error('Acesso ao app garcom nao liberado para este usuario.')
  }

  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await supabase.from('waiter_web_sessions').delete().eq('id', data.id)
    throw new Error('Sessao expirada. Faca login novamente.')
  }

  await supabase
    .from('waiter_web_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', data.id)

  const tableAccess = await getWaiterTableAccess(supabase, waiter)

  return {
    rawToken,
    sessionId: data.id,
    profile: {
      id: waiter.id,
      restaurantId: data.restaurant_id,
      name: waiter.name,
      cpf: waiter.cpf || '',
      role: waiter.role || 'cashier',
      permissions,
      tableAccessMode: tableAccess.mode,
      allowedTableIds: tableAccess.tableIds,
      faceioFacialId: waiter.faceio_facial_id || null,
      localFaceEnrolledAt: waiter.local_face_enrolled_at || null,
      localFaceProfile: waiter.local_face_profile || null,
    },
    expiresAt: data.expires_at,
    supabase,
  }
}
