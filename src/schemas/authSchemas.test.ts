import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatOwnerPhoneInput,
  normalizeOwnerPhone,
  ownerPhoneDigits,
  signupSchema,
} from './authSchemas';

const validSignup = {
  email: 'proprietario@restaurante.com',
  password: 'Senha123',
  confirmPassword: 'Senha123',
  restaurantName: 'Restaurante Teste',
  name: 'Maria Silva',
  ownerPhone: '(85) 99999-9999',
};

test('normaliza o telefone do proprietário para o padrão internacional', () => {
  assert.equal(ownerPhoneDigits('(85) 99999-9999'), '85999999999');
  assert.equal(normalizeOwnerPhone('(85) 99999-9999'), '5585999999999');
  assert.equal(normalizeOwnerPhone('+55 (85) 99999-9999'), '5585999999999');
});

test('preserva corretamente um telefone local cujo DDD é 55', () => {
  assert.equal(formatOwnerPhoneInput('55999999999'), '(55) 99999-9999');
  assert.equal(normalizeOwnerPhone('(55) 99999-9999'), '5555999999999');
  assert.equal(signupSchema.safeParse({ ...validSignup, ownerPhone: '(55) 99999-9999' }).success, true);
});

test('cadastro exige telefone com DDD válido', () => {
  assert.equal(signupSchema.safeParse(validSignup).success, true);
  assert.equal(signupSchema.safeParse({ ...validSignup, ownerPhone: '' }).success, false);
  assert.equal(signupSchema.safeParse({ ...validSignup, ownerPhone: '9999-9999' }).success, false);
});
