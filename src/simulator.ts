export const ABI = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3',
  's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
] as const

export const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const
export type Stage = typeof STAGES[number]
export type Op = 'ADD' | 'SUB' | 'ADDI' | 'AND' | 'OR' | 'XOR' | 'LW' | 'SW' | 'BEQ' | 'BNE' | 'NOP'
export type Instruction = { op: Op; rd?: number; rs1?: number; rs2?: number; imm?: number; target?: number; line: number; text: string; pc: number }
export type Token = { id: number; pc: number; inst: Instruction; result?: number; address?: number; storeValue?: number }
export type Slot = Token | null
export type StageMap = Record<Stage, Slot>
export type Trace = {
  cycle: number
  stages: Record<Stage, number | null>
  flushed: { id: number; stage: Stage }[]
  stall: boolean
  events: string[]
  registerWrite?: { index: number; value: number }
  memoryWrite?: { address: number; value: number }
  registers: number[]
  memory: number[]
}
export type Machine = {
  program: Instruction[]
  registers: number[]
  memory: number[]
  slots: StageMap
  fetched: Token[]
  trace: Trace[]
  pc: number
  nextId: number
  cycle: number
  retired: number
  stalls: number
  flushes: number
  forwarding: boolean
  done: boolean
}

export const MEMORY_WORDS = 64
export const CYCLE_LIMIT = 500
const OPS = new Set<Op>(['ADD', 'SUB', 'ADDI', 'AND', 'OR', 'XOR', 'LW', 'SW', 'BEQ', 'BNE', 'NOP'])
const writes = (i: Instruction) => i.rd !== undefined && i.rd !== 0

function fail(line: number, message: string): never { throw new Error(`Line ${line}: ${message}`) }
function register(value: string, line: number): number {
  const name = value.trim().toLowerCase()
  const x = /^x(\d+)$/.exec(name)
  const index = x ? Number(x[1]) : name === 'fp' ? 8 : ABI.indexOf(name as typeof ABI[number])
  if (!Number.isInteger(index) || index < 0 || index > 31) fail(line, `unknown register "${value}"`)
  return index
}
function immediate(value: string, line: number): number {
  const raw = value.trim()
  if (!/^[+-]?(?:\d+|0x[\da-f]+)$/i.test(raw)) fail(line, `invalid immediate "${value}"`)
  const sign = raw.startsWith('-') ? -1 : 1
  const magnitude = raw.replace(/^[+-]/, '')
  const n = sign * Number(magnitude)
  if (!Number.isSafeInteger(n)) fail(line, `immediate is too large: "${value}"`)
  return n
}
function imm12(value: string, line: number): number {
  const n = immediate(value, line)
  if (n < -2048 || n > 2047) fail(line, '12-bit immediate must be between -2048 and 2047')
  return n
}
function memoryOperand(value: string, line: number): { imm: number; rs1: number } {
  const match = /^(.+?)\s*\(\s*([^()]+)\s*\)$/.exec(value.trim())
  if (!match) fail(line, 'expected offset(base), for example 0(sp)')
  return { imm: imm12(match[1], line), rs1: register(match[2], line) }
}

