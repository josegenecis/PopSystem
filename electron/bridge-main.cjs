const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, exec, execFile } = require('child_process')

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
let installingUpdate = false
let updateStatus = { state: 'idle', message: 'Pop Connect atualizado.' }

const LOGIN_START_ARG = '--popsystem-login-start'
const POPSYSTEM_PWA_URL = 'https://popsystem.com.br/pwa?source=installed'

const setLoginStartup = (enabled) => {
  const settings = { openAtLogin: Boolean(enabled) }
  if (process.platform === 'win32') settings.args = [LOGIN_START_ARG]
  app.setLoginItemSettings(settings)
}

const emitUpdateStatus = (state, message) => {
  updateStatus = { state, message: String(message || '') }
  if (win && !win.isDestroyed()) win.webContents.send('bridge:updateStatus', updateStatus)
}

const findInstalledPwaShortcut = () => {
  if (process.platform !== 'win32') return ''
  const programs = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const candidates = [
    path.join(programs, 'Chrome Apps'),
    path.join(programs, 'Microsoft Edge Apps'),
    path.join(programs, 'Edge Apps'),
  ]
  for (const directory of candidates) {
    try {
      const match = fs.readdirSync(directory, { withFileTypes: true }).find((entry) => {
        const normalized = entry.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        return entry.isFile() && entry.name.toLowerCase().endsWith('.lnk') && normalized.includes('popsystem')
      })
      if (match) return path.join(directory, match.name)
    } catch {}
  }
  return ''
}

const launchPopSystemPwa = async () => {
  if (process.platform !== 'win32') return
  const shortcut = findInstalledPwaShortcut()
  if (shortcut) {
    const error = await shell.openPath(shortcut)
    if (!error) return
    logStartupError('pwa shortcut', error)
  }

  const localAppData = process.env.LOCALAPPDATA || ''
  const programFiles = process.env.ProgramFiles || ''
  const programFilesX86 = process.env['ProgramFiles(x86)'] || ''
  const browserCandidates = [
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean)
  const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate))
  if (browserPath) {
    const browser = spawn(browserPath, [`--app=${POPSYSTEM_PWA_URL}`, '--start-maximized'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    browser.unref()
    return
  }
  await shell.openExternal(POPSYSTEM_PWA_URL)
}

const configureAutoUpdater = () => {
  // O canal atual publica instaladores NSIS. O macOS continuará usando a
  // versão instalada até termos artefatos assinados e um canal próprio.
  if (!app.isPackaged || process.platform !== 'win32') return
  let autoUpdater
  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch (error) {
    logStartupError('auto updater unavailable', error)
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://popsystem.com.br/api/bridge/update',
  })
  autoUpdater.logger = {
    info: (...args) => logStartupError('auto update info', args.join(' ')),
    warn: (...args) => logStartupError('auto update warning', args.join(' ')),
    error: (...args) => logStartupError('auto update error', args.join(' ')),
    debug: () => {},
  }
  autoUpdater.on('checking-for-update', () => emitUpdateStatus('checking', 'Verificando atualização...'))
  autoUpdater.on('update-available', (info) => emitUpdateStatus('downloading', `Baixando Pop Connect ${info?.version || ''}...`))
  autoUpdater.on('update-not-available', () => emitUpdateStatus('ready', 'Pop Connect atualizado.'))
  autoUpdater.on('download-progress', (progress) => {
    emitUpdateStatus('downloading', `Baixando atualização: ${Math.round(Number(progress?.percent) || 0)}%`)
  })
  autoUpdater.on('update-downloaded', () => {
    installingUpdate = true
    emitUpdateStatus('installing', 'Instalando atualização automática...')
    stopBridge()
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 700)
  })
  autoUpdater.on('error', (error) => {
    logStartupError('auto update', error)
    emitUpdateStatus('error', 'Não foi possível verificar a atualização agora.')
  })
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => logStartupError('auto update check', error))
  }, 1800)
}

