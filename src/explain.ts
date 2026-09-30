import { ABI, STAGES, type Instruction, type Machine, type Stage } from './simulator.ts'

export function format(value: number, hex: boolean) {
  return hex ? `0x${(value >>> 0).toString(16).padStart(8, '0')}` : String(value | 0)
}

type Note = { tone: 'stall' | 'flush' | 'forward' | 'write' | 'info'; title: string; text: string }
type StageNote = { stage: Stage; instruction?: string; id?: number; text: string; state: 'active' | 'idle' | 'bubble' }

function operation(inst: Instruction) {
  const a = ABI[inst.rs1 ?? 0]
  const b = ABI[inst.rs2 ?? 0]
  switch (inst.op) {
    case 'ADD': return `add ${a} and ${b}`
    case 'SUB': return `subtract ${b} from ${a}`
    case 'ADDI': return `add ${inst.imm} to ${a}`
    case 'AND': return `apply bitwise AND to ${a} and ${b}`
    case 'OR': return `apply bitwise OR to ${a} and ${b}`
    case 'XOR': return `apply bitwise XOR to ${a} and ${b}`
    case 'LW': return `calculate the address ${a} + ${inst.imm} for a word load`
    case 'SW': return `calculate the address ${a} + ${inst.imm} and prepare ${b} for a word store`
    case 'BEQ': return `compare ${a} and ${b} for equality`
    case 'BNE': return `compare ${a} and ${b} for inequality`
    case 'NOP': return 'do no work'
  }
}

