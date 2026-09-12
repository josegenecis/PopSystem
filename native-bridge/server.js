import { WebSocketServer } from 'ws'
import os from 'os'
import net from 'net'
import printerLib from '@thiagoelg/node-printer'
import { SerialPort } from 'serialport'

const bridgePort = Number(process.env.POP_CONNECT_PORT || process.env.BRIDGE_PORT || 8766)
const bridgeHost = process.env.POP_CONNECT_HOST || process.env.BRIDGE_HOST || '127.0.0.1'
const wss = new WebSocketServer({ port: bridgePort, host: bridgeHost })

let systemPrinterName = null
let networkAddress = null
let scalePort = null
let scaleConfig = null
let scaleBuffer = ''
let latestScaleReading = null

const SCALE_PROTOCOLS = {
  toledo: { name: 'Toledo Prix', baudRate: 9600, request: Buffer.from([0x05]), tare: Buffer.from('T'), zero: Buffer.from('Z') },
  filizola: { name: 'Filizola', baudRate: 9600, request: Buffer.from([0x05]), tare: Buffer.from([0x02, 0x54, 0x03]), zero: Buffer.from([0x02, 0x5a, 0x03]) },
  urano: { name: 'Urano', baudRate: 4800, request: Buffer.from([0x05]), tare: Buffer.from('T\r\n'), zero: Buffer.from('Z\r\n') },
  magna: { name: 'Magna', baudRate: 9600, request: Buffer.from([0x05]), tare: Buffer.from('TARE\r'), zero: Buffer.from('ZERO\r') },
  elgin: { name: 'Elgin', baudRate: 9600, request: Buffer.from([0x05]), tare: Buffer.from('T'), zero: Buffer.from('Z') },
  generic: { name: 'Genérica', baudRate: 9600, request: Buffer.from([0x05]), tare: Buffer.from('T'), zero: Buffer.from('Z') },
}

function parseWeight(raw) {
  const clean = String(raw || '').replace(/[\u0000-\u001f]/g, ' ').trim().toLowerCase()
  if (!clean) return null
  const match = clean.match(/([-+]?\s*\d+(?:[.,]\d+)?)\s*(kg|kgs|g|gramas?)?/i)
  if (!match) return null
  const value = Number(match[1].replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(value)) return null
  const unit = String(match[2] || '').toLowerCase()
  const weightKg = unit.startsWith('g') ? value / 1000 : (unit.startsWith('kg') || /[.,]/.test(match[1]) ? value : value / 1000)
  return {
    weight: weightKg,
    unit: 'kg',
    stable: !/\b(us|unst|motion|inst)\b/i.test(clean),
    raw: clean,
    readAt: Date.now(),
  }
}

function closeScale() {
  return new Promise((resolve) => {
    const current = scalePort
    scalePort = null
    scaleConfig = null
    scaleBuffer = ''
    latestScaleReading = null
    if (!current?.isOpen) return resolve(true)
    current.close(() => resolve(true))
  })
}

async function listSerialPorts() {
  const ports = await SerialPort.list()
  return ports.map((port) => ({
    path: port.path,
    name: port.friendlyName || port.manufacturer || port.path,
    manufacturer: port.manufacturer || '',
    vendorId: port.vendorId || '',
    productId: port.productId || '',
    serialNumber: port.serialNumber || '',
  }))
}

