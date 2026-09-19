import { Capacitor } from '@capacitor/core';
import { formatBRL } from '@/lib/currency';

export interface PrinterDevice {
  id: string;
  name: string;
  type: 'usb' | 'bluetooth' | 'wifi' | 'agent';
  address?: string;
  connected: boolean;
  agentUrl?: string; // URL do agente local se aplicável
}

const AGENT_URL = 'http://localhost:17171';

export class PrinterService {
  private connectedPrinter: PrinterDevice | null = null;
  private isAgentAvailable = false;

  constructor() {
    this.checkAgentAvailability();
  }

  async checkAgentAvailability(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      
      const response = await fetch(`${AGENT_URL}/status`, { 
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        this.isAgentAvailable = true;
        console.log('Agente de impressão detectado!');
        return true;
      }
    } catch (e) {
      // Agente não encontrado
    }
    
    this.isAgentAvailable = false;
    return false;
  }

  async scanForPrinters(): Promise<PrinterDevice[]> {
    const devices: PrinterDevice[] = [];

    // 1. Tentar buscar impressoras do Agente Local
    if (await this.checkAgentAvailability()) {
      try {
        const response = await fetch(`${AGENT_URL}/printers`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && Array.isArray(data.printers)) {
            const printers = data.printers as Array<{ name: string }>;
            printers.forEach((printer) => {
              devices.push({
                id: printer.name, // Usar nome como ID para impressoras do sistema
                name: `${printer.name} (Agente)`,
                type: 'agent',
                connected: false,
                agentUrl: AGENT_URL
              });
            });
          }
        }
      } catch (error) {
        console.error('Erro ao buscar impressoras do agente:', error);
      }
    }

    // 2. Dispositivos Nativos (Mobile/Desktop App)
    if (Capacitor.isNativePlatform()) {
      // Mock native devices for demo purposes (or implementation via plugins)
      devices.push(
        {
          id: 'usb_printer',
          name: 'Impressora USB (Nativa)',
          type: 'usb',
          connected: false
        },
        {
          id: 'bt_printer_1',
          name: 'Impressora Bluetooth MP-4200',
          type: 'bluetooth',
          address: '00:11:22:33:44:55',
          connected: false
        }
      );
    } else if (!this.isAgentAvailable) {
      // Web fallback - return mock devices ONLY if agent is not found
      // to avoid cluttering if user has the agent
      devices.push({
        id: 'mock_printer',
        name: 'Impressora Simulada (Sem Agente)',
        type: 'usb',
        connected: false
      });
    }

    return devices;
  }

  async connectToPrinter(printer: PrinterDevice): Promise<boolean> {
    try {
      console.log(`Conectando à impressora ${printer.name}...`);
      
      if (printer.type === 'agent') {
        // Para o agente, "conectar" é apenas selecionar
        // O agente mantém a conexão real ou conecta sob demanda
        this.connectedPrinter = { ...printer, connected: true };
        return true;
      }

      // Simulate connection delay for others
      await new Promise(resolve => setTimeout(resolve, 1000));

      this.connectedPrinter = { ...printer, connected: true };
      return true;
    } catch (error) {
      console.error('Erro ao conectar impressora:', error);
      return false;
    }
  }

  async disconnectPrinter(): Promise<void> {
    if (!this.connectedPrinter) return;

    try {
      console.log(`Desconectando impressora ${this.connectedPrinter.name}...`);
      // Simulate disconnection delay
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Erro ao desconectar impressora:', error);
    }

    this.connectedPrinter = null;
  }


  async printReceipt(orderData: {
    order_number: string;
    customer_name: string;
    customer_phone?: string;
    items: Array<{
      quantity: number;
      product_name: string;
      subtotal: number;
      notes?: string;
    }>;
    total: number;
    subtotal?: number;
    discount?: number;
    delivery_fee?: number;
    payment_method?: string;
    store?: {
      name: string;
      address?: string;
      phone?: string;
      website?: string;
    };
    date?: string | Date;
  }): Promise<boolean> {

    if (!this.connectedPrinter) {
      throw new Error('Nenhuma impressora conectada');
    }

    try {
      // Se for impressão via Agente
      if (this.connectedPrinter.type === 'agent' && this.connectedPrinter.agentUrl) {
        const response = await fetch(`${this.connectedPrinter.agentUrl}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            printerName: this.connectedPrinter.id,
            content: orderData, // Enviamos o objeto estruturado, o agente formata
            options: { template: 'receipt' }
          })
        });
        
        const result = await response.json();
        if (!result.success) {
          throw new Error(result.message || 'Erro na impressão via agente');
        }
        return true;
      }

      // Fallback para ESC/POS local (Mobile/Web Simulado)
      // Create simple ESC/POS commands as string
      let escposData = '';
      
      // Header
      escposData += '\x1B\x61\x01'; // Center align
      escposData += '\x1B\x45\x01'; // Bold on
      escposData += `${orderData.store?.name || 'POPSYSTEM'}\n`;
      escposData += '\x1B\x45\x00'; // Bold off
      escposData += '--------------------------------\n';
      escposData += '\x1B\x61\x00'; // Left align
      escposData += `Pedido: #${orderData.order_number}\n`;
      escposData += `Cliente: ${orderData.customer_name}\n`;

      if (orderData.customer_phone) {
        escposData += `Telefone: ${orderData.customer_phone}\n`;
      }

      escposData += '--------------------------------\n';

      // Items
      orderData.items.forEach((item) => {
        escposData += `${item.quantity}x ${item.product_name}\n`;
        escposData += '\x1B\x61\x02'; // Right align
        escposData += `${formatBRL(item.subtotal)}\n`;
        escposData += '\x1B\x61\x00'; // Left align

        if (item.notes) {
          escposData += `Obs: ${item.notes}\n`;
        }
      });

      escposData += '--------------------------------\n';
      escposData += '\x1B\x61\x02'; // Right align
      escposData += '\x1B\x45\x01'; // Bold on
      escposData += `TOTAL: ${formatBRL(orderData.total)}\n`;
      escposData += '\x1B\x45\x00'; // Bold off
      escposData += '\x1B\x61\x01'; // Center align
      escposData += '--------------------------------\n';
      escposData += 'Obrigado pela preferência!\n\n\n';
      
      // Cut paper command
      escposData += '\x1D\x56\x00';

      // Simulate printing in web environment or send to native printer
      if (Capacitor.isNativePlatform()) {
        // In a real implementation, you would use the native plugins here
        console.log('Enviando para impressora nativa:', this.connectedPrinter.name);
      } else {
        // Web fallback - simulate printing
        console.log('Imprimindo (simulado):', orderData);
        console.log('ESC/POS Data:', escposData);
      }

      return true;
    } catch (error) {
      console.error('Erro ao imprimir:', error);
      return false;
    }
  }

  getConnectedPrinter(): PrinterDevice | null {
    return this.connectedPrinter;
  }
}
