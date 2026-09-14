const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = !app.isPackaged;
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch {}
// Os módulos de hardware são carregados somente depois da verificação de
// atualização. Assim, um driver incompatível nunca bloqueia a autocorreção.
let DeviceManager = null;
let PrinterService = null;
let ScaleService = null;
let PrintAgentServer = null;
let FirebirdMigrationService = null;
let hardwareModulesLoadError = null;

let mainWindow;
let tray = null;
let deviceManager;
let printerService;
let scaleService;
let printAgentServer;
let updateWindow;
let pendingOAuthCallback = '';
let rendererReportsOpenCash = false;
let allowWindowClose = false;
const generatedPdfPreviews = new Set();

function loadHardwareModules() {
  if (DeviceManager && PrinterService && ScaleService && PrintAgentServer) return true;
  if (hardwareModulesLoadError) return false;

  try {
    DeviceManager = require('./services/DeviceManager');
    PrinterService = require('./services/PrinterService');
    ScaleService = require('./services/ScaleService');
    PrintAgentServer = require('./server');
    return true;
  } catch (error) {
    hardwareModulesLoadError = error;
    console.error('Módulos de hardware indisponíveis; o aplicativo continuará sem integração local:', error);
    return false;
  }
}

function loadFirebirdMigrationService() {
  if (FirebirdMigrationService) return FirebirdMigrationService;
  FirebirdMigrationService = require('./services/FirebirdMigrationService');
  return FirebirdMigrationService;
}

function focusMainWindow() {
  if (!mainWindow) {
    if (updateWindow) {
      updateWindow.show();
      updateWindow.focus();
    }
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function handleProtocolUrl(url) {
  if (!String(url || '').toLowerCase().startsWith('popsystem://')) return false;
  pendingOAuthCallback = String(url);
  focusMainWindow();
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('oauth-callback', pendingOAuthCallback);
  }
  return true;
}

// Verificar se deve rodar em modo "Agente" (sem janela principal, apenas Tray)
// Pode ser passado via linha de comando: --agent-mode
const isAgentMode = process.argv.includes('--agent-mode');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', (_event, commandLine) => {
  const protocolUrl = commandLine.find((argument) => String(argument).toLowerCase().startsWith('popsystem://'));
  if (protocolUrl) handleProtocolUrl(protocolUrl);
  else focusMainWindow();
});

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('popsystem', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('popsystem');
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

function createWindow() {
  // Se for modo agente, não criar janela principal imediatamente, ou criar oculta
  if (isAgentMode) {
    createTray();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../public/LOGOMARCA/ICONE DESKTOP.png'),
    show: false,
    titleBarStyle: 'default'
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:8080/#/dashboard');
  } else {
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    if (!fs.existsSync(indexPath)) {
      dialog.showErrorBox('Erro ao iniciar', `Arquivo não encontrado:\n${indexPath}`);
    } else {
      mainWindow.loadFile(indexPath, { hash: '/dashboard' });
    }
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // O carregamento da interface nunca pode deixar o processo invisível.
  const startupVisibilityFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
  }, 3000);
  mainWindow.once('show', () => clearTimeout(startupVisibilityFallback));

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOAuthCallback) mainWindow.webContents.send('oauth-callback', pendingOAuthCallback);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Falha ao carregar UI:', { errorCode, errorDescription, validatedURL });
    dialog.showErrorBox('Erro ao carregar interface', `${errorDescription}\n\nURL:\n${validatedURL}`);
  });

  // Autenticações e páginas de terceiros devem usar o navegador padrão.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    let currentOrigin = '';
    let targetOrigin = '';
    try {
      currentOrigin = new URL(mainWindow.webContents.getURL()).origin;
      targetOrigin = new URL(url).origin;
    } catch {}
    if (/^https?:\/\//i.test(url) && currentOrigin && targetOrigin !== currentOrigin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    if (allowWindowClose || isAgentMode || !rendererReportsOpenCash) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'Caixa ainda aberto',
      message: 'O caixa não foi fechado.',
      detail: 'Para manter a conferência financeira correta, feche o caixa antes de encerrar o PopSystem.',
      buttons: ['Fechar caixa', 'Encerrar mesmo assim', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 0) {
      mainWindow.webContents.send('navigate-to-cash-close');
      focusMainWindow();
    } else if (choice === 1) {
      allowWindowClose = true;
      mainWindow.close();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // No uso normal, fechar a janela significa encerrar integralmente o app,
    // inclusive servidor local e integrações de hardware. Somente a execução
    // explícita com --agent-mode permanece na bandeja.
    if (!isAgentMode) {
      if (tray) {
        try { tray.destroy(); } catch {}
        tray = null;
      }
      app.quit();
    }
  });

  if (isAgentMode && !tray) {
    createTray();
  }

  initializeServices();
}

