# RISC-V Pipeline Lab

A browser-only, cycle-by-cycle visualizer for a small RV32I assembly subset. Built with React, TypeScript, and Vite. No server or account is needed after loading the app.

## Run

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Run `npm test` for simulator checks and `npm run build` for a production bundle.

## Use

Choose one of the four examples or edit the source and click **Assemble / Load**. **Step** advances exactly one cycle. **Run / Pause** advances on a timer; the speed slider affects only the timer. **Reset** restarts the loaded program and applies the current forwarding setting. The decimal/hex switch changes display formatting only. The cycle history can be downloaded as JSON (including register and memory snapshots) or CSV.

The interface starts in a white, black, and orange theme. Use the header toggle for dark mode; the choice is saved in the browser.

Anime.js animates stage arrivals, hazard indicators, new timeline cells, and changed register or memory values after each simulator step. Animation never advances the simulator and is skipped when the operating system requests reduced motion.

The **Cycle guide** below the timeline stacks a short bubble for every cycle, first to last. Click a bubble or a cycle number in the timeline to open its detailed event notes and stage descriptions. The stage cards show end-of-cycle occupancy, while the notes describe work completed during that cycle.

Use the floating **Instruction book** button in the bottom-right corner for a compact reference to every supported instruction, including syntax, examples, and common use cases. Close it with the button, Escape, or a click outside the page.

## Assembly subset

`ADD`, `SUB`, `ADDI`, `AND`, `OR`, `XOR`, `LW`, `SW`, `BEQ`, `BNE`, and `NOP`. Registers `x0`–`x31` and ABI names (`zero`, `ra`, `sp`, `t0`, `a0`, etc.; also `fp`) work interchangeably. `x0` always reads as zero and ignores writes. Immediates accept signed decimal or signed hexadecimal (`-0x10`). `ADDI`, `LW`, and `SW` use signed 12-bit immediates. Memory operands use `offset(base)`, such as `LW t0, 4(sp)`. Branches accept a label or a byte offset divisible by four. Labels can share a line with an instruction. Blank lines and `#` comments are ignored. Errors identify source lines.

## Pipeline timing

The model is single issue and in order: IF → ID → EX → MEM → WB. Each **Step** moves the pipeline through one clock cycle. Register writes retire in WB, and a value written in WB is readable by ID in the same cycle. ALU work and branch decisions happen in EX. Loads and stores access memory in MEM. With forwarding enabled, EX operands may come from MEM or WB; an instruction directly after a load that reads its destination waits one cycle in ID while a bubble enters EX. Store data uses the same forwarding path. With forwarding disabled, a dependent instruction waits in ID until its producer reaches WB. Branches use static predict-not-taken; a taken branch in EX flushes younger instructions in IF and ID. The pipeline drains after the last fetch. Dynamic instruction IDs distinguish repeated loop iterations.

Memory is 64 little-endian conceptual **words** at byte addresses 0–252. Only aligned 32-bit word loads/stores are modeled; misaligned and out-of-range accesses stop execution with an error. Arithmetic wraps to signed 32-bit values. Each cycle stores stage occupancy, events, writes, and full register/memory snapshots. A 500-cycle limit stops nonterminating programs.

This is an educational timing model, not a complete RV32I processor: there are no bytes, halfwords, calls, exceptions, cache misses, variable memory latency, or hardware branch prediction. The examples cover dependent arithmetic, load-use, a conditional loop, and a store/load round trip.
