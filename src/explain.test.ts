import assert from 'node:assert/strict'
import test from 'node:test'
import { explainCycle } from './explain.ts'
import { assemble, createMachine, run } from './simulator.ts'
import { examples } from './examples.ts'
import { instructionGroups } from './instructionReference.ts'

const execute = (source: string, forwarding = true) => run(createMachine(assemble(source), forwarding))

test('instruction book covers the complete supported subset', () => {
  assert.deepEqual(instructionGroups.flatMap(group => group.entries.map(entry => entry.op)).sort(),
    ['ADD', 'ADDI', 'AND', 'BEQ', 'BNE', 'LW', 'NOP', 'OR', 'SUB', 'SW', 'XOR'])
})

test('the guide explains the recorded cycle rather than the final machine state', () => {
  const m = execute(examples.arithmetic.source)
  assert.match(explainCycle(m, 0).brief, /Step once/)
  const first = explainCycle(m, 1)
  assert.match(first.brief, /fetched into IF/)
  assert.equal(first.stages.find(item => item.stage === 'IF')?.instruction, 'ADDI t0, zero, 7')
  assert.match(first.stages.find(item => item.stage === 'IF')!.text, /byte address 0/)
  assert.match(explainCycle(m, 2).stages.find(item => item.stage === 'ID')!.text, /decoder identifies/i)
})

test('load-use stalls and bubbles get a teaching explanation', () => {
  const m = execute(examples.load.source)
  const cycle = m.trace.find(t => t.stall)!.cycle
  const guide = explainCycle(m, cycle)
  assert.equal(guide.stages.find(item => item.stage === 'EX')?.state, 'bubble')
  assert.match(guide.brief, /bubble enters EX/)
  assert.match(guide.stages.find(item => item.stage === 'ID')!.text, /Held in decode/)
  assert.ok(guide.notes.some(note => note.tone === 'stall' && note.text.includes('bubble')))
  assert.ok(m.trace.some(t => explainCycle(m, t.cycle).notes.some(note => note.title === 'Memory read')))
})

test('branch outcomes, flushes, writes, and hex values are explained', () => {
  const loop = execute(examples.loop.source)
  const taken = loop.trace.find(t => t.flushed.length)!.cycle
  const branchGuide = explainCycle(loop, taken)
  assert.match(branchGuide.brief, /flushed after a taken branch/)
  assert.ok(branchGuide.notes.some(note => note.tone === 'flush' && note.text.includes('wrong path')))
  assert.match(branchGuide.stages.find(item => item.stage === 'MEM')!.text, /branch was taken/)
  const notTaken = loop.trace.find(t => t.events.every(e => !e.includes('taken at line')) && t.stages.MEM && loop.fetched.find(f => f.id === t.stages.MEM)?.inst.op === 'BNE')!.cycle
  assert.ok(explainCycle(loop, notTaken).notes.some(note => note.title === 'Branch not taken'))

  const store = execute(examples.store.source)
  const write = store.trace.find(t => t.memoryWrite)!.cycle
  assert.ok(explainCycle(store, write, true).notes.some(note => note.text.includes('0xfffffff0')))
  const register = store.trace.find(t => t.registerWrite?.index === 10)!.cycle
  assert.ok(explainCycle(store, register, true).notes.some(note => note.text.includes('0xfffffff0')))
})