function createUpdateWindow() {
  updateWindow = new BrowserWindow({
    width: 520,
    height: 240,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, '../public/LOGOMARCA/ICONE DESKTOP.png'),
    title: 'PopSystem'
  });

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>PopSystem</title>
        <style>
          body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:18px;background:#fff;color:#111}
          .title{font-weight:700;font-size:16px;margin-bottom:10px}
          .desc{font-size:13px;color:#444;margin-bottom:14px}
          .bar{height:10px;background:#f2f2f2;border-radius:999px;overflow:hidden}
          .fill{height:100%;width:0%;background:#f97316;border-radius:999px;transition:width .15s ease}
          .meta{margin-top:10px;font-size:12px;color:#666;display:flex;justify-content:space-between;gap:10px}
          .status{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px}
        </style>
      </head>
      <body>
        <div class="title">Atualizando PopSystem</div>
        <div class="desc">Verificando atualizações...</div>
        <div class="bar"><div id="fill" class="fill"></div></div>
        <div class="meta">
          <div id="status" class="status">Aguarde</div>
          <div id="pct">0%</div>
        </div>
        <script>
          function setProgress(p){document.getElementById('fill').style.width = Math.max(0,Math.min(100,p))+'%';document.getElementById('pct').textContent = Math.round(p)+'%';}
          function setStatus(t){document.getElementById('status').textContent=t||'';}
          window.__setProgress=setProgress;
          window.__setStatus=setStatus;
        </script>
      </body>
    </html>
  `;
  updateWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  updateWindow.on('closed', () => {
    updateWindow = null;
  });
}

async function runAutoUpdateFlow() {
  if (isDev) return true;
  if (!autoUpdater) {
    console.warn('Auto-update indisponível: electron-updater não foi carregado.');
    return true;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (...args) => console.log('[auto-update]', ...args),
    warn: (...args) => console.warn('[auto-update]', ...args),
    error: (...args) => console.error('[auto-update]', ...args),
    debug: (...args) => console.log('[auto-update]', ...args),
  };
  const showUi = !isAgentMode;

  return await new Promise((resolve) => {
    let decided = false;
    let updateInProgress = false;
    let checkTimeout = null;
    const done = (result) => {
      if (decided) return;
      decided = true;
      if (checkTimeout) {
        clearTimeout(checkTimeout);
        checkTimeout = null;
      }
      try {
        autoUpdater.removeAllListeners();
      } catch {}
      if (updateWindow) {
        try {
          updateWindow.close();
        } catch {}
      }
      resolve(result);
    };

    const setStatus = (text) => {
      if (!updateWindow) return;
      try {
        updateWindow.webContents.executeJavaScript(`window.__setStatus(${JSON.stringify(String(text || ''))})`, true);
      } catch {}
    };
    const setProgress = (pct) => {
      if (!updateWindow) return;
      try {
        updateWindow.webContents.executeJavaScript(`window.__setProgress(${Number(pct) || 0})`, true);
      } catch {}
    };

    if (showUi) {
      createUpdateWindow();
      setStatus('Verificando atualizações...');
      setProgress(10);
    }

    autoUpdater.on('checking-for-update', () => {
      setStatus('Verificando atualizações...');
      setProgress(15);
    });
    autoUpdater.on('update-available', (info) => {
      updateInProgress = true;
      if (checkTimeout) {
        clearTimeout(checkTimeout);
        checkTimeout = null;
      }
      setStatus(`Baixando atualização ${info?.version || ''}...`.trim());
      setProgress(20);
    });
    autoUpdater.on('update-not-available', () => {
      setStatus('Aplicativo atualizado.');
      setProgress(100);
      setTimeout(() => done(true), 400);
    });
    autoUpdater.on('download-progress', (p) => {
      updateInProgress = true;
      const percent = Number(p?.percent || 0);
      setStatus(`Baixando atualização... ${Math.round(percent)}%`);
      setProgress(20 + (percent * 0.8));
    });
    autoUpdater.on('update-downloaded', (info) => {
      setStatus('Instalando atualização...');
      setProgress(100);
      console.log('[auto-update] Atualização baixada', info?.version || '');
      setTimeout(() => {
        try {
          // A atualização precisa conseguir reiniciar o processo mesmo quando o
          // renderer informou um caixa aberto. Sem isto, o listener de `close`
          // cancela o quitAndInstall e o operador continua usando o bundle antigo.
          allowWindowClose = true;
          autoUpdater.quitAndInstall(true, true);
        } catch {
          allowWindowClose = false;
          done(true);
        }
      }, 500);
    });
    autoUpdater.on('error', (e) => {
      console.error('Auto-update error:', e);
      done(true);
    });

    autoUpdater.checkForUpdates().catch((e) => {
      console.error('Auto-update check failed:', e);
      done(true);
    });

    checkTimeout = setTimeout(() => {
      if (!updateInProgress) done(true);
    }, 45000);
  });
}

function createTray() {
  if (tray) return;
  try {
    const iconPath = path.join(__dirname, '../public/LOGOMARCA/ICONE DESKTOP.png');
    tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      { label: 'PopSystem Print Agent', enabled: false },
      { type: 'separator' },
      { label: 'Status: Rodando', enabled: false },
      { label: 'Porta: 17171', enabled: false },
      { type: 'separator' },
      { 
        label: 'Abrir Painel', 
        click: () => {
          if (mainWindow) {
            mainWindow.show();
          } else {
            // Se estiver em modo agente e usuário clicar em abrir, recria janela normal
            // mas navegando para uma página de status local se possível, ou recarregando app
             if (isAgentMode && !mainWindow) {
               // TODO: Implementar janela de status leve
               // Por enquanto, não faz nada ou abre app completo
             }
             if (!mainWindow) createWindow();
          }
        } 
      },
      { label: 'Sair', click: () => app.quit() }
    ]);

    tray.setToolTip('PopSystem Print Agent');
    tray.setContextMenu(contextMenu);
    
    // Duplo clique abre
    tray.on('double-click', () => {
      if (mainWindow) mainWindow.show();
      else createWindow();
    });

  } catch (error) {
    console.error('Erro ao criar Tray:', error);
  }
}

app.whenReady().then(() => {
  // A janela abre primeiro. Falha, lentidão ou indisponibilidade do provedor de
  // updates nunca mais impede o operador de acessar o sistema.
  createWindow();
  startPrintServer();
  setTimeout(() => {
    void runAutoUpdateFlow().catch((error) => {
      console.error('Falha não bloqueante ao verificar atualização:', error);
    });
  }, 1500);
});

app.on('window-all-closed', () => {
  if (!isAgentMode) app.quit();
});

app.on('activate', () => {
  if (!isAgentMode && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on('cash-session-status', (_event, payload) => {
  rendererReportsOpenCash = payload?.open === true;
});

function initializeServices() {
  try {
    if (!loadHardwareModules()) return;
    // Se já foi inicializado pelo Server, reaproveitar ou garantir singleton
    if (!deviceManager) {
      deviceManager = new DeviceManager();
      printerService = new PrinterService(deviceManager);
      scaleService = new ScaleService(deviceManager);
    }
    console.log('Serviços de dispositivos inicializados com sucesso');
  } catch (error) {
    console.error('Erro ao inicializar serviços:', error);
  }
}

function startPrintServer() {
  try {
    if (!loadHardwareModules()) return;
    printAgentServer = new PrintAgentServer(17171);
    printAgentServer.start();
    
    // Sincronizar instâncias de serviço se necessário
    // O PrintAgentServer cria suas próprias instâncias de DeviceManager, etc.
    // O ideal seria compartilhar, mas para simplificar MVP vamos deixar independentes
    // ou fazer o Server usar os globais se existirem.
    
    // Melhor: O Server instancia seus serviços. Vamos usar as referências dele para o IPC também
    // para evitar conflito de acesso às portas seriais.
    deviceManager = printAgentServer.deviceManager;
    printerService = printAgentServer.printerService;
    scaleService = printAgentServer.scaleService;
    
    console.log('Print Agent Server iniciado');
  } catch (error) {
    console.error('Erro ao iniciar Print Agent Server:', error);
  }
}

// IPC Handlers (mantidos iguais, agora usando as instâncias do Server)
ipcMain.handle('scan-serial-ports', async () => {
  try {
    if (!deviceManager) return { success: false, error: 'Serviços não inicializados' };
    return await deviceManager.scanForDevices(); // Corrigido nome do método se necessário
  } catch (error) {
    console.error('Error scanning serial ports:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-serial-ports', async () => {
  try {
    if (!deviceManager) return { success: false, error: 'Serviços não inicializados', ports: [] };
    const ports = await deviceManager.listSerialPorts();
    return { success: true, ports };
  } catch (error) {
    console.error('Error listing serial ports:', error);
    return { success: false, error: error.message, ports: [] };
  }
});

ipcMain.handle('connect-printer', async (event, deviceId, protocol = 'epson', options = {}) => {
  try {
    if (!printerService) return { success: false, error: 'Serviço de impressora não inicializado' };
    const merged = { ...(options || {}), protocol };
    return await printerService.connectPrinter(deviceId, merged);
  } catch (error) {
    console.error('Error connecting to printer:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('print-receipt', async (event, deviceId, orderData, template = 'receipt') => {
  try {
    if (!printerService) return { success: false, error: 'Serviço de impressora não inicializado' };
    return await printerService.printReceipt(deviceId, orderData, template);
  } catch (error) {
    console.error('Error printing receipt:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('connect-scale', async (event, deviceId, protocol = 'generic', options = {}) => {
  try {
    if (!scaleService) return { success: false, error: 'Serviço de balança não inicializado' };
    return await scaleService.connectScale(deviceId, protocol, options);
  } catch (error) {
    console.error('Error connecting to scale:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-weight', async (event, deviceId, timeout = 5000) => {
  try {
    if (!scaleService) return { success: false, error: 'Serviço de balança não inicializado' };
    return await scaleService.readWeight(deviceId, timeout);
  } catch (error) {
    console.error('Error reading weight:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect-printer', async (event, deviceId) => {
  try {
    if (!printerService) return { success: false, error: 'Serviço de impressora não inicializado' };
    return await printerService.disconnectPrinter(deviceId);
  } catch (error) {
    console.error('Error disconnecting printer:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect-scale', async (event, deviceId) => {
  try {
    if (!scaleService) return { success: false, error: 'Serviço de balança não inicializado' };
    return await scaleService.disconnectScale(deviceId);
  } catch (error) {
    console.error('Error disconnecting scale:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('show-notification', async (event, title, body) => {
  try {
    if (mainWindow && (mainWindow.isMinimized() || !mainWindow.isFocused())) {
      mainWindow.flashFrame(true);
      mainWindow.once('focus', () => {
        try {
          mainWindow.flashFrame(false);
        } catch {}
      });
    }
    if (Notification.isSupported()) {
      // O áudio operacional é controlado pela aplicação (ex.: alerta de pedido).
      // A notificação nativa deve ser sempre silenciosa para não produzir um
      // segundo toque do Windows nem confundir mensagens com novos pedidos.
      new Notification({ title, body, icon: path.join(__dirname, '../assets/icon.png'), silent: true }).show();
    }
    return { success: true };
  } catch (error) {
    console.error('Error showing notification:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('tare-scale', async (event, deviceId) => {
  try {
    if (!scaleService) return { success: false, error: 'Serviço de balança não inicializado' };
    return await scaleService.tareScale(deviceId);
  } catch (error) {
    console.error('Error taring scale:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('zero-scale', async (event, deviceId) => {
  try {
    if (!scaleService) return { success: false, error: 'Serviço de balança não inicializado' };
    return await scaleService.zeroScale(deviceId);
  } catch (error) {
    console.error('Error zeroing scale:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('calibrate-scale', async (event, deviceId, knownWeight, currentReading) => {
  try {
    if (!scaleService) return { success: false, error: 'Serviço de balança não inicializado' };
    return await scaleService.calibrateScale(deviceId, knownWeight, currentReading);
  } catch (error) {
    console.error('Error calibrating scale:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-auto-reading', async (event, deviceId) => {
  try {
    if (!scaleService) return { success: false, error: 'Serviço de balança não inicializado' };
    scaleService.startAutoReading(deviceId);
    return { success: true, message: 'Leitura automática iniciada' };
  } catch (error) {
    console.error('Error starting auto reading:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-auto-reading', async (event, deviceId) => {
  try {
    if (!scaleService) return { success: false, error: 'Serviço de balança não inicializado' };
    scaleService.stopAutoReading(deviceId);
    return { success: true, message: 'Leitura automática parada' };
  } catch (error) {
    console.error('Error stopping auto reading:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-connected-devices', async () => {
  try {
    const devices = {
      printers: printerService ? printerService.getConnectedPrinters() : [],
      scales: scaleService ? scaleService.getConnectedScales() : []
    };
    return { success: true, devices };
  } catch (error) {
    console.error('Error getting connected devices:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-supported-protocols', async (event, deviceType) => {
  try {
    let protocols = [];
    if (deviceType === 'printer' && printerService) {
      protocols = printerService.getSupportedProtocols();
    } else if (deviceType === 'scale' && scaleService) {
      protocols = scaleService.getSupportedProtocols();
    }
    return { success: true, protocols };
  } catch (error) {
    console.error('Error getting supported protocols:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-available-printers', async () => {
  try {
    if (!printerService) throw new Error('Serviço de impressora não inicializado');
    const printers = await printerService.getAvailablePrinters();
    return { success: true, printers };
  } catch (error) {
    console.error('Erro ao listar impressoras:', error);
    return { success: false, error: error.message, printers: [] };
  }
});

ipcMain.handle('select-firebird-database', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecione o banco Firebird do sistema anterior',
      properties: ['openFile'],
      filters: [
        { name: 'Banco Firebird', extensions: ['fdb', 'gdb'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths?.[0]) return { success: false, canceled: true };
    const databasePath = result.filePaths[0];
    return { success: true, path: databasePath, name: path.basename(databasePath) };
  } catch (error) {
    return { success: false, error: error?.message || 'Não foi possível selecionar o banco Firebird.' };
  }
});

ipcMain.handle('analyze-firebird-database', async (_event, options = {}) => {
  try {
    return await loadFirebirdMigrationService().analyze(options);
  } catch (error) {
    console.error('Erro ao analisar banco Firebird:', error?.message || error);
    return { success: false, error: error?.message || 'Não foi possível analisar o banco Firebird.' };
  }
});

ipcMain.handle('open-external', async (_event, url) => {
  try {
    const parsed = new URL(String(url || ''));
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return { success: false, error: 'Endereço externo inválido' };
    }
    await shell.openExternal(parsed.toString());
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-pending-oauth-callback', async () => {
  const value = pendingOAuthCallback;
  pendingOAuthCallback = '';
  return value;
});

ipcMain.handle('print-system', async (event, { deviceName, html, silent = true } = {}) => {
  let win;
  try {
    if (!html || typeof html !== 'string') {
      return { success: false, error: 'HTML inválido' };
    }

    win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const encoded = encodeURIComponent(html);
    await win.loadURL(`data:text/html;charset=utf-8,${encoded}`);

    const isA4 = /data-print-format=["']a4["']/i.test(html);
    let receiptPageSize;

    if (!isA4) {
      // `@page size: 58mm auto` nao e respeitado de forma consistente pelo
      // Chromium/driver do Windows. Sem uma altura explicita, pedidos longos
      // viram varias paginas e a guilhotina corta cada pagina. Medimos o
      // documento pronto e enviamos o cupom inteiro como uma unica pagina.
      const receiptMetrics = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            if (document.fonts && document.fonts.ready) await document.fonts.ready;
            const images = Array.from(document.images || []);
            await Promise.all(images.map((image) => {
              if (image.complete) return Promise.resolve();
              return new Promise((resolve) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
              });
            }));
          } catch {}

          const root = document.documentElement;
          const body = document.body;
          const widthAttr = String(root?.dataset?.paperWidth || '58mm').toLowerCase();
          const widthMm = widthAttr === '80mm' ? 80 : 58;
          const heightPx = Math.max(
            root?.scrollHeight || 0,
            root?.offsetHeight || 0,
            body?.scrollHeight || 0,
            body?.offsetHeight || 0
          );

          return { widthMm, heightPx };
        })()
      `, true);

      const widthMicrons = receiptMetrics?.widthMm === 80 ? 80000 : 58000;
      const measuredHeightMicrons = Math.ceil(Math.max(1, Number(receiptMetrics?.heightPx || 0)) * 264.583333);
      const heightMicrons = Math.max(50000, Math.min(3000000, measuredHeightMicrons + 8000));
      receiptPageSize = { width: widthMicrons, height: heightMicrons };

      await win.webContents.insertCSS(`
        @page { margin: 0 !important; size: ${widthMicrons / 1000}mm ${heightMicrons / 1000}mm !important; }
        html, body { min-height: 0 !important; height: auto !important; overflow: visible !important; }
      `);
    }

    const printResult = await new Promise((resolve) => {
      win.webContents.print(
        {
          silent: !!silent,
          deviceName: deviceName || undefined,
          printBackground: true,
          margins: { marginType: isA4 ? 'default' : 'none' },
          pageSize: isA4 ? 'A4' : receiptPageSize,
          scaleFactor: 100
        },
        (success, failureReason) => resolve({ success, failureReason })
      );
    });

    if (!printResult.success) {
      return { success: false, error: String(printResult.failureReason || 'Falha ao imprimir') };
    }

    return { success: true };
  } catch (error) {
    console.error('Erro ao imprimir via sistema:', error);
    return { success: false, error: error.message };
  } finally {
    try {
      if (win && !win.isDestroyed()) win.close();
    } catch {}
  }
});

