export type SaleUnit = 'un' | 'kg';

export function normalizeSaleUnit(value: unknown): SaleUnit {
  return String(value || '').toLowerCase() === 'kg' ? 'kg' : 'un';
}

export function formatSaleQuantity(quantity: unknown, saleUnit: unknown): string {
  const value = Number(quantity || 0);

  if (normalizeSaleUnit(saleUnit) !== 'kg') {
    return `${Number.isInteger(value) ? value : value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}x`;
  }

  if (value > 0 && value < 1) {
    return `${Math.round(value * 1000)} g`;
  }

  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 3,
    maximumFractionDigits: 3,
  })} kg`;
}