export function assemble(source: string): Instruction[] {
  const labels = new Map<string, number>()
  const lines: { line: number; text: string }[] = []
  source.split(/\r?\n/).forEach((raw, index) => {
    let text = raw.split('#', 1)[0].trim()
    while (text) {
      const label = /^([a-z_][\w]*):/i.exec(text)
      if (!label) break
      if (labels.has(label[1].toLowerCase())) fail(index + 1, `duplicate label "${label[1]}"`)
      labels.set(label[1].toLowerCase(), lines.length)
      text = text.slice(label[0].length).trim()
    }
    if (text) lines.push({ line: index + 1, text })
  })
  return lines.map(({ line, text }, pc) => {
    const match = /^([a-z]+)(?:\s+(.*))?$/i.exec(text)
    if (!match) fail(line, `invalid instruction "${text}"`)
    const op = match[1].toUpperCase() as Op
    if (!OPS.has(op)) fail(line, `unsupported instruction "${match[1]}"`)
    const args = match[2]?.split(',').map(x => x.trim()) ?? []
    const expected = op === 'NOP' ? 0 : ['LW', 'SW'].includes(op) ? 2 : 3
    if (args.length !== expected || args.some(x => !x)) fail(line, `${op} expects ${expected} operands`)
    const inst: Instruction = { op, line, text, pc }
    if (op === 'NOP') return inst
    if (op === 'LW' || op === 'SW') {
      const mem = memoryOperand(args[1], line)
      Object.assign(inst, mem)
      if (op === 'LW') inst.rd = register(args[0], line)
      else inst.rs2 = register(args[0], line)
    } else if (op === 'BEQ' || op === 'BNE') {
      inst.rs1 = register(args[0], line)
      inst.rs2 = register(args[1], line)
      const label = labels.get(args[2].toLowerCase())
      if (label !== undefined) inst.target = label
      else if (/^[+-]?(?:\d+|0x[\da-f]+)$/i.test(args[2])) {
        const offset = immediate(args[2], line)
        if (offset % 4 !== 0) fail(line, 'branch byte offset must be a multiple of 4')
        inst.target = pc + offset / 4
      } else fail(line, `unknown label "${args[2]}"`)
      if (inst.target < 0 || inst.target > lines.length) fail(line, 'branch target is outside the program')
    } else {
      inst.rd = register(args[0], line)
      inst.rs1 = register(args[1], line)
      if (op === 'ADDI') inst.imm = imm12(args[2], line)
      else inst.rs2 = register(args[2], line)
    }
    return inst
  })
}

export function createMachine(program: Instruction[], forwarding = true): Machine {
  return {
    program, forwarding, registers: Array(32).fill(0), memory: Array(MEMORY_WORDS).fill(0),
    slots: { IF: null, ID: null, EX: null, MEM: null, WB: null }, fetched: [], trace: [],
    pc: 0, nextId: 1, cycle: 0, retired: 0, stalls: 0, flushes: 0, done: program.length === 0,
  }
}

function checkedAddress(address: number, token: Token): number {
  if (address % 4 !== 0) throw new Error(`Cycle memory access: line ${token.inst.line} (${token.inst.text}) uses misaligned address ${address}; word addresses must be multiples of 4`)
  if (address < 0 || address >= MEMORY_WORDS * 4) throw new Error(`Cycle memory access: line ${token.inst.line} (${token.inst.text}) uses address ${address}; valid range is 0–${MEMORY_WORDS * 4 - 4}`)
  return address / 4
}

