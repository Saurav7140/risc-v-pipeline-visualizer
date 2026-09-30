import type { Op } from './simulator'

type Entry = { op: Op; syntax: string; meaning: string; useCase: string; example: string }

export const instructionGroups: { title: string; entries: Entry[] }[] = [
  {
    title: 'Arithmetic & logic',
    entries: [
      { op: 'ADD', syntax: 'ADD rd, rs1, rs2', meaning: 'Add two register values and keep the 32-bit result.', useCase: 'Build a running total from values already in registers.', example: 'ADD a0, t0, t1' },
      { op: 'SUB', syntax: 'SUB rd, rs1, rs2', meaning: 'Subtract rs2 from rs1.', useCase: 'Find a difference or the amount remaining.', example: 'SUB a0, t0, t1' },
      { op: 'ADDI', syntax: 'ADDI rd, rs1, imm', meaning: 'Add a signed 12-bit constant to a register.', useCase: 'Initialize a value, increment a counter, or move a pointer.', example: 'ADDI t0, zero, 5' },
      { op: 'AND', syntax: 'AND rd, rs1, rs2', meaning: 'Keep only the bits that are set in both registers.', useCase: 'Mask out unwanted bits or test selected flags.', example: 'AND a0, t0, t1' },
      { op: 'OR', syntax: 'OR rd, rs1, rs2', meaning: 'Set each result bit that is set in either register.', useCase: 'Combine bit flags from two values.', example: 'OR a0, t0, t1' },
      { op: 'XOR', syntax: 'XOR rd, rs1, rs2', meaning: 'Set result bits where the two registers differ.', useCase: 'Toggle selected bits with a mask.', example: 'XOR a0, t0, t1' },
    ],
  },
  {
    title: 'Memory',
    entries: [
      { op: 'LW', syntax: 'LW rd, offset(rs1)', meaning: 'Load one 32-bit word from the byte address rs1 + offset.', useCase: 'Read a saved value from memory into a register.', example: 'LW a0, 4(sp)' },
      { op: 'SW', syntax: 'SW rs2, offset(rs1)', meaning: 'Store the 32-bit value in rs2 at the byte address rs1 + offset.', useCase: 'Save a computed value for a later load.', example: 'SW t0, 4(sp)' },
    ],
  },
  {
    title: 'Control flow',
    entries: [
      { op: 'BEQ', syntax: 'BEQ rs1, rs2, label', meaning: 'Jump to a label when the two register values are equal.', useCase: 'Exit a loop or enter a conditional path when values match.', example: 'BEQ t0, t1, done' },
      { op: 'BNE', syntax: 'BNE rs1, rs2, label', meaning: 'Jump to a label when the two register values differ.', useCase: 'Keep looping until a counter reaches its target.', example: 'BNE t0, t1, loop' },
      { op: 'NOP', syntax: 'NOP', meaning: 'Do no work while still passing through the pipeline.', useCase: 'Observe pipeline timing without changing registers or memory.', example: 'NOP' },
    ],
  },
]
