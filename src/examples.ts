export const examples = {
  arithmetic: {
    name: 'Arithmetic & forwarding',
    description: 'A chain of dependent ALU operations',
    source: `# Dependent ALU instructions\nADDI t0, zero, 7\nADDI t1, zero, 5\nADD t2, t0, t1\nSUB s0, t2, t0\nAND s1, t2, t1\nOR s2, s0, s1\nXOR a0, s2, t0`,
  },
  load: {
    name: 'Load-use hazard',
    description: 'A load followed by an immediate consumer',
    source: `# One-cycle load-use bubble with forwarding\nADDI sp, zero, 32\nADDI t0, zero, 21\nSW t0, 0(sp)\nLW t1, 0(sp)\nADD t2, t1, t0\nADDI a0, t2, 1`,
  },
  loop: {
    name: 'Conditional loop',
    description: 'A taken branch flushes younger instructions',
    source: `# Sum 1 + 2 + 3 + 4\nADDI t0, zero, 1\nADDI t1, zero, 5\nADDI a0, zero, 0\nloop: ADD a0, a0, t0\nADDI t0, t0, 1\nBNE t0, t1, loop\nNOP`,
  },
  store: {
    name: 'Store → load',
    description: 'Forward store data, then read the word back',
    source: `# Memory round trip\nADDI sp, zero, 64\nADDI t0, zero, -0x10\nSW t0, 4(sp)\nLW a0, 4(sp)\nADDI a1, a0, 3`,
  },
} as const
