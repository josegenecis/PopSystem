export type InternalClientFilterRow = {
  restaurantName: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  financialStatus?: string;
  healthClassification?: string;
  accessStatus?: string;
  healthScore?: number;
  overdueDays?: number;
};

export function filterInternalClients<T extends InternalClientFilterRow>(clients: T[], filters: {
  search?: string;
  financial?: string;
  health?: string;
  access?: string;
}) {
  const query = String(filters.search || '').trim().toLocaleLowerCase('pt-BR');
  return clients.filter((client) => {
    const searchable = `${client.restaurantName} ${client.email || ''} ${client.phone || ''} ${client.city || ''} ${client.state || ''}`.toLocaleLowerCase('pt-BR');
    if (query && !searchable.includes(query)) return false;
    if (filters.financial && filters.financial !== 'all' && client.financialStatus !== filters.financial) return false;
    if (filters.health && filters.health !== 'all' && client.healthClassification !== filters.health) return false;
    if (filters.access && filters.access !== 'all' && client.accessStatus !== filters.access) return false;
    return true;
  }).sort((a, b) => Number(a.healthScore || 0) - Number(b.healthScore || 0) || Number(b.overdueDays || 0) - Number(a.overdueDays || 0));
}

export function monthlyRecurringRevenue(amount: number, billingMonths: number) {
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const safeMonths = Number.isFinite(billingMonths) ? Math.max(1, billingMonths) : 1;
  return safeAmount / safeMonths;
}