async function connectScale(payload = {}) {
  const portPath = String(payload.portPath || payload.path || '').trim()
  if (!portPath) return { ok: false, error: 'scale_port_required' }
  await closeScale()
  const protocolId = SCALE_PROTOCOLS[payload.protocol] ? payload.protocol : 'generic'
  const protocol = SCALE_PROTOCOLS[protocolId]
  const options = {
    path: portPath,
    baudRate: Number(payload.baudRate || protocol.baudRate),
    dataBits: Number(payload.dataBits || 8),
    stopBits: Number(payload.stopBits || 1),
    parity: payload.parity || 'none',
    autoOpen: false,
  }
  const port = new SerialPort(options)
  const opened = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ ok: false, error: 'scale_connection_timeout' }), 8000)
    port.open((error) => {
      clearTimeout(timeout)
      resolve(error ? { ok: false, error: error.message } : { ok: true })
    })
  })
  if (!opened.ok) {
    try { port.destroy() } catch {}
    return opened
  }
  scalePort = port
  scaleConfig = { portPath, protocol: protocolId, ...options }
  port.on('data', (chunk) => {
    scaleBuffer = `${scaleBuffer}${chunk.toString('latin1')}`.slice(-256)
    const parsed = parseWeight(scaleBuffer)
    if (parsed) {
      latestScaleReading = parsed
      scaleBuffer = ''
    }
  })
  port.on('close', () => {
    if (scalePort === port) scalePort = null
  })
  port.on('error', () => {})
  return { ok: true, scale: scaleConfig }
}

async function writeScaleCommand(command) {
  if (!scalePort?.isOpen) return false
  return await new Promise((resolve) => scalePort.write(command, (error) => resolve(!error)))
}

async function readScaleWeight(timeoutMs = 2200) {
  if (!scalePort?.isOpen || !scaleConfig) return { ok: false, error: 'scale_not_connected' }
  const protocol = SCALE_PROTOCOLS[scaleConfig.protocol] || SCALE_PROTOCOLS.generic
  const startedAt = Date.now()
  await writeScaleCommand(protocol.request)
  return await new Promise((resolve) => {
    const poll = setInterval(() => {
      if (latestScaleReading?.readAt >= startedAt) {
        clearInterval(poll)
        clearTimeout(timeout)
        resolve({ ok: true, reading: latestScaleReading })
      }
    }, 40)
    const timeout = setTimeout(() => {
      clearInterval(poll)
      if (latestScaleReading) resolve({ ok: true, reading: latestScaleReading, cached: true })
      else resolve({ ok: false, error: 'scale_read_timeout' })
    }, Math.max(400, Number(timeoutMs) || 2200))
  })
}

const getEnv = (...keys) => {
  for (const k of keys) {
    const v = process.env[k]
    if (v) return v
  }
  return ''
}

function openPrinter(transport, address) {
  try {
    switch (transport) {
      case 'network':
        networkAddress = address || null
        systemPrinterName = null
        return !!networkAddress
      case 'system':
        systemPrinterName = address || printerLib.getDefaultPrinterName?.() || null
        networkAddress = null
        return !!systemPrinterName
      case 'usb':
      case 'bluetooth':
        systemPrinterName = address || printerLib.getDefaultPrinterName?.() || null
        networkAddress = null
        return !!systemPrinterName
      default:
        throw new Error('Unsupported transport')
    }
  } catch (e) {
    console.error('openPrinter error', e)
    return false
  }
}

function restoreConfiguredPrinter() {
  if (systemPrinterName || networkAddress) return true
  const transport = getEnv('PRINT_TRANSPORT', 'BRIDGE_TRANSPORT') || 'system'
  const address = getEnv('PRINT_ADDRESS', 'BRIDGE_ADDRESS') || ''
  if (!address) return false
  return openPrinter(transport, address)
}

async function printRawNetwork(data) {
  return await new Promise((resolve) => {
    try {
      const sock = new net.Socket()
      let resolved = false
      const done = (ok) => { if (!resolved) { resolved = true; try { sock.destroy() } catch {} ; resolve(ok) } }
      sock.setTimeout(4000)
      sock.once('connect', () => {
        try { sock.write(Buffer.from(data, 'binary')) } catch {}
        try { sock.end() } catch {}
        done(true)
      })
      sock.once('error', () => done(false))
      sock.once('timeout', () => done(false))
      sock.connect(9100, networkAddress)
    } catch {
      resolve(false)
    }
  })
}

async function printTest() {
  const data = buildEscpos({ header: 'Teste de Impressão', items: [{ name: 'Item', qty: 1, subtotal: 0 }], total: 0, order_number: 'TESTE' })
  if (systemPrinterName) {
    return await printRawSystem(data)
  }
  if (networkAddress) return await printRawNetwork(data)
  return false
}

