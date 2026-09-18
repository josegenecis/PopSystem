const PENDING_PRINT_KEY_PREFIX = 'orders_auto_print_pending:';
const MAX_PENDING_PRINTS = 100;

const getStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

const getPendingPrintKey = (userId: string) => `${PENDING_PRINT_KEY_PREFIX}${userId}`;

export const readPendingOrderPrintIds = (userId: string) => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return [];

  try {
    const stored = getStorage()?.getItem(getPendingPrintKey(normalizedUserId)) || '[]';
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? [...new Set(parsed.map(String).map((id) => id.trim()).filter(Boolean))].slice(-MAX_PENDING_PRINTS)
      : [];
  } catch {
    return [];
  }
};

const savePendingOrderPrintIds = (userId: string, ids: string[]) => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return;

  try {
    const storage = getStorage();
    if (!storage) return;
    const normalizedIds = [...new Set(ids.map(String).map((id) => id.trim()).filter(Boolean))]
      .slice(-MAX_PENDING_PRINTS);
    storage.setItem(getPendingPrintKey(normalizedUserId), JSON.stringify(normalizedIds));
  } catch (error) {
    console.warn('Não foi possível persistir a fila local de impressão:', error);
  }
};

export const enqueuePendingOrderPrint = (userId: string, orderId: string) => {
  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) return;
  savePendingOrderPrintIds(userId, [...readPendingOrderPrintIds(userId), normalizedOrderId]);
};

export const dequeuePendingOrderPrint = (userId: string, orderId: string) => {
  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) return;
  savePendingOrderPrintIds(
    userId,
    readPendingOrderPrintIds(userId).filter((id) => id !== normalizedOrderId),
  );
};