function bitmapToEscPos(bitmap, width, height, options = {}) {
  const safeWidth = Math.max(1, Number(width) || 1)
  const safeHeight = Math.max(1, Number(height) || 1)
  const bytesPerLine = Math.ceil(safeWidth / 8)
  const raster = Buffer.alloc(bytesPerLine * safeHeight)
  const bandHeightLimit = 128
  const bayer4x4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ]

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const offset = (y * safeWidth + x) * 4
      const blue = bitmap[offset] ?? 255
      const green = bitmap[offset + 1] ?? 255
      const red = bitmap[offset + 2] ?? 255
      const alpha = bitmap[offset + 3] ?? 255
      const luminance = (red * 299 + green * 587 + blue * 114) / 1000
      const threshold = 80 + bayer4x4[y % 4][x % 4] * 8
      if (alpha > 24 && luminance < threshold) {
        const byteIndex = y * bytesPerLine + Math.floor(x / 8)
        raster[byteIndex] |= 0x80 >> (x % 8)
      }
    }
  }

  const bands = []
  for (let startRow = 0; startRow < safeHeight; startRow += bandHeightLimit) {
    const bandHeight = Math.min(bandHeightLimit, safeHeight - startRow)
    const bandStart = startRow * bytesPerLine
    const bandEnd = bandStart + bandHeight * bytesPerLine
    bands.push(
      Buffer.from([
        0x1d, 0x76, 0x30, 0x00,
        bytesPerLine & 0xff, (bytesPerLine >> 8) & 0xff,
        bandHeight & 0xff, (bandHeight >> 8) & 0xff,
      ]),
      raster.subarray(bandStart, bandEnd),
    )
  }

  const finish = options.fragment
    ? Buffer.from([0x1b, 0x61, 0x00, 0x0a])
    : Buffer.from([0x1b, 0x61, 0x00, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x41, 0x00])
  return Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x01]),
    ...bands,
    finish,
  ])
}