export function explainCycle(machine: Machine, cycle: number, hex = false): { title: string; brief: string; stages: StageNote[]; notes: Note[] } {
  const trace = machine.trace[cycle - 1]
  if (!trace) return { title: 'Ready for the first cycle', brief: 'Step once to fetch an instruction.', stages: [], notes: [] }
  const previous = machine.trace[cycle - 2]
  const byId = new Map(machine.fetched.map(token => [token.id, token.inst]))
  const taken = trace.events.some(event => /^(BEQ|BNE) taken at line/.test(event))
  const load = trace.events.find(event => event.includes(' loads from address '))
  const forwarding = trace.events.filter(event => event.startsWith('Forwarded'))
  const stages: StageNote[] = STAGES.map(stage => {
    const id = trace.stages[stage]
    if (id === null) return {
      stage, state: stage === 'EX' && trace.stall ? 'bubble' : 'idle',
      text: stage === 'EX' && trace.stall
        ? 'A bubble occupies this cycle in place of an instruction. Decode and fetch are held while the needed value becomes available.'
        : stage === 'IF' && taken ? 'Fetch pauses for the taken branch. The target instruction can be fetched on the next cycle.'
          : 'No instruction occupies this stage at the end of this cycle.',
    }
    const inst = byId.get(id)!
    let text: string
    if (stage === 'IF') text = previous?.stages.IF === id
      ? 'Fetch is held on this instruction while a dependency is resolved in decode.'
      : `Fetched from program byte address ${inst.pc * 4}. The next instruction is predicted to be sequential.`
    else if (stage === 'ID') text = previous?.stages.ID === id && trace.stall
      ? 'Held in decode because a source register depends on an earlier instruction. It has not entered EX yet.'
      : `The decoder identifies this instruction and its operands. It will enter EX when the operands are safe to use.`
    else if (stage === 'EX') text = `Ready to ${operation(inst)} on the next cycle. EX is where arithmetic, addresses, and branch decisions are resolved.`
    else if (stage === 'MEM') {
      if (inst.op === 'LW') text = 'EX calculated the effective address this cycle. MEM will read the word on the next cycle.'
      else if (inst.op === 'SW') text = 'EX calculated the effective address and prepared store data this cycle. MEM will write the word on the next cycle.'
      else if (inst.op === 'BEQ' || inst.op === 'BNE') text = `EX compared the registers this cycle. The branch was ${taken ? 'taken, so younger instructions were flushed' : 'not taken, so sequential execution continues'}.`
      else text = inst.op === 'NOP' ? 'NOP advanced without changing any data.' : `EX completed ${inst.op} this cycle. MEM passes its result toward WB without accessing data memory.`
    } else if (inst.op === 'LW') text = 'MEM read the word this cycle. WB can write the loaded value to its destination on the next cycle.'
    else if (inst.op === 'SW') text = 'MEM performed the store this cycle. The instruction will retire in WB without a register write.'
    else if (inst.rd !== undefined && inst.rd !== 0) text = `The result is ready. WB will write ${ABI[inst.rd]} on the next cycle.`
    else text = 'This instruction will retire in WB on the next cycle without changing a register.'
    return { stage, id, instruction: inst.text, text, state: 'active' }
  })
  const notes: Note[] = []
  if (trace.stall) notes.push({ tone: 'stall', title: 'Why the pipeline paused', text: `${trace.events.find(event => event.includes(' stall:')) ?? 'A data dependency needs more time.'} IF and ID stay in place while EX receives a bubble.` })
  if (taken) notes.push({ tone: 'flush', title: 'Taken branch and flush', text: `The branch resolved in EX. ${trace.flushed.length ? `${trace.flushed.map(item => `I${item.id} in ${item.stage}`).join(' and ')} ${trace.flushed.length === 1 ? 'was' : 'were'} on the wrong path and discarded.` : 'There were no younger instructions to discard.'} Fetch restarts at the target next cycle.` })
  else if (previous?.stages.EX) {
    const branch = byId.get(previous.stages.EX)
    if (branch?.op === 'BEQ' || branch?.op === 'BNE') notes.push({ tone: 'info', title: 'Branch not taken', text: `${branch.op} compared its operands in EX. The condition was false, so execution continues with the next instruction.` })
  }
  for (const event of forwarding) notes.push({ tone: 'forward', title: 'Forwarding avoided a wait', text: `${event} The value bypassed the register file so the consumer could execute now.` })
  if (load) notes.push({ tone: 'info', title: 'Memory read', text: `${load} The loaded value travels to WB, where its destination register will be written next cycle.` })
  if (trace.memoryWrite) notes.push({ tone: 'write', title: 'Memory write', text: `MEM stored ${format(trace.memoryWrite.value, hex)} at byte address ${trace.memoryWrite.address}. The memory table now contains the new word.` })
  if (trace.registerWrite) notes.push({ tone: 'write', title: 'Register write and retirement', text: `WB wrote ${format(trace.registerWrite.value, hex)} to ${ABI[trace.registerWrite.index]} (x${trace.registerWrite.index}). That instruction has retired.` })
  else if (previous?.stages.WB) notes.push({ tone: 'info', title: 'Instruction retired', text: `I${previous.stages.WB} finished WB without writing a register.` })
  if (!notes.length) notes.push({ tone: 'info', title: 'Normal flow', text: 'No hazard or architectural write occurred in this cycle. Instructions advanced where possible, and fetch brought in a new instruction if one was available.' })
  const title = trace.stall ? 'A dependency holds the pipeline' : taken ? 'A branch redirects execution' : trace.memoryWrite ? 'A store updates memory' : trace.registerWrite ? 'A result reaches the register file' : load ? 'A load reads memory' : STAGES.every(stage => trace.stages[stage] === null) ? 'The pipeline has drained' : 'Instructions move forward'
  const brief = trace.stall ? 'Fetch and decode wait while a bubble enters EX.'
    : taken ? `${trace.flushed.length} wrong-path instruction${trace.flushed.length === 1 ? '' : 's'} flushed after a taken branch.`
      : trace.memoryWrite ? `MEM stores ${format(trace.memoryWrite.value, hex)} at byte address ${trace.memoryWrite.address}.`
        : trace.registerWrite ? `WB writes ${format(trace.registerWrite.value, hex)} to ${ABI[trace.registerWrite.index]}.`
          : load ? 'MEM reads a word that will be written back next cycle.'
            : forwarding.length ? 'A result is forwarded directly to an instruction in EX.'
              : cycle === 1 && trace.stages.IF ? `I${trace.stages.IF} was fetched into IF to begin execution.`
                : STAGES.every(stage => trace.stages[stage] === null) ? 'The final instruction retires and every stage is empty.'
                : 'Instructions advance to the next stage; no hazard blocks the pipeline.'
  return { title, brief, stages, notes }
}
