import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createPrintQueue } from './print-queue.js'

const server = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8')
const start = server.indexOf('async function queueCashDrawer(')
const end = server.indexOf('async function queueReportPrint(', start)
assert.ok(start >= 0 && end > start)
const body = server.slice(start, end)

function fixture({ configured = 'CAIXA TP-450', unavailable = false } = {}) {
  const queue = createPrintQueue()
  const events = []
  let current = 'COZINHA'
  const run = new Function('resolvePrinterTarget', 'physicalPrintQueue', 'openPrinter', 'restoreConfiguredPrinter', 'openCashDrawer', `${body}; return queueCashDrawer`)(
    route => { assert.equal(route, 'receipt'); return { transport: 'system', address: configured } },
    queue,
    (_transport, address) => { current = address; events.push(`select:${address}`); return !unavailable },
    () => Boolean(current),
    async payload => { events.push(`drawer:${current}:${payload.connector}`); return current === (configured || 'COZINHA') },
  )
  return { run, queue, events, setCurrent: value => { current = value } }
}

test('seleciona o caixa em dez vendas, mesmo após cada via de cozinha', async () => {
  const f = fixture()
  for (let i = 0; i < 10; i++) {
    f.setCurrent('COZINHA')
    assert.equal(await f.run({ connector: 'auto' }), true)
  }
  assert.equal(f.events.filter(e => e === 'drawer:CAIXA TP-450:auto').length, 10)
})

test('aguarda cupom em andamento e seleciona o caixa dentro da fila', async () => {
  const f = fixture()
  let release
  const pending = f.queue.run(async () => { await new Promise(resolve => { release = resolve }); f.setCurrent('COZINHA'); return true })
  await new Promise(resolve => setImmediate(resolve))
  const drawer = f.run({ connector: 'auto' })
  assert.deepEqual(f.events, [])
  release()
  await pending
  assert.equal(await drawer, true)
  assert.deepEqual(f.events, ['select:CAIXA TP-450', 'drawer:CAIXA TP-450:auto'])
})

test('não envia pulso quando a impressora do caixa não pode ser selecionada', async () => {
  const f = fixture({ unavailable: true })
  assert.equal(await f.run({ connector: 'auto' }), false)
  assert.deepEqual(f.events, ['select:CAIXA TP-450'])
})

test('preserva seleção explícita de integrações antigas sem rota configurada', async () => {
  const f = fixture({ configured: '' })
  assert.equal(await f.run({ connector: 0 }), true)
  assert.deepEqual(f.events, ['drawer:COZINHA:0'])
})

test('cada solicitação envia um único pulso lógico, sem repetição automática', async () => {
  const f = fixture()
  assert.deepEqual(await Promise.all([f.run({ connector: 'auto' }), f.run({ connector: 'auto' })]), [true, true])
  assert.equal(f.events.filter(e => e.startsWith('drawer:')).length, 2)
  assert.match(server, /case 'open_cash_drawer': \{\s*const ok = await queueCashDrawer\(payload\)/)
})