async function printReceipt(data) {
  const { order_number, customer_name, customer_phone, items = [], total = 0 } = data || {}
  const escposData = buildEscpos({ header: `Pedido #${order_number}`, customer_name, customer_phone, items, total, order_number })
  if (systemPrinterName) {
    return await printRawSystem(escposData)
  }
  if (networkAddress) return await printRawNetwork(escposData)
  return false
}

async function openCashDrawer(payload = {}) {
  if (!systemPrinterName && !networkAddress) return false

  // ESC/POS: ESC p m t1 t2. A maioria das gavetas usa o conector 2 (m = 0).
  // O conector 5 pode ser informado pelo cliente quando necessário.
  const connector = Number(payload.connector) === 1 ? 1 : 0
  const pulseOn = Math.min(255, Math.max(1, Number(payload.pulseOn) || 25))
  const pulseOff = Math.min(255, Math.max(1, Number(payload.pulseOff) || 250))
  const command = Buffer.from([0x1b, 0x70, connector, pulseOn, pulseOff]).toString('binary')

  if (systemPrinterName) return await printRawSystem(command)
  return await printRawNetwork(command)
}

function buildEscpos({ header = 'BORA CUME HUB', customer_name, customer_phone, items = [], total = 0, order_number }) {
  let d = ''
  d += '\x1B\x61\x01' // center
  d += '\x1B\x45\x01' // bold on
  d += 'BORA CUME HUB\n'
  d += '\x1B\x45\x00' // bold off
  d += '--------------------------------\n'
  d += '\x1B\x61\x00' // left
  if (order_number) d += `Pedido: #${order_number}\n`
  if (customer_name) d += `Cliente: ${customer_name}\n`
  if (customer_phone) d += `Telefone: ${customer_phone}\n`
  d += '--------------------------------\n'
  items.forEach((it) => {
    const name = it.product_name || it.name || ''
    const qty = it.quantity || it.qty || 1
    const sub = Number(it.subtotal || it.price || 0)
    d += `${qty}x ${name}\n`
    d += '\x1B\x61\x02' // right
    d += `R$ ${sub.toFixed(2)}\n`
    d += '\x1B\x61\x00' // left
    if (it.notes) d += `Obs: ${it.notes}\n`
  })
  d += '--------------------------------\n'
  d += '\x1B\x61\x02' // right
  d += '\x1B\x45\x01' // bold on
  d += `TOTAL: R$ ${Number(total).toFixed(2)}\n`
  d += '\x1B\x45\x00' // bold off
  d += '\x1B\x61\x01' // center
  d += '--------------------------------\n'
  d += 'Obrigado pela preferência!\n\n\n'
  d += '\x1D\x56\x00' // cut
  return d
}

async function printRawSystem(data) {
  return await new Promise((resolve) => {
    try {
      printerLib.printDirect({ data, printer: systemPrinterName || undefined, type: 'RAW', success: () => resolve(true), error: () => resolve(false) })
    } catch { resolve(false) }
  })
}

function getLocalSubnets() {
  const ifaces = os.networkInterfaces()
  const subnets = []
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (!info || info.internal || info.family !== 'IPv4') continue
      const ip = info.address.split('.')
      const subnet = `${ip[0]}.${ip[1]}.${ip[2]}.`
      subnets.push(subnet)
    }
  }
  return [...new Set(subnets)]
}