export function step(machine: Machine): Machine {
  if (machine.done) return machine
  if (machine.cycle >= CYCLE_LIMIT) throw new Error(`Cycle limit (${CYCLE_LIMIT}) reached. The program may contain an infinite loop.`)
  const { IF, ID, EX, MEM, WB } = machine.slots
  const registers = [...machine.registers]
  const memory = [...machine.memory]
  const events: string[] = []
  let registerWrite: Trace['registerWrite']
  let memoryWrite: Trace['memoryWrite']
  let retired = machine.retired
  if (WB) {
    if (writes(WB.inst)) {
      registers[WB.inst.rd!] = WB.result! | 0
      registerWrite = { index: WB.inst.rd!, value: registers[WB.inst.rd!] }
      events.push(`${WB.inst.text} writes ${ABI[WB.inst.rd!]} = ${registers[WB.inst.rd!]}.`)
    }
    retired++
  }
  let nextWB: Slot = null
  if (MEM) {
    nextWB = { ...MEM }
    if (MEM.inst.op === 'LW') {
      const address = MEM.address!
      nextWB.result = memory[checkedAddress(address, MEM)]
      events.push(`${MEM.inst.text} loads from address ${address}.`)
    } else if (MEM.inst.op === 'SW') {
      const address = MEM.address!
      memory[checkedAddress(address, MEM)] = MEM.storeValue! | 0
      memoryWrite = { address, value: memory[address / 4] }
      events.push(`${MEM.inst.text} stores ${MEM.storeValue} at address ${address}.`)
    }
  }
  const forward = (reg: number | undefined, consumer: Token): number => {
    if (reg === undefined || reg === 0) return 0
    if (machine.forwarding && MEM && MEM.inst.rd === reg && writes(MEM.inst)) {
      events.push(`Forwarded ${ABI[reg]} from MEM to ${consumer.inst.op} in EX.`)
      return nextWB!.result!
    }
    if (machine.forwarding && WB && WB.inst.rd === reg && writes(WB.inst)) {
      events.push(`Forwarded ${ABI[reg]} from WB to ${consumer.inst.op} in EX.`)
      return WB.result!
    }
    return registers[reg]
  }
  let nextMEM: Slot = null
  let branchTaken = false
  let branchTarget = machine.pc
  if (EX) {
    const i = EX.inst
    const a = forward(i.rs1, EX)
    const b = forward(i.rs2, EX)
    nextMEM = { ...EX }
    switch (i.op) {
      case 'ADD': nextMEM.result = (a + b) | 0; break
      case 'SUB': nextMEM.result = (a - b) | 0; break
      case 'ADDI': nextMEM.result = (a + i.imm!) | 0; break
      case 'AND': nextMEM.result = a & b; break
      case 'OR': nextMEM.result = a | b; break
      case 'XOR': nextMEM.result = a ^ b; break
      case 'LW': case 'SW':
        nextMEM.address = (a + i.imm!) | 0
        if (i.op === 'SW') nextMEM.storeValue = b
        break
      case 'BEQ': branchTaken = a === b; break
      case 'BNE': branchTaken = a !== b; break
    }
    if (branchTaken) {
      branchTarget = i.target!
      events.push(`${i.op} taken at line ${i.line}; redirect to ${branchTarget === machine.program.length ? 'program end' : `line ${machine.program[branchTarget].line}`}.`)
    }
  }
  const reads = ID ? [ID.inst.rs1, ID.inst.rs2].filter((r): r is number => r !== undefined && r !== 0) : []
  const hazard = !!ID && !branchTaken && (
    machine.forwarding
      ? !!EX && EX.inst.op === 'LW' && writes(EX.inst) && reads.includes(EX.inst.rd!)
      : [EX, MEM].some(t => !!t && writes(t.inst) && reads.includes(t.inst.rd!))
  )
  const flushed: Trace['flushed'] = []
  let nextEX: Slot = null
  let nextID: Slot = null
  let nextIF: Slot = null
  let pc = machine.pc
  let nextId = machine.nextId
  const fetched = [...machine.fetched]
  if (branchTaken) {
    if (ID) flushed.push({ id: ID.id, stage: 'ID' })
    if (IF) flushed.push({ id: IF.id, stage: 'IF' })
    pc = branchTarget
    events.push(`Flushed ${flushed.length} younger instruction${flushed.length === 1 ? '' : 's'}; predict-not-taken was wrong.`)
  } else if (hazard) {
    nextID = ID
    nextIF = IF
    events.push(machine.forwarding
      ? `Load-use stall: ${ID!.inst.text} waits one cycle for ${EX!.inst.text}; bubble inserted in EX.`
      : `Data stall: ${ID!.inst.text} waits for ${[EX, MEM].filter(t => t && writes(t.inst) && reads.includes(t.inst.rd!)).map(t => t!.inst.text).join(' and ')} to reach WB; bubble inserted in EX.`)
  } else {
    nextEX = ID
    nextID = IF
    if (pc < machine.program.length) {
      nextIF = { id: nextId++, pc, inst: machine.program[pc] }
      fetched.push(nextIF)
      pc++
    }
  }
  const slots = { IF: nextIF, ID: nextID, EX: nextEX, MEM: nextMEM, WB: nextWB }
  const cycle = machine.cycle + 1
  const trace: Trace = {
    cycle, stages: Object.fromEntries(STAGES.map(stage => [stage, slots[stage]?.id ?? null])) as Trace['stages'],
    flushed, stall: hazard, events, registerWrite, memoryWrite, registers: [...registers], memory: [...memory],
  }
  return {
    ...machine, registers, memory, slots, fetched, pc, nextId, cycle, retired,
    stalls: machine.stalls + Number(hazard), flushes: machine.flushes + flushed.length,
    trace: [...machine.trace, trace],
    done: pc >= machine.program.length && STAGES.every(stage => !slots[stage]),
  }
}

export function run(machine: Machine): Machine {
  while (!machine.done) machine = step(machine)
  return machine
}
