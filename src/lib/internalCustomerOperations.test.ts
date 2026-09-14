import assert from 'node:assert/strict';
import test from 'node:test';
import { filterInternalClients, monthlyRecurringRevenue } from './internalCustomerOperations';

test('normaliza contrato anual para MRR mensal', () => {
  assert.equal(monthlyRecurringRevenue(2400, 12), 200);
  assert.equal(monthlyRecurringRevenue(159, 0), 159);
});

test('filtra carteira e prioriza cliente crítico mais atrasado', () => {
  const clients = [
    { restaurantName: 'Loja saudável', healthClassification: 'healthy', healthScore: 95, financialStatus: 'paid', accessStatus: 'allowed' },
    { restaurantName: 'Burger Crítico', healthClassification: 'critical', healthScore: 20, financialStatus: 'overdue', accessStatus: 'blocked', overdueDays: 12 },
    { restaurantName: 'Pizza Crítica', healthClassification: 'critical', healthScore: 20, financialStatus: 'overdue', accessStatus: 'blocked', overdueDays: 30 },
  ];
  const result = filterInternalClients(clients, { health: 'critical', financial: 'overdue', access: 'blocked' });
  assert.deepEqual(result.map((item) => item.restaurantName), ['Pizza Crítica', 'Burger Crítico']);
});

test('busca carteira ignorando maiúsculas', () => {
  const result = filterInternalClients([{ restaurantName: 'Açaí do João', city: 'Fortaleza' }], { search: 'JOÃO' });
  assert.equal(result.length, 1);
});

test('filtro de pagos inclui pagamento confirmado e período de assinatura pago', () => {
  const clients = [
    { restaurantName: 'Pagamento confirmado', financialStatus: 'paid' },
    { restaurantName: 'Assinatura vigente', financialStatus: 'paid_period' },
    { restaurantName: 'Pendente', financialStatus: 'pending' },
  ];
  const result = filterInternalClients(clients, { financial: 'paid' });
  assert.deepEqual(result.map((item) => item.restaurantName).sort(), ['Assinatura vigente', 'Pagamento confirmado']);
});
