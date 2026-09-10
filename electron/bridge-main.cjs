const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, exec } = require('child_process')

app.setName('Pop Connect')
app.setPath('userData', path.join(app.getPath('appData'), 'Pop Connect'))
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

const POP_CONNECT_PORT = 8766
const SCALE_PROTOCOLS = [
  { id: 'toledo', name: 'Toledo Prix', baudRate: 9600 },
  { id: 'filizola', name: 'Filizola', baudRate: 9600 },
  { id: 'urano', name: 'Urano', baudRate: 4800 },
  { id: 'magna', name: 'Magna', baudRate: 9600 },
  { id: 'elgin', name: 'Elgin', baudRate: 9600 },
  { id: 'generic', name: 'Outra / genérica', baudRate: 9600 },
]

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
  try { dialog.showErrorBox('Pop Connect não pôde iniciar', `${message}\n\nLog: ${startupLogPath()}`) } catch {}
}

process.on('uncaughtException', (error) => showStartupError('uncaughtException', error))
process.on('unhandledRejection', (error) => showStartupError('unhandledRejection', error))

const nativeBridgePath = (...segments) => app.isPackaged
  ? path.join(process.resourcesPath, 'native-bridge', ...segments)
  : path.join(__dirname, '..', 'native-bridge', ...segments)

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
    SCALE_PORT: cfg?.scale?.portPath || '',
    SCALE_PROTOCOL: cfg?.scale?.protocol || 'generic',
    SCALE_BAUD_RATE: String(cfg?.scale?.baudRate || ''),
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

const getBridgeWebSocket = () => {
  try {
    return require('ws')
  } catch {
    return require(nativeBridgePath('node_modules', 'ws'))
  }
}

const bridgeCommand = async (action, payload = {}, expectedEvent, timeoutMs = 6000) => {
  if (!bridgeProc) {
    const cfg = readConfig()
    startBridge(cfg.token || '')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  const WebSocket = getBridgeWebSocket()
  const sendOnce = () => new Promise((resolve) => {
    let settled = false
    let ws
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try { ws?.close() } catch {}
      resolve(value)
    }
    const timeout = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs)
    try {
      ws = new WebSocket(`ws://127.0.0.1:${POP_CONNECT_PORT}`)
      ws.once('open', () => ws.send(JSON.stringify({ action, payload })))
      ws.on('message', (raw) => {
        try {
          const result = JSON.parse(String(raw))
          if (!expectedEvent || result?.event === expectedEvent) finish(result)
        } catch {}
      })
      ws.once('error', (error) => finish({ ok: false, error: error?.message || 'connection_failed' }))
    } catch (error) {
      finish({ ok: false, error: error?.message || 'connection_failed' })
    }
  })

  let result = { ok: false, error: 'connection_failed' }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await sendOnce()
    if (result?.ok || result?.error === 'timeout') return result
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return result
}

const createWindow = () => {
  win = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 1040,
    minHeight: 700,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f7f4',
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
  const iconPath = path.join(__dirname, '..', 'public', 'LOGOMARCA', 'ICONE DESKTOP.png')
  let trayIcon = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') {
    const pattern = [
      '................',
      '...#######......',
      '...##....##.....',
      '...##.....##....',
      '...##.....##....',
      '...##....##.....',
      '...#######......',
      '...##...........',
      '...##...........',
      '...##...........',
      '...##...........',
      '...##...........',
      '...##...........',
      '...##...........',
      '................',
      '................',
    ]
    const makeTemplateBitmap = (scale) => {
      const size = pattern.length * scale
      const bitmap = Buffer.alloc(size * size * 4)
      pattern.forEach((row, y) => {
        Array.from(row).forEach((pixel, x) => {
          if (pixel !== '#') return
          for (let offsetY = 0; offsetY < scale; offsetY += 1) {
            for (let offsetX = 0; offsetX < scale; offsetX += 1) {
              const index = (((y * scale) + offsetY) * size + (x * scale) + offsetX) * 4
              bitmap[index] = 255
              bitmap[index + 1] = 255
              bitmap[index + 2] = 255
              bitmap[index + 3] = 255
            }
          }
        })
      })
      return { bitmap, size }
    }
    const standard = makeTemplateBitmap(1)
    const retina = makeTemplateBitmap(2)
    trayIcon = nativeImage.createFromBitmap(standard.bitmap, { width: standard.size, height: standard.size, scaleFactor: 1 })
    trayIcon.addRepresentation({ buffer: retina.bitmap, width: retina.size, height: retina.size, scaleFactor: 2 })
    trayIcon.setTemplateImage(true)
  } else {
    trayIcon = trayIcon.resize({ width: 18, height: 18 })
  }
  tray = new Tray(trayIcon)
  tray.setToolTip('Pop Connect')
  tray.on('double-click', () => {
    if (win) win.show()
  })
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir', click: () => win && win.show() },
    {
      label: 'Abrir gaveta',
      click: async () => {
        const cfg = readConfig()
        if (!cfg?.printerName) return win && win.show()
        const connected = await bridgeCommand('connect_printer', { transport: 'system', address: cfg.printerName }, 'printer_connected')
        if (connected?.ok) await bridgeCommand('open_cash_drawer', { connector: 0 }, 'cash_drawer_opened')
      },
    },
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
    printerName: cfg?.printerName || '',
    scale: cfg?.scale || null,
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
  startBridge(cfg.token || '')
  return { ok: true }
})

