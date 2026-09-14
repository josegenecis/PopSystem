import assert from 'node:assert/strict';
import test from 'node:test';
import { hasFeatureAccess, isFeatureAccessPending } from './featureAccess';

test('Essencial ativo acessa caixa e financeiro', () => {
  assert.equal(hasFeatureAccess('finance', { status: 'active', plan_id: 1 }), true);
});

test('Essencial ativo acessa o WhatsApp Bot', () => {
  assert.equal(hasFeatureAccess('whatsapp', { status: 'active', plan_id: 1 }), true);
});

test('Essencial ativo acessa estoque, motoboys, app desktop, impressão e balanças', () => {
  const essencial = { status: 'active', plan_id: 1 };
  assert.equal(hasFeatureAccess('stock', essencial), true);
  assert.equal(hasFeatureAccess('deliveryTeam', essencial), true);
  assert.equal(hasFeatureAccess('desktop', essencial), true);
  assert.equal(hasFeatureAccess('hardware', essencial), true);
});

test('Essencial ativo permite administrar usuários, equipe e permissões de caixa', () => {
  assert.equal(hasFeatureAccess('team', { status: 'active', plan_id: 1 }), true);
});

test('Essencial ativo acessa banners, cupons e fidelidade sem liberar o marketing Pro', () => {
  const essencial = { status: 'active', plan_id: 1 };
  assert.equal(hasFeatureAccess('marketingEssential', essencial), true);
  assert.equal(hasFeatureAccess('marketing', essencial), false);
});

test('acesso ao plano fica pendente enquanto a assinatura inicial ainda carrega', () => {
  assert.equal(isFeatureAccessPending(true, null), true);
  assert.equal(isFeatureAccessPending(false, null), false);
  assert.equal(isFeatureAccessPending(true, { plan_id: 1 }), false);
});

test('Essencial continua sem acesso ao financeiro multilojas', () => {
  assert.equal(hasFeatureAccess('multiFinance', { status: 'active', plan_id: 1 }), false);
});

test('teste ativo recebe acesso completo, inclusive Multi', () => {
  assert.equal(hasFeatureAccess('multiFinance', {
    status: 'trialing',
    plan_id: 1,
    trial_end: '2999-12-31T23:59:59.000Z',
  }), true);
});

test('liberacao administrativa preserva os recursos do plano contratado', () => {
  const subscription = {
    status: 'expired',
    plan_id: 1,
    access_override_until: '2999-12-31T23:59:59.000Z',
  };
  assert.equal(hasFeatureAccess('finance', subscription), true);
  assert.equal(hasFeatureAccess('stock', subscription), true);
  assert.equal(hasFeatureAccess('cmv', subscription), false);
});

test('liberacao administrativa vencida nao libera recursos', () => {
  assert.equal(hasFeatureAccess('finance', {
    status: 'expired',
    plan_id: 1,
    access_override_until: '2000-01-01T00:00:00.000Z',
  }), false);
});
