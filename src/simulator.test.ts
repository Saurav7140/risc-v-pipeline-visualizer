import assert from 'node:assert/strict'
import test from 'node:test'
import { assemble, createMachine, run, step } from './simulator.ts'
import { examples } from './examples.ts'

const execute = (source: string, forwarding = true) => run(createMachine(assemble(source), forwarding))

test('arithmetic, aliases, 32-bit wraparound, and x0', () => {
  const m = execute(`ADDI t0, zero, -0x1\nADDI t1, zero, 2\nADD t2, t0, t1\nSUB s0, t1, t0\nAND s1, t0, t1\nOR s2, s0, s1\nXOR a0, s2, t1\nADDI zero, a0, 7`)
  assert.equal(m.registers[0], 0)
  assert.deepEqual([m.registers[7], m.registers[8], m.registers[9], m.registers[18], m.registers[10]], [1, 3, 2, 3, 1])
  const wrap = execute('ADDI t0, zero, 2047\nADD t0, t0, t0\nADD t0, t0, t0')
  assert.equal(wrap.registers[5], 8188)
})

test('forwarding resolves ALU dependencies; disabling it inserts data stalls', () => {
  const source = 'ADDI t0, zero, 8\nADD t1, t0, t0\nSUB t2, t1, t0'
  const fast = execute(source)
  const slow = execute(source, false)
  assert.equal(fast.registers[7], 8)
  assert.deepEqual(fast.registers, slow.registers)
  assert.equal(fast.stalls, 0)
  assert.ok(slow.stalls >= 2)
  assert.ok(fast.trace.some(t => t.events.some(e => e.startsWith('Forwarded'))))
})

test('load-use waits one cycle and forwards the loaded value', () => {
  const m = execute(examples.load.source)
  assert.equal(m.memory[8], 21)
  assert.equal(m.registers[7], 42)
  assert.equal(m.registers[10], 43)
  assert.equal(m.stalls, 1)
  assert.ok(m.trace.some(t => t.stall && t.stages.EX === null))
})

test('store data dependencies work with and without forwarding', () => {
  const source = 'ADDI t0, zero, 11\nSW t0, 0(zero)\nLW a0, 0(zero)'
  for (const forwarding of [true, false]) {
    const m = execute(source, forwarding)
    assert.equal(m.memory[0], 11)
    assert.equal(m.registers[10], 11)
  }
  const loadedStore = execute('ADDI t0, zero, 19\nSW t0, 0(zero)\nLW t1, 0(zero)\nSW t1, 4(zero)')
  assert.equal(loadedStore.memory[1], 19)
  assert.equal(loadedStore.stalls, 1)
})

test('taken branches flush younger instructions and loop instances remain distinct', () => {
  const m = execute(examples.loop.source)
  assert.equal(m.registers[10], 10)
  assert.equal(m.registers[5], 5)
  assert.equal(m.retired, 16)
  assert.ok(m.flushes > 0)
  assert.ok(m.trace.some(t => t.flushed.length > 0))
  assert.equal(new Set(m.fetched.map(t => t.id)).size, m.fetched.length)
})

test('included examples finish with expected state', () => {
  const arithmetic = execute(examples.arithmetic.source)
  assert.deepEqual([arithmetic.registers[7], arithmetic.registers[8], arithmetic.registers[9], arithmetic.registers[18], arithmetic.registers[10]], [12, 5, 4, 5, 2])
  const store = execute(examples.store.source)
  assert.equal(store.memory[17], -16)
  assert.equal(store.registers[10], -16)
  assert.equal(store.registers[11], -13)
  for (const example of Object.values(examples)) assert.ok(execute(example.source).done)
})

test('assembly and memory failures include useful source context', () => {
  assert.throws(() => assemble('ADDI t0, zero, 1\nADD x33, t0, zero'), /Line 2: unknown register/)
  assert.throws(() => assemble('BEQ zero, zero, missing'), /Line 1: unknown label/)
  assert.throws(() => execute('LW t0, 2(zero)'), /line 1.*misaligned address 2/)
  assert.throws(() => execute('LW t0, 256(zero)'), /line 1.*valid range/)
})

test('each step records stage occupancy and full state; the pipeline drains', () => {
  let m = createMachine(assemble('ADDI t0, zero, 1'))
  for (let cycle = 1; cycle <= 6; cycle++) {
    m = step(m)
    assert.equal(m.trace.at(-1)?.cycle, cycle)
    assert.equal(m.trace.at(-1)?.registers.length, 32)
    assert.equal(m.trace.at(-1)?.memory.length, 64)
  }
  assert.ok(m.done)
  assert.equal(m.retired, 1)
  assert.equal(m.registers[5], 1)
})