ipcMain.handle('preview-pdf', async (_event, { html, fileName } = {}) => {
  let win;
  try {
    if (!html || typeof html !== 'string') {
      return { success: false, error: 'HTML inválido para gerar o PDF' };
    }

    win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      landscape: false,
      printBackground: true,
      margins: { top: 0.2, bottom: 0.2, left: 0.2, right: 0.2 },
      preferCSSPageSize: true,
    });
    const safeName = String(fileName || 'DANFE-NFe')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'DANFE-NFe';
    const pdfPath = path.join(app.getPath('temp'), `${safeName}-${Date.now()}.pdf`);
    fs.writeFileSync(pdfPath, pdf);
    generatedPdfPreviews.add(pdfPath);
    const openError = await shell.openPath(pdfPath);
    if (openError) return { success: false, error: openError };
    return { success: true, path: pdfPath };
  } catch (error) {
    return { success: false, error: error?.message || 'Falha ao gerar a pré-visualização do PDF' };
  } finally {
    try { win?.close(); } catch {}
  }
});

ipcMain.handle('preview-pdf-buffer', async (_event, { pdfBytes, fileName } = {}) => {
  try {
    const pdf = Buffer.from(pdfBytes || []);
    if (pdf.length < 5 || pdf.subarray(0, 5).toString() !== '%PDF-') {
      return { success: false, error: 'O servidor não devolveu um arquivo PDF válido.' };
    }
    const safeName = String(fileName || 'DANFE-NFe')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'DANFE-NFe';
    const pdfPath = path.join(app.getPath('temp'), `${safeName}-${Date.now()}.pdf`);
    fs.writeFileSync(pdfPath, pdf);
    generatedPdfPreviews.add(pdfPath);
    const openError = await shell.openPath(pdfPath);
    if (openError) return { success: false, error: openError };
    return { success: true, path: pdfPath };
  } catch (error) {
    return { success: false, error: error?.message || 'Falha ao abrir o DANFE em PDF' };
  }
});

