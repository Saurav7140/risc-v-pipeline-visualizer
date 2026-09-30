import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, createScope, stagger } from 'animejs'
import { ABI, assemble, createMachine, MEMORY_WORDS, STAGES, step, type Machine } from './simulator'
import { examples } from './examples'
import { explainCycle, format } from './explain'
import { instructionGroups } from './instructionReference'

const initialSource = examples.arithmetic.source
const initialMachine = createMachine(assemble(initialSource))
type ExampleKey = keyof typeof examples

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csv(machine: Machine) {
  const names = new Map(machine.fetched.map(token => [token.id, token.inst.text]))
  const header = ['cycle', ...STAGES, 'stall', 'flushed', 'register_write', 'memory_write', 'events']
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return [header.join(','), ...machine.trace.map(t => [
    t.cycle, ...STAGES.map(s => t.stages[s] ? `I${t.stages[s]} ${names.get(t.stages[s]!)}` : ''), t.stall, t.flushed.map(f => `${f.stage}:I${f.id} ${names.get(f.id)}`).join('; '),
    t.registerWrite ? `x${t.registerWrite.index}=${t.registerWrite.value}` : '',
    t.memoryWrite ? `${t.memoryWrite.address}=${t.memoryWrite.value}` : '', t.events.join(' '),
  ].map(quote).join(','))].join('\n')
}

