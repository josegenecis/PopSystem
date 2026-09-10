const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron')
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

const startupLogPath = () => path.join(app.getPath('userData'), 'startup.log')
const logStartupError = (context, error) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error)
  try {
    fs.mkdirSync(path.dirname(startupLogPath()), { recursive: true })
    fs.appendFileSync(startupLogPath(), `[${new Date().toISOString()}] ${context}\n${message}\n\n`)
  } catch {}
  return message
}

const showStartupError = (context, error) => {
  const message = logStartupError(context, error)
  try { dialog.showErrorBox('PopConnect não pôde iniciar', `${message}\n\nLog: ${startupLogPath()}`) } catch {}
}

process.on('uncaughtException', (error) => showStartupError('uncaughtException', error))
process.on('unhandledRejection', (error) => showStartupError('unhandledRejection', error))

const stopBridge = () => {
  try { bridgeProc?.kill() } catch {}
  bridgeProc = null
}

const nativeBridgePath = (...segments) => app.isPackaged
  ? path.join(process.resourcesPath, 'native-bridge', ...segments)
  : path.join(__dirname, '..', 'native-bridge', ...segments)

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
    ELECTRON_RUN_AS_NODE: '1',
  }

  const serverPath = nativeBridgePath('server.js')
  bridgeProc = spawn(process.execPath, [serverPath], { env, stdio: 'ignore' })
  bridgeProc.on('error', (error) => {
    logStartupError('native bridge process', error)
    bridgeProc = null
  })
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
    height: 520,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'bridge-preload.cjs')
    }
  })
  win.loadFile(path.join(__dirname, 'bridge-ui.html'))
  win.on('close', (e) => {
    e.preventDefault()
    win.hide()
  })
}

const createTray = () => {
  const iconPath = path.join(__dirname, '..', 'public', 'icon-512x512.png')
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

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(() => {
    try {
      createWindow()
      createTray()
      const cfg = readConfig()
      if (cfg?.token) startBridge(cfg.token)
      app.setLoginItemSettings({ openAtLogin: true })
    } catch (error) {
      showStartupError('startup', error)
      if (!win) app.quit()
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    return
  }
})