ipcMain.handle('bridge:stop', async () => {
  stopBridge()
  return { ok: true }
})

ipcMain.handle('bridge:listPrinters', async () => {
  if (process.platform !== 'win32') {
    const result = await bridgeCommand('scan_os_printers', {}, 'scan_os_done')
    return { ok: !!result?.ok, printers: result?.printers || [] }
  }
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
  startBridge(cfg?.token || '')
  return { ok: true }
})

ipcMain.handle('bridge:testPrinter', async () => {
  const cfg = readConfig()
  if (!cfg?.printerName) return { ok: false, error: 'printer_not_selected' }
  await bridgeCommand('connect_printer', { transport: 'system', address: cfg.printerName }, 'printer_connected')
  return await bridgeCommand('test_print', {}, 'printed_test', 10000)
})

ipcMain.handle('bridge:openCashDrawer', async () => {
  const cfg = readConfig()
  if (!cfg?.printerName) return { ok: false, error: 'printer_not_selected' }
  const connected = await bridgeCommand('connect_printer', { transport: 'system', address: cfg.printerName }, 'printer_connected')
  if (!connected?.ok) return connected
  return await bridgeCommand('open_cash_drawer', { connector: 0 }, 'cash_drawer_opened')
})

ipcMain.handle('bridge:listSerialPorts', async () => {
  const result = await bridgeCommand('list_serial_ports', {}, 'serial_ports_listed')
  return { ok: !!result?.ok, ports: result?.ports || [], error: result?.error, protocols: SCALE_PROTOCOLS }
})

ipcMain.handle('bridge:getScaleSelection', async () => {
  const cfg = readConfig()
  return { ok: true, scale: cfg?.scale || null, protocols: SCALE_PROTOCOLS }
})

ipcMain.handle('bridge:setScaleSelection', async (_event, payload) => {
  const cfg = readConfig()
  const protocol = SCALE_PROTOCOLS.some((item) => item.id === payload?.protocol) ? payload.protocol : 'generic'
  const defaultBaudRate = SCALE_PROTOCOLS.find((item) => item.id === protocol)?.baudRate || 9600
  const scale = {
    portPath: String(payload?.portPath || ''),
    protocol,
    baudRate: Number(payload?.baudRate || defaultBaudRate),
  }
  writeConfig({ ...cfg, scale })
  if (bridgeProc) startBridge(cfg.token || '')
  return { ok: true, scale }
})

ipcMain.handle('bridge:connectScale', async (_event, payload) => {
  const cfg = readConfig()
  const selection = payload?.portPath ? payload : cfg?.scale
  if (!selection?.portPath) return { ok: false, error: 'scale_not_selected' }
  const result = await bridgeCommand('connect_scale', selection, 'scale_connected', 10000)
  if (result?.ok) {
    const latest = readConfig()
    writeConfig({ ...latest, scale: selection })
  }
  return result
})

ipcMain.handle('bridge:disconnectScale', async () => {
  return await bridgeCommand('disconnect_scale', {}, 'scale_disconnected')
})

ipcMain.handle('bridge:readWeight', async () => {
  return await bridgeCommand('read_weight', { timeoutMs: 2500 }, 'weight_read', 5000)
})

ipcMain.handle('bridge:getAutoStart', async () => {
  const settings = app.getLoginItemSettings()
  return { ok: true, enabled: !!settings.openAtLogin }
})

ipcMain.handle('bridge:setAutoStart', async (_event, payload) => {
  const enabled = payload?.enabled !== false
  app.setLoginItemSettings({ openAtLogin: enabled })
  return { ok: true, enabled }
})

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  try {
    createWindow()
    createTray()
    const cfg = readConfig()
    startBridge(cfg?.token || '')
    app.setLoginItemSettings({ openAtLogin: true })
  } catch (error) {
    showStartupError('startup', error)
    if (!win) app.quit()
  }
})

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    return
  }
})