async function scanNetwork9100(subnet) {
  const ips = []
  const testIp = (ip) => new Promise((resolve) => {
    const socket = new net.Socket()
    let resolved = false
    const done = (ok) => { if (!resolved) { resolved = true; try { socket.destroy() } catch {} ; resolve(ok) } }
    socket.setTimeout(800)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
    try { socket.connect(9100, ip) } catch { done(false) }
  })
  const tasks = []
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}${i}`
    tasks.push((async () => { const ok = await testIp(ip); if (ok) ips.push(ip) })())
  }
  await Promise.all(tasks)
  return ips
}

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { ws.send(JSON.stringify({ ok: false, error: 'invalid_json' })); return }
    const { action, payload } = msg
    try {
      switch (action) {
        case 'connect_printer': {
          const requestedAddress = String(payload?.address || '').trim()
          const ok = requestedAddress
            ? openPrinter(payload?.transport || 'network', requestedAddress)
            : restoreConfiguredPrinter()
          ws.send(JSON.stringify({ ok, event: 'printer_connected' }))
          break
        }
        case 'test_print': {
          restoreConfiguredPrinter()
          const ok = (systemPrinterName || networkAddress) ? await printTest() : false
          ws.send(JSON.stringify({ ok, event: 'printed_test' }))
          break
        }
        case 'print_receipt': {
          restoreConfiguredPrinter()
          const ok = (systemPrinterName || networkAddress) ? await printReceipt(payload) : false
          ws.send(JSON.stringify({ ok, event: 'printed_receipt' }))
          break
        }
        case 'open_cash_drawer': {
          restoreConfiguredPrinter()
          const ok = await openCashDrawer(payload)
          ws.send(JSON.stringify({
            ok,
            event: 'cash_drawer_opened',
            error: ok ? undefined : 'printer_not_configured_or_unavailable',
          }))
          break
        }
        case 'scan_network_printers': {
          const subnets = payload?.subnets && Array.isArray(payload.subnets) && payload.subnets.length > 0 ? payload.subnets : getLocalSubnets()
          const results = []
          for (const subnet of subnets) {
            const found = await scanNetwork9100(subnet)
            for (const ip of found) results.push({ ip, transport: 'network' })
          }
          ws.send(JSON.stringify({ ok: true, event: 'scan_network_done', printers: results }))
          break
        }
        case 'scan_usb_printers': {
          const list = []
          ws.send(JSON.stringify({ ok: true, event: 'scan_usb_done', printers: list }))
          break
        }
        case 'scan_os_printers': {
          try {
            const printers = printerLib.getPrinters() || []
            ws.send(JSON.stringify({ ok: true, event: 'scan_os_done', printers: printers.map(p => ({ name: p.name, isDefault: p.isDefault, transport: 'system' })) }))
          } catch (e) {
            ws.send(JSON.stringify({ ok: false, event: 'scan_os_done', printers: [] }))
          }
          break
        }
        case 'list_serial_ports': {
          const ports = await listSerialPorts()
          ws.send(JSON.stringify({ ok: true, event: 'serial_ports_listed', ports }))
          break
        }
        case 'list_scale_protocols': {
          const protocols = Object.entries(SCALE_PROTOCOLS).map(([id, config]) => ({ id, name: config.name, baudRate: config.baudRate }))
          ws.send(JSON.stringify({ ok: true, event: 'scale_protocols_listed', protocols }))
          break
        }
        case 'connect_scale': {
          const result = await connectScale(payload)
          ws.send(JSON.stringify({ ...result, event: 'scale_connected' }))
          break
        }
        case 'disconnect_scale': {
          await closeScale()
          ws.send(JSON.stringify({ ok: true, event: 'scale_disconnected' }))
          break
        }
        case 'read_weight': {
          const result = await readScaleWeight(payload?.timeoutMs)
          ws.send(JSON.stringify({ ...result, event: 'weight_read' }))
          break
        }
        case 'tare_scale': {
          const protocol = SCALE_PROTOCOLS[scaleConfig?.protocol] || SCALE_PROTOCOLS.generic
          const ok = await writeScaleCommand(protocol.tare)
          ws.send(JSON.stringify({ ok, event: 'scale_tared' }))
          break
        }
        case 'zero_scale': {
          const protocol = SCALE_PROTOCOLS[scaleConfig?.protocol] || SCALE_PROTOCOLS.generic
          const ok = await writeScaleCommand(protocol.zero)
          ws.send(JSON.stringify({ ok, event: 'scale_zeroed' }))
          break
        }
        case 'get_status': {
          restoreConfiguredPrinter()
          ws.send(JSON.stringify({
            ok: true,
            event: 'status',
            printer: { connected: Boolean(systemPrinterName || networkAddress), systemPrinterName, networkAddress },
            scale: { connected: Boolean(scalePort?.isOpen), config: scaleConfig, reading: latestScaleReading },
          }))
          break
        }
        default:
          ws.send(JSON.stringify({ ok: false, error: 'unknown_action' }))
      }
    } catch (e) {
      ws.send(JSON.stringify({ ok: false, error: String(e?.message || e) }))
    }
  })
  ws.send(JSON.stringify({ ok: true, event: 'connected' }))
})

console.log(`Pop Connect listening on ws://${bridgeHost}:${bridgePort}`)

