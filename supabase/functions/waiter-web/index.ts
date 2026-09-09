import { corsHeaders, fail, getWaiterSession, ok } from '../_shared/waiter-web.ts'

const EPSILON = 0.009

type KitchenStatus = 'idle' | 'sent' | 'preparing' | 'ready' | 'delivered'
type AccountStatus = 'open' | 'preparing' | 'ready' | 'check_requested' | 'partially_paid' | 'paid'
type TableStatus = 'free' | 'occupied' | 'preparing' | 'ready' | 'check_requested' | 'partially_paid'
type TableOrderMode = 'marked_items' | 'all_items' | 'account_only'

const minutesSince = (value: string) => Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
const normalizeAmount = (value: unknown) => Number(value || 0)
const isEffectivelyZero = (value: number) => Math.abs(value) <= EPSILON
const toNumberOrNull = (value: unknown) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toRadians = (value: number) => (value * Math.PI) / 180
const calculateDistanceMeters = (fromLat?: number | null, fromLng?: number | null, toLat?: number | null, toLng?: number | null) => {
  if (![fromLat, fromLng, toLat, toLng].every((value) => Number.isFinite(Number(value)))) return null

  const earthRadiusMeters = 6371000
  const dLat = toRadians(Number(toLat) - Number(fromLat))
  const dLng = toRadians(Number(toLng) - Number(fromLng))
  const startLat = toRadians(Number(fromLat))
  const endLat = toRadians(Number(toLat))
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function getTableOrderFlowSettings(supabase: any, restaurantId: string) {
  const { data, error } = await supabase
    .from('table_order_flow_settings')
    .select('table_order_mode, show_table_orders_in_manager, auto_accept_table_orders')
    .eq('user_id', restaurantId)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    console.warn('[waiter-web] table_order_flow_settings unavailable:', error?.message || error)
  }

  const mode = String(data?.table_order_mode || 'all_items') as TableOrderMode
  return {
    mode: ['marked_items', 'all_items', 'account_only'].includes(mode) ? mode : 'all_items',
    showInManager: data?.show_table_orders_in_manager !== false,
    autoAccept: data ? data.auto_accept_table_orders === true : true,
  }
}

const extractDataUrlPayload = (dataUrl: string) => {
  const match = String(dataUrl || '').match(/^data:([a-z0-9/+.-]+);base64,(.+)$/i)
  return match ? { mimeType: match[1], base64: match[2] } : null
}

const sha256Hex = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const sanitizeFaceFrame = async (frame: any, index: number) => {
  const payload = extractDataUrlPayload(String(frame?.dataUrl || ''))
  const sizeBytes = payload?.base64 ? Math.floor((payload.base64.length * 3) / 4) : 0
  return {
    index,
    step: String(frame?.step || `frame_${index + 1}`).slice(0, 40),
    capturedAt: String(frame?.capturedAt || '').slice(0, 80) || null,
    mimeType: payload?.mimeType || null,
    sizeBytes,
    imageSha256: payload?.base64 ? await sha256Hex(payload.base64) : null,
    faceDetected: frame?.faceDetected === true,
    faceBox: frame?.faceBox && typeof frame.faceBox === 'object'
      ? {
        x: Number(frame.faceBox.x || 0),
        y: Number(frame.faceBox.y || 0),
        width: Number(frame.faceBox.width || 0),
        height: Number(frame.faceBox.height || 0),
      }
      : null,
  }
}

async function analyzeTimeClockFaceCapture(settings: any, waiterSession: any, body: any) {
  if (!settings.requireFaceLiveness) {
    return {
      faceProvider: 'not_required',
      faceStatus: 'not_configured',
      faceScore: null,
      faceReferenceId: null,
      faceLivenessPassed: null,
      faceChallengeId: null,
      faceChallengePrompt: null,
      privacyAcknowledgedAt: null,
      evidence: {},
      providerPayload: {},
      reviewReason: '',
    }
  }

  if (settings.faceLivenessMode === 'faceio' || settings.faceProvider === 'faceio') {
    const verification = body?.faceioVerification && typeof body.faceioVerification === 'object'
      ? body.faceioVerification
      : null
    const facialId = String(verification?.facialId || '').trim().slice(0, 240)
    const expectedFacialId = String(waiterSession.profile?.faceioFacialId || '').trim()
    const rawStatus = String(verification?.status || '').toLowerCase()
    const confidence = toNumberOrNull(verification?.confidence)
    const verified = rawStatus === 'verified' && facialId && expectedFacialId && facialId === expectedFacialId
    const failed = rawStatus === 'failed' || !facialId || !expectedFacialId || facialId !== expectedFacialId

    return {
      faceProvider: 'faceio',
      faceStatus: verified ? 'verified' : failed ? 'failed' : 'pending_review',
      faceScore: confidence,
      faceReferenceId: facialId || null,
      faceLivenessPassed: verified,
      faceChallengeId: 'faceio_widget',
      faceChallengePrompt: 'Autenticacao facial/liveness via FACEIO',
      privacyAcknowledgedAt: verification?.verifiedAt || new Date().toISOString(),
      evidence: {
        mode: 'faceio',
        provider: 'FACEIO',
        expectedFacialIdSha256: expectedFacialId ? await sha256Hex(expectedFacialId) : null,
        returnedFacialIdSha256: facialId ? await sha256Hex(facialId) : null,
        facialIdMatched: Boolean(facialId && expectedFacialId && facialId === expectedFacialId),
        status: rawStatus || null,
        confidence,
        auditId: String(verification?.auditId || '').slice(0, 240) || null,
        response: verification?.response && typeof verification.response === 'object'
          ? verification.response
          : {},
      },
      providerPayload: {
        provider: 'FACEIO',
        status: rawStatus || null,
        confidence,
        auditId: verification?.auditId || null,
      },
      reviewReason: verified
        ? ''
        : !expectedFacialId
          ? 'Funcionario ainda nao cadastrou biometria facial no FACEIO.'
          : facialId && facialId !== expectedFacialId
            ? 'FACEIO autenticou um rosto diferente do funcionario logado.'
            : 'FACEIO nao confirmou a biometria facial/liveness.',
    }
  }

  const capture = body?.faceCapture && typeof body.faceCapture === 'object' ? body.faceCapture : null
  const frames = Array.isArray(capture?.frames) ? capture.frames.slice(0, 4) : []
  if (!capture || frames.length < 2) {
    return {
      faceProvider: settings.faceProvider,
      faceStatus: 'failed',
      faceScore: null,
      faceReferenceId: null,
      faceLivenessPassed: false,
      faceChallengeId: String(capture?.challengeId || '').slice(0, 80) || null,
      faceChallengePrompt: String(capture?.challengePrompt || '').slice(0, 180) || null,
      privacyAcknowledgedAt: capture?.privacyAcknowledgedAt || null,
      evidence: {
        reason: 'missing_capture',
        frameCount: frames.length,
      },
      providerPayload: {},
      reviewReason: 'Prova de vida facial obrigatoria nao foi capturada.',
    }
  }

  const evidenceFrames = await Promise.all(frames.map((frame: any, index: number) => sanitizeFaceFrame(frame, index)))
  const clientChecks = capture?.clientChecks && typeof capture.clientChecks === 'object' ? capture.clientChecks : {}
  const detectedFrames = Math.max(0, Number(clientChecks.detectedFrames || evidenceFrames.filter((frame) => frame.faceDetected).length))
  const movementScore = Math.max(0, Math.min(1, Number(clientChecks.movementScore || 0)))
  const browserLivenessPassed = clientChecks.browserLivenessPassed === true
  const baseEvidence = {
    mode: settings.faceLivenessMode,
    policyVersion: settings.facePolicyVersion,
    challengeId: String(capture.challengeId || '').slice(0, 80) || null,
    challengePrompt: String(capture.challengePrompt || '').slice(0, 180) || null,
    clientChecks: {
      cameraPermission: clientChecks.cameraPermission === true,
      faceDetectorAvailable: clientChecks.faceDetectorAvailable === true,
      detectedFrames,
      movementScore,
      browserLivenessPassed,
    },
    frameCount: evidenceFrames.length,
    frames: evidenceFrames,
    storedRawImage: false,
  }

  if (
    settings.faceLivenessMode === 'simple_liveness' ||
    settings.faceProvider === 'simple_liveness' ||
    settings.faceLivenessMode === 'manual_review' ||
    settings.faceProvider === 'manual_review'
  ) {
    const localFaceProfile = waiterSession.profile?.localFaceProfile && typeof waiterSession.profile.localFaceProfile === 'object'
      ? waiterSession.profile.localFaceProfile
      : null
    const enrollmentId = String(localFaceProfile?.enrollmentId || '').slice(0, 240)
    const enrolledAt = String(waiterSession.profile?.localFaceEnrolledAt || localFaceProfile?.enrolledAt || '')
    const hasEnrollment = Boolean(enrollmentId || enrolledAt)
    const minimumFrames = evidenceFrames.length >= 3
    const livenessPassed = minimumFrames && (browserLivenessPassed || detectedFrames >= 1 || movementScore >= 0.02)
    const faceStatus = hasEnrollment && livenessPassed ? 'verified' : 'failed'

    return {
      faceProvider: 'simple_liveness',
      faceStatus,
      faceScore: livenessPassed ? Math.max(0.65, Math.min(0.98, movementScore || 0.7)) : null,
      faceReferenceId: enrollmentId || null,
      faceLivenessPassed: livenessPassed,
      faceChallengeId: baseEvidence.challengeId,
      faceChallengePrompt: baseEvidence.challengePrompt,
      privacyAcknowledgedAt: capture.privacyAcknowledgedAt || null,
      evidence: {
        ...baseEvidence,
        hasEnrollment,
        enrollmentIdSha256: enrollmentId ? await sha256Hex(enrollmentId) : null,
        enrolledAt: enrolledAt || null,
      },
      providerPayload: {
        provider: 'popsystem_simple_liveness',
        enrollmentId: enrollmentId || null,
        status: faceStatus,
      },
      reviewReason: faceStatus === 'verified'
        ? ''
        : !hasEnrollment
          ? 'Funcionario ainda nao concluiu o cadastro facial inicial.'
          : 'Prova de vida facial incompleta. Refaca a captura antes de bater o ponto.',
    }
  }

  if (settings.faceLivenessMode === 'provider_webhook') {
    const providerUrl = Deno.env.get('TIME_CLOCK_FACE_PROVIDER_URL') || ''
    const providerToken = Deno.env.get('TIME_CLOCK_FACE_PROVIDER_TOKEN') || ''
    if (!providerUrl) {
      return {
        faceProvider: settings.faceProvider || 'provider_webhook',
        faceStatus: 'pending_review',
        faceScore: null,
        faceReferenceId: null,
        faceLivenessPassed: browserLivenessPassed,
        faceChallengeId: baseEvidence.challengeId,
        faceChallengePrompt: baseEvidence.challengePrompt,
        privacyAcknowledgedAt: capture.privacyAcknowledgedAt || null,
        evidence: { ...baseEvidence, providerConfigured: false },
        providerPayload: {},
        reviewReason: 'Prova de vida capturada, mas o provedor facial ainda nao foi configurado nos secrets.',
      }
    }

    try {
      const providerResponse = await fetch(providerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(providerToken ? { Authorization: `Bearer ${providerToken}` } : {}),
        },
        body: JSON.stringify({
          employee: {
            id: waiterSession.profile.id,
            name: waiterSession.profile.name,
            restaurantId: waiterSession.profile.restaurantId,
          },
          challenge: {
            id: baseEvidence.challengeId,
            prompt: baseEvidence.challengePrompt,
          },
          minScore: settings.faceMinScore,
          frames: settings.faceStoreEvidence ? frames : frames.map((frame: any) => ({
            step: frame?.step,
            capturedAt: frame?.capturedAt,
            dataUrl: frame?.dataUrl,
          })),
          clientChecks: baseEvidence.clientChecks,
        }),
      })
      const providerJson = await providerResponse.json().catch(() => ({}))
      const rawStatus = String(providerJson?.status || '').toLowerCase()
      const providerScore = toNumberOrNull(providerJson?.score)
      const passedByScore = providerScore !== null ? providerScore >= settings.faceMinScore : false
      const faceStatus = rawStatus === 'verified' && passedByScore
        ? 'verified'
        : rawStatus === 'failed' || (providerScore !== null && !passedByScore)
          ? 'failed'
          : 'pending_review'

      return {
        faceProvider: settings.faceProvider || 'provider_webhook',
        faceStatus,
        faceScore: providerScore,
        faceReferenceId: String(providerJson?.referenceId || providerJson?.id || '').slice(0, 240) || null,
        faceLivenessPassed: faceStatus === 'verified',
        faceChallengeId: baseEvidence.challengeId,
        faceChallengePrompt: baseEvidence.challengePrompt,
        privacyAcknowledgedAt: capture.privacyAcknowledgedAt || null,
        evidence: {
          ...baseEvidence,
          providerConfigured: true,
          providerStatusCode: providerResponse.status,
          providerStatus: rawStatus || null,
          providerReferenceId: String(providerJson?.referenceId || providerJson?.id || '').slice(0, 240) || null,
        },
        providerPayload: {
          status: rawStatus || null,
          score: providerScore,
          referenceId: providerJson?.referenceId || providerJson?.id || null,
        },
        reviewReason: faceStatus === 'verified'
          ? ''
          : faceStatus === 'failed'
            ? 'Biometria facial/liveness reprovada pelo provedor.'
            : 'Biometria facial/liveness pendente de verificacao do provedor.',
      }
    } catch (error) {
      return {
        faceProvider: settings.faceProvider || 'provider_webhook',
        faceStatus: 'pending_review',
        faceScore: null,
        faceReferenceId: null,
        faceLivenessPassed: browserLivenessPassed,
        faceChallengeId: baseEvidence.challengeId,
        faceChallengePrompt: baseEvidence.challengePrompt,
        privacyAcknowledgedAt: capture.privacyAcknowledgedAt || null,
        evidence: { ...baseEvidence, providerError: String((error as Error)?.message || error).slice(0, 300) },
        providerPayload: {},
        reviewReason: 'Prova de vida capturada, mas o provedor facial nao respondeu. Revisao manual necessaria.',
      }
    }
  }

  return {
    faceProvider: settings.faceProvider || 'manual_review',
    faceStatus: 'pending_review',
    faceScore: browserLivenessPassed ? Math.max(0.55, movementScore) : null,
    faceReferenceId: null,
    faceLivenessPassed: browserLivenessPassed,
    faceChallengeId: baseEvidence.challengeId,
    faceChallengePrompt: baseEvidence.challengePrompt,
    privacyAcknowledgedAt: capture.privacyAcknowledgedAt || null,
    evidence: baseEvidence,
    providerPayload: {},
    reviewReason: browserLivenessPassed
      ? 'Prova de vida capturada no aparelho e aguardando revisao manual.'
      : 'Prova de vida capturada, mas o navegador nao confirmou rosto/movimento com seguranca.',
  }
}

