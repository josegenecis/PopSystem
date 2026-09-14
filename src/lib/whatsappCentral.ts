export type WhatsAppTemplateVariables = {
  customerName?: string;
  restaurantName?: string;
  menuLink?: string;
  orderNumber?: string;
  deliveryTime?: string;
};

export function fillWhatsAppQuickReply(template: string, variables: WhatsAppTemplateVariables) {
  return String(template || '')
    .replaceAll('{{cliente_nome}}', variables.customerName || 'cliente')
    .replaceAll('{{restaurante_nome}}', variables.restaurantName || 'nosso restaurante')
    .replaceAll('{{link_cardapio}}', variables.menuLink || '')
    .replaceAll('{{pedido_numero}}', variables.orderNumber || '')
    .replaceAll('{{tempo_entrega}}', variables.deliveryTime || 'a confirmar');
}

export function orderItemSuggestions(items: unknown) {
  if (!Array.isArray(items)) return [];
  return items.flatMap((rawItem) => {
    const item = rawItem as Record<string, unknown>;
    const product = item.product && typeof item.product === 'object' ? item.product as Record<string, unknown> : {};
    const quantity = Math.max(1, Number(item.quantity || item.qty || 1));
    const name = String(item.name || item.product_name || product.name || '').trim();
    return name ? [`${quantity}x ${name}`] : [];
  });
}

export function normalizeSuggestedProductSearch(value: unknown) {
  return String(value || '').replace(/^\d+(?:[.,]\d+)?x\s*/i, '').trim();
}

export function minutesUntilTomorrow(now = new Date()) {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  return Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / 60_000));
}

export function isPossiblePaymentReceipt(message: { message_type?: string; content?: string; media_name?: string | null }) {
  if (message.message_type !== 'image') return false;
  const searchable = `${message.content || ''} ${message.media_name || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
  return /(comprovante|pagamento|pix|transferencia|paguei|deposito)/.test(searchable);
}

const deliveryRanks: Record<string, number> = { sending: 0, sent: 1, received: 1, delivered: 2, read: 3, failed: 4 };

export function latestDeliveryStatus(current: string, incoming: string) {
  return (deliveryRanks[incoming] ?? -1) >= (deliveryRanks[current] ?? -1) ? incoming : current;
}
