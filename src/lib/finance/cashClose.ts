type CashCloseOrder = {
  total?: unknown;
  discount?: unknown;
  delivery_fee?: unknown;
  variations?: unknown;
};

export type CashCloseRevenueSummary = {
  grossRevenue: number;
  discounts: number;
  deliveryFee: number;
  surcharge: number;
  netRevenue: number;
};

const toCents = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

const readVariations = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const getSurchargeCents = (order: CashCloseOrder) => {
  const variations = readVariations(order.variations);
  const adjustments = variations.financial_adjustments;
  if (!adjustments || typeof adjustments !== 'object' || Array.isArray(adjustments)) return 0;
  return Math.max(0, toCents((adjustments as Record<string, unknown>).surcharge));
};

export const summarizeCashCloseRevenue = (orders: CashCloseOrder[]): CashCloseRevenueSummary => {
  let grossRevenueCents = 0;
  let discountsCents = 0;
  let deliveryFeeCents = 0;
  let surchargeCents = 0;
  let netRevenueCents = 0;

  for (const order of orders) {
    const total = Math.max(0, toCents(order.total));
    const discount = Math.max(0, toCents(order.discount));
    const deliveryFee = Math.max(0, toCents(order.delivery_fee));
    const surcharge = getSurchargeCents(order);

    netRevenueCents += total;
    discountsCents += discount;
    deliveryFeeCents += deliveryFee;
    surchargeCents += surcharge;
    grossRevenueCents += Math.max(0, total + discount - deliveryFee - surcharge);
  }

  return {
    grossRevenue: grossRevenueCents / 100,
    discounts: discountsCents / 100,
    deliveryFee: deliveryFeeCents / 100,
    surcharge: surchargeCents / 100,
    netRevenue: netRevenueCents / 100,
  };
};