const orderStatusLabel: Record<string, string> = {
  pending: 'enviado',
  accepted: 'aceito',
  preparing: 'em preparo',
  ready: 'pronto',
  in_delivery: 'levou para mesa',
  delivered: 'mesa atendida',
  completed: 'finalizado',
  cancelled: 'cancelado',
}

const buildOptionsMap = (rows: any[]) => {
  const map = new Map<string, any[]>()

  rows.forEach((row) => {
    const current = map.get(row.order_item_id) ?? []
    current.push({
      id: row.id,
      orderItemId: row.order_item_id,
      optionName: row.option_name,
      price: normalizeAmount(row.price),
      quantity: Math.max(1, Number(row.quantity || 1)),
    })
    map.set(row.order_item_id, current)
  })

  return map
}

const buildItemTotal = (row: any, options: any[]) => {
  const unitPrice = normalizeAmount(row.unit_price)
  const quantity = Math.max(1, Number(row.quantity || 1))
  const optionsTotal = options.reduce((sum, option) => sum + normalizeAmount(option.price) * Math.max(1, Number(option.quantity || 1)), 0)
  return unitPrice * quantity + optionsTotal
}

const parseVariationOptions = (rawOptions: unknown, groupId: string) => {
  let parsedOptions = rawOptions

  if (typeof parsedOptions === 'string') {
    try {
      parsedOptions = JSON.parse(parsedOptions)
    } catch {
      parsedOptions = []
    }
  }

  if (!Array.isArray(parsedOptions)) return []

  return parsedOptions
    .filter((option: any) => option && typeof option === 'object' && String(option.name || '').trim() && option.active !== false)
    .map((option: any, index: number) => ({
      id: `${groupId}-${index}-${String(option.name).trim()}`,
      name: String(option.name).trim(),
      price: normalizeAmount(option.price),
    }))
}

const buildProductVariationGroups = (productId: string, specificRows: any[], linkRows: any[], globalRows: any[]) => {
  const directGroups = specificRows
    .filter((row) => row.product_id === productId && row.active !== false)
    .map((row) => ({
      id: row.id,
      name: String(row.name),
      required: Boolean(row.required),
      maxSelections: Math.max(1, Number(row.max_selections ?? 1)),
      displayOrder: Number.isFinite(Number(row.display_order)) ? Number(row.display_order) : 10_000,
      options: parseVariationOptions(row.options, String(row.id)),
    }))

  const links = linkRows.filter((row) => row.product_id === productId)
  const globalGroups = links
    .map((link) => {
      const globalRow = globalRows.find((row) => row.id === link.global_variation_id)
      if (!globalRow || globalRow.active === false) return null

      return {
        id: String(globalRow.id),
        name: String(globalRow.name),
        required: Boolean(link.required ?? globalRow.required),
        maxSelections: Math.max(1, Number(link.max_selections ?? globalRow.max_selections ?? 1)),
        displayOrder: Number.isFinite(Number(link.display_order ?? globalRow.display_order))
          ? Number(link.display_order ?? globalRow.display_order)
          : 10_000,
        options: parseVariationOptions(globalRow.options, String(globalRow.id)),
      }
    })
    .filter(Boolean)

  return [...directGroups, ...globalGroups]
    .filter((group: any) => Array.isArray(group.options) && group.options.length > 0)
    .sort((left: any, right: any) => {
      if (left.displayOrder !== right.displayOrder) return left.displayOrder - right.displayOrder
      return String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR')
    })
    .map(({ displayOrder, ...group }: any) => group)
}

const mapTableRecordStatus = (status?: string | null): TableStatus => {
  if (status === 'payment_pending') return 'check_requested'
  if (status === 'serving') return 'preparing'
  if (status === 'occupied' || status === 'reserved') return 'occupied'
  return 'free'
}

const mapOrderToKitchenStatus = (status?: string | null): KitchenStatus => {
  if (status === 'ready') return 'ready'
  if (status === 'preparing') return 'preparing'
  if (status === 'delivered' || status === 'completed' || status === 'in_delivery') return 'delivered'
  if (status === 'cancelled') return 'idle'
  return 'sent'
}

const mapOrderItemStatus = (itemStatus?: string | null, orderStatus?: string | null) => {
  if (itemStatus === 'draft') return 'draft'
  if (itemStatus === 'cancelled') return 'cancelled'
  if (orderStatus === 'preparing') return 'preparing'
  if (orderStatus === 'ready') return 'ready'
  if (orderStatus === 'delivered' || orderStatus === 'completed' || orderStatus === 'in_delivery') return 'delivered'
  if (orderStatus === 'cancelled') return 'cancelled'
  return 'sent'
}

const pickKitchenStatus = (statuses: KitchenStatus[]): KitchenStatus => {
  if (statuses.includes('ready')) return 'ready'
  if (statuses.includes('preparing')) return 'preparing'
  if (statuses.includes('sent')) return 'sent'
  if (statuses.includes('delivered')) return 'delivered'
  return 'idle'
}

const deriveAccountStatus = ({
  total,
  paidTotal,
  dueAmount,
  kitchenStatus,
  sessionStatus,
}: {
  total: number
  paidTotal: number
  dueAmount: number
  kitchenStatus: KitchenStatus
  sessionStatus: string
}): AccountStatus => {
  if (!isEffectivelyZero(total) && isEffectivelyZero(dueAmount)) return 'paid'
  if (paidTotal > EPSILON) return 'partially_paid'
  if (sessionStatus === 'payment_pending') return 'check_requested'
  if (kitchenStatus === 'ready') return 'ready'
  if (kitchenStatus === 'preparing' || kitchenStatus === 'sent') return 'preparing'
  return 'open'
}

const deriveTableStatus = ({
  hasSession,
  total,
  paidTotal,
  dueAmount,
  kitchenStatus,
  sessionStatus,
}: {
  hasSession: boolean
  total: number
  paidTotal: number
  dueAmount: number
  kitchenStatus: KitchenStatus
  sessionStatus: string
}): TableStatus => {
  if (!hasSession) return 'free'
  if (!isEffectivelyZero(total) && isEffectivelyZero(dueAmount)) return 'free'
  if (paidTotal > EPSILON) return 'partially_paid'
  if (sessionStatus === 'payment_pending') return 'check_requested'
  if (kitchenStatus === 'ready') return 'ready'
  if (kitchenStatus === 'preparing' || kitchenStatus === 'sent') return 'preparing'
  return 'occupied'
}

const resolveTableRecordStatus = ({
  hasSession,
  dueAmount,
}: {
  hasSession: boolean
  dueAmount: number
}) => {
  if (!hasSession || isEffectivelyZero(dueAmount)) return 'available'
  return 'occupied'
}