async function renderReceiptHtml(html, options = {}) {
  let renderWindow
  try {
    renderWindow = new BrowserWindow({
      show: false,
      width: 380,
      height: 800,
      backgroundColor: '#ffffff',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    await renderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(String(html || ''))}`)
    const metrics = await renderWindow.webContents.executeJavaScript(`
      (async () => {
        try {
          if (document.fonts?.ready) await document.fonts.ready;
          await Promise.all(Array.from(document.images || []).map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise((resolve) => {
              image.addEventListener('load', resolve, { once: true });
              image.addEventListener('error', resolve, { once: true });
            });
          }));
        } catch {}
        const root = document.documentElement;
        const body = document.body;
        const paperWidth = String(root.dataset.paperWidth || '80mm').toLowerCase();
        const paperWidthMm = paperWidth === '58mm' ? 58 : 80;
        const bodyRect = body.getBoundingClientRect();
        const bodyTop = Number(bodyRect.top || 0);
        const childBottom = Math.max(
          Number(bodyRect.bottom || 0),
          ...Array.from(body.children || []).map((element) => Number(element.getBoundingClientRect?.().bottom || 0))
        );
        return {
          paperWidth,
          width: Math.ceil((paperWidthMm / 25.4) * 96),
          height: Math.ceil(Math.max(bodyRect.height, childBottom - bodyTop, 1))
        };
      })()
    `, true)
    const viewportWidth = Math.max(220, Math.min(1000, Number(metrics?.width) || 302))
    const viewportHeight = Math.max(32, Math.min(12000, Number(metrics?.height) || 32))
    renderWindow.setContentSize(viewportWidth, viewportHeight)
    await new Promise((resolve) => setTimeout(resolve, 60))
    const image = await renderWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: viewportWidth,
      height: viewportHeight,
    })
    const targetWidth = metrics?.paperWidth === '58mm' ? 384 : 576
    const resized = image.resize({ width: targetWidth, quality: 'best' })
    const size = resized.getSize()
    return bitmapToEscPos(resized.toBitmap(), size.width, size.height, options)
  } finally {
    try {
      if (renderWindow && !renderWindow.isDestroyed()) renderWindow.close()
    } catch {}
  }
}

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

const execFileText = (file, args) => new Promise((resolve) => {
  execFile(file, args, { encoding: 'utf8' }, (error, stdout) => {
    resolve(error ? '' : String(stdout || '').trim())
  })
})

const cleanupOrphanedBridge = async () => {
  if (process.platform !== 'darwin') return
  const output = await execFileText('/usr/sbin/lsof', [
    '-nP',
    `-iTCP:${POP_CONNECT_PORT}`,
    '-sTCP:LISTEN',
    '-t',
  ])
  const pids = [...new Set(output.split(/\s+/).map(Number).filter(Number.isInteger))]
  const stopped = []
  for (const pid of pids) {
    if (pid === process.pid) continue
    const command = await execFileText('/bin/ps', ['-p', String(pid), '-o', 'command='])
    const isPopConnectBridge = command.includes('/Pop Connect.app/Contents/MacOS/Pop Connect')
      && command.includes('/native-bridge/server.js')
    if (!isPopConnectBridge) continue
    try {
      process.kill(pid, 'SIGTERM')
      stopped.push(pid)
    } catch {}
  }
  if (!stopped.length) return
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const alive = stopped.some((pid) => {
      try { process.kill(pid, 0); return true } catch { return false }
    })
    if (!alive) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const stopBridge = () => {
  const child = bridgeProc
  if (!child) return null
  bridgeProc = null
  try { child.kill() } catch {}
  return child
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
  const child = spawn(process.execPath, [serverPath], {
    env,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  bridgeProc = child
  child.on('message', async (message) => {
    if (message?.type !== 'render_receipt' || !message?.requestId) return
    try {
      const bytes = await renderReceiptHtml(message.html, { fragment: Boolean(message.fragment) })
      if (child.connected) {
        child.send({
          type: 'render_receipt_result',
          requestId: message.requestId,
          ok: true,
          data: bytes.toString('base64'),
        })
      }
    } catch (error) {
      logStartupError('receipt renderer', error)
      if (child.connected) {
        child.send({ type: 'render_receipt_result', requestId: message.requestId, ok: false })
      }
    }
  })
  child.on('error', (error) => {
    logStartupError('native bridge process', error)
    if (bridgeProc === child) bridgeProc = null
  })
  child.on('exit', () => {
    if (bridgeProc === child) bridgeProc = null
  })
}

const restartBridge = async (token) => {
  const previous = stopBridge()
  if (previous && previous.exitCode == null) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1200)
      previous.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
  startBridge(token)
  // O processo nativo precisa abrir a porta 8766 antes do primeiro comando.
  await new Promise((resolve) => setTimeout(resolve, 450))
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
    if (installingUpdate) return
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
        if (connected?.ok) await bridgeCommand('open_cash_drawer', { connector: 'auto' }, 'cash_drawer_opened')
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
  await restartBridge(cfg.token || '')
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
  const selectionChanged = printerName !== String(cfg?.printerName || '')
  writeConfig({ ...cfg, printerName })
  if (selectionChanged || !bridgeProc) {
    await restartBridge(cfg?.token || '')
  }
  return { ok: true }
})

ipcMain.handle('bridge:testPrinter', async () => {
  const cfg = readConfig()
  if (!cfg?.printerName) return { ok: false, error: 'printer_not_selected' }
  const connected = await bridgeCommand('connect_printer', { transport: 'system', address: cfg.printerName }, 'printer_connected')
  if (!connected?.ok) return connected
  return await bridgeCommand('test_print', {}, 'printed_test', 10000)
})

ipcMain.handle('bridge:openCashDrawer', async () => {
  const cfg = readConfig()
  if (!cfg?.printerName) return { ok: false, error: 'printer_not_selected' }
  const connected = await bridgeCommand('connect_printer', { transport: 'system', address: cfg.printerName }, 'printer_connected')
  if (!connected?.ok) return connected
  return await bridgeCommand('open_cash_drawer', { connector: 'auto' }, 'cash_drawer_opened')
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
  if (bridgeProc) await restartBridge(cfg.token || '')
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
  const cfg = readConfig()
  const enabled = payload?.enabled !== false
  writeConfig({ ...cfg, autoStartEnabled: enabled })
  setLoginStartup(enabled)
  return { ok: true, enabled }
})

ipcMain.handle('bridge:getOpenPwaAtLogin', async () => {
  const cfg = readConfig()
  return { ok: true, enabled: cfg?.openPwaAtLogin !== false }
})

ipcMain.handle('bridge:setOpenPwaAtLogin', async (_event, payload) => {
  const cfg = readConfig()
  const enabled = payload?.enabled !== false
  writeConfig({ ...cfg, openPwaAtLogin: enabled })
  return { ok: true, enabled }
})

ipcMain.handle('bridge:getUpdateStatus', async () => ({ ok: true, ...updateStatus }))

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  try {
    createWindow()
    createTray()
    const cfg = readConfig()
    await cleanupOrphanedBridge()
    startBridge(cfg?.token || '')
    setLoginStartup(cfg?.autoStartEnabled !== false)
    if (process.argv.includes(LOGIN_START_ARG) && cfg?.openPwaAtLogin !== false) {
      setTimeout(() => launchPopSystemPwa().catch((error) => logStartupError('launch pwa', error)), 1200)
    }
    configureAutoUpdater()
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

app.on('before-quit', () => {
  stopBridge()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    return
  }
})