ipcMain.handle('print-raw-system', async (event, { deviceName, text } = {}) => {
  try {
    if (!printerService) return { success: false, error: 'Serviço de impressora não inicializado' };
    if (!deviceName || !text) return { success: false, error: 'Impressora ou texto inválido' };
    const result = await printerService.printRawTextSystem(deviceName, text);
    return {
      success: !!result?.success,
      error: result?.error || result?.message,
      message: result?.message,
    };
  } catch (error) {
    console.error('Erro ao imprimir RAW via sistema:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-cash-drawer', async (event, deviceId) => {
  try {
    if (!printerService) return { success: false, error: 'Serviço de impressora não inicializado' };
    return await printerService.openCashDrawer(deviceId);
  } catch (error) {
    console.error('Error opening cash drawer:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('print-product-label', async (event, deviceId, productData) => {
  try {
    if (!printerService) return { success: false, error: 'Serviço de impressora não inicializado' };
    return await printerService.printReceipt(deviceId, productData, 'product_label');
  } catch (error) {
    console.error('Error printing product label:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-device-options', async (event, deviceType, deviceId, options) => {
  try {
    let result;
    if (deviceType === 'printer' && printerService) {
      result = await printerService.updatePrinterOptions(deviceId, options);
    } else if (deviceType === 'scale' && scaleService) {
      result = await scaleService.updateScaleOptions(deviceId, options);
    } else {
      return { success: false, error: 'Tipo de dispositivo inválido ou serviço não disponível' };
    }
    return result;
  } catch (error) {
    console.error('Error updating device options:', error);
    return { success: false, error: error.message };
  }
});