async function requireOpenCashSession(supabase: any, restaurantId: string) {
  const { data, error } = await supabase
    .from('cash_register_sessions')
    .select('id')
    .eq('user_id', restaurantId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error

  if (!data?.id) {
    return fail('Abra o caixa antes de operar mesas.', 400)
  }

  return null
}

async function listTransferTables(supabase: any, restaurantId: string, currentSessionId?: string) {
  const { data: tableRows, error: tableError } = await supabase
    .from('tables')
    .select('*')
    .eq('user_id', restaurantId)
    .order('table_number')

  if (tableError) throw tableError

  const { data: sessionRows, error: sessionError } = await supabase
    .from('table_sessions')
    .select('id, table_id, status')
    .eq('user_id', restaurantId)
    .in('status', ['open', 'serving', 'payment_pending'])

  if (sessionError) throw sessionError

  const sessionByTableId = new Map<string, any>()
  ;(sessionRows ?? []).forEach((row: any) => {
    sessionByTableId.set(row.table_id, row)
  })

  return (tableRows ?? []).map((row: any) => {
    const session = sessionByTableId.get(row.id)
    const isCurrentSession = Boolean(session?.id && currentSessionId && session.id === currentSessionId)

    return {
      id: row.id,
      number: Number(row.table_number),
      location: row.location,
      capacity: Number(row.capacity ?? 0),
      status: isCurrentSession ? 'current' : session ? 'occupied' : 'free',
      sessionId: session?.id ?? null,
      canReceiveTableTransfer: !session || isCurrentSession,
      canReceiveAccountTransfer: !session || session.id !== currentSessionId,
    }
  })
}

async function getServiceChargeSettings(supabase: any, restaurantId: string) {
  const { data, error } = await supabase
    .from('waiter_service_charge_settings')
    .select('enabled, auto_apply, percentage, tax_withhold_percent')
    .eq('user_id', restaurantId)
    .maybeSingle()

  if (error) {
    console.warn('waiter_service_charge_settings unavailable:', error?.message || error)
  }

  return {
    enabled: data?.enabled !== false,
    autoApply: Boolean(data?.auto_apply),
    percentage: Math.max(0, Number(data?.percentage ?? 10)),
    taxWithholdPercent: Math.max(0, Number(data?.tax_withhold_percent ?? 0)),
  }
}

async function getNextAccountNumber(supabase: any, sessionId: string) {
  const { data, error } = await supabase
    .from('table_accounts')
    .select('account_number')
    .eq('session_id', sessionId)
    .order('account_number', { ascending: false })
    .limit(1)

  if (error) throw error

  return Number(data?.[0]?.account_number ?? 0) + 1
}

async function getSessionSnapshot(supabase: any, sessionId: string) {
  const { data: sessionRow, error: sessionError } = await supabase
    .from('table_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (sessionError) throw sessionError

  const { data: tableRow, error: tableError } = await supabase
    .from('tables')
    .select('*')
    .eq('id', sessionRow.table_id)
    .single()

  if (tableError) throw tableError

  const { data: accountRows, error: accountError } = await supabase
    .from('table_accounts')
    .select('*')
    .eq('session_id', sessionId)
    .order('account_number')

  if (accountError) throw accountError

  const accountIds = (accountRows ?? []).map((row: any) => row.id)
  const commandIds = (accountRows ?? [])
    .map((row: any) => row.electronic_command_id)
    .filter(Boolean)

  const { data: commandRows, error: commandError } = commandIds.length
    ? await supabase
        .from('electronic_commands')
        .select('id,code,label')
        .in('id', commandIds)
    : { data: [], error: null }

  if (commandError) throw commandError

  const { data: itemRows, error: itemError } = accountIds.length
    ? await supabase
        .from('order_items')
        .select('*')
        .in('account_id', accountIds)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: true })
    : { data: [], error: null }

  if (itemError) throw itemError

  const itemIds = (itemRows ?? []).map((row: any) => row.id)

  const { data: optionRows, error: optionError } = itemIds.length
    ? await supabase
        .from('order_item_options')
        .select('*')
        .in('order_item_id', itemIds)
    : { data: [], error: null }

  if (optionError) throw optionError

  const { data: paymentRows, error: paymentError } = await supabase
    .from('payments')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (paymentError) throw paymentError

  const { data: orderRows, error: orderError } = await supabase
    .from('orders')
    .select('id, session_id, account_id, table_id, order_number, status, created_at, updated_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (orderError) throw orderError

  return {
    sessionRow,
    tableRow,
    accountRows: accountRows ?? [],
    commandRows: commandRows ?? [],
    itemRows: itemRows ?? [],
    optionRows: optionRows ?? [],
    paymentRows: paymentRows ?? [],
    orderRows: orderRows ?? [],
  }
}

function buildSessionMetrics(snapshot: Awaited<ReturnType<typeof getSessionSnapshot>>) {
  const optionsMap = buildOptionsMap(snapshot.optionRows)
  const commandsById = new Map(snapshot.commandRows.map((row: any) => [row.id, row]))
  const ordersById = new Map<string, any>()
  const ordersByAccount = new Map<string, any[]>()
  const itemsByAccount = new Map<string, any[]>()
  const paymentsByAccount = new Map<string, any[]>()
  const paidAmountByAccount = new Map<string, number>()
  const orderTicketsByAccount = new Map<string, any[]>()

  snapshot.orderRows.forEach((row: any) => {
    ordersById.set(row.id, row)
    if (!row.account_id) return
    const current = ordersByAccount.get(row.account_id) ?? []
    current.push(row)
    ordersByAccount.set(row.account_id, current)
  })

  snapshot.paymentRows.forEach((row: any) => {
    if (!row.account_id) return
    const current = paymentsByAccount.get(row.account_id) ?? []
    current.push(row)
    paymentsByAccount.set(row.account_id, current)
    paidAmountByAccount.set(row.account_id, (paidAmountByAccount.get(row.account_id) ?? 0) + normalizeAmount(row.amount))
  })

  const items = snapshot.itemRows.map((row: any) => {
    const options = optionsMap.get(row.id) ?? []
    const order = row.order_id ? ordersById.get(row.order_id) : null
    const status = mapOrderItemStatus(row.status, order?.status)
    const kitchenStatus = status === 'draft' || status === 'cancelled' || !order ? 'idle' : mapOrderToKitchenStatus(order?.status)

    const item = {
      id: row.id,
      sessionId: row.session_id,
      accountId: row.account_id,
      orderId: row.order_id ?? null,
      orderStatus: order?.status ?? null,
      productId: row.product_id,
      productName: row.product_name,
      quantity: Math.max(1, Number(row.quantity || 1)),
      unitPrice: normalizeAmount(row.unit_price),
      totalPrice: buildItemTotal(row, options),
      notes: row.notes || '',
      status,
      kitchenStatus,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      options,
    }

    const current = itemsByAccount.get(row.account_id) ?? []
    current.push(item)
    itemsByAccount.set(row.account_id, current)

    return item
  })

  const accounts = snapshot.accountRows.map((row: any) => {
    const accountItems = itemsByAccount.get(row.id) ?? []
    const accountOrders = ordersByAccount.get(row.id) ?? []
    const accountPayments = paymentsByAccount.get(row.id) ?? []
    const total = normalizeAmount(row.total)
    const paidTotal = normalizeAmount(paidAmountByAccount.get(row.id))
    const dueAmount = Math.max(total - paidTotal, 0)
    const draftCount = accountItems.filter((item) => item.status === 'draft').length
    const sentCount = accountItems.filter((item) => ['sent', 'preparing', 'ready', 'delivered'].includes(item.status)).length
    const readyCount = accountItems.filter((item) => item.status === 'ready').length
    const deliveredCount = accountItems.filter((item) => item.status === 'delivered').length
    const kitchenStatus = pickKitchenStatus(accountItems.map((item) => item.kitchenStatus).filter(Boolean))
    const status = deriveAccountStatus({
      total,
      paidTotal,
      dueAmount,
      kitchenStatus,
      sessionStatus: String(snapshot.sessionRow.status || 'open'),
    })

    const tickets = accountOrders.map((order: any) => {
      const relatedItems = accountItems.filter((item) => item.orderId === order.id)
      return {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        itemCount: relatedItems.length,
      }
    })

    orderTicketsByAccount.set(row.id, tickets)

    return {
      id: row.id,
      sessionId: row.session_id,
      name: row.name || `Conta ${row.account_number ?? 1}`,
      notes: '',
      accountNumber: Number(row.account_number ?? 0),
      commandCode: row.electronic_command_id ? commandsById.get(row.electronic_command_id)?.code ?? null : null,
      commandLabel: row.electronic_command_id ? commandsById.get(row.electronic_command_id)?.label ?? null : null,
      total,
      paidTotal,
      dueAmount,
      status,
      kitchenStatus,
      itemCount: accountItems.length,
      draftCount,
      sentCount,
      readyCount,
      deliveredCount,
      payments: accountPayments.map((payment: any) => ({
        id: payment.id,
        sessionId: payment.session_id,
        accountId: payment.account_id,
        method: payment.method,
        amount: normalizeAmount(payment.amount),
        createdAt: payment.created_at,
        provider: payment.provider ?? payment.metadata?.provider ?? null,
        transactionId: payment.transaction_id ?? payment.metadata?.transaction_id ?? payment.metadata?.transactionId ?? null,
        atk: payment.atk ?? payment.metadata?.atk ?? null,
        nsu: payment.nsu ?? payment.metadata?.nsu ?? null,
        authorizationCode: payment.authorization_code ?? payment.metadata?.authorization_code ?? payment.metadata?.authorizationCode ?? null,
        installments: payment.installments ?? payment.metadata?.installments ?? null,
        status: payment.status ?? payment.metadata?.status ?? null,
        deviceId: payment.device_id ?? payment.metadata?.device_id ?? payment.metadata?.deviceId ?? null,
        terminal: payment.terminal ?? payment.metadata?.terminal ?? null,
        stoneCode: payment.stone_code ?? payment.metadata?.stone_code ?? payment.metadata?.stoneCode ?? null,
        receiptText: payment.receipt_text ?? payment.metadata?.receiptText ?? null,
      })),
      tickets,
      items: accountItems,
    }
  })

  const total = accounts.reduce((sum: number, account: any) => sum + account.total, 0)
  const paidTotal = accounts.reduce((sum: number, account: any) => sum + account.paidTotal, 0)
  const dueAmount = Math.max(total - paidTotal, 0)
  const itemCount = accounts.reduce((sum: number, account: any) => sum + account.itemCount, 0)
  const sentItemsCount = accounts.reduce((sum: number, account: any) => sum + account.sentCount, 0)
  const readyItemsCount = accounts.reduce((sum: number, account: any) => sum + account.readyCount, 0)
  const deliveredItemsCount = accounts.reduce((sum: number, account: any) => sum + account.deliveredCount, 0)
  const kitchenStatus = pickKitchenStatus(accounts.map((account: any) => account.kitchenStatus).filter(Boolean))
  const tableStatus = deriveTableStatus({
    hasSession: true,
    total,
    paidTotal,
    dueAmount,
    kitchenStatus,
    sessionStatus: String(snapshot.sessionRow.status || 'open'),
  })

  const history = [
    ...items.map((item: any) => ({
      id: `item-${item.id}`,
      type: 'item',
      label: `${item.quantity}x ${item.productName}`,
      timestamp: item.sentAt ?? item.createdAt,
      amount: item.totalPrice,
    })),
    ...snapshot.paymentRows.map((payment: any) => ({
      id: `payment-${payment.id}`,
      type: 'payment',
      label: `Pagamento ${String(payment.method).toUpperCase()}`,
      timestamp: payment.created_at,
      amount: normalizeAmount(payment.amount),
    })),
    ...snapshot.orderRows.map((order: any) => ({
      id: `order-${order.id}`,
      type: 'status',
      label: `Pedido ${order.order_number || ''} ${orderStatusLabel[String(order.status || '').toLowerCase()] || 'atualizado'}`.trim(),
      timestamp: order.updated_at || order.created_at,
    })),
  ].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())

  return {
    accounts,
    total,
    paidTotal,
    dueAmount,
    itemCount,
    sentItemsCount,
    readyItemsCount,
    deliveredItemsCount,
    kitchenStatus,
    tableStatus,
    history,
  }
}

