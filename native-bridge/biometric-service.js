import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'

const safeJson = (value, fallback) => {
  try { return JSON.parse(value) } catch { return fallback }
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')

const containsRawBiometric = (value) => {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
    const forbidden = normalized.includes('image')
      || normalized.includes('minutiae')
      || normalized === 'template'
      || normalized === 'rawtemplate'
      || normalized === 'biometrictemplate'
    return forbidden || containsRawBiometric(nested)
  })
}

export class BiometricService {
  constructor(options = {}) {
    this.provider = String(options.provider || 'not_configured')
    this.sidecarPath = String(options.sidecarPath || '')
    this.dataDir = String(options.dataDir || process.cwd())
    this.deviceId = String(options.deviceId || this.loadOrCreateDeviceId())
    this.simulationAllowed = options.simulationAllowed === true
    this.storePath = path.join(this.dataDir, 'biometric-enrollments.json')
  }

  loadOrCreateDeviceId() {
    const idPath = path.join(this.dataDir, 'biometric-device-id')
    try {
      const existing = fs.readFileSync(idPath, 'utf8').trim()
      if (existing) return existing
    } catch {}
    const created = `popconnect-${crypto.randomUUID()}`
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(idPath, created, { mode: 0o600 })
    return created
  }

  readStore() {
    try {
      const parsed = safeJson(fs.readFileSync(this.storePath, 'utf8'), { enrollments: [] })
      return { enrollments: Array.isArray(parsed.enrollments) ? parsed.enrollments : [] }
    } catch {
      return { enrollments: [] }
    }
  }

  writeStore(store) {
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), { mode: 0o600 })
  }

  status() {
    const configured = this.provider === 'simulator'
      ? this.simulationAllowed
      : this.provider === 'sdk_sidecar' && Boolean(this.sidecarPath) && fs.existsSync(this.sidecarPath)
    return {
      configured,
      provider: this.provider,
      deviceId: this.deviceId,
      model: this.provider === 'simulator' ? 'Simulador de homologação' : 'Leitor via SDK do fabricante',
      simulation: this.provider === 'simulator',
      storesRawBiometrics: false,
    }
  }

  async invokeSidecar(action, payload = {}) {
    if (!this.sidecarPath) throw new Error('biometric_sidecar_not_configured')
    return await new Promise((resolve, reject) => {
      execFile(
        this.sidecarPath,
        [action, JSON.stringify(payload)],
        { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) return reject(new Error(error.message || 'biometric_sidecar_failed'))
          const parsed = safeJson(String(stdout || '').trim(), null)
          if (!parsed || parsed.ok === false) return reject(new Error(parsed?.error || 'invalid_biometric_sidecar_response'))
          if (containsRawBiometric(parsed)) return reject(new Error('raw_biometric_data_rejected'))
          resolve(parsed)
        },
      )
    })
  }

  ensureSimulator() {
    if (this.provider !== 'simulator' || !this.simulationAllowed) {
      throw new Error('biometric_provider_not_configured')
    }
  }

  async listDevices() {
    if (this.provider === 'sdk_sidecar') return await this.invokeSidecar('list_devices')
    this.ensureSimulator()
    return { ok: true, devices: [{ id: this.deviceId, name: 'Leitor biométrico (simulador)', model: 'HOMOLOGAÇÃO', serialNumber: 'SIMULATOR' }] }
  }

  async enroll(payload = {}) {
    if (this.provider === 'sdk_sidecar') return await this.invokeSidecar('enroll', { ...payload, deviceId: this.deviceId, samples: 3 })
    this.ensureSimulator()
    const employeeRef = String(payload.employeeRef || '').trim()
    if (!employeeRef) throw new Error('employee_reference_required')
    const fingerPosition = String(payload.fingerPosition || 'right_index')
    const providerReference = crypto.randomUUID()
    const templateHash = sha256(`${providerReference}|${employeeRef}|${fingerPosition}|${Date.now()}`)
    const store = this.readStore()
    store.enrollments = store.enrollments.filter((item) => !(item.employeeRef === employeeRef && item.fingerPosition === fingerPosition))
    store.enrollments.push({ employeeRef, fingerPosition, providerReference, templateHash, createdAt: new Date().toISOString() })
    this.writeStore(store)
    return { ok: true, employeeRef, fingerPosition, providerReference, templateHash, quality: 0.98, simulated: true }
  }

  async identify(payload = {}) {
    if (this.provider === 'sdk_sidecar') return await this.invokeSidecar('identify', { ...payload, deviceId: this.deviceId })
    this.ensureSimulator()
    const store = this.readStore()
    const requested = String(payload.providerReference || '')
    const match = requested
      ? store.enrollments.find((item) => item.providerReference === requested)
      : store.enrollments[0]
    if (!match) return { ok: false, error: 'biometric_not_recognized' }
    return { ok: true, ...match, quality: 0.98, livenessPassed: true, simulated: true }
  }

  async remove(payload = {}) {
    if (this.provider === 'sdk_sidecar') return await this.invokeSidecar('remove', { ...payload, deviceId: this.deviceId })
    this.ensureSimulator()
    const providerReference = String(payload.providerReference || '')
    const store = this.readStore()
    const before = store.enrollments.length
    store.enrollments = store.enrollments.filter((item) => item.providerReference !== providerReference)
    this.writeStore(store)
    return { ok: store.enrollments.length !== before }
  }
}