function App() {
  const rootRef = useRef<HTMLDivElement>(null)
  const stepsRef = useRef<HTMLDivElement>(null)
  const dictionaryRef = useRef<HTMLDialogElement>(null)
  const [source, setSource] = useState<string>(initialSource)
  const [loadedSource, setLoadedSource] = useState<string>(initialSource)
  const [selected, setSelected] = useState<ExampleKey | ''>('arithmetic')
  const [machine, setMachine] = useState(initialMachine)
  const machineRef = useRef(machine)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(3)
  const [forwarding, setForwarding] = useState(true)
  const [hex, setHex] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const [editorTop, setEditorTop] = useState(0)
  const [activeTab, setActiveTab] = useState<'registers' | 'memory' | 'events'>('registers')
  const [expandedCycle, setExpandedCycle] = useState<number | null>(null)
  const last = machine.trace.at(-1)

  const install = (next: Machine) => {
    machineRef.current = next
    setMachine(next)
    setRunning(false)
    setError('')
    setExpandedCycle(null)
  }
  const load = (text: string = source) => {
    try { install(createMachine(assemble(text), forwarding)); setLoadedSource(text) }
    catch (e) { setRunning(false); setError((e as Error).message) }
  }
  const advance = useCallback(() => {
    try {
      const next = step(machineRef.current)
      machineRef.current = next
      setMachine(next)
      if (next.done) setRunning(false)
    } catch (e) { setError((e as Error).message); setRunning(false) }
  }, [])
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(advance, 1100 - speed * 180)
    return () => window.clearInterval(timer)
  }, [running, speed, advance])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#11100e' : '#f6f4f0')
    try { localStorage.setItem('pipeline-lab-theme', theme) } catch { /* Storage may be unavailable. */ }
  }, [theme])

  useEffect(() => {
    if (expandedCycle !== null) stepsRef.current?.querySelector(`[data-guide-cycle="${expandedCycle}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [expandedCycle])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !machine.cycle || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const previous = machine.trace.at(-2)
    const latest = machine.trace.at(-1)!
    const duration = Math.min(380, (1100 - speed * 180) * .65)
    const scope = createScope({ root }).add(() => {
      for (const stage of STAGES) {
        const token = machine.slots[stage]
        if (token && previous?.stages[stage] !== token.id) {
          const content = root.querySelector(`[data-stage="${stage}"] .stage-content`)
          if (content) animate(content, { x: [-18, 0], opacity: [0, 1], duration, ease: 'out(3)' })
        }
      }
      const cycleCells = Array.from(root.querySelectorAll('[data-current-cycle="true"]:not(.cell-flush)'))
      if (cycleCells.length) animate(cycleCells, { opacity: [0, 1], scale: [.9, 1], delay: stagger(25), duration, ease: 'out(3)' })
      const flushed = Array.from(root.querySelectorAll('.cell-flush[data-current-cycle="true"]'))
      if (flushed.length) animate(flushed, { opacity: [.3, 1], scale: [1.18, 1], duration, ease: 'out(3)' })
      if (latest.stall) {
        const bubble = root.querySelector('.bubble-stage')
        if (bubble) animate(bubble, { scale: [.92, 1], duration, ease: 'out(3)' })
      }
      const forwarded = root.querySelector('.forward-stage')
      if (forwarded) animate(forwarded, { scale: [1.04, 1], duration, ease: 'out(3)' })
      const changed = root.querySelector('.register.changed, .memory-cell.changed')
      if (changed) {
        const palette = getComputedStyle(root)
        animate(changed, { scale: [1.05, 1], backgroundColor: [palette.getPropertyValue('--flash-start').trim(), palette.getPropertyValue('--flash-end').trim()], duration: Math.min(520, duration * 1.4), ease: 'out(3)' })
      }
      if (latest.stall || latest.flushed.length || latest.events.some(event => event.startsWith('Forwarded'))) {
        const callout = root.querySelector('.cycle-callout')
        if (callout) animate(callout, { y: [7, 0], opacity: [.65, 1], duration, ease: 'out(3)' })
      }
      const newStep = root.querySelector('.step-item[data-latest-cycle="true"]')
      if (newStep) animate(newStep, { y: [8, 0], opacity: [.55, 1], duration, ease: 'out(3)' })
    })
    return () => scope.revert()
  }, [machine, theme])

  const chooseExample = (key: ExampleKey) => {
    setSelected(key)
    setSource(examples[key].source)
    load(examples[key].source)
  }
  const exportTrace = (kind: 'json' | 'csv') => {
    const content = kind === 'json' ? JSON.stringify({ program: machine.program, fetched: machine.fetched.map(({ id, pc, inst }) => ({ id, pc, line: inst.line, text: inst.text })), forwarding: machine.forwarding, cycles: machine.trace }, null, 2) : csv(machine)
    download(`riscv-trace.${kind}`, content, kind === 'json' ? 'application/json' : 'text/csv')
  }
  const currentLine = machine.slots.EX?.inst.line ?? machine.slots.ID?.inst.line ?? machine.slots.IF?.inst.line
  const lineCount = Math.max(10, source.split('\n').length)

  return <div className="app-shell" ref={rootRef}>
    <header className="topbar">
      <div className="brand"><div className="brand-mark" aria-hidden="true"><span /><span /><span /></div><div><strong>PIPELINE<span className="brand-dot">.</span>LAB</strong><small>RISC-V RV32I VISUALIZER</small></div></div>
      <div className="topbar-right"><span className="edition">EDUCATIONAL SUBSET · RV32I</span><button className="theme-toggle" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} aria-pressed={theme === 'dark'}><span className="theme-icon" aria-hidden="true">{theme === 'light' ? '◐' : '☀'}</span><span className="theme-label">{theme === 'light' ? 'Dark mode' : 'Light mode'}</span></button><span className="live-indicator"><i />{running ? 'RUNNING' : machine.done && machine.cycle ? 'COMPLETE' : 'READY'}</span></div>
    </header>

    <main>
      <div className="page-heading"><div><p className="eyebrow">INTERACTIVE CPU WORKBENCH</p><h1>See every cycle. <em>Understand every instruction.</em></h1><p className="intro">Write assembly, step through a five-stage pipeline, and inspect each hazard as it happens.</p></div><div className="architecture-badge"><span className="badge-icon">↗</span><span>5 STAGES<br /><b>IF → ID → EX → MEM → WB</b></span></div></div>

      <section className="metric-grid" aria-label="Execution metrics">
        {[
          ['CYCLES', machine.cycle, 'clock ticks'], ['RETIRED', machine.retired, 'completed'],
          ['STALLS', machine.stalls, 'data hazards'], ['FLUSHES', machine.flushes, 'squashed'],
          ['CPI', machine.retired ? (machine.cycle / machine.retired).toFixed(2) : '—', 'cycles / instruction'],
        ].map(([label, value, hint]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}
      </section>

      <div className="workspace-grid">
        <section className="panel editor-panel" aria-labelledby="editor-title">
          <div className="panel-heading"><div><span className="section-number">01 / SOURCE</span><h2 id="editor-title">Assembly editor</h2></div><span className="panel-meta">{machine.program.length} INSTRUCTIONS</span></div>
          <div className="example-select"><label htmlFor="example">EXAMPLE PROGRAM</label><select id="example" value={selected} onChange={e => chooseExample(e.target.value as ExampleKey)}><option value="" disabled>Custom program</option>{Object.entries(examples).map(([key, example]) => <option key={key} value={key}>{example.name}</option>)}</select></div>
          {selected && <p className="example-description">{examples[selected].description}</p>}
          <div className="code-editor"><div className="line-numbers" aria-hidden="true"><div style={{ transform: `translateY(-${editorTop}px)` }}>{Array.from({ length: lineCount }, (_, i) => <span className={currentLine === i + 1 ? 'line-active' : ''} key={i}>{String(i + 1).padStart(2, '0')}</span>)}</div></div>{currentLine && <div className="current-code-line" style={{ top: 17 + (currentLine - 1) * 25 - editorTop }} aria-hidden="true" />}<textarea spellCheck={false} aria-label="RISC-V assembly source" value={source} onScroll={e => setEditorTop(e.currentTarget.scrollTop)} onChange={e => { setSource(e.target.value); setSelected(''); setError('') }} /></div>
          {error && <div className="error-box" role="alert"><span>!</span>{error}</div>}
          <div className="editor-footer"><span><i className="ready-dot" /> {source === loadedSource ? 'PROGRAM LOADED' : 'EDIT AND ASSEMBLE'}</span><button className="primary-button" onClick={() => load()}>Assemble / Load <span>→</span></button></div>
        </section>

        <section className="panel pipeline-panel" aria-labelledby="pipeline-title">
          <div className="panel-heading"><div><span className="section-number">02 / EXECUTION</span><h2 id="pipeline-title">Pipeline flow</h2></div><span className="panel-meta">CYCLE {String(machine.cycle).padStart(3, '0')}</span></div>
          <div className="pipeline-legend"><span><i className="legend-dot cyan" /> Active</span><span><i className="legend-dot amber" /> Stall / bubble</span><span><i className="legend-dot violet" /> Forwarded</span><span><i className="legend-dot red" /> Flushed</span></div>
          <div className="pipeline-track">{STAGES.map((stage, index) => <div className="stage-wrap" key={stage} data-stage={stage}>
            <div className={`stage-card ${machine.slots[stage] ? 'occupied' : ''} ${stage === 'EX' && last?.stall ? 'bubble-stage' : ''} ${stage === 'MEM' && last?.events.some(event => event.startsWith('Forwarded')) ? 'forward-stage' : ''}`}>
              <div className="stage-top"><span className="stage-index">0{index + 1}</span><span className="stage-label">{stage}</span></div>
              {machine.slots[stage] ? <div className="stage-content" key={`${stage}-${machine.slots[stage].id}`}><span className="instruction-id">I{String(machine.slots[stage].id).padStart(2, '0')} · L{machine.slots[stage].inst.line}</span><strong>{machine.slots[stage].inst.text}</strong></div> : <div className="stage-empty">{stage === 'EX' && last?.stall ? 'BUBBLE' : 'EMPTY'}</div>}
              <div className="stage-bottom">{{ IF: 'FETCH', ID: 'DECODE', EX: 'EXECUTE', MEM: 'MEMORY', WB: 'WRITE BACK' }[stage]}</div>
            </div>{index < 4 && <svg className="stage-arrow" viewBox="0 0 28 16" aria-hidden="true"><path d="M1 8h24m-6-6 6 6-6 6" /></svg>}
          </div>)}</div>
          <div className="cycle-callout"><div className="callout-icon">{last?.stall ? 'Ⅱ' : last?.flushed.length ? '↶' : last?.events.some(e => e.startsWith('Forwarded')) ? '↗' : '›'}</div><div><strong>{last?.stall ? 'Pipeline stalled' : last?.flushed.length ? 'Branch flush' : last?.events.some(e => e.startsWith('Forwarded')) ? 'Forwarding active' : machine.done && machine.cycle ? 'Program complete' : machine.cycle ? 'Cycle complete' : 'Ready to execute'}</strong><p>{last?.events.at(-1) ?? (machine.program.length ? 'Step a cycle or run to see instructions enter the pipeline.' : 'Add instructions in the editor to begin.')}</p></div></div>
          <div className="control-bar"><button className="control-button" onClick={advance} disabled={running || machine.done || !!error} title="Step one cycle"><span>⏭</span> Step</button><button className={`control-button run-button ${running ? 'is-running' : ''}`} onClick={() => setRunning(!running)} disabled={machine.done || !!error}><span>{running ? 'Ⅱ' : '▶'}</span> {running ? 'Pause' : 'Run'}</button><button className="control-button" onClick={() => install(createMachine(machine.program, forwarding))}><span>↺</span> Reset</button><div className="control-divider" /><label className="speed-control">SPEED <input type="range" min="1" max="5" value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="Execution speed" /><b>{speed}×</b></label></div>
          <div className="settings-row"><label className="switch-label"><input type="checkbox" checked={forwarding} onChange={e => setForwarding(e.target.checked)} /><span className="switch-track" /> Forwarding <small>{forwarding !== machine.forwarding ? 'applies on reset' : 'enabled by default'}</small></label><label className="switch-label"><input type="checkbox" checked={hex} onChange={e => setHex(e.target.checked)} /><span className="switch-track" /> Hex display</label></div>
        </section>
      </div>

      <section className="panel timeline-panel" aria-labelledby="timeline-title"><div className="panel-heading"><div><span className="section-number">03 / CYCLE HISTORY</span><h2 id="timeline-title">Instruction timeline</h2></div><div className="download-group"><span className="panel-meta">EXPORT TRACE</span><button onClick={() => exportTrace('json')} disabled={!machine.trace.length}>JSON ↓</button><button onClick={() => exportTrace('csv')} disabled={!machine.trace.length}>CSV ↓</button></div></div>
        <div className="timeline-scroll">{machine.fetched.length ? <div className="timeline-table" style={{ gridTemplateColumns: `210px repeat(${machine.trace.length}, 55px)` }}><div className="timeline-corner">INSTRUCTION / CYCLE</div>{machine.trace.map(t => <button className={`timeline-cycle ${expandedCycle === t.cycle ? 'reviewed-cycle' : ''}`} key={t.cycle} data-current-cycle={t.cycle === machine.cycle ? 'true' : undefined} onClick={() => setExpandedCycle(t.cycle)} aria-label={`Open explanation for cycle ${t.cycle}`} aria-pressed={expandedCycle === t.cycle}>{String(t.cycle).padStart(2, '0')}</button>)}{machine.fetched.map(token => <div className="timeline-row" key={token.id}><div className="timeline-instruction"><span>I{String(token.id).padStart(2, '0')}</span><b title={token.inst.text}>{token.inst.text}</b></div>{machine.trace.map(t => { const flushed = t.flushed.find(f => f.id === token.id); const stage = STAGES.find(s => t.stages[s] === token.id); const label = flushed ? 'FLUSH' : stage; return <div key={t.cycle} data-current-cycle={t.cycle === machine.cycle && !!label ? 'true' : undefined} className={`timeline-cell ${flushed ? 'cell-flush' : t.stall && stage === 'ID' ? 'cell-stall' : stage ? `cell-${stage.toLowerCase()}` : ''}`} title={flushed ? `Flushed in ${flushed.stage}` : t.stall && stage === 'ID' ? 'Stalled in ID' : stage ?? ''}>{label ?? ''}</div> })}</div>)}</div> : <div className="empty-state">The cycle trace will appear here as instructions enter the pipeline.</div>}</div>
        <div className="timeline-footnote"><span>Each row is a fetched instruction instance. Select a cycle number to open its step bubble.</span><span>Scroll horizontally to inspect later cycles →</span></div>
      </section>

      <section className="panel explanation-panel" aria-labelledby="explanation-title">
        <div className="panel-heading explanation-heading"><div><span className="section-number">04 / CYCLE GUIDE</span><h2 id="explanation-title">Step-by-step explanation</h2></div><span className="panel-meta">{machine.cycle ? `${machine.cycle} STEPS · FIRST TO LAST` : 'READY TO BEGIN'}</span></div>
        {machine.cycle ? <div className="step-stack" ref={stepsRef}>{machine.trace.map(trace => {
          const explanation = explainCycle(machine, trace.cycle, hex)
          const expanded = expandedCycle === trace.cycle
          return <article className={`step-item ${expanded ? 'step-open' : ''} step-${explanation.notes[0].tone}`} data-guide-cycle={trace.cycle} data-latest-cycle={trace.cycle === machine.cycle ? 'true' : undefined} key={trace.cycle}>
            <button className="step-bubble" onClick={() => setExpandedCycle(expanded ? null : trace.cycle)} aria-expanded={expanded}>
              <span className="step-bubble-number">{String(trace.cycle).padStart(2, '0')}</span>
              <span className="step-bubble-copy"><span className="step-bubble-label">CYCLE {String(trace.cycle).padStart(3, '0')}{trace.cycle === machine.cycle ? ' · LATEST' : ''}</span><strong>{explanation.title}</strong><span className="step-brief">{explanation.brief}</span></span>
              <span className="step-chevron" aria-hidden="true">⌄</span>
            </button>
            {expanded && <div className="step-detail"><div className="explanation-notes">{explanation.notes.map((note, index) => <div className={`explanation-note tone-${note.tone}`} key={`${note.title}-${index}`}><span className="note-marker" aria-hidden="true" /><div><strong>{note.title}</strong><p>{note.text}</p></div></div>)}</div><div className="stage-guide-heading">AT THE END OF THIS CYCLE <span>IF → ID → EX → MEM → WB</span></div><div className="stage-guide-grid">{explanation.stages.map(item => <div className={`stage-guide-card guide-${item.state}`} key={item.stage}><div className="guide-card-top"><b>{item.stage}</b><span>{item.id ? `I${String(item.id).padStart(2, '0')}` : item.state === 'bubble' ? 'BUBBLE' : 'EMPTY'}</span></div>{item.instruction && <code title={item.instruction}>{item.instruction}</code>}<p>{item.text}</p></div>)}</div></div>}
          </article>
        })}</div> : <div className="explanation-empty"><span aria-hidden="true">▤</span><div><strong>Ready for the first cycle</strong><p>Step once to fetch an instruction. Each cycle will appear here as a short bubble you can open for details.</p></div></div>}
      </section>

      <section className="panel state-panel" aria-label="Machine state"><div className="state-heading"><div><span className="section-number">05 / MACHINE STATE</span><h2>Inspect the machine</h2></div><div className="tab-list" role="tablist" aria-label="Machine state views">{(['registers', 'memory', 'events'] as const).map(tab => <button role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} key={tab} onClick={() => setActiveTab(tab)}>{tab === 'registers' ? 'Registers' : tab === 'memory' ? 'Memory' : 'Event log'}</button>)}</div></div>
        {activeTab === 'registers' && <div className="register-grid">{machine.registers.map((value, index) => <div className={`register ${last?.registerWrite?.index === index ? 'changed' : ''}`} key={index}><div><b>x{String(index).padStart(2, '0')}</b><span>{ABI[index]}</span></div><strong>{format(value, hex)}</strong></div>)}</div>}
        {activeTab === 'memory' && <div className="memory-view"><p>64 words · 256 bytes · aligned addresses 0–252</p><div className="memory-grid">{Array.from({ length: MEMORY_WORDS }, (_, index) => <div className={`memory-cell ${last?.memoryWrite?.address === index * 4 ? 'changed' : ''}`} key={index}><span>0x{(index * 4).toString(16).padStart(3, '0')}</span><strong>{format(machine.memory[index], hex)}</strong></div>)}</div></div>}
        {activeTab === 'events' && <div className="events-list">{machine.trace.some(t => t.events.length) ? [...machine.trace].reverse().filter(t => t.events.length).map(t => <div className="event-cycle" key={t.cycle}><span>CYCLE {String(t.cycle).padStart(3, '0')}</span><div>{t.events.map((event, index) => <p key={index} className={event.includes('stall') ? 'event-stall' : event.includes('Flushed') ? 'event-flush' : event.startsWith('Forwarded') ? 'event-forward' : ''}>{event}</p>)}</div></div>) : <div className="empty-state">Stalls, forwarding, branches, flushes, and writes will be explained here.</div>}</div>}
      </section>

      <footer><span>PIPELINE.LAB</span><span className="footer-credit">Website built and designed by <a href="https://github.com/Saurav7140" target="_blank" rel="noopener noreferrer" aria-label="Saurav Jyothish on GitHub (opens in a new tab)">Saurav Jyothish <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.08c-3.12.68-3.78-1.32-3.78-1.32-.5-1.28-1.23-1.62-1.23-1.62-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .1.8 2.07 3.24 1.47.1-.73.4-1.23.72-1.51-2.49-.28-5.1-1.25-5.1-5.54 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .94-.3 3.08 1.15A10.7 10.7 0 0 1 12 6.16c.95 0 1.9.13 2.8.38 2.14-1.45 3.08-1.15 3.08-1.15.61 1.55.23 2.69.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.3-2.62 5.25-5.12 5.53.41.36.77 1.06.77 2.14v3.03c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z" /></svg></a></span></footer>
    </main>
    <button className="dictionary-launch" type="button" onClick={() => dictionaryRef.current?.showModal()} aria-label="Open instruction dictionary" title="Open instruction dictionary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5C9.4 3.7 6.5 3.5 3 4v14c3.5-.5 6.4-.3 9 1 2.6-1.3 5.5-1.5 9-1V4c-3.5-.5-6.4-.3-9 1Z" /><path d="M12 5v14" /></svg><span>Instruction book</span></button>
    <dialog className="dictionary-dialog" ref={dictionaryRef} aria-labelledby="dictionary-title" onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
      <div className="dictionary-shell"><div className="dictionary-heading"><div><span className="section-number">RV32I / QUICK REFERENCE</span><h2 id="dictionary-title">Instruction dictionary</h2><p>What each supported instruction does and when to use it.</p></div><button className="dictionary-close" type="button" onClick={() => dictionaryRef.current?.close()} aria-label="Close instruction dictionary">×</button></div>
        <div className="dictionary-content">{instructionGroups.map(group => <section className="dictionary-group" key={group.title}><h3>{group.title}</h3>{group.entries.map(entry => <article className="dictionary-entry" key={entry.op}><div className="dictionary-entry-heading"><strong>{entry.op}</strong><code>{entry.syntax}</code></div><p>{entry.meaning}</p><p><b>Use it for</b> {entry.useCase}</p><code className="dictionary-example">{entry.example}</code></article>)}</section>)}</div>
        <div className="dictionary-footnote">Registers x0–x31 and ABI names work here. Word memory accesses require aligned addresses from 0 to 252.</div>
      </div>
    </dialog>
  </div>
}

export default App