async function sendAccountDraftItemsToKitchen(
  supabase: any,
  waiterSession: any,
  sessionId: string,
  accountId: string,
) {
  const draftRows = await supabase
    .from('order_items')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'draft')
    .order('created_at', { ascending: true })

  if (draftRows.error) throw draftRows.error
  if (!draftRows.data?.length) {
    return {
      sent: false,
      accountName: '',
      itemCount: 0,
    }
  }

  const { data: accountRow, error: accountError } = await supabase
    .from('table_accounts')
    .select('id, name, session_id')
    .eq('id', accountId)
    .single()

  if (accountError) throw accountError

  const { data: sessionRow, error: sessionError } = await supabase
    .from('table_sessions')
    .select('table_id')
    .eq('id', sessionId)
    .single()

  if (sessionError) throw sessionError

  const { data: tableRow, error: tableError } = await supabase
    .from('tables')
    .select('table_number, location')
    .eq('id', sessionRow.table_id)
    .single()

  if (tableError) throw tableError

  const itemIds = draftRows.data.map((row: any) => row.id)
  const optionRows = itemIds.length
    ? await supabase
        .from('order_item_options')
        .select('*')
        .in('order_item_id', itemIds)
    : { data: [], error: null }

  if (optionRows.error) throw optionRows.error

  const productIds = Array.from(new Set(draftRows.data.map((row: any) => String(row.product_id || '')).filter(Boolean)))
  const { data: productRows, error: productRowsError } = productIds.length
    ? await supabase
        .from('products')
        .select('id, send_to_kds')
        .in('id', productIds)
        .eq('user_id', waiterSession.profile.restaurantId)
    : { data: [], error: null }

  if (productRowsError) throw productRowsError

  const tableFlow = await getTableOrderFlowSettings(supabase, waiterSession.profile.restaurantId)
  const kdsProductIds = new Set(
    (productRows ?? []).filter((row: any) => row.send_to_kds === true).map((row: any) => String(row.id)),
  )
  const shouldCreateManagerOrder = tableFlow.mode !== 'account_only' && tableFlow.showInManager
  // Em bases antigas, nenhum produto possuía a marca send_to_kds. Nesse caso,
  // "itens marcados" acabava descartando a comanda inteira sem criar pedido.
  // O fallback mantém a intenção operacional: enviar a comanda completa.
  const effectiveMode = tableFlow.mode === 'marked_items' && kdsProductIds.size === 0
    ? 'all_items'
    : tableFlow.mode
  const kitchenRows = !shouldCreateManagerOrder
    ? []
    : effectiveMode === 'all_items'
      ? draftRows.data
      : draftRows.data.filter((row: any) => kdsProductIds.has(String(row.product_id)))

  const optionsMap = buildOptionsMap(optionRows.data ?? [])
  const orderItems = kitchenRows.map((row: any) => {
    const options = optionsMap.get(row.id) ?? []
    return {
      product_id: row.product_id,
      product_name: row.product_name,
      quantity: Math.max(1, Number(row.quantity || 1)),
      price: normalizeAmount(row.unit_price),
      subtotal: buildItemTotal(row, options),
      options: options.map((option: any) => option.optionName),
      notes: row.notes || '',
      account_name: accountRow.name,
      table_number: Number(tableRow.table_number),
    }
  })

  const total = orderItems.reduce((sum: number, item: any) => sum + normalizeAmount(item.subtotal), 0)
  let orderRow: any = null

  if (orderItems.length > 0) {
    const orderNumber = `M${tableRow.table_number}-${Date.now().toString().slice(-5)}-${String(accountId).slice(0, 4)}`

    const { data: createdOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: waiterSession.profile.restaurantId,
        order_number: orderNumber,
        customer_name: `Mesa ${tableRow.table_number} - ${accountRow.name}`,
        table_id: sessionRow.table_id,
        items: orderItems,
        total,
        order_type: 'dine_in',
        payment_method: 'pendente',
        status: tableFlow.autoAccept ? 'preparing' : 'pending',
        acceptance_status: tableFlow.autoAccept ? 'accepted' : 'pending_acceptance',
        session_id: sessionId,
        account_id: accountId,
        waiter_id: waiterSession.profile.id,
        variations: {
          source: 'WAITER_WEB_TABLE',
          table_order_flow: tableFlow.mode,
          show_in_manager: tableFlow.showInManager,
          auto_accept: tableFlow.autoAccept,
        },
      })
      .select('id')
      .single()

    if (orderError) throw orderError
    orderRow = createdOrder
  }

  const { error: updateError } = await supabase
    .from('order_items')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .in('id', itemIds)

  if (updateError) throw updateError

  if (orderRow?.id && kitchenRows.length > 0) {
    const { error: kitchenUpdateError } = await supabase
      .from('order_items')
      .update({ order_id: orderRow.id })
      .in('id', kitchenRows.map((row: any) => row.id))

    if (kitchenUpdateError) throw kitchenUpdateError
  }

  return {
    sent: true,
    accountName: String(accountRow.name || ''),
    itemCount: draftRows.data.length,
    kitchenItemCount: kitchenRows.length,
    tableOrderMode: effectiveMode,
  }
}

async function refreshAccountTotal(supabase: any, accountId: string) {
  const { data: itemRows, error: itemError } = await supabase
    .from('order_items')
    .select('id, quantity, unit_price, status')
    .eq('account_id', accountId)
    .neq('status', 'cancelled')

  if (itemError) throw itemError

  const itemIds = (itemRows ?? []).map((row: any) => row.id)
  const { data: optionRows, error: optionError } = itemIds.length
    ? await supabase
        .from('order_item_options')
        .select('*')
        .in('order_item_id', itemIds)
    : { data: [], error: null }

  if (optionError) throw optionError

  const optionsMap = buildOptionsMap(optionRows ?? [])
  const total = (itemRows ?? []).reduce((sum: number, row: any) => {
    const options = optionsMap.get(row.id) ?? []
    return sum + buildItemTotal(row, options)
  }, 0)

  const { error: updateError } = await supabase
    .from('table_accounts')
    .update({ total })
    .eq('id', accountId)

  if (updateError) throw updateError
}

async function refreshAccountTotals(supabase: any, accountIds: string[]) {
  for (const accountId of accountIds) {
    await refreshAccountTotal(supabase, accountId)
  }
}

async function refreshSessionStatus(supabase: any, sessionId: string) {
  const snapshot = await getSessionSnapshot(supabase, sessionId)
  const metrics = buildSessionMetrics(snapshot)

  const accountUpdates = snapshot.accountRows.map((row: any) => {
    const account = metrics.accounts.find((item: any) => item.id === row.id)
    const nextStatus = account?.status === 'paid' ? 'paid' : 'open'

    return supabase
      .from('table_accounts')
      .update({
        status: nextStatus,
        paid_at: nextStatus === 'paid' ? row.paid_at || new Date().toISOString() : null,
      })
      .eq('id', row.id)
  })

  for (const request of accountUpdates) {
    const { error } = await request
    if (error) throw error
  }

  let nextSessionStatus = 'open'

  if (snapshot.accountRows.length === 0 || (metrics.total > 0 && isEffectivelyZero(metrics.dueAmount))) {
    nextSessionStatus = 'closed'
  } else if (String(snapshot.sessionRow.status) === 'payment_pending') {
    nextSessionStatus = 'payment_pending'
  } else if (metrics.kitchenStatus === 'ready' || metrics.kitchenStatus === 'preparing' || metrics.kitchenStatus === 'sent') {
    nextSessionStatus = 'serving'
  }

  const nextTableStatus = resolveTableRecordStatus({
    hasSession: nextSessionStatus !== 'closed',
    dueAmount: metrics.dueAmount,
  })

  const { error: updateSessionError } = await supabase
    .from('table_sessions')
    .update({
      status: nextSessionStatus,
      closed_at: nextSessionStatus === 'closed' ? new Date().toISOString() : null,
    })
    .eq('id', sessionId)

  if (updateSessionError) throw updateSessionError

  const { error: updateTableError } = await supabase
    .from('tables')
    .update({ status: nextTableStatus })
    .eq('id', snapshot.sessionRow.table_id)

  if (updateTableError) throw updateTableError

  return {
    ...metrics,
    sessionStatus: nextSessionStatus,
  }
}

async function buildSessionResponse(supabase: any, restaurantId: string, sessionId: string) {
  const snapshot = await getSessionSnapshot(supabase, sessionId)
  const metrics = buildSessionMetrics(snapshot)
  const tableChoices = await listTransferTables(supabase, restaurantId, sessionId)
  const serviceChargeSettings = await getServiceChargeSettings(supabase, restaurantId)

  return {
    id: snapshot.sessionRow.id,
    tableId: snapshot.sessionRow.table_id,
    tableNumber: Number(snapshot.tableRow.table_number),
    tableLabel: snapshot.tableRow.location ? `Mesa ${snapshot.tableRow.table_number} - ${snapshot.tableRow.location}` : `Mesa ${snapshot.tableRow.table_number}`,
    openedAt: snapshot.sessionRow.opened_at,
    closedAt: snapshot.sessionRow.closed_at,
    guestCount: Math.max(1, Number((snapshot.sessionRow.guest_count ?? metrics.accounts.length) || 1)),
    status: snapshot.sessionRow.status,
    notes: '',
    total: metrics.total,
    paidTotal: metrics.paidTotal,
    dueAmount: metrics.dueAmount,
    itemCount: metrics.itemCount,
    sentItemsCount: metrics.sentItemsCount,
    readyItemsCount: metrics.readyItemsCount,
    accountCount: metrics.accounts.length,
    accounts: metrics.accounts,
    history: metrics.history,
    tableChoices,
    serviceChargeSettings,
  }
}

