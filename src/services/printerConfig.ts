export type PrinterTransport = 'network' | 'usb' | 'bluetooth' | 'system'

export interface PrinterRouteTarget {
  name?: string
  transport: PrinterTransport
  address?: string
}

export interface PrinterConfig {
  autoPrintKds: boolean
  bridge: {
    websocketUrl: string
    transport: PrinterTransport
    address?: string
  }
  relay: {
    selectedPrinter?: {
      printerId: string
      name: string
      transport: PrinterTransport
      address?: string
    }
  }
  routes: {
    kitchen?: PrinterRouteTarget
    bar?: PrinterRouteTarget
  }
}

const STORAGE_KEY = 'boracume_printer_config_v1'

export const getDefaultPrinterConfig = (): PrinterConfig => ({
  autoPrintKds: false,
  bridge: {
    websocketUrl: 'ws://localhost:8766',
    transport: 'network',
    address: '',
  },
  relay: {},
  routes: {},
})

export const loadPrinterConfig = (): PrinterConfig => {
  if (typeof window === 'undefined') return getDefaultPrinterConfig()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return getDefaultPrinterConfig()
    const parsed = JSON.parse(raw)
    const merged: PrinterConfig = {
      ...getDefaultPrinterConfig(),
      ...parsed,
      bridge: {
        ...getDefaultPrinterConfig().bridge,
        ...(parsed?.bridge || {}),
      },
      relay: {
        ...getDefaultPrinterConfig().relay,
        ...(parsed?.relay || {}),
      },
      routes: {
        ...getDefaultPrinterConfig().routes,
        ...(parsed?.routes || {}),
      },
    }
    return merged
  } catch {
    return getDefaultPrinterConfig()
  }
}

export const savePrinterConfig = (config: PrinterConfig) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}
