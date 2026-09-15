import assert from 'node:assert/strict';
import test from 'node:test';
import { isStaleChunkError } from './chunkRecovery';

test('reconhece erro de MIME do Safari ao receber HTML no lugar do chunk', () => {
  assert.equal(
    isStaleChunkError(new TypeError("'text/html' is not a valid JavaScript MIME type.")),
    true,
  );
});

test('reconhece mensagens de módulos dinâmicos usadas por outros navegadores', () => {
  assert.equal(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module')), true);
  assert.equal(
    isStaleChunkError(new TypeError('Expected a JavaScript module script but the server responded with a MIME type of text/html.')),
    true,
  );
});

test('não recarrega a aplicação por erros comuns de negócio', () => {
  assert.equal(isStaleChunkError(new Error('Pagamento não autorizado')), false);
});