async function listRestaurantTables(supabase: any, restaurantId: string) {
  const { data: tableRows, error: tableError } = await supabase
    .from('tables')
    .select('*')
    .eq('user_id', restaurantId)
    .order('table_number')

  if (tableError) throw tableError

  const { data: sessionRows, error: sessionError } = await supabase
    .from('table_sessions')
    .select('id, table_id, opened_at, status')
    .eq('user_id', restaurantId)
    .in('status', ['open', 'serving', 'payment_pending'])
    .order('opened_at', { ascending: false })

  if (sessionError) throw sessionError

  const activeSessions = sessionRows ?? []
  const latestSessionByTable = new Map<string, any>()
  activeSessions.forEach((row: any) => {
    if (!latestSessionByTable.has(row.table_id)) latestSessionByTable.set(row.table_id, row)
  })

  const sessionIds = activeSessions.map((row: any) => row.id)

  const { data: accountRows, error: accountError } = sessionIds.length
    ? await supabase
        .from('table_accounts')
        .select('id, session_id, total, status')
        .in('session_id', sessionIds)
    : { data: [], error: null }

  if (accountError) throw accountError

  const { data: paymentRows, error: paymentError } = sessionIds.length
    ? await supabase
        .from('payments')
        .select('session_id, account_id, amount')
        .in('session_id', sessionIds)
    : { data: [], error: null }

  if (paymentError) throw paymentError

  const { data: orderRows, error: orderError } = sessionIds.length
    ? await supabase
        .from('orders')
        .select('id, session_id, account_id, status')
        .in('session_id', sessionIds)
    : { data: [], error: null }

  if (orderError) throw orderError

  const { data: itemRows, error: itemError } = sessionIds.length
    ? await supabase
        .from('order_items')
        .select('id, session_id, account_id, status, order_id')
        .in('session_id', sessionIds)
        .neq('status', 'cancelled')
    : { data: [], error: null }

  if (itemError) throw itemError

  const legacyAccountsResult = await supabase
    .from('table_accounts')
    .select('id, table_id, total, status, updated_at, session_id')
    .eq('user_id', restaurantId)
    .order('updated_at', { ascending: false })

  const legacyRows = legacyAccountsResult.error ? [] : (legacyAccountsResult.data ?? [])

  const ordersById = new Map<string, any>()
  ;(orderRows ?? []).forEach((row: any) => ordersById.set(row.id, row))

  const accountsBySession = new Map<string, any[]>()
  ;(accountRows ?? []).forEach((row: any) => {
    const current = accountsBySession.get(row.session_id) ?? []
    current.push(row)
    accountsBySession.set(row.session_id, current)
  })

  const paymentsBySession = new Map<string, any[]>()
  ;(paymentRows ?? []).forEach((row: any) => {
    const current = paymentsBySession.get(row.session_id) ?? []
    current.push(row)
    paymentsBySession.set(row.session_id, current)
  })

  const itemsBySession = new Map<string, any[]>()
  ;(itemRows ?? []).forEach((row: any) => {
    const current = itemsBySession.get(row.session_id) ?? []
    current.push(row)
    itemsBySession.set(row.session_id, current)
  })

  const legacyTotalsByTable = new Map<string, number>()
  const legacyAccountCountByTable = new Map<string, number>()
  legacyRows.forEach((row: any) => {
    if (row.session_id) return
    const status = String(row.status || '').toLowerCase()
    if (status === 'closed' || status === 'paid') return
    legacyTotalsByTable.set(row.table_id, (legacyTotalsByTable.get(row.table_id) ?? 0) + normalizeAmount(row.total))
    legacyAccountCountByTable.set(row.table_id, (legacyAccountCountByTable.get(row.table_id) ?? 0) + 1)
  })

  return (tableRows ?? []).map((row: any) => {
    const session = latestSessionByTable.get(row.id)

    if (!session) {
      return {
        id: row.id,
        number: Number(row.table_number),
        label: row.location ? `Mesa ${row.table_number} - ${row.location}` : `Mesa ${row.table_number}`,
        capacity: Number(row.capacity ?? 0),
        location: row.location,
        status: legacyTotalsByTable.get(row.id) ? 'occupied' : mapTableRecordStatus(row.status),
        total: legacyTotalsByTable.get(row.id) ?? 0,
        paidTotal: 0,
        dueAmount: legacyTotalsByTable.get(row.id) ?? 0,
        openMinutes: 0,
        sessionId: null,
        accountCount: legacyAccountCountByTable.get(row.id) ?? 0,
        itemCount: 0,
        sentItemsCount: 0,
        readyItemsCount: 0,
        notes: '',
      }
    }

    const sessionAccounts = accountsBySession.get(session.id) ?? []
    const sessionPayments = paymentsBySession.get(session.id) ?? []
    const sessionItems = itemsBySession.get(session.id) ?? []
    const rawPaidByAccount = new Map<string, number>()

    sessionPayments.forEach((payment: any) => {
      if (!payment.account_id) return
      rawPaidByAccount.set(payment.account_id, (rawPaidByAccount.get(payment.account_id) ?? 0) + normalizeAmount(payment.amount))
    })

    const total = sessionAccounts.reduce((sum: number, account: any) => sum + normalizeAmount(account.total), 0)
    const paidTotal = Array.from(rawPaidByAccount.values()).reduce((sum, amount) => sum + amount, 0)
    const dueAmount = Math.max(total - paidTotal, 0)
    const kitchenStatuses = sessionItems.map((item: any) => {
      const order = item.order_id ? ordersById.get(item.order_id) : null
      return order ? mapOrderToKitchenStatus(order.status) : 'idle'
    })
    const kitchenStatus = pickKitchenStatus(kitchenStatuses.filter(Boolean))
    const itemCount = sessionItems.length
    const sentItemsCount = sessionItems.filter((item: any) => mapOrderItemStatus(item.status, ordersById.get(item.order_id)?.status) !== 'draft').length
    const readyItemsCount = sessionItems.filter((item: any) => mapOrderItemStatus(item.status, ordersById.get(item.order_id)?.status) === 'ready').length

    return {
      id: row.id,
      number: Number(row.table_number),
      label: row.location ? `Mesa ${row.table_number} - ${row.location}` : `Mesa ${row.table_number}`,
      capacity: Number(row.capacity ?? 0),
      location: row.location,
      status: deriveTableStatus({
        hasSession: true,
        total,
        paidTotal,
        dueAmount,
        kitchenStatus,
        sessionStatus: String(session.status || 'open'),
      }),
      total,
      paidTotal,
      dueAmount,
      openMinutes: session.opened_at ? minutesSince(session.opened_at) : 0,
      sessionId: session.id,
      accountCount: sessionAccounts.length,
      itemCount,
      sentItemsCount,
      readyItemsCount,
      notes: '',
    }
  })
}

async function listCatalog(supabase: any, restaurantId: string) {
  const { data: categoryRows, error: categoryError } = await supabase
    .from('product_categories')
    .select('*')
    .eq('user_id', restaurantId)
    .order('display_order', { ascending: true })

  if (categoryError) throw categoryError

  const { data: productRows, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', restaurantId)
    .eq('show_in_pdv', true)
    .order('name', { ascending: true })

  if (productError) throw productError

  const productIds = (productRows ?? []).map((row: any) => row.id)
  const effectivePrices = await resolveWaiterPrices(supabase, restaurantId, productIds)

  const { data: specificRows, error: specificError } = productIds.length
    ? await supabase
        .from('product_variations')
        .select('*')
        .in('product_id', productIds)
    : { data: [], error: null }

  if (specificError) throw specificError

  const { data: linkRows, error: linkError } = productIds.length
    ? await supabase
        .from('product_global_variation_links')
        .select('*')
        .in('product_id', productIds)
    : { data: [], error: null }

  if (linkError) throw linkError

  const globalIds = (linkRows ?? []).map((row: any) => row.global_variation_id)
  const { data: globalRows, error: globalError } = globalIds.length
    ? await supabase
        .from('global_variations')
        .select('*')
        .in('id', globalIds)
    : { data: [], error: null }

  if (globalError) throw globalError

  const products = (productRows ?? []).map((row: any) => ({
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    price: effectivePrices.get(String(row.id)) ?? normalizeAmount(row.price),
    featured: Boolean(row.featured ?? row.is_featured),
    sendToKds: Boolean(row.send_to_kds ?? true),
    variations: buildProductVariationGroups(row.id, specificRows ?? [], linkRows ?? [], globalRows ?? []),
  }))

  const categories = (categoryRows ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    products: products.filter((product: any) => product.categoryId === row.id),
  }))

  const favorites = {
    id: 'favorites',
    name: 'Destaques',
    products: products.filter((product: any) => product.featured),
  }

  return favorites.products.length ? [favorites, ...categories] : categories
}

async function resolveWaiterPrices(supabase: any, restaurantId: string, productIds: string[]) {
  const prices = new Map<string, number>()
  if (!productIds.length) return prices

  const { data, error } = await supabase.rpc('resolve_product_prices', {
    p_user_id: restaurantId,
    p_channel: 'waiter',
    p_product_ids: productIds,
    p_at: new Date().toISOString(),
  })

  // Price rules are an enhancement. A temporary resolver failure must not stop
  // the waiter from opening a table or adding products.
  if (error) {
    console.warn('[waiter-web] promotional price resolver unavailable:', error?.message || error)
    return prices
  }

  for (const row of data ?? []) {
    const price = Number(row?.effective_price)
    if (row?.product_id && Number.isFinite(price)) prices.set(String(row.product_id), Math.max(0, price))
  }
  return prices
}

async function ensureTableIsFree(supabase: any, tableId: string, restaurantId: string, ignoreSessionId?: string) {
  const { data, error } = await supabase
    .from('table_sessions')
    .select('id')
    .eq('user_id', restaurantId)
    .eq('table_id', tableId)
    .in('status', ['open', 'serving', 'payment_pending'])

  if (error) throw error

  const blocking = (data ?? []).find((row: any) => row.id !== ignoreSessionId)
  if (blocking?.id) return false
  return true
}

async function getTimeClockSettings(supabase: any, restaurantId: string) {
  const { data, error } = await supabase
    .from('employee_time_clock_settings')
    .select('*')
    .eq('user_id', restaurantId)
    .maybeSingle()

  if (error) {
    console.warn('employee_time_clock_settings unavailable:', error?.message || error)
  }

  return {
    enabled: data?.enabled !== false,
    requireLocation: data?.require_location !== false,
    requireFaceLiveness: data?.require_face_liveness !== false,
    requireDeviceBinding: data?.require_device_binding !== false,
    allowOutsideRadius: data?.allow_outside_radius === true,
    restaurantLatitude: toNumberOrNull(data?.restaurant_latitude),
    restaurantLongitude: toNumberOrNull(data?.restaurant_longitude),
    allowedRadiusMeters: Math.max(20, Number(data?.allowed_radius_meters ?? 120)),
    faceProvider: String(data?.face_provider || (data?.face_liveness_mode === 'faceio' ? 'faceio' : 'simple_liveness')),
    faceLivenessMode: String(data?.face_liveness_mode || (data?.face_provider === 'faceio' ? 'faceio' : 'simple_liveness')),
    faceMinScore: Math.max(0.1, Math.min(0.99, Number(data?.face_min_score ?? 0.75))),
    faceStoreEvidence: data?.face_store_evidence === true,
    facePolicyVersion: String(data?.face_policy_version || '2026-05-lgpd-v1'),
    policyNotice: data?.policy_notice || null,
  }
}

async function getTimeClockStatus(supabase: any, waiterSession: any) {
  const settings = await getTimeClockSettings(supabase, waiterSession.profile.restaurantId)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: events, error } = await supabase
    .from('employee_time_clock_events')
    .select('*')
    .eq('user_id', waiterSession.profile.restaurantId)
    .eq('waiter_id', waiterSession.profile.id)
    .gte('occurred_at', today.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(20)

  if (error) throw error

  const lastEvent = events?.[0] || null
  const nextEventType =
    !lastEvent || lastEvent.event_type === 'clock_out'
      ? 'clock_in'
      : lastEvent.event_type === 'clock_in'
        ? 'break_start'
        : lastEvent.event_type === 'break_start'
          ? 'break_end'
          : 'clock_out'

  return {
    settings,
    lastEvent,
    todayEvents: events ?? [],
    nextEventType,
  }
}

