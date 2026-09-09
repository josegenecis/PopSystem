const { app, BrowserWindow, ipcMain } = require('electron')
const { Tray, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, exec } = require('child_process')

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gcfyrcpugmducptktjic.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjZnlyY3B1Z21kdWNwdGt0amljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc5MzAwNjUsImV4cCI6MjA2MzUwNjA2NX0.G9l2LEE6DtnSGChmGx5sTCQhC7yVHZJtq6rTTsti2aE'

const configPath = () => path.join(app.getPath('userData'), 'bridge-config.json')
const readConfig = () => {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) } catch { return {} }
}
const writeConfig = (cfg) => {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}

let bridgeProc = null
let tray = null
let win = null

const stopBridge = () => {
  try { bridgeProc?.kill() } catch {}
  bridgeProc = null
}

const startBridge = (token) => {
  stopBridge()
  const cfg = readConfig()
  const env = {
    ...process.env,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    PRINT_AGENT_TOKEN: token,
    PRINT_TRANSPORT: 'system',
    PRINT_ADDRESS: cfg?.printerName || '',
    POP_CONNECT_DATA_DIR: app.getPath('userData'),
    POP_CONNECT_BIOMETRIC_PROVIDER: cfg?.biometricProvider || 'not_configured',
    POP_CONNECT_BIOMETRIC_SIDECAR: cfg?.biometricSidecar || '',
    POP_CONNECT_BIOMETRIC_DEVICE_ID: cfg?.biometricDeviceId || '',
    POP_CONNECT_ALLOW_BIOMETRIC_SIMULATION: cfg?.biometricProvider === 'simulator' ? 'true' : 'false',
  }

  const serverPath = path.join(__dirname, '..', 'native-bridge', 'server.js')
  bridgeProc = spawn(process.execPath, [serverPath], { env, stdio: 'ignore' })
  bridgeProc.on('exit', () => { bridgeProc = null })
}

const fetchJson = async (url, options) => {
  const res = await fetch(url, options)
  const text = await res.text()
  try { return JSON.parse(text) } catch { return {} }
}

const functionsBase = () => `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1`

const createWindow = () => {
  win = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 520,
    minHeight: 620,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'bridge-preload.js')
    }
  })
  win.loadFile(path.join(__dirname, 'bridge-ui.html'))
  win.on('close', (e) => {
    e.preventDefault()
    win.hide()
  })
}

const createTray = () => {
  const iconPath = path.join(__dirname, '..', 'public', 'LOGOMARCA', 'ICONE DESKTOP.png')
  tray = new Tray(iconPath)
  tray.setToolTip('PopConnect')
  tray.on('double-click', () => {
    if (win) win.show()
  })
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir', click: () => win && win.show() },
    { type: 'separator' },
    { label: 'Sair', click: () => { stopBridge(); app.exit(0) } },
  ])
  tray.setContextMenu(menu)
}

ipcMain.handle('bridge:getStatus', async () => {
  const cfg = readConfig()
  return {
    paired: !!cfg.token,
    running: !!bridgeProc,
    pairingCode: cfg.pairingCode || null,
  }
})

ipcMain.handle('bridge:startPairing', async () => {
  const cfg = readConfig()
  const url = `${functionsBase()}/print-agent-pair-start`
  const json = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({})
  })
  if (!json?.ok || !json?.pairingCode) return { ok: false }
  writeConfig({ ...cfg, pairingCode: String(json.pairingCode), token: cfg.token || null })
  return { ok: true, pairingCode: String(json.pairingCode) }
})

ipcMain.handle('bridge:pollPairing', async () => {
  const cfg = readConfig()
  const code = cfg.pairingCode
  if (!code) return { ok: false, status: 'missing' }
  const url = `${functionsBase()}/print-agent-pair-poll`
  const json = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ pairingCode: code })
  })
  if (json?.status === 'ready' && json?.token) {
    const next = { ...cfg, token: String(json.token), pairingCode: null }
    writeConfig(next)
    startBridge(next.token)
    return { ok: true, status: 'paired' }
  }
  return { ok: true, status: json?.status || 'waiting' }
})

ipcMain.handle('bridge:start', async () => {
  const cfg = readConfig()
  if (!cfg.token) return { ok: false, error: 'not_paired' }
  startBridge(cfg.token)
  return { ok: true }
})

ipcMain.handle('bridge:stop', async () => {
  stopBridge()
  return { ok: true }
})

ipcMain.handle('bridge:listPrinters', async () => {
  if (process.platform !== 'win32') return { ok: true, printers: [] }
  return await new Promise((resolve) => {
    const cmd = 'powershell "Get-Printer | Select-Object Name, PrinterStatus, DriverName, PortName, Shared, Published, IsDefault | ConvertTo-Json"'
    exec(cmd, { windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ ok: false, printers: [] })
      try {
        const data = JSON.parse(stdout || '[]')
        const arr = Array.isArray(data) ? data : (data ? [data] : [])
        resolve({
          ok: true,
          printers: arr.map((p) => ({
            name: p.Name,
            isDefault: !!p.IsDefault,
            status: p.PrinterStatus,
            driver: p.DriverName,
            port: p.PortName,
          })),
        })
      } catch {
        resolve({ ok: false, printers: [] })
      }
    })
  })
})

ipcMain.handle('bridge:getPrinterSelection', async () => {
  const cfg = readConfig()
  return { ok: true, printerName: cfg?.printerName || '' }
})

ipcMain.handle('bridge:setPrinterSelection', async (_ev, payload) => {
  const cfg = readConfig()
  const printerName = payload?.printerName ? String(payload.printerName) : ''
  writeConfig({ ...cfg, printerName })
  if (cfg?.token) startBridge(cfg.token)
  return { ok: true }
})

ipcMain.handle('bridge:getBiometricConfig', async () => {
  const cfg = readConfig()
  return {
    ok: true,
    provider: cfg?.biometricProvider || 'not_configured',
    sidecarPath: cfg?.biometricSidecar || '',
    deviceId: cfg?.biometricDeviceId || '',
  }
})

ipcMain.handle('bridge:setBiometricConfig', async (_ev, payload) => {
  const cfg = readConfig()
  const provider = ['not_configured', 'simulator', 'sdk_sidecar'].includes(payload?.provider)
    ? payload.provider
    : 'not_configured'
  const next = {
    ...cfg,
    biometricProvider: provider,
    biometricSidecar: String(payload?.sidecarPath || '').trim(),
    biometricDeviceId: String(payload?.deviceId || '').trim(),
  }
  writeConfig(next)
  if (cfg?.token) startBridge(cfg.token)
  return { ok: true }
})

app.whenReady().then(() => {
  const cfg = readConfig()
  if (cfg?.token) startBridge(cfg.token)
  app.setLoginItemSettings({ openAtLogin: true })
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  createTray()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    return
  }
})
