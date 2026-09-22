type ReceiptOrder = {
  total?: unknown;
  change_amount?: unknown;
  variations?: {
    payment_split?: {
      cash_received?: unknown;
      change_amount?: unknown;
    } | null;
  } | null;
};

function optionalMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Resolves the amount handed over by the customer and the resulting change.
 * Older PDV orders stored the resulting change in the top-level change_amount,
 * while payment_split retained both values. Prefer that explicit split data so
 * old receipts and reprints remain correct.
 */
export function resolveCashReceiptAmounts(order: ReceiptOrder) {
  const split = order?.variations?.payment_split;
  const storedAmount = optionalMoney(order?.change_amount) ?? 0;
  const cashReceived = optionalMoney(split?.cash_received) ?? storedAmount;
  const explicitChange = optionalMoney(split?.change_amount);
  const total = optionalMoney(order?.total) ?? 0;

  return {
    cashReceived,
    change: explicitChange ?? Math.max(0, cashReceived - total),
  };
}
