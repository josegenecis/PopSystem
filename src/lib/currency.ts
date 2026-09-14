export const formatBRL = (value: number | string | null | undefined) => {
  const numericValue = typeof value === 'string' ? Number(value) : value;
  if (numericValue === null || numericValue === undefined || Number.isNaN(Number(numericValue))) {
    return 'R$ 0,00';
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(numericValue)).replace(/\u00a0/g, ' ');
};

export const formatBRLFromCents = (value: number | string | null | undefined) => {
  const numericValue = typeof value === 'string' ? Number(value) : value;
  if (numericValue === null || numericValue === undefined || Number.isNaN(Number(numericValue))) {
    return 'R$ 0,00';
  }

  return formatBRL(Number(numericValue) / 100);
};

export const parseBRL = (value: number | string | null | undefined) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const cleaned = String(value || '')
    .replace(/\s/g, '')
    .replace(/[^\d,.-]/g, '')
    .replace(/-/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatCurrencyInput = (value: number | string | null | undefined) => {
  const cents = typeof value === 'number'
    ? Math.max(0, Math.round(value * 100))
    : Math.max(0, parseInt(String(value || '').replace(/\D/g, ''), 10) || 0);

  return formatBRL(cents / 100);
};
