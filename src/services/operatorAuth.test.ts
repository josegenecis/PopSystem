import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessOperatorArea,
  canCancelOrder,
  canCloseCash,
  canMoveCash,
  canOpenCash,
  getDefaultOperatorPath,
  getOperatorAreaForPath,
  getOperatorPathForRequestedPath,
} from './operatorAuth';

test('permissão abrir/fechar caixa libera a operação e a rota do caixa', () => {
  const operator = { id: 'cashier-1', permissions: { pos_open_close: true } };
  assert.equal(canOpenCash(operator), true);
  assert.equal(canCloseCash(operator), true);
  assert.equal(canAccessOperatorArea(operator, 'cash'), true);
  assert.equal(canAccessOperatorArea(operator, 'finance'), false);
});

test('permissões legadas de abertura e fechamento continuam válidas', () => {
  assert.equal(canOpenCash({ id: 'cashier-2', permissions: { can_open_cash: true } }), true);
  assert.equal(canCloseCash({ id: 'cashier-3', permissions: { can_close_cash: true } }), true);
});

test('movimentação de caixa é independente de abrir e fechar', () => {
  const operator = { id: 'cashier-4', permissions: { cash_movement: true } };
  assert.equal(canMoveCash(operator), true);
  assert.equal(canOpenCash(operator), false);
  assert.equal(canCloseCash(operator), false);
  assert.equal(canAccessOperatorArea(operator, 'cash'), true);
});

test('administrador sempre pode operar o caixa', () => {
  const admin = { id: 'admin-1', role: 'admin' };
  assert.equal(canOpenCash(admin), true);
  assert.equal(canCloseCash(admin), true);
  assert.equal(canMoveCash(admin), true);
});

test('permissões de delivery separam áreas de entrega e motoboys', () => {
  const areas = { id: 'delivery-areas', permissions: { delivery_areas_manage: true } };
  const drivers = { id: 'delivery-drivers', permissions: { delivery_drivers_manage: true } };

  assert.equal(canAccessOperatorArea(areas, 'deliveryAreas'), true);
  assert.equal(canAccessOperatorArea(areas, 'deliveryTeam'), false);
  assert.equal(canAccessOperatorArea(areas, 'settings'), true);
  assert.equal(canAccessOperatorArea(drivers, 'deliveryTeam'), true);
  assert.equal(canAccessOperatorArea(drivers, 'deliveryAreas'), false);
  assert.equal(canAccessOperatorArea(drivers, 'settings'), false);
});

test('permissão legada de delivery continua liberando áreas e motoboys', () => {
  const operator = { id: 'legacy-delivery', permissions: { delivery_manage: true } };
  assert.equal(canAccessOperatorArea(operator, 'deliveryAreas'), true);
  assert.equal(canAccessOperatorArea(operator, 'deliveryTeam'), true);
});

test('permissões granulares liberam somente as áreas correspondentes', () => {
  const whatsapp = { id: 'whatsapp', permissions: { whatsapp_manage: true } };
  const hardware = { id: 'hardware', permissions: { hardware_manage: true } };
  const ifood = { id: 'ifood', permissions: { ifood_manage: true } };
  const payments = { id: 'payments', permissions: { payments_manage: true } };
  const timeclock = { id: 'timeclock', permissions: { timeclock_manage: true } };

  assert.equal(canAccessOperatorArea(whatsapp, 'whatsapp'), true);
  assert.equal(canAccessOperatorArea(whatsapp, 'marketing'), false);
  assert.equal(canAccessOperatorArea(hardware, 'hardware'), true);
  assert.equal(canAccessOperatorArea(ifood, 'integrations'), true);
  assert.equal(canAccessOperatorArea(payments, 'pix'), true);
  assert.equal(canAccessOperatorArea(timeclock, 'timeclock'), true);
  assert.equal(canAccessOperatorArea(timeclock, 'team'), false);
});

test('cancelamento de pedidos é independente da permissão de remover itens', () => {
  assert.equal(canCancelOrder({ id: 'cashier-5', permissions: { orders_cancel: true } }), true);
  assert.equal(canCancelOrder({ id: 'cashier-6', permissions: { pos_cancel_item: true } }), false);
});

test('cadastro de clientes aceita permissão própria e mantém acesso de quem gerencia pedidos', () => {
  const customerManager = { id: 'customers', permissions: { customers_manage: true } };
  const orderManager = { id: 'orders', permissions: { orders_manage: true } };
  assert.equal(canAccessOperatorArea(customerManager, 'customers'), true);
  assert.equal(canAccessOperatorArea(customerManager, 'orders'), false);
  assert.equal(canAccessOperatorArea(orderManager, 'customers'), true);
  assert.equal(getOperatorAreaForPath('/clientes'), 'customers');
});

test('rotas de entrega respeitam as novas permissões e escolhem um destino válido', () => {
  const driver = { id: 'driver', permissions: { delivery_drivers_manage: true } };
  assert.equal(getOperatorAreaForPath('/bairros-entrega'), 'deliveryAreas');
  assert.equal(getOperatorAreaForPath('/entregadores'), 'deliveryTeam');
  assert.equal(getDefaultOperatorPath(driver), '/entregadores');
  assert.equal(getOperatorPathForRequestedPath(driver, '/bairros-entrega'), '/entregadores');
  assert.equal(getOperatorPathForRequestedPath(driver, '/entregadores'), '/entregadores');
});
