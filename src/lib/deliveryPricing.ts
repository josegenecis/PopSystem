type DeliveryFeeSource = {
  delivery_fee?: unknown;
  fee?: unknown;
};

type ResolveDeliveryFeeInput = {
  isDeliveryMode: boolean;
  showNeighborhoodSelect: boolean;
  deliveryZoneId?: string | null;
  selectedZone?: DeliveryFeeSource | null;
  deliveryQuote?: {
    ok?: boolean;
    fee?: unknown;
    delivery_fee?: unknown;
    zone?: DeliveryFeeSource | null;
  } | null;
  storePricingMode?: string | null;
  deliverySettings?: {
    pricing?: {
      fixed?: DeliveryFeeSource | null;
    } | null;
  } | null;
};

const toNonNegativeMoney = (value: unknown) => {
  const parsed = typeof value === 'string'
    ? Number(value.trim().replace(',', '.'))
    : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const readDeliveryFee = (source?: DeliveryFeeSource | null): number | null => {
  if (!source) return null;
  const value = source.delivery_fee ?? source.fee;
  if (value === undefined || value === null || value === '') return null;
  return toNonNegativeMoney(value);
};

export const resolveDeliveryFee = ({
  isDeliveryMode,
  showNeighborhoodSelect,
  deliveryZoneId,
  selectedZone,
  deliveryQuote,
  storePricingMode,
  deliverySettings,
}: ResolveDeliveryFeeInput) => {
  if (!isDeliveryMode || storePricingMode === 'free') return 0;

  if (showNeighborhoodSelect) {
    if (String(deliveryZoneId || '').trim()) return readDeliveryFee(selectedZone) ?? 0;
    return readDeliveryFee(deliveryQuote?.zone) ?? 0;
  }

  if (deliveryQuote?.ok) {
    const quotedFee = readDeliveryFee(deliveryQuote.zone);
    return quotedFee ?? toNonNegativeMoney(deliveryQuote.delivery_fee ?? deliveryQuote.fee);
  }

  if (storePricingMode === 'fixed') {
    return readDeliveryFee(deliverySettings?.pricing?.fixed) ?? 0;
  }

  return 0;
};
