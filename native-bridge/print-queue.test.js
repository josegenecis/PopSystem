import assert from 'node:assert/strict'
import test from 'node:test'
import { createPrintQueue } from './print-queue.js'

test('serializes different physical print jobs', async () => {
  const queue = createPrintQueue()
  let active = 0
  let maxActive = 0
  const job = async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    active -= 1
    return true
  }

  await Promise.all([queue.run(job, { key: 'one' }), queue.run(job, { key: 'two' })])
  assert.equal(maxActive, 1)
})

test('coalesces concurrent copies and remembers successful automatic prints', async () => {
  const queue = createPrintQueue()
  let calls = 0
  const job = async () => { calls += 1; return true }

  const [first, concurrent] = await Promise.all([
    queue.run(job, { key: 'order-1' }),
    queue.run(job, { key: 'order-1' }),
  ])
  const repeated = await queue.run(job, { key: 'order-1' })

  assert.equal(calls, 1)
  assert.equal(first.ok, true)
  assert.equal(concurrent.ok, true)
  assert.equal(repeated.duplicate, true)
})

test('allows retry after a failed print', async () => {
  const queue = createPrintQueue()
  let calls = 0
  const job = async () => { calls += 1; return calls > 1 }

  assert.equal((await queue.run(job, { key: 'order-2' })).ok, false)
  assert.equal((await queue.run(job, { key: 'order-2' })).ok, true)
  assert.equal(calls, 2)
})
