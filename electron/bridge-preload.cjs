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
})
