const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;
const EventEmitter = require('events');
const { execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class PrinterService extends EventEmitter {
  constructor(deviceManager) {
    super();
    this.deviceManager = deviceManager;
    this.connectedPrinters = new Map();
    this.templates = new Map();
    
    // Carregar templates padrão
    this.loadDefaultTemplates();
  }

  loadDefaultTemplates() {
    // Template padrão para cupom fiscal
    this.templates.set('receipt', {
      name: 'Cupom Padrão',
      width: 48,
      sections: [
        { type: 'header', align: 'center' },
        { type: 'order_info', align: 'left' },
        { type: 'items', align: 'left' },
        { type: 'totals', align: 'right' },
        { type: 'footer', align: 'center' }
      ]
    });

    this.templates.set('kitchen_ticket', {
      name: 'Comanda da Cozinha',
      width: 48,
      sections: [
        { type: 'kitchen_header', align: 'center' },
        { type: 'kitchen_order_info', align: 'left' },
        { type: 'kitchen_items', align: 'left' },
        { type: 'kitchen_footer', align: 'center' }
      ]
    });

    // Template para etiqueta de produto
    this.templates.set('product_label', {
      name: 'Etiqueta de Produto',
      width: 32,
      sections: [
        { type: 'product_name', align: 'center' },
        { type: 'barcode', align: 'center' },
        { type: 'price', align: 'center' }
      ]
    });
  }

  formatPaymentMethodLabel(method, data = {}) {
    const value = String(method || '').trim().toLowerCase();
    const acceptanceStatus = String(data.acceptance_status || '').trim().toLowerCase();
    if (value === 'pix' && acceptanceStatus === 'awaiting_pix_payment') return 'PIX ONLINE';
    if (value === 'pix') return 'PIX';
    if (value === 'pix_online') return 'PIX ONLINE';
    if (value === 'pix_entrega') return 'PIX NA ENTREGA';
    if (value === 'cartao' || value === 'cartão') return 'CARTAO';
    if (value === 'dinheiro') return 'DINHEIRO';
    if (value === 'cartao_credito') return 'CREDITO';
    if (value === 'cartao_debito') return 'DEBITO';
    return String(method || 'N/A').toUpperCase().replace(/_/g, ' ');
  }

  normalizeNfcePrintData(data = {}) {
    const raw = data.nfce || data.fiscal || data.nfce_data || null;
    if (!raw || typeof raw !== 'object') return null;
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const decodeXmlEntities = (value) => String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    const extractQrCodeFromXml = (value) => {
      const match = String(value || '').match(/<qrCode>([\s\S]*?)<\/qrCode>/i);
      return match ? clean(decodeXmlEntities(match[1])) : '';
    };
    const extractAccessKeyFromXml = (value) => {
      const xml = String(value || '');
      const idMatch = xml.match(/<infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i);
      if (idMatch?.[1]) return idMatch[1];
      const keyMatch = xml.match(/<chNFe>(\d{44})<\/chNFe>/i);
      return keyMatch?.[1] || '';
    };
    const extractQrAccessKey = (value) => {
      const match = String(value || '').match(/[?&]p=([^&\s]+)/);
      if (!match) return '';
      return decodeURIComponent(match[1]).replace(/%7C/gi, '|').split('|')[0]?.replace(/\D/g, '').slice(0, 44) || '';
    };
    const xmlContent = clean(raw.xml_content || raw.xmlContent || raw.xml_enviado || raw.xmlEnviado || raw.xml_autorizado || raw.xmlAutorizado);
    const numero = clean(raw.numero || raw.number || raw.nfce_number);
    const serie = clean(raw.serie || raw.series || raw.nfce_serie || '1');
    const protocolo = clean(raw.protocolo || raw.protocolo_autorizacao || raw.protocol);
    const chave = clean(raw.chave_acesso || raw.access_key || raw.chave || extractAccessKeyFromXml(xmlContent));
    let qrCodeUrl = clean(extractQrCodeFromXml(xmlContent) || raw.qr_code_url || raw.qrCodeUrl || raw.qrcode_url || raw.qr_url);
    const ambiente = clean(raw.ambiente || raw.environment);
    if (ambiente && ambiente !== 'producao' && qrCodeUrl.includes('://nfce.sefaz.ce.gov.br/')) {
      qrCodeUrl = qrCodeUrl.replace('://nfce.sefaz.ce.gov.br/', '://nfceh.sefaz.ce.gov.br/');
    }
    const qrAccessKey = extractQrAccessKey(qrCodeUrl);
    const accessKey = chave.replace(/\D/g, '').slice(0, 44);
    if (accessKey && qrAccessKey && accessKey !== qrAccessKey) {
      console.warn('NFC-e QR Code ignorado: chave do QR diferente da chave autorizada.', { accessKey, qrAccessKey });
      qrCodeUrl = '';
    }
    if (!numero && !protocolo && !chave && !qrCodeUrl) return null;
    return { numero, serie, protocolo, chave, qrCodeUrl, ambiente };
  }

  formatAccessKeyForPrint(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 44);
    if (!digits) return '';
    return (digits.match(/.{1,4}/g) || [digits]).join(' ');
  }

  getNfceConsultaBaseUrl(qrCodeUrl) {
    const value = String(qrCodeUrl || '').replace(/\s+/g, ' ').trim();
    if (!value) return '';
    const queryIndex = value.indexOf('?');
    return queryIndex >= 0 ? value.slice(0, queryIndex) : value;
  }

  getNfceQrCodePayloadUrl(qrCodeUrl) {
    return String(qrCodeUrl || '').replace(/\s+/g, ' ').trim().replace(/%7C/gi, '|');
  }

  printWrappedChunks(printer, value, chunkSize) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const size = Math.max(8, Number(chunkSize) || 24);
    for (let i = 0; i < text.length; i += size) {
      printer.println(text.slice(i, i + size));
    }
  }

  printNfceBlock(printer, data, section) {
    const nfce = this.normalizeNfcePrintData(data);
    if (!nfce) return;

    const width = this.getSectionWidth(section);
    printer.drawLine();
    printer.alignCenter();
    printer.bold(true);
    printer.println('CUPOM FISCAL NFC-e');
    printer.bold(false);
    if (nfce.numero) printer.println(`NFC-e ${nfce.numero}${nfce.serie ? ` / Serie ${nfce.serie}` : ''}`);
    if (nfce.protocolo) printer.println(`Protocolo: ${nfce.protocolo}`);
    if (nfce.ambiente && nfce.ambiente !== 'producao') {
      printer.bold(true);
      printer.println(`AMBIENTE: ${nfce.ambiente.toUpperCase()}`);
      printer.bold(false);
    }
    printer.alignLeft();
    if (nfce.chave) {
      printer.alignCenter();
      printer.bold(true);
      printer.println('CHAVE DE ACESSO');
      printer.bold(false);
      printer.alignLeft();
      this.printWrappedChunks(printer, this.formatAccessKeyForPrint(nfce.chave), width);
    }
    if (nfce.qrCodeUrl) {
      printer.alignCenter();
      try {
        printer.printQR(this.getNfceQrCodePayloadUrl(nfce.qrCodeUrl), {
          cellSize: width <= 32 ? 4 : 5,
          correction: 'M',
        });
      } catch (error) {
        console.warn('Falha ao imprimir QR Code NFC-e nativo:', error?.message || error);
      }
      printer.alignLeft();
      printer.println('Consulta pela chave:');
      this.printWrappedChunks(printer, this.getNfceConsultaBaseUrl(nfce.qrCodeUrl), width);
    }
  }

  async connectPrinter(deviceId, options = {}) {
    try {
      // Verificar se já está conectado
      if (this.connectedPrinters.has(deviceId)) {
        const printerInfo = this.connectedPrinters.get(deviceId);
        const mergedOptions = { ...(printerInfo.options || {}), ...(options || {}) };
        printerInfo.options = mergedOptions;
        if (printerInfo.config?.options) {
          printerInfo.config.options = {
            ...printerInfo.config.options,
            timeout: mergedOptions.timeout || printerInfo.config.options.timeout || 5000,
            width: mergedOptions.width || printerInfo.config.options.width || 48
          };
        }
        return { success: true, message: 'Impressora já conectada' };
      }

      // Conectar dispositivo via DeviceManager
      const connectionResult = await this.deviceManager.connectDevice(deviceId, 'printer', options);
      
      if (!connectionResult.success) {
        return connectionResult;
      }

      // Configurar impressora térmica
      const printerConfig = {
        type: this.getPrinterType(options.protocol || 'epson'),
        interface: deviceId,
        options: {
          timeout: options.timeout || 5000,
          width: options.width || 48
        }
      };

      const printer = new ThermalPrinter(printerConfig);
      
      // Testar conexão
      const isConnected = await printer.isPrinterConnected();
      
      if (!isConnected) {
        await this.deviceManager.disconnectDevice(deviceId);
        return { success: false, message: 'Falha na comunicação com a impressora' };
      }

      // Armazenar informações da impressora
      this.connectedPrinters.set(deviceId, {
        printer,
        config: printerConfig,
        options,
        lastPrint: null,
        status: 'ready'
      });

      this.emit('printerConnected', { deviceId, config: printerConfig });
      return { success: true, message: 'Impressora conectada com sucesso' };
      
    } catch (error) {
      console.error('Erro ao conectar impressora:', error);
      return { success: false, message: error.message };
    }
  }

  async disconnectPrinter(deviceId) {
    try {
      const printerInfo = this.connectedPrinters.get(deviceId);
      
      if (printerInfo) {
        this.connectedPrinters.delete(deviceId);
      }

      const result = await this.deviceManager.disconnectDevice(deviceId);
      
      if (result.success) {
        this.emit('printerDisconnected', { deviceId });
      }
      
      return result;
    } catch (error) {
      console.error('Erro ao desconectar impressora:', error);
      return { success: false, message: error.message };
    }
  }

  getPrinterType(protocol) {
    const typeMap = {
      'epson': PrinterTypes.EPSON,
      'bematech': PrinterTypes.EPSON, // Compatível com ESC/POS
      'daruma': PrinterTypes.EPSON,
      'elgin': PrinterTypes.EPSON,
      'tanca': PrinterTypes.EPSON,
      'pos': PrinterTypes.EPSON,
      'generic': PrinterTypes.EPSON
    };
    
    return typeMap[protocol] || PrinterTypes.EPSON;
  }

  async printReceipt(deviceId, orderData, templateName = 'receipt') {
    try {
      const printerInfo = this.connectedPrinters.get(deviceId);
      
      if (!printerInfo) {
        return { success: false, message: 'Impressora não conectada' };
      }

      const { printer } = printerInfo;
      const baseTemplate = this.templates.get(templateName);
      
      if (!baseTemplate) {
        return { success: false, message: 'Template não encontrado' };
      }

      const template = {
        ...baseTemplate,
        width: Number(printerInfo?.options?.width || baseTemplate.width || 32)
      };

      // Limpar buffer da impressora
      printer.clear();
      this.applyStrongPrintMode(printer);
      
      // Aplicar template
      await this.applyTemplate(printer, template, orderData);
      
      // Executar impressão
      await printer.execute();
      
      // Atualizar status
      printerInfo.lastPrint = Date.now();
      printerInfo.status = 'ready';
      
      this.emit('printCompleted', { deviceId, orderData });
      return { success: true, message: 'Cupom impresso com sucesso' };
      
    } catch (error) {
      console.error('Erro ao imprimir:', error);
      
      // Atualizar status de erro
      const printerInfo = this.connectedPrinters.get(deviceId);
      if (printerInfo) {
        printerInfo.status = 'error';
      }
      
      this.emit('printError', { deviceId, error: error.message });
      return { success: false, message: error.message };
    }
  }

  applyStrongPrintMode(printer) {
    try {
      // ESC E = bold, ESC G = double-strike. Mantem compatibilidade ESC/POS.
      printer.raw(Buffer.from([0x1b, 0x45, 0x01, 0x1b, 0x47, 0x01]));
    } catch {}
  }

  async applyTemplate(printer, template, data) {
    for (const section of template.sections) {
      const sectionConfig = {
        ...section,
        width: section.width || template.width
      };

      switch (section.type) {
        case 'header':
          await this.printHeader(printer, data, sectionConfig);
          break;
        case 'order_info':
          await this.printOrderInfo(printer, data, sectionConfig);
          break;
        case 'items':
          await this.printItems(printer, data, sectionConfig);
          break;
        case 'totals':
          await this.printTotals(printer, data, sectionConfig);
          break;
        case 'footer':
          await this.printFooter(printer, data, sectionConfig);
          break;
        case 'kitchen_header':
          await this.printKitchenHeader(printer, data, sectionConfig);
          break;
        case 'kitchen_order_info':
          await this.printKitchenOrderInfo(printer, data, sectionConfig);
          break;
        case 'kitchen_items':
          await this.printKitchenItems(printer, data, sectionConfig);
          break;
        case 'kitchen_footer':
          await this.printKitchenFooter(printer, data, sectionConfig);
          break;
        case 'product_name':
          await this.printProductName(printer, data, sectionConfig);
          break;
        case 'barcode':
          await this.printBarcode(printer, data, sectionConfig);
          break;
        case 'price':
          await this.printPrice(printer, data, sectionConfig);
          break;
      }
    }
  }

  getSectionWidth(section) {
    const width = Number(section?.width || section?.charsPerLine || 48);
    return Number.isFinite(width) && width > 0 ? width : 48;
  }

  formatCurrency(value) {
    const amount = Number(value || 0);
    return `R$ ${amount.toFixed(2)}`;
  }

  getOrderTypeLabel(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'delivery') return 'Delivery';
    if (raw === 'pickup') return 'Retirada';
    if (raw === 'dine_in') return 'Mesa';
    return 'Balcão';
  }

  getKitchenCustomerName(data) {
    const name = String(data?.customer_name || '').trim();
    if (name) return name;
    return String(data?.order_type || '').trim().toLowerCase() === 'dine_in' ? 'Mesa' : 'Balcão';
  }

  shouldPrintTicketCode(data) {
    const orderType = String(data?.order_type || '').trim().toLowerCase();
    return orderType === 'dine_in' || orderType === 'counter' || (!orderType && !data?.delivery_zone_id);
  }

  wrapText(text, width) {
    const content = String(text || '').replace(/\s+/g, ' ').trim();
    if (!content) return [''];

    const safeWidth = Math.max(8, Number(width) || 48);
    const words = content.split(' ');
    const lines = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= safeWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
      }

      if (word.length <= safeWidth) {
        current = word;
        continue;
      }

      let remaining = word;
      while (remaining.length > safeWidth) {
        lines.push(remaining.slice(0, safeWidth));
        remaining = remaining.slice(safeWidth);
      }
      current = remaining;
    }

    if (current) {
      lines.push(current);
    }

    return lines.length ? lines : [''];
  }

  formatColumns(left, right, width) {
    const safeWidth = Math.max(8, Number(width) || 48);
    const leftText = String(left || '').trim();
    const rightText = String(right || '').trim();

    if (!rightText) {
      return this.wrapText(leftText, safeWidth);
    }

    const minGap = 2;
    const maxLeftWidth = Math.max(8, safeWidth - rightText.length - minGap);
    const leftLines = this.wrapText(leftText, maxLeftWidth);
    const lastLeftLine = leftLines[leftLines.length - 1] || '';

    if (lastLeftLine.length + minGap + rightText.length <= safeWidth) {
      const gap = Math.max(minGap, safeWidth - lastLeftLine.length - rightText.length);
      leftLines[leftLines.length - 1] = `${lastLeftLine}${' '.repeat(gap)}${rightText}`;
      return leftLines;
    }

    return [...leftLines, rightText.padStart(safeWidth)];
  }

  async printHeader(printer, data, section) {
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    
    const storeName = data.store?.name || 'POPSYSTEM';
    printer.println(storeName);
    
    if (data.store?.description) {
      printer.bold(true);
      printer.println(String(data.store.description));
    }
    
    if (data.store?.address) {
      printer.bold(true);
      printer.println(data.store.address);
    }
    
    if (data.store?.phone) {
      printer.println(`Tel: ${data.store.phone}`);
    }

    if (data.store?.cnpj) {
      printer.println(`CNPJ: ${data.store.cnpj}`);
    }
    
    printer.bold(true);
    printer.println(new Date(data.created_at || data.date || Date.now()).toLocaleString('pt-BR'));
    printer.drawLine();
    printer.newLine();
  }

  async printOrderInfo(printer, data, section) {
    printer.alignLeft();
    printer.setTextNormal();
    printer.bold(true);
    
    if (data.order_number) {
      printer.println(`Pedido: #${data.order_number}`);
    }
    
    if (data.customer_name) {
      printer.println(`Cliente: ${data.customer_name}`);
    }
    
    if (data.customer_phone) {
      printer.println(`Telefone: ${data.customer_phone}`);
    }

    const customerAddress = String(data.customer_address_display || data.customer_address || '').trim();
    if (customerAddress) {
      this.wrapText(`End: ${customerAddress}`, this.getSectionWidth(section)).forEach((line) => {
        printer.println(line);
      });
    }

    if (data.delivery_zone_name && String(customerAddress).toLowerCase().includes(String(data.delivery_zone_name).toLowerCase()) === false) {
      printer.println(`Bairro: ${data.delivery_zone_name}`);
    }

    if (data.order_type) {
      const label = data.order_type === 'delivery'
        ? 'Delivery'
        : data.order_type === 'pickup'
          ? 'Retirada'
          : data.order_type === 'dine_in'
            ? 'Mesa'
            : 'BalcÃ£o';
      printer.println(`Tipo: ${label}`);
    }
    
    if (data.date) {
      const date = new Date(data.date);
      printer.println(`Data: ${date.toLocaleString('pt-BR')}`);
    }
    
    printer.drawLine();
  }

  async printItems(printer, data, section) {
    printer.alignLeft();
    printer.setTextNormal();
    printer.bold(true);
    const width = this.getSectionWidth(section);
    
    if (!data.items || data.items.length === 0) {
      printer.println('Nenhum item encontrado');
      return;
    }
    
    for (const item of data.items) {
      // Nome do produto
      const productName = item.product_name || item.name || 'Produto';
      const quantity = Number(item.quantity || 1);

      this.wrapText(`${quantity}x ${productName}`, width).forEach((line) => {
        printer.println(line);
      });
      
      // Preço unitário e subtotal
      const unitPrice = Number(item.price || item.unit_price || 0);
      const subtotal = Number(item.subtotal || item.total || (quantity * unitPrice) || 0);

      this.formatColumns(
        `${this.formatCurrency(unitPrice)} x ${quantity}`,
        this.formatCurrency(subtotal),
        width
      ).forEach((line) => {
        printer.println(line);
      });
      
      if (Array.isArray(item.variations) && item.variations.length > 0) {
        for (const v of item.variations) {
          if (!v) continue;
          const raw = String(v);
          const idx = raw.indexOf(':');
          if (idx > 0) {
            this.wrapText(`  ${raw.slice(0, idx).trim()}: ${raw.slice(idx + 1).trim()}`, width).forEach((line) => {
              printer.println(line);
            });
          } else {
            this.wrapText(`  ${raw}`, width).forEach((line) => {
              printer.println(line);
            });
          }
        }
      }

      if (item.notes || item.observations) {
        this.wrapText(`Obs: ${item.notes || item.observations}`, width).forEach((line) => {
          printer.println(line);
        });
      }
      
      printer.newLine();
    }
  }

  async printTotals(printer, data, section) {
    printer.drawLine();
    printer.alignLeft();
    const width = this.getSectionWidth(section);
    printer.setTextNormal();
    printer.bold(true);
    
    // Subtotal
    if (data.subtotal && data.subtotal !== data.total) {
      this.formatColumns('Subtotal', this.formatCurrency(data.subtotal), width).forEach((line) => {
        printer.println(line);
      });
    }
    
    // Desconto
    if (data.discount && data.discount > 0) {
      this.formatColumns('Desconto', `- ${this.formatCurrency(data.discount)}`, width).forEach((line) => {
        printer.println(line);
      });
    }
    
    // Taxa de entrega
    if (data.delivery_fee && data.delivery_fee > 0) {
      this.formatColumns('Taxa Entrega', this.formatCurrency(data.delivery_fee), width).forEach((line) => {
        printer.println(line);
      });
    }
    
    // Total
    printer.bold(true);
    printer.setTextSize(1, 1);
    this.formatColumns('TOTAL', this.formatCurrency(data.total), width).forEach((line) => {
      printer.println(line);
    });
    printer.setTextNormal();
  }

  async printFooter(printer, data, section) {
    printer.alignCenter();
    printer.drawLine();
    printer.bold(true);

    this.printNfceBlock(printer, data, section);
    
    if (data.payment_method) {
      printer.alignCenter();
      printer.bold(true);
      printer.println(`Pagamento: ${this.formatPaymentMethodLabel(data.payment_method, data)}`);
    }
    
    printer.newLine();
    printer.println('Obrigado pela preferência!');
    
    if (data.store?.website) {
      printer.println(data.store.website);
    }
    
    printer.newLine();
    printer.newLine();
    printer.cut();
  }

  async printKitchenHeader(printer, data, section) {
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println('COMANDA DA COZINHA');
    printer.setTextNormal();
    printer.bold(true);
    printer.println(new Date(data.created_at || data.date || Date.now()).toLocaleString('pt-BR'));
    printer.drawLine();
    printer.newLine();
  }

  async printKitchenOrderInfo(printer, data, section) {
    printer.alignLeft();
    printer.bold(true);
    printer.setTextSize(1, 1);
    if (this.shouldPrintTicketCode(data)) {
      printer.println(`SENHA: ${String(data.order_number || '----').slice(-4) || '----'}`);
    }
    printer.setTextNormal();
    printer.bold(true);
    if (data.order_number) {
      printer.println(`Pedido: #${data.order_number}`);
    }
    printer.println(`Tipo: ${this.getOrderTypeLabel(data.order_type)}`);
    printer.println(`Cliente: ${this.getKitchenCustomerName(data)}`);
    printer.drawLine();
  }

  async printKitchenItems(printer, data, section) {
    printer.alignLeft();
    printer.setTextNormal();
    printer.bold(true);
    const width = this.getSectionWidth(section);

    if (!data.items || data.items.length === 0) {
      printer.println('Nenhum item encontrado');
      return;
    }

    for (const item of data.items) {
      const productName = item.product_name || item.name || 'Produto';
      const quantity = Number(item.quantity || 1);

      this.wrapText(`${quantity}x ${productName}`, width).forEach((line) => {
        printer.println(line);
      });

      if (Array.isArray(item.variations) && item.variations.length > 0) {
        for (const variation of item.variations) {
          if (!variation) continue;
          const raw = String(variation);
          const idx = raw.indexOf(':');
          if (idx > 0) {
            this.wrapText(`  ${raw.slice(0, idx).trim()}: ${raw.slice(idx + 1).trim()}`, width).forEach((line) => {
              printer.println(line);
            });
          } else {
            this.wrapText(`  ${raw}`, width).forEach((line) => {
              printer.println(line);
            });
          }
        }
      }

      if (item.notes || item.observations) {
        this.wrapText(`Obs: ${item.notes || item.observations}`, width).forEach((line) => {
          printer.println(line);
        });
      }

      printer.newLine();
    }
  }

  async printKitchenFooter(printer, data, section) {
    printer.alignCenter();
    printer.drawLine();
    printer.newLine();
    printer.newLine();
    printer.cut();
  }

  async printProductName(printer, data, section) {
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(data.name || 'Produto');
    printer.bold(false);
    printer.setTextNormal();
  }

  async printBarcode(printer, data, section) {
    if (data.barcode) {
      printer.alignCenter();
      printer.code128(data.barcode);
      printer.println(data.barcode);
    }
  }

  async printPrice(printer, data, section) {
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(2, 2);
    printer.println(`R$ ${(data.price || 0).toFixed(2)}`);
    printer.bold(false);
    printer.setTextNormal();
    printer.cut();
  }

  async testPrint(deviceId) {
    try {
      const testData = {
        store: {
          name: 'POPSYSTEM - TESTE',
          address: 'Rua Teste, 123',
          phone: '(11) 99999-9999'
        },
        order_number: 'TEST001',
        date: new Date(),
        items: [
          {
            quantity: 1,
            product_name: 'Produto Teste',
            price: 10.00,
            subtotal: 10.00
          }
        ],
        total: 10.00,
        payment_method: 'Dinheiro'
      };
      
      return await this.printReceipt(deviceId, testData);
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async openCashDrawer(deviceId) {
    try {
      if (String(deviceId || '').startsWith('system:')) {
        const printerName = String(deviceId || '').slice('system:'.length).trim();
        if (!printerName) {
          return { success: false, message: 'Impressora do sistema não informada para acionar a gaveta' };
        }
        return await this.openCashDrawerSystem(printerName);
      }

      let printerInfo = this.connectedPrinters.get(deviceId);

      if (!printerInfo) {
        const reconnectResult = await this.connectPrinter(deviceId, { protocol: 'epson', width: 48 });
        if (!reconnectResult?.success) {
          return { success: false, message: reconnectResult?.message || reconnectResult?.error || 'Dispositivo não conectado' };
        }
        printerInfo = this.connectedPrinters.get(deviceId);
      }

      const printer = printerInfo?.printer;
      if (!printer) {
        return { success: false, message: 'Impressora térmica indisponível para acionar a gaveta' };
      }

      printer.clear();
      printer.openCashDrawer();
      await printer.execute();
      
      this.emit('cashDrawerOpened', { deviceId });
      return { success: true, message: 'Gaveta aberta' };
      
    } catch (error) {
      console.error('Erro ao abrir gaveta:', error);
      return { success: false, message: error.message };
    }
  }

  async openCashDrawerSystem(printerName) {
    if (process.platform !== 'win32') {
      return { success: false, message: 'Abertura da gaveta via impressora do sistema está disponível apenas no Windows' };
    }

    const script = `
$printerName = $env:DRAWER_PRINTER_NAME
$bytes = [byte[]](27,112,0,25,250,27,112,1,25,250)
$signature = @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, DOCINFOA di);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, Int32 dwCount, out Int32 dwWritten);

  public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr pPrinter = IntPtr.Zero;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "POPSYSTEM Drawer Pulse";
    di.pDataType = "RAW";
    int written = 0;

    if (!OpenPrinter(printerName, out pPrinter, IntPtr.Zero)) return false;
    try {
      if (!StartDocPrinter(pPrinter, 1, di)) return false;
      try {
        return WritePrinter(pPrinter, bytes, bytes.Length, out written) && written == bytes.Length;
      } finally {
        EndDocPrinter(pPrinter);
      }
    } finally {
      ClosePrinter(pPrinter);
    }
  }
}
"@
Add-Type -TypeDefinition $signature -Language CSharp
if ([RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)) {
  exit 0
}
exit 1
`;

    return await new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
          windowsHide: true,
          env: {
            ...process.env,
            DRAWER_PRINTER_NAME: printerName,
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            console.error('Erro ao abrir gaveta via impressora do sistema:', stderr || error.message);
            resolve({ success: false, message: stderr || error.message || 'Falha ao acionar gaveta na impressora do sistema' });
            return;
          }

          this.emit('cashDrawerOpened', { deviceId: `system:${printerName}` });
          resolve({ success: true, message: 'Gaveta aberta' });
        }
      );
    });
  }

  async printRawTextSystem(printerName, text) {
    if (process.platform !== 'win32') {
      return { success: false, message: 'Impressão RAW via impressora do sistema está disponível apenas no Windows' };
    }

    const safeText = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!safeText.trim()) {
      return { success: false, message: 'Texto de impressão vazio' };
    }

    const script = `
$printerName = $env:RAW_PRINTER_NAME
$rawText = $env:RAW_PRINTER_TEXT
$encoding = [System.Text.Encoding]::GetEncoding(850)
$payload = $encoding.GetBytes($rawText)
$prefix = [byte[]](27,64,27,116,2,27,69,1,27,71,1)
$suffix = [byte[]](27,71,0,27,69,0,10,10,10,29,86,65,0)
$bytes = New-Object byte[] ($prefix.Length + $payload.Length + $suffix.Length)
[Array]::Copy($prefix, 0, $bytes, 0, $prefix.Length)
[Array]::Copy($payload, 0, $bytes, $prefix.Length, $payload.Length)
[Array]::Copy($suffix, 0, $bytes, $prefix.Length + $payload.Length, $suffix.Length)
$signature = @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, DOCINFOA di);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, Int32 dwCount, out Int32 dwWritten);

  public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr pPrinter = IntPtr.Zero;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "POPSYSTEM Cash Report";
    di.pDataType = "RAW";
    int written = 0;

    if (!OpenPrinter(printerName, out pPrinter, IntPtr.Zero)) return false;
    try {
      if (!StartDocPrinter(pPrinter, 1, di)) return false;
      try {
        if (!StartPagePrinter(pPrinter)) return false;
        try {
          return WritePrinter(pPrinter, bytes, bytes.Length, out written);
        } finally {
          EndPagePrinter(pPrinter);
        }
      } finally {
        EndDocPrinter(pPrinter);
      }
    } finally {
      ClosePrinter(pPrinter);
    }
  }
}
"@
Add-Type -TypeDefinition $signature -Language CSharp
if ([RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)) {
  exit 0
}
exit 1
`;

    return await new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            RAW_PRINTER_NAME: printerName,
            RAW_PRINTER_TEXT: safeText,
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            console.error('Erro ao imprimir RAW via impressora do sistema:', stderr || error.message);
            resolve({ success: false, message: stderr || error.message || 'Falha ao imprimir relatório em RAW' });
            return;
          }

          resolve({ success: true, message: 'Relatório enviado para a impressora' });
        }
      );
    });
  }

  async printRawBytesSystem(printerName, bytes, documentName = 'POPSYSTEM Receipt') {
    if (process.platform !== 'win32') {
      return { success: false, message: 'Impressão RAW via impressora do sistema está disponível apenas no Windows' };
    }

    const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (!payload.length) {
      return { success: false, message: 'Dados de impressão vazios' };
    }

    const tempPath = path.join(os.tmpdir(), `popsystem-print-${crypto.randomUUID()}.raw`);
    await fs.writeFile(tempPath, payload);

    const script = `
$printerName = $env:RAW_PRINTER_NAME
$rawFile = $env:RAW_PRINTER_FILE
$documentName = $env:RAW_DOCUMENT_NAME
$bytes = [System.IO.File]::ReadAllBytes($rawFile)
$signature = @"
using System;
using System.Runtime.InteropServices;
public class PopSystemRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr handle, Int32 level, DOCINFOA info);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr handle, byte[] bytes, Int32 count, out Int32 written);

  public static bool Send(string printerName, string documentName, byte[] bytes) {
    IntPtr handle = IntPtr.Zero;
    int written = 0;
    DOCINFOA info = new DOCINFOA();
    info.pDocName = documentName;
    info.pDataType = "RAW";
    if (!OpenPrinter(printerName, out handle, IntPtr.Zero)) return false;
    try {
      if (!StartDocPrinter(handle, 1, info)) return false;
      try {
        if (!StartPagePrinter(handle)) return false;
        try { return WritePrinter(handle, bytes, bytes.Length, out written) && written == bytes.Length; }
        finally { EndPagePrinter(handle); }
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}
"@
Add-Type -TypeDefinition $signature -Language CSharp
if ([PopSystemRawPrinter]::Send($printerName, $documentName, $bytes)) { exit 0 }
exit 1
`;

    try {
      return await new Promise((resolve) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
          {
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            env: {
              ...process.env,
              RAW_PRINTER_NAME: printerName,
              RAW_PRINTER_FILE: tempPath,
              RAW_DOCUMENT_NAME: String(documentName || 'POPSYSTEM Receipt'),
            },
          },
          (error, stdout, stderr) => {
            if (error) {
              console.error('Erro ao imprimir bytes RAW via impressora do sistema:', stderr || error.message);
              resolve({ success: false, message: stderr || error.message || 'Falha ao imprimir cupom em RAW' });
              return;
            }
            resolve({ success: true, message: 'Cupom enviado para a impressora' });
          }
        );
      });
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  getConnectedPrinters() {
    const printers = [];
    
    for (const [deviceId, info] of this.connectedPrinters) {
      printers.push({
        deviceId,
        status: info.status,
        lastPrint: info.lastPrint,
        config: info.config
      });
    }
    
    return printers;
  }

  getPrinterStatus(deviceId) {
    const printerInfo = this.connectedPrinters.get(deviceId);
    return printerInfo ? printerInfo.status : 'disconnected';
  }

  getSupportedProtocols() {
    return [
      { id: 'epson', name: 'ESC/POS (Epson)', baudRate: 9600 },
      { id: 'bematech', name: 'ESC/POS (Bematech)', baudRate: 9600 },
      { id: 'daruma', name: 'ESC/POS (Daruma)', baudRate: 9600 },
      { id: 'elgin', name: 'ESC/POS (Elgin)', baudRate: 9600 },
      { id: 'tanca', name: 'ESC/POS (Tanca)', baudRate: 9600 },
      { id: 'pos', name: 'ESC/POS (POS Genérica)', baudRate: 9600 },
      { id: 'generic', name: 'ESC/POS (Genérico)', baudRate: 9600 }
    ];
  }

  async updatePrinterOptions(deviceId, newOptions) {
    const printerInfo = this.connectedPrinters.get(deviceId);
    if (!printerInfo) {
      return { success: false, message: 'Impressora não conectada' };
    }

    const merged = { ...(printerInfo.options || {}), ...(newOptions || {}) };
    printerInfo.options = merged;

    const requiresReconnect = Boolean(
      (newOptions && typeof newOptions === 'object') &&
      ('protocol' in newOptions || 'baudRate' in newOptions || 'dataBits' in newOptions || 'stopBits' in newOptions || 'parity' in newOptions || 'timeout' in newOptions || 'width' in newOptions)
    );

    if (requiresReconnect) {
      await this.disconnectPrinter(deviceId);
      return await this.connectPrinter(deviceId, merged);
    }

    return { success: true, message: 'Opções atualizadas com sucesso' };
  }

  async createCustomTemplate(name, templateConfig) {
    try {
      this.templates.set(name, templateConfig);
      
      // Salvar template em arquivo
      const templatesDir = path.join(__dirname, '../config/templates');
      await fs.mkdir(templatesDir, { recursive: true });
      
      const templatePath = path.join(templatesDir, `${name}.json`);
      await fs.writeFile(templatePath, JSON.stringify(templateConfig, null, 2));
      
      return { success: true, message: 'Template criado com sucesso' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  getAvailableTemplates() {
    const templates = [];
    
    for (const [name, config] of this.templates) {
      templates.push({
        name,
        displayName: config.name,
        width: config.width,
        sections: config.sections.length
      });
    }
    
    return templates;
  }

  async getAvailablePrinters() {
    try {
      // Obter impressoras do sistema Windows
      const systemPrinters = await this.getSystemPrinters();
      
      return systemPrinters;
    } catch (error) {
      console.error('Erro ao listar impressoras:', error);
      return [];
    }
  }

  async getSystemPrinters() {
    try {
      // Comando PowerShell para listar impressoras instaladas
      const command = 'powershell "Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus | ConvertTo-Json"';
      const { stdout } = await execAsync(command);
      
      let printers = [];
      if (stdout.trim()) {
        const result = JSON.parse(stdout);
        // Se há apenas uma impressora, o resultado não é um array
        printers = Array.isArray(result) ? result : [result];
      }

      return printers.map(printer => ({
        name: printer.Name,
        path: printer.PortName,
        driver: printer.DriverName,
        status: printer.PrinterStatus,
        type: 'system'
      }));
    } catch (error) {
      console.error('Erro ao obter impressoras do sistema:', error);
      return [];
    }
  }
}

module.exports = PrinterService;
