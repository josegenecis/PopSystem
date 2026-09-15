const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridgeAPI', {
  getStatus: () => ipcRenderer.invoke('bridge:getStatus'),
  startPairing: () => ipcRenderer.invoke('bridge:startPairing'),
  pollPairing: () => ipcRenderer.invoke('bridge:pollPairing'),
  start: () => ipcRenderer.invoke('bridge:start'),
  stop: () => ipcRenderer.invoke('bridge:stop'),
  listPrinters: () => ipcRenderer.invoke('bridge:listPrinters'),
  getPrinterSelection: () => ipcRenderer.invoke('bridge:getPrinterSelection'),
  setPrinterSelection: (printerName) => ipcRenderer.invoke('bridge:setPrinterSelection', { printerName }),
  testPrinter: () => ipcRenderer.invoke('bridge:testPrinter'),
  openCashDrawer: () => ipcRenderer.invoke('bridge:openCashDrawer'),
  listSerialPorts: () => ipcRenderer.invoke('bridge:listSerialPorts'),
  getScaleSelection: () => ipcRenderer.invoke('bridge:getScaleSelection'),
  setScaleSelection: (selection) => ipcRenderer.invoke('bridge:setScaleSelection', selection),
  connectScale: (selection) => ipcRenderer.invoke('bridge:connectScale', selection),
  disconnectScale: () => ipcRenderer.invoke('bridge:disconnectScale'),
  readWeight: () => ipcRenderer.invoke('bridge:readWeight'),
  getAutoStart: () => ipcRenderer.invoke('bridge:getAutoStart'),
  setAutoStart: (enabled) => ipcRenderer.invoke('bridge:setAutoStart', { enabled }),
  getOpenPwaAtLogin: () => ipcRenderer.invoke('bridge:getOpenPwaAtLogin'),
  setOpenPwaAtLogin: (enabled) => ipcRenderer.invoke('bridge:setOpenPwaAtLogin', { enabled }),
  getUpdateStatus: () => ipcRenderer.invoke('bridge:getUpdateStatus'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('bridge:updateStatus', listener)
    return () => ipcRenderer.removeListener('bridge:updateStatus', listener)
  },
})