const supabaseUrl = getEnv('SUPABASE_URL', 'BORACUME_SUPABASE_URL')
const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY', 'BORACUME_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
const printAgentToken = getEnv('PRINT_AGENT_TOKEN')
const relayTransport = getEnv('PRINT_TRANSPORT', 'BRIDGE_TRANSPORT') || 'system'
const relayAddress = getEnv('PRINT_ADDRESS', 'BRIDGE_ADDRESS') || ''
const relayIntervalMs = Number(getEnv('PRINT_RELAY_INTERVAL_MS') || '2000')
const reportIntervalMs = Number(getEnv('PRINT_REPORT_INTERVAL_MS') || '5000')

async function pollPrintJobs() {
  if (!supabaseUrl || !supabaseAnonKey || !printAgentToken) return
  try {
    const resp = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/print-agent-poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'x-print-agent-token': printAgentToken,
      },
      body: JSON.stringify({ limit: 5 }),
    })
    const json = await resp.json().catch(() => ({}))
    const jobs = Array.isArray(json?.jobs) ? json.jobs : []
    if (jobs.length === 0) return

    for (const job of jobs) {
      let ok = false
      let errText = ''
      try {
        const printerCfg = job?.payload?.printer || {}
        const transport = printerCfg.transport || relayTransport
        const address = printerCfg.address || relayAddress || undefined
        try { openPrinter(transport, address) } catch {}
        ok = await printReceipt(job?.payload || {})
      } catch (e) {
        ok = false
        errText = String(e?.message || e)
      }

      await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/print-agent-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'x-print-agent-token': printAgentToken,
        },
        body: JSON.stringify({ jobId: job.id, ok, error: errText }),
      }).catch(() => {})
    }
  } catch {
  }
}

async function reportPrinters() {
  if (!supabaseUrl || !supabaseAnonKey || !printAgentToken) return
  try {
    let printers = []
    try {
      const list = printerLib.getPrinters() || []
      printers = list.map((p) => ({
        printer_id: p.name,
        name: p.isDefault ? `${p.name} (padrão)` : p.name,
        transport: 'system',
        address: p.name,
        meta: { isDefault: !!p.isDefault, status: p.status || null },
      }))
    } catch {
      printers = []
    }

    await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/print-agent-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'x-print-agent-token': printAgentToken,
      },
      body: JSON.stringify({ printers }),
    }).catch(() => {})
  } catch {
  }
}

try {
  openPrinter(relayTransport, relayAddress || undefined)
} catch {
}

const configuredScalePort = getEnv('SCALE_PORT', 'POP_CONNECT_SCALE_PORT')
if (configuredScalePort) {
  connectScale({
    portPath: configuredScalePort,
    protocol: getEnv('SCALE_PROTOCOL', 'POP_CONNECT_SCALE_PROTOCOL') || 'generic',
    baudRate: Number(getEnv('SCALE_BAUD_RATE', 'POP_CONNECT_SCALE_BAUD_RATE') || 0) || undefined,
  }).catch(() => {})
}

if (supabaseUrl && supabaseAnonKey && printAgentToken) {
  setInterval(pollPrintJobs, Math.max(500, relayIntervalMs))
  setInterval(reportPrinters, Math.max(1000, reportIntervalMs))
  reportPrinters()
}
