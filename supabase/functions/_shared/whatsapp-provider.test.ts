import { buildMetaRecipientCandidates } from './whatsapp-provider.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
  }
}

Deno.test('prioriza o nono dígito ao receber wa_id brasileiro legado', () => {
  assertEquals(buildMetaRecipientCandidates('558584570267'), [
    '5585984570267',
    '558584570267',
  ]);
});

Deno.test('preserva o número brasileiro atual e mantém o legado como fallback', () => {
  assertEquals(buildMetaRecipientCandidates('+55 85 98457-0267'), [
    '5585984570267',
    '558584570267',
  ]);
});