async function punchTimeClock(supabase: any, waiterSession: any, body: any) {
  const settings = await getTimeClockSettings(supabase, waiterSession.profile.restaurantId)
  if (!settings.enabled) return fail('Controle de ponto desativado para este restaurante.', 400)

  const eventType = String(body?.eventType || '')
  if (!['clock_in', 'break_start', 'break_end', 'clock_out'].includes(eventType)) {
    return fail('Tipo de ponto invalido.', 400)
  }

  const latitude = toNumberOrNull(body?.latitude)
  const longitude = toNumberOrNull(body?.longitude)
  const accuracyMeters = toNumberOrNull(body?.accuracyMeters)
  if (settings.requireLocation && (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)))) {
    return fail('Localizacao obrigatoria para bater ponto.', 400)
  }

  const distanceMeters = calculateDistanceMeters(latitude, longitude, settings.restaurantLatitude, settings.restaurantLongitude)
  const hasGeofence = Number.isFinite(Number(distanceMeters))
  const withinGeofence = hasGeofence ? Number(distanceMeters) <= settings.allowedRadiusMeters : null
  const outsideBlocked = settings.requireLocation && hasGeofence && withinGeofence === false && !settings.allowOutsideRadius
  const faceAnalysis = await analyzeTimeClockFaceCapture(settings, waiterSession, body)
  const faceStatus = faceAnalysis.faceStatus

  const status = outsideBlocked || faceStatus === 'failed'
    ? 'rejected'
    : faceStatus === 'pending_review'
      ? 'pending_review'
      : 'approved'

  const reviewReasons = [
    outsideBlocked ? `Fora do raio permitido (${Math.round(Number(distanceMeters || 0))}m de ${settings.allowedRadiusMeters}m).` : '',
    faceAnalysis.reviewReason,
  ].filter(Boolean)

  const deviceFingerprint = String(body?.deviceFingerprint || '').trim().slice(0, 160)
  let deviceTrusted = true
  if (settings.requireDeviceBinding && deviceFingerprint) {
    const { data: deviceRow, error: deviceError } = await supabase
      .from('employee_time_clock_devices')
      .upsert({
        user_id: waiterSession.profile.restaurantId,
        waiter_id: waiterSession.profile.id,
        device_fingerprint: deviceFingerprint,
        device_label: String(body?.deviceLabel || '').trim().slice(0, 120) || null,
        last_seen_at: new Date().toISOString(),
        metadata: body?.deviceMetadata && typeof body.deviceMetadata === 'object' ? body.deviceMetadata : {},
      }, { onConflict: 'waiter_id,device_fingerprint' })
      .select('trusted')
      .maybeSingle()

    if (deviceError) throw deviceError
    deviceTrusted = deviceRow?.trusted !== false
  }

  const { data: eventRow, error: eventError } = await supabase
    .from('employee_time_clock_events')
    .insert({
      user_id: waiterSession.profile.restaurantId,
      waiter_id: waiterSession.profile.id,
      event_type: eventType,
      status,
      latitude,
      longitude,
      accuracy_meters: accuracyMeters,
      distance_meters: distanceMeters !== null ? Math.round(Number(distanceMeters) * 100) / 100 : null,
      within_geofence: withinGeofence,
      device_fingerprint: deviceFingerprint || null,
      device_trusted: deviceTrusted,
      face_provider: faceAnalysis.faceProvider,
      face_status: faceStatus,
      face_score: faceAnalysis.faceScore,
      face_reference_id: faceAnalysis.faceReferenceId,
      face_liveness_passed: faceAnalysis.faceLivenessPassed,
      face_challenge_id: faceAnalysis.faceChallengeId,
      face_challenge_prompt: faceAnalysis.faceChallengePrompt,
      face_evidence: faceAnalysis.evidence,
      privacy_acknowledged_at: faceAnalysis.privacyAcknowledgedAt,
      selfie_url: null,
      review_reason: reviewReasons.join(' '),
      metadata: {
        userAgent: String(body?.userAgent || '').slice(0, 500),
        source: 'waiter_web',
        providerPayload: faceAnalysis.providerPayload,
      },
    })
    .select('*')
    .single()

  if (eventError) throw eventError
  return ok({ event: eventRow, status: await getTimeClockStatus(supabase, waiterSession) })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const waiterSession = await getWaiterSession(req)
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || '')
    const supabase = waiterSession.supabase

    if (action === 'bootstrap') {
      const tables = await listRestaurantTables(supabase, waiterSession.profile.restaurantId)
      const timeClock = await getTimeClockStatus(supabase, waiterSession)
      return ok({ profile: waiterSession.profile, tables, timeClock })
    }

    if (action === 'time_clock_status') {
      return ok(await getTimeClockStatus(supabase, waiterSession))
    }

    if (action === 'time_clock_punch') {
      return punchTimeClock(supabase, waiterSession, body)
    }

    if (action === 'payment_settings') {
      const { data, error } = await supabase
        .from('pix_settings')
        .select('enabled, mp_pdv_enabled, mp_waiter_enabled')
        .eq('user_id', waiterSession.profile.restaurantId)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') {
        console.warn('[waiter-web] pix_settings unavailable:', error?.message || error)
      }

      return ok({
        pixEnabled: data?.enabled === true,
        mpPdvEnabled: data?.mp_pdv_enabled === true,
        mpWaiterPixEnabled: data?.enabled === true && data?.mp_waiter_enabled === true,
      })
    }

    if (action === 'create_table') {
      const tableNumber = Math.max(1, Number(body?.tableNumber || 0))
      const capacity = Math.max(0, Number(body?.capacity || 0))
      const location = String(body?.location || '').trim() || null

      if (!tableNumber) return fail('Informe o numero da mesa.', 400)

      const { data: existing, error: existingError } = await supabase
        .from('tables')
        .select('id')
        .eq('user_id', waiterSession.profile.restaurantId)
        .eq('table_number', tableNumber)
        .maybeSingle()

      if (existingError) throw existingError
      if (existing?.id) return fail('Ja existe uma mesa com este numero.', 400)

      const { data: tableRow, error: tableError } = await supabase
        .from('tables')
        .insert({
          user_id: waiterSession.profile.restaurantId,
          table_number: tableNumber,
          capacity: capacity || null,
          location,
          status: 'available',
        })
        .select('id, table_number, capacity, location')
        .single()

      if (tableError) throw tableError

      return ok({
        table: {
          id: tableRow.id,
          number: Number(tableRow.table_number),
          capacity: Number(tableRow.capacity ?? 0),
          location: tableRow.location,
        },
      })
    }

    if (action === 'open_session') {
      const tableId = String(body?.tableId || '')
      const tableNumber = Math.max(1, Number(body?.tableNumber || 0))
      const guestCount = Math.max(1, Number(body?.guestCount || 1))
      const customerName = String(body?.customerName || '').trim().slice(0, 80)

      if (!tableId || !tableNumber) return fail('Mesa invalida.', 400)

      const existing = await supabase
        .from('table_sessions')
        .select('id')
        .eq('table_id', tableId)
        .eq('user_id', waiterSession.profile.restaurantId)
        .in('status', ['open', 'serving', 'payment_pending'])
        .maybeSingle()

      if (existing.error) throw existing.error
      if (existing.data?.id) return ok({ sessionId: existing.data.id })

      const { data: sessionRow, error: sessionError } = await supabase
        .from('table_sessions')
        .insert({
          user_id: waiterSession.profile.restaurantId,
          table_id: tableId,
          status: 'open',
          guest_count: guestCount,
          opened_at: new Date().toISOString(),
          opened_by_waiter_id: waiterSession.profile.id,
        })
        .select('id')
        .single()

      if (sessionError) throw sessionError

      const accountsToInsert = Array.from({ length: guestCount }, (_, index) => ({
        user_id: waiterSession.profile.restaurantId,
        session_id: sessionRow.id,
        table_id: null,
        account_number: index + 1,
        name: customerName && index === 0 ? customerName : `Conta ${index + 1}`,
        total: 0,
        status: 'open',
        opened_by_waiter_id: waiterSession.profile.id,
        opened_at: new Date().toISOString(),
        items: [],
      }))

      const { error: accountError } = await supabase.from('table_accounts').insert(accountsToInsert)
      if (accountError) throw accountError

      const { error: tableError } = await supabase.from('tables').update({ status: 'occupied' }).eq('id', tableId)
      if (tableError) throw tableError

      return ok({ sessionId: sessionRow.id })
    }

    if (action === 'session_details') {
      const sessionId = String(body?.sessionId || '')
      if (!sessionId) return fail('Sessao invalida.', 400)

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sessionId)
      return ok({ session })
    }

    if (action === 'update_session_note') {
      const sessionId = String(body?.sessionId || '')
      if (!sessionId) return fail('Sessao invalida.', 400)

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sessionId)
      return ok({ session })
    }

    if (action === 'request_check') {
      const sessionId = String(body?.sessionId || '')
      if (!sessionId) return fail('Sessao invalida.', 400)

      const snapshot = await getSessionSnapshot(supabase, sessionId)
      const metrics = buildSessionMetrics(snapshot)
      if (isEffectivelyZero(metrics.dueAmount)) return fail('Nao ha saldo pendente nesta mesa.', 400)

      const { error: sessionError } = await supabase
        .from('table_sessions')
        .update({ status: 'payment_pending' })
        .eq('id', sessionId)

      if (sessionError) throw sessionError

      const { error: tableError } = await supabase
        .from('tables')
        .update({ status: 'occupied' })
        .eq('id', snapshot.sessionRow.table_id)

      if (tableError) throw tableError

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sessionId)
      return ok({ session })
    }

    if (action === 'release_table') {
      const sessionId = String(body?.sessionId || '')
      if (!sessionId) return fail('Sessao invalida.', 400)

      const snapshot = await getSessionSnapshot(supabase, sessionId)
      const metrics = buildSessionMetrics(snapshot)
      if (!isEffectivelyZero(metrics.dueAmount)) return fail('A mesa ainda possui saldo pendente.', 400)

      const { error: sessionError } = await supabase
        .from('table_sessions')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
        })
        .eq('id', sessionId)

      if (sessionError) throw sessionError

      const { error: tableError } = await supabase
        .from('tables')
        .update({ status: 'available' })
        .eq('id', snapshot.sessionRow.table_id)

      if (tableError) throw tableError

      return ok({ ok: true })
    }

    if (action === 'transfer_table') {
      const sessionId = String(body?.sessionId || '')
      const targetTableId = String(body?.targetTableId || '')
      if (!sessionId || !targetTableId) return fail('Informe a mesa de destino.', 400)

      const snapshot = await getSessionSnapshot(supabase, sessionId)
      if (snapshot.sessionRow.table_id === targetTableId) return fail('A mesa ja esta selecionada.', 400)

      const targetIsFree = await ensureTableIsFree(supabase, targetTableId, waiterSession.profile.restaurantId, sessionId)
      if (!targetIsFree) return fail('A mesa de destino ja esta ocupada.', 400)

      const previousTableId = snapshot.sessionRow.table_id

      const { error: sessionError } = await supabase
        .from('table_sessions')
        .update({ table_id: targetTableId })
        .eq('id', sessionId)

      if (sessionError) throw sessionError

      const { error: ordersError } = await supabase
        .from('orders')
        .update({ table_id: targetTableId })
        .eq('session_id', sessionId)

      if (ordersError) throw ordersError

      const { error: previousTableError } = await supabase
        .from('tables')
        .update({ status: 'available' })
        .eq('id', previousTableId)

      if (previousTableError) throw previousTableError

      const { error: nextTableError } = await supabase
        .from('tables')
        .update({ status: 'occupied' })
        .eq('id', targetTableId)

      if (nextTableError) throw nextTableError

      await refreshSessionStatus(supabase, sessionId)

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sessionId)
      return ok({ session })
    }

    if (action === 'create_account') {
      const sessionId = String(body?.sessionId || '')
      const name = String(body?.name || '').trim()
      const commandCode = String(body?.commandCode || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '')
      if (!sessionId || !name) return fail('Informe o nome da comanda.', 400)

      let electronicCommandId: string | null = null
      if (commandCode) {
        const { data: commandRow, error: commandError } = await supabase
          .from('electronic_commands')
          .upsert(
            {
              user_id: waiterSession.profile.restaurantId,
              code: commandCode,
              active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,code' },
          )
          .select('id')
          .single()
        if (commandError) throw commandError
        electronicCommandId = commandRow.id

        const { data: occupiedAccount, error: occupiedError } = await supabase
          .from('table_accounts')
          .select('id')
          .eq('electronic_command_id', electronicCommandId)
          .in('status', ['open', 'payment_pending'])
          .is('closed_at', null)
          .maybeSingle()
        if (occupiedError) throw occupiedError
        if (occupiedAccount) return fail('Esta comanda já está vinculada a outra conta aberta.', 409)
      }

      const nextNumber = await getNextAccountNumber(supabase, sessionId)
      const { error } = await supabase.from('table_accounts').insert({
        user_id: waiterSession.profile.restaurantId,
        session_id: sessionId,
        table_id: null,
        account_number: nextNumber,
        name,
        total: 0,
        status: 'open',
        opened_by_waiter_id: waiterSession.profile.id,
        opened_at: new Date().toISOString(),
        items: [],
        electronic_command_id: electronicCommandId,
      })

      if (error) throw error

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sessionId)
      return ok({ session })
    }

    if (action === 'rename_account') {
      const accountId = String(body?.accountId || '')
      const name = String(body?.name || '').trim()
      const commandCode = String(body?.commandCode || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '')
      if (!accountId || !name) return fail('Informe um nome valido.', 400)

      const { data: accountRow, error: accountError } = await supabase
        .from('table_accounts')
        .select('id, session_id, electronic_command_id')
        .eq('id', accountId)
        .single()

      if (accountError) throw accountError

      let electronicCommandId: string | null = null
      if (commandCode) {
        const { data: commandRow, error: commandError } = await supabase
          .from('electronic_commands')
          .upsert(
            {
              user_id: waiterSession.profile.restaurantId,
              code: commandCode,
              active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,code' },
          )
          .select('id')
          .single()
        if (commandError) throw commandError
        electronicCommandId = commandRow.id

        const { data: occupiedAccount, error: occupiedError } = await supabase
          .from('table_accounts')
          .select('id')
          .eq('electronic_command_id', electronicCommandId)
          .neq('id', accountId)
          .in('status', ['open', 'payment_pending'])
          .is('closed_at', null)
          .maybeSingle()
        if (occupiedError) throw occupiedError
        if (occupiedAccount) return fail('Esta comanda já está vinculada a outra conta aberta.', 409)
      }

      const { error } = await supabase
        .from('table_accounts')
        .update({ name, electronic_command_id: electronicCommandId })
        .eq('id', accountId)

      if (error) throw error

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, accountRow.session_id)
      return ok({ session })
    }

    if (action === 'remove_account') {
      const accountId = String(body?.accountId || '')
      if (!accountId) return fail('Comanda invalida.', 400)

      const { data: accountRow, error: accountError } = await supabase
        .from('table_accounts')
        .select('id, session_id')
        .eq('id', accountId)
        .single()

      if (accountError) throw accountError

      const { data: data, error } = await supabase
        .from('order_items')
        .select('id')
        .eq('account_id', accountId)
        .limit(1)

      if (error) throw error
      if ((data ?? []).length > 0) return fail('So e possivel remover comanda vazia.', 400)

      const { error: paymentError } = await supabase
        .from('payments')
        .select('id')
        .eq('account_id', accountId)
        .limit(1)

      if (paymentError) throw paymentError

      const { error: deleteError } = await supabase.from('table_accounts').delete().eq('id', accountId)
      if (deleteError) throw deleteError

      await refreshSessionStatus(supabase, accountRow.session_id)
      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, accountRow.session_id)
      return ok({ session })
    }

    if (action === 'merge_accounts') {
      const sourceAccountId = String(body?.sourceAccountId || '')
      const targetAccountId = String(body?.targetAccountId || '')
      if (!sourceAccountId || !targetAccountId || sourceAccountId === targetAccountId) {
        return fail('Selecione duas comandas diferentes.', 400)
      }

      const { data: accountRows, error: accountError } = await supabase
        .from('table_accounts')
        .select('id, session_id')
        .in('id', [sourceAccountId, targetAccountId])

      if (accountError) throw accountError

      if ((accountRows ?? []).length !== 2) return fail('Comandas nao encontradas.', 404)

      const [sourceAccount, targetAccount] = [sourceAccountId, targetAccountId].map((id) =>
        (accountRows ?? []).find((row: any) => row.id === id),
      )

      if (!sourceAccount || !targetAccount) return fail('Comandas nao encontradas.', 404)
      if (sourceAccount.session_id !== targetAccount.session_id) return fail('So e possivel juntar comandas da mesma mesa.', 400)

      const { error: itemError } = await supabase
        .from('order_items')
        .update({ account_id: targetAccountId })
        .eq('account_id', sourceAccountId)

      if (itemError) throw itemError

      const { error: paymentError } = await supabase
        .from('payments')
        .update({ account_id: targetAccountId })
        .eq('account_id', sourceAccountId)

      if (paymentError) throw paymentError

      const { error: orderError } = await supabase
        .from('orders')
        .update({ account_id: targetAccountId })
        .eq('account_id', sourceAccountId)

      if (orderError) throw orderError

      const { error: deleteError } = await supabase
        .from('table_accounts')
        .delete()
        .eq('id', sourceAccountId)

      if (deleteError) throw deleteError

      await refreshAccountTotals(supabase, [targetAccountId])
      await refreshSessionStatus(supabase, sourceAccount.session_id)

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sourceAccount.session_id)
      return ok({ session })
    }

    if (action === 'transfer_account') {
      const accountId = String(body?.accountId || '')
      const targetTableId = String(body?.targetTableId || '')
      if (!accountId || !targetTableId) return fail('Informe a comanda e a mesa de destino.', 400)

      const { data: accountRow, error: accountError } = await supabase
        .from('table_accounts')
        .select('*')
        .eq('id', accountId)
        .single()

      if (accountError) throw accountError

      const sourceSessionId = String(accountRow.session_id || '')
      if (!sourceSessionId) return fail('Comanda invalida.', 400)

      const sourceSnapshot = await getSessionSnapshot(supabase, sourceSessionId)
      if (sourceSnapshot.sessionRow.table_id === targetTableId) return fail('A comanda ja esta nesta mesa.', 400)

      let targetSessionId = ''
      const { data: targetSessionRow, error: targetSessionError } = await supabase
        .from('table_sessions')
        .select('id')
        .eq('user_id', waiterSession.profile.restaurantId)
        .eq('table_id', targetTableId)
        .in('status', ['open', 'serving', 'payment_pending'])
        .maybeSingle()

      if (targetSessionError) throw targetSessionError

      if (targetSessionRow?.id) {
        targetSessionId = targetSessionRow.id
      } else {
        const { data: createdSession, error: createSessionError } = await supabase
          .from('table_sessions')
          .insert({
            user_id: waiterSession.profile.restaurantId,
            table_id: targetTableId,
            status: 'open',
            guest_count: 1,
            opened_at: new Date().toISOString(),
            opened_by_waiter_id: waiterSession.profile.id,
          })
          .select('id')
          .single()

        if (createSessionError) throw createSessionError

        targetSessionId = createdSession.id

        const { error: targetTableError } = await supabase
          .from('tables')
          .update({ status: 'occupied' })
          .eq('id', targetTableId)

        if (targetTableError) throw targetTableError
      }

      const nextAccountNumber = await getNextAccountNumber(supabase, targetSessionId)

      const { error: accountUpdateError } = await supabase
        .from('table_accounts')
        .update({
          session_id: targetSessionId,
          account_number: nextAccountNumber,
        })
        .eq('id', accountId)

      if (accountUpdateError) throw accountUpdateError

      const { error: itemUpdateError } = await supabase
        .from('order_items')
        .update({ session_id: targetSessionId })
        .eq('account_id', accountId)

      if (itemUpdateError) throw itemUpdateError

      const { error: paymentUpdateError } = await supabase
        .from('payments')
        .update({ session_id: targetSessionId })
        .eq('account_id', accountId)

      if (paymentUpdateError) throw paymentUpdateError

      const { error: orderUpdateError } = await supabase
        .from('orders')
        .update({ session_id: targetSessionId, table_id: targetTableId, account_id: accountId })
        .eq('account_id', accountId)

      if (orderUpdateError) throw orderUpdateError

      await refreshAccountTotals(supabase, [accountId])
      await refreshSessionStatus(supabase, sourceSessionId)
      await refreshSessionStatus(supabase, targetSessionId)

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sourceSessionId)
      return ok({ session, transferredSessionId: targetSessionId })
    }

    if (action === 'move_item') {
      const itemId = String(body?.itemId || '')
      const targetAccountId = String(body?.targetAccountId || '')
      const moveQuantity = Math.max(1, Number(body?.quantity || 1))

      if (!itemId || !targetAccountId) return fail('Informe o item e a comanda de destino.', 400)

      const { data: itemRow, error: itemError } = await supabase
        .from('order_items')
        .select('*')
        .eq('id', itemId)
        .single()

      if (itemError) throw itemError
      if (itemRow.status !== 'draft') return fail('So e possivel mover itens ainda nao enviados.', 400)

      const { data: accountRows, error: accountError } = await supabase
        .from('table_accounts')
        .select('id, session_id')
        .in('id', [itemRow.account_id, targetAccountId])

      if (accountError) throw accountError
      if ((accountRows ?? []).length !== 2) return fail('Comanda de origem ou destino nao encontrada.', 404)

      const sourceAccount = (accountRows ?? []).find((row: any) => row.id === itemRow.account_id)
      const targetAccount = (accountRows ?? []).find((row: any) => row.id === targetAccountId)
      if (!sourceAccount || !targetAccount) return fail('Comanda de origem ou destino nao encontrada.', 404)
      if (sourceAccount.session_id !== targetAccount.session_id) return fail('So e possivel mover itens dentro da mesma mesa.', 400)

      const { data: optionRows, error: optionError } = await supabase
        .from('order_item_options')
        .select('*')
        .eq('order_item_id', itemId)

      if (optionError) throw optionError

      const sourceQuantity = Math.max(1, Number(itemRow.quantity || 1))
      const quantityToMove = Math.min(sourceQuantity, moveQuantity)

      if (quantityToMove >= sourceQuantity) {
        const { error: moveError } = await supabase
          .from('order_items')
          .update({ account_id: targetAccountId })
          .eq('id', itemId)

        if (moveError) throw moveError
      } else {
        const { data: duplicatedItem, error: duplicateError } = await supabase
          .from('order_items')
          .insert({
            session_id: itemRow.session_id,
            account_id: targetAccountId,
            product_id: itemRow.product_id,
            product_name: itemRow.product_name,
            quantity: quantityToMove,
            unit_price: normalizeAmount(itemRow.unit_price),
            notes: itemRow.notes || '',
            status: 'draft',
          })
          .select('id')
          .single()

        if (duplicateError) throw duplicateError

        if ((optionRows ?? []).length) {
          const { error: insertOptionsError } = await supabase
            .from('order_item_options')
            .insert(
              (optionRows ?? []).map((option: any) => ({
                order_item_id: duplicatedItem.id,
                option_name: option.option_name,
                price: normalizeAmount(option.price),
                quantity: Math.max(1, Number(option.quantity || 1)),
              })),
            )

          if (insertOptionsError) throw insertOptionsError
        }

        const { error: reduceError } = await supabase
          .from('order_items')
          .update({ quantity: sourceQuantity - quantityToMove })
          .eq('id', itemId)

        if (reduceError) throw reduceError
      }

      await refreshAccountTotals(supabase, [itemRow.account_id, targetAccountId])
      await refreshSessionStatus(supabase, itemRow.session_id)

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, itemRow.session_id)
      return ok({ session })
    }

    if (action === 'catalog') {
      const categories = await listCatalog(supabase, waiterSession.profile.restaurantId)
      return ok({ categories })
    }

    if (action === 'add_item') {
      const sessionId = String(body?.sessionId || '')
      const accountId = String(body?.accountId || '')
      const productId = String(body?.productId || '')
      const quantity = Math.max(1, Number(body?.quantity || 1))
      const notes = String(body?.notes || '')
      const selectedOptions = Array.isArray(body?.selectedOptions) ? body.selectedOptions : []

      if (!sessionId || !accountId || !productId) return fail('Dados do item invalidos.', 400)

      const { data: productRow, error: productError } = await supabase
        .from('products')
        .select('id, name, price')
        .eq('id', productId)
        .eq('user_id', waiterSession.profile.restaurantId)
        .single()

      if (productError) throw productError

      const effectivePrices = await resolveWaiterPrices(
        supabase,
        waiterSession.profile.restaurantId,
        [String(productRow.id)],
      )
      const unitPrice = effectivePrices.get(String(productRow.id)) ?? normalizeAmount(productRow.price)

      const { error: itemError } = await supabase
        .from('order_items')
        .insert({
          session_id: sessionId,
          account_id: accountId,
          product_id: productRow.id,
          product_name: productRow.name,
          quantity,
          unit_price: unitPrice,
          notes,
          status: 'draft',
        })

      if (itemError) throw itemError

      const { data: createdRows, error: createdRowsError } = await supabase
        .from('order_items')
        .select('id')
        .eq('session_id', sessionId)
        .eq('account_id', accountId)
        .eq('product_id', productId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)

      if (createdRowsError) throw createdRowsError
      const itemId = createdRows?.[0]?.id

      if (itemId && selectedOptions.length) {
        const { error: optionError } = await supabase
          .from('order_item_options')
          .insert(
            selectedOptions.map((option: any) => ({
              order_item_id: itemId,
              option_name: String(option.optionName || option.name || ''),
              price: normalizeAmount(option.price),
              quantity: Math.max(1, Number(option.quantity || 1)),
            })),
          )

        if (optionError) throw optionError
      }

      await refreshAccountTotal(supabase, accountId)
      await refreshSessionStatus(supabase, sessionId)

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sessionId)
      return ok({ session })
    }

    if (action === 'update_draft_item') {
      const itemId = String(body?.itemId || '')
      const quantity = Math.max(1, Number(body?.quantity || 1))
      const notes = String(body?.notes || '')
      const selectedOptions = Array.isArray(body?.selectedOptions) ? body.selectedOptions : []

      if (!itemId) return fail('Item invalido.', 400)

      const { data: itemRow, error: itemError } = await supabase
        .from('order_items')
        .select('id, session_id, account_id, status')
        .eq('id', itemId)
        .single()

      if (itemError) throw itemError
      if (itemRow.status !== 'draft') return fail('So e possivel editar itens ainda nao enviados.', 400)

      const { error: updateError } = await supabase
        .from('order_items')
        .update({
          quantity,
          notes,
        })
        .eq('id', itemId)

      if (updateError) throw updateError

      const { error: deleteOptionsError } = await supabase
        .from('order_item_options')
        .delete()
        .eq('order_item_id', itemId)

      if (deleteOptionsError) throw deleteOptionsError

      if (selectedOptions.length) {
        const { error: insertOptionsError } = await supabase
          .from('order_item_options')
          .insert(
            selectedOptions.map((option: any) => ({
              order_item_id: itemId,
              option_name: String(option.optionName || option.name || ''),
              price: normalizeAmount(option.price),
              quantity: Math.max(1, Number(option.quantity || 1)),
            })),
          )

        if (insertOptionsError) throw insertOptionsError
      }

      await refreshAccountTotal(supabase, itemRow.account_id)
      await refreshSessionStatus(supabase, itemRow.session_id)

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, itemRow.session_id)
      return ok({ session })
    }

    if (action === 'cancel_draft_item') {
      const itemId = String(body?.itemId || '')
      const accountId = String(body?.accountId || '')
      const sessionId = String(body?.sessionId || '')
      if (!itemId || !accountId || !sessionId) return fail('Item invalido.', 400)

      const { data: row, error: rowError } = await supabase
        .from('order_items')
        .select('id, status')
        .eq('id', itemId)
        .maybeSingle()

      if (rowError) throw rowError
      if (!row) return fail('Item nao encontrado.', 404)
      if (row.status !== 'draft') return fail('So e possivel cancelar itens que ainda nao foram enviados.', 400)

      const { error: updateError } = await supabase
        .from('order_items')
        .update({ status: 'cancelled' })
        .eq('id', itemId)

      if (updateError) throw updateError

      await refreshAccountTotal(supabase, accountId)
      await refreshSessionStatus(supabase, sessionId)

      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sessionId)
      return ok({ session })
    }

    if (action === 'send_account') {
      const sessionId = String(body?.sessionId || '')
      const accountId = String(body?.accountId || '')
      if (!sessionId || !accountId) return fail('Comanda invalida.', 400)

      const sentAccount = await sendAccountDraftItemsToKitchen(supabase, waiterSession, sessionId, accountId)
      if (!sentAccount.sent) return fail('Nenhum item pendente para enviar.', 400)

      await refreshSessionStatus(supabase, sessionId)
      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sessionId)
      return ok({ session, kitchenItemCount: sentAccount.kitchenItemCount || 0, itemCount: sentAccount.itemCount || 0 })
    }

    if (action === 'send_all_accounts') {
      const sessionId = String(body?.sessionId || '')
      if (!sessionId) return fail('Sessao invalida.', 400)

      const { data: draftRows, error: draftError } = await supabase
        .from('order_items')
        .select('account_id')
        .eq('session_id', sessionId)
        .eq('status', 'draft')

      if (draftError) throw draftError

      const accountIds = Array.from(
        new Set((draftRows ?? []).map((row: any) => String(row.account_id || '')).filter(Boolean)),
      )

      if (!accountIds.length) return fail('Nenhuma comanda com itens pendentes para enviar.', 400)

      let kitchenItemCount = 0
      let itemCount = 0
      for (const accountId of accountIds) {
        const result = await sendAccountDraftItemsToKitchen(supabase, waiterSession, sessionId, accountId)
        kitchenItemCount += Number(result.kitchenItemCount || 0)
        itemCount += Number(result.itemCount || 0)
      }

      await refreshSessionStatus(supabase, sessionId)
      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sessionId)
      return ok({ session, sentAccounts: accountIds.length, kitchenItemCount, itemCount })
    }

    if (action === 'record_payments') {
      const cashGuard = await requireOpenCashSession(supabase, waiterSession.profile.restaurantId)
      if (cashGuard) return cashGuard

      const sessionId = String(body?.sessionId || '')
      const payments = Array.isArray(body?.payments) ? body.payments : []
      if (!sessionId || !payments.length) return fail('Informe ao menos um pagamento.', 400)

      const sanitizedPayments = payments
        .map((payment: any) => ({
          accountId: String(payment?.accountId || ''),
          method: String(payment?.method || ''),
          amount: normalizeAmount(payment?.amount),
          provider: String(payment?.provider || 'manual'),
          transactionId: String(payment?.transactionId || payment?.transaction_id || ''),
          atk: String(payment?.atk || ''),
          nsu: String(payment?.nsu || ''),
          authorizationCode: String(payment?.authorizationCode || payment?.authorization_code || ''),
          installments: payment?.installments ? Number(payment.installments) : null,
          status: String(payment?.status || 'approved'),
          date: String(payment?.date || ''),
          deviceId: String(payment?.deviceId || payment?.device_id || ''),
          terminal: String(payment?.terminal || ''),
          stoneCode: String(payment?.stoneCode || payment?.stone_code || ''),
          receiptText: String(payment?.receiptText || ''),
          raw: payment?.raw ?? null,
        }))
        .filter((payment: any) => payment.accountId && ['cash', 'pix', 'debit', 'credit', 'card'].includes(payment.method) && payment.amount > 0)

      if (!sanitizedPayments.length) return fail('Nenhum pagamento valido foi informado.', 400)

      const { data: accountRows, error: accountError } = await supabase
        .from('table_accounts')
        .select('id, session_id, total')
        .in('id', sanitizedPayments.map((payment: any) => payment.accountId))

      if (accountError) throw accountError
      const validAccountIds = new Set((accountRows ?? []).filter((row: any) => row.session_id === sessionId).map((row: any) => row.id))
      if (!sanitizedPayments.every((payment: any) => validAccountIds.has(payment.accountId))) {
        return fail('Existe uma comanda invalida no pagamento informado.', 400)
      }

      const serviceSettings = await getServiceChargeSettings(supabase, waiterSession.profile.restaurantId)
      const serviceChargeRequest = body?.serviceCharge || {}
      const serviceEnabled = Boolean(serviceChargeRequest?.enabled && serviceSettings.enabled)
      const servicePercent = serviceEnabled
        ? Math.max(0, Number(serviceChargeRequest?.percentage ?? serviceSettings.percentage ?? 10))
        : 0
      const taxPercent = serviceEnabled ? Math.max(0, Number(serviceSettings.taxWithholdPercent || 0)) : 0
      const accountById = new Map((accountRows ?? []).map((row: any) => [row.id, row]))
      const roundMoney = (value: number) => Math.round(value * 100) / 100
      const serviceRows: any[] = []
      const extraTotalByAccount = new Map<string, number>()
      const paymentRows = sanitizedPayments.map((payment: any) => {
        const serviceAmount = roundMoney((payment.amount * servicePercent) / 100)
        const taxAmount = roundMoney((serviceAmount * taxPercent) / 100)
        const totalAmount = roundMoney(payment.amount + serviceAmount)

        if (serviceAmount > 0) {
          extraTotalByAccount.set(payment.accountId, roundMoney((extraTotalByAccount.get(payment.accountId) ?? 0) + serviceAmount))
          serviceRows.push({
            user_id: waiterSession.profile.restaurantId,
            session_id: sessionId,
            account_id: payment.accountId,
            waiter_id: waiterSession.profile.id,
            base_amount: payment.amount,
            percentage: servicePercent,
            gross_amount: serviceAmount,
            tax_withhold_percent: taxPercent,
            tax_amount: taxAmount,
            net_waiter_amount: roundMoney(serviceAmount - taxAmount),
          })
        }

        return {
          session_id: sessionId,
          account_id: payment.accountId,
          user_id: waiterSession.profile.restaurantId,
          waiter_id: waiterSession.profile.id,
          method: payment.method,
          amount: totalAmount,
          provider: payment.provider,
          transaction_id: payment.transactionId || null,
          atk: payment.atk || null,
          nsu: payment.nsu || null,
          authorization_code: payment.authorizationCode || null,
          installments: payment.installments,
          status: payment.status || 'approved',
          payment_date: payment.date || new Date().toISOString(),
          device_id: payment.deviceId || null,
          terminal: payment.terminal || null,
          stone_code: payment.stoneCode || null,
          receipt_text: payment.receiptText || null,
          metadata: {
            provider: payment.provider,
            transaction_id: payment.transactionId || null,
            atk: payment.atk || null,
            nsu: payment.nsu || null,
            authorization_code: payment.authorizationCode || null,
            installments: payment.installments,
            status: payment.status || 'approved',
            payment_date: payment.date || null,
            device_id: payment.deviceId || null,
            terminal: payment.terminal || null,
            stone_code: payment.stoneCode || null,
            raw: payment.raw,
          },
        }
      })

      if (extraTotalByAccount.size > 0) {
        for (const [accountId, serviceAmount] of extraTotalByAccount.entries()) {
          const account = accountById.get(accountId)
          const nextTotal = roundMoney(normalizeAmount(account?.total) + serviceAmount)
          const { error: updateAccountError } = await supabase
            .from('table_accounts')
            .update({ total: nextTotal })
            .eq('id', accountId)
            .eq('session_id', sessionId)

          if (updateAccountError) throw updateAccountError
        }

        const { error: serviceInsertError } = await supabase
          .from('waiter_service_charges')
          .insert(serviceRows)

        if (serviceInsertError) throw serviceInsertError
      }

      const { data: insertedPayments, error: insertError } = await supabase
        .from('payments')
        .insert(paymentRows)
        .select('id, account_id, method, amount, transaction_id, nsu, atk, status, device_id')

      if (insertError) throw insertError

      const { data: sessionRowForLogs, error: sessionLogError } = await supabase
        .from('table_sessions')
        .select('table_id')
        .eq('id', sessionId)
        .maybeSingle()

      if (sessionLogError) throw sessionLogError

      const paymentLogs = (insertedPayments ?? []).map((payment: any) => ({
        restaurant_id: waiterSession.profile.restaurantId,
        table_id: sessionRowForLogs?.table_id ?? null,
        account_id: payment.account_id,
        operator_id: waiterSession.profile.id,
        device_id: payment.device_id ?? null,
        transaction_id: payment.transaction_id ?? null,
        nsu: payment.nsu ?? null,
        atk: payment.atk ?? null,
        amount: normalizeAmount(payment.amount),
        payment_method: payment.method,
        status: payment.status || 'approved',
      }))

      if (paymentLogs.length) {
        const { error: logError } = await supabase
          .from('payment_logs')
          .insert(paymentLogs)

        if (logError) console.warn('payment_logs insert failed:', logError?.message || logError)
      }

      await refreshSessionStatus(supabase, sessionId)
      const session = await buildSessionResponse(supabase, waiterSession.profile.restaurantId, sessionId)
      return ok({ session })
    }

    return fail('Acao invalida.', 400)
  } catch (error: any) {
    return fail(String(error?.message || 'Erro interno no app do garcom.'), 500)
  }
})
