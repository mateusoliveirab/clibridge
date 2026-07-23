import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronRight, Clock3, FileCode2, GripVertical, Play, Plus, Save, ShieldAlert, SquareTerminal, Trash2, X } from 'lucide-react'
import { decode as decodeToon, encode as encodeToon } from '@toon-format/toon'
import './style.css'
import './studio.css'
import './console.css'

type Run = { id: string; workflow: string; task?: string; status: string; created_at: number; updated_at: number; pending_approvals?: number; providers?: string | null }
type Approval = { id: string; run_id: string; phase: string; action: string; reason: string; scope?: string; provider?: string; impact: string }
type Notice = { message: string; tone: 'success' | 'error' | 'neutral' }
const API = '/api'

const activeStatuses = new Set(['queued', 'running', 'awaiting_approval'])
const statusLabel = (status: string) => status.replaceAll('_', ' ')

function ProviderMark({ provider }: { provider?: string }) {
  const name = provider || 'local'
  const glyphs: Record<string, string> = { claude: 'C', codex: 'O', gemini: 'G', opencode: 'OC', agy: 'A', ollama: 'OL', local: '↳', routed: '↗' }
  return <span className={`provider-mark ${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`} title={`Provider: ${name}`} aria-label={`Provider: ${name}`}>{glyphs[name.toLowerCase()] || name.slice(0, 2).toUpperCase()}</span>
}

function App() {
  const [runs, setRuns] = useState<Run[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [workflows, setWorkflows] = useState<{ path: string }[]>([])
  const [task, setTask] = useState('')
  const [workflowPath, setWorkflowPath] = useState('')
  const [filter, setFilter] = useState('')
  const [view, setView] = useState<'console' | 'studio' | 'run'>('console')
  const [source, setSource] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [launchNotice, setLaunchNotice] = useState<Notice | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [workflowData, setWorkflowData] = useState<any>(null)
  const [selectedPhase, setSelectedPhase] = useState<number | null>(null)

  const refresh = async () => {
    try {
      const [nextRuns, nextApprovals, nextWorkflows] = await Promise.all([get<Run[]>('/runs'), get<Approval[]>('/approvals'), get<{ path: string }[]>('/workflows')])
      setRuns(nextRuns); setApprovals(nextApprovals); setWorkflows(nextWorkflows)
      if (nextWorkflows[0]) setWorkflowPath(current => current || nextWorkflows[0]!.path)
    } catch (error) {
      setLaunchNotice({ message: error instanceof Error ? error.message : 'The local daemon could not be reached.', tone: 'error' })
    }
  }
  useEffect(() => { void refresh(); const stream = new EventSource(`${API}/events`); stream.onmessage = () => void refresh(); stream.addEventListener('run.finished', () => void refresh()); return () => stream.close() }, [])
  useEffect(() => { if (selected) void get(`/runs/${encodeURIComponent(selected)}`).then(setDetail) }, [selected, runs])
  useEffect(() => { if (workflowPath && view === 'studio') void get<{ content: string }>(`/workflows/${encodeURIComponent(workflowPath)}`).then(file => { setSource(file.content); setIsDirty(false); try { setWorkflowData(parseWorkflow(file.content, workflowPath)); setSelectedPhase(null); setNotice(null) } catch { setWorkflowData(null); setNotice({ message: 'This source cannot be shown as a flow.', tone: 'error' }) } }).catch(error => setNotice({ message: error instanceof Error ? error.message : 'Workflow could not be opened.', tone: 'error' })) }, [workflowPath, view])
  const visible = useMemo(() => runs.filter(run => !filter || run.status === filter), [runs, filter])
  const selectedBlock = selectedPhase === null ? null : workflowData?.phases?.[selectedPhase]
  const start = async (event: React.FormEvent) => { event.preventDefault(); if (!workflowPath || !task.trim()) { setLaunchNotice({ message: 'Choose a workflow and describe the outcome.', tone: 'error' }); return }; setIsStarting(true); setLaunchNotice(null); try { const created = await post('/runs', { workflowPath, task, dryRun }); setSelected(created.runId); setTask(''); setLaunchNotice({ message: dryRun ? 'Dry run added to the log.' : 'Run started.', tone: 'success' }); await refresh() } catch (error) { setLaunchNotice({ message: error instanceof Error ? error.message : 'Could not start the run.', tone: 'error' }) } finally { setIsStarting(false) } }
  const resolve = async (approval: Approval, decision: 'approve' | 'reject') => { try { await post(`/runs/${approval.run_id}/approvals/${approval.id}`, { decision }); await refresh() } catch (error) { setLaunchNotice({ message: error instanceof Error ? error.message : 'The decision could not be recorded.', tone: 'error' }) } }
  const save = async () => { setIsSaving(true); setNotice(null); try { await put(`/workflows/${encodeURIComponent(workflowPath)}`, { content: source }); setIsDirty(false); setNotice({ message: 'Saved locally', tone: 'success' }) } catch (error) { setNotice({ message: error instanceof Error ? error.message : 'Source was not saved.', tone: 'error' }) } finally { setIsSaving(false) } }
  const syncCanvas = () => { try { setWorkflowData(parseWorkflow(source, workflowPath)); setSelectedPhase(null); setIsDirty(true); setNotice({ message: 'Canvas updated from source.', tone: 'neutral' }); } catch (error) { setNotice({ message: error instanceof Error ? error.message : 'Invalid workflow source.', tone: 'error' }) } }
  const updateWorkflow = (next: any) => { setWorkflowData(next); setSource(serializeWorkflow(next, workflowPath)); setIsDirty(true); setNotice(null); }
  const updatePhase = (key: string, value: unknown) => { if (selectedPhase === null || !workflowData) return; const phases = workflowData.phases.map((phase: any, index: number) => index === selectedPhase ? { ...phase, [key]: value || undefined } : phase); updateWorkflow({ ...workflowData, phases }) }
  const addPhase = (afterIndex = (workflowData?.phases?.length || 0) - 1) => { const phases = [...(workflowData?.phases || [])]; const index = afterIndex + 1; phases.splice(index, 0, { name: `step-${phases.length + 1}`, kind: 'agent', prompt: '{{task}}' }); updateWorkflow({ ...(workflowData || { name: 'new-workflow' }), phases }); setSelectedPhase(index) }
  const removePhase = () => { if (selectedPhase === null || !workflowData) return; const phases = workflowData.phases.filter((_phase: any, index: number) => index !== selectedPhase); updateWorkflow({ ...workflowData, phases }); setSelectedPhase(null) }
  const movePhase = (direction: -1 | 1) => { if (selectedPhase === null || !workflowData) return; const target = selectedPhase + direction; if (target < 0 || target >= workflowData.phases.length) return; const phases = [...workflowData.phases]; [phases[selectedPhase], phases[target]] = [phases[target], phases[selectedPhase]]; updateWorkflow({ ...workflowData, phases }); setSelectedPhase(target) }
  const updateCommands = (value: string) => { if (Array.isArray(selectedBlock?.commands)) updatePhase('commands', value.split('\n').filter(Boolean)); else updatePhase('command', value) }
  const updateFiles = (value: string) => updatePhase('files', value.split('\n').map(item => item.trim()).filter(Boolean))
  const chooseWorkflow = (nextPath: string) => { if (isDirty && !window.confirm('Discard unsaved changes and open another workflow?')) return; setWorkflowPath(nextPath) }
  const switchView = (nextView: 'console' | 'studio') => { if (view === 'studio' && isDirty && !window.confirm('Leave the Studio and discard unsaved changes?')) return; setView(nextView) }
  const inspectRun = (runId: string) => { setSelected(runId); setView('run') }
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (isDirty) event.preventDefault() }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [isDirty])
  return <main>
    <aside className="sidebar"><div className="brand"><SquareTerminal size={18}/><span>clibridge</span><i>local</i></div><nav aria-label="Primary navigation"><button aria-current={view === 'console' || view === 'run' ? 'page' : undefined} className={view === 'console' || view === 'run' ? 'active' : ''} onClick={() => switchView('console')}><Activity/>Control room</button><button aria-current={view === 'studio' ? 'page' : undefined} className={view === 'studio' ? 'active' : ''} onClick={() => switchView('studio')}><FileCode2/>Workflow studio</button></nav><div className="side-note"><span className="pulse"/>daemon listening<br/><code>127.0.0.1</code></div></aside>
    <div className="workspace"><header><div><p className="eyebrow">{view === 'studio' ? 'SOURCE OF TRUTH' : view === 'run' ? 'EXECUTION TRACE' : 'RUN OBSERVABILITY'}</p><h1>{view === 'studio' ? 'Workflow studio' : view === 'run' ? 'Run details' : 'Control room'}</h1></div><div className="context"><span>{runs.filter(r => activeStatuses.has(r.status)).length} active</span><span>{approvals.length} need review</span></div></header>
    {view === 'console' ? <>
      <section className="launch"><form onSubmit={start}><div className="launch-label"><Play size={16}/><span>New run</span></div><label className="sr-only" htmlFor="run-workflow">Workflow</label><select id="run-workflow" value={workflowPath} onChange={e => setWorkflowPath(e.target.value)}><option value="">Choose a workflow</option>{workflows.map(workflow => <option key={workflow.path} value={workflow.path}>{workflow.path}</option>)}</select><label className="sr-only" htmlFor="run-outcome">Intended outcome</label><input id="run-outcome" value={task} onChange={e => setTask(e.target.value)} placeholder="Describe the intended outcome"/><label className="dry-run"><input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)}/> dry run</label><button disabled={isStarting}><span>{isStarting ? 'Starting…' : 'Run'}</span><ArrowUpRight size={15}/></button></form>{launchNotice && <p className={`form-note ${launchNotice.tone}`} role="status">{launchNotice.message}</p>}</section>
      {approvals.length > 0 && <section className="approvals"><div className="section-title"><ShieldAlert/> Decision required <em>nothing executes until you decide</em></div>{approvals.map(item => <div className="approval" key={item.id}><div className="approval-code">{item.impact}</div><div><b>{item.action.replaceAll('_', ' ')}</b><p>{item.reason}</p><small>{item.phase} / {item.provider || 'local provider'}</small></div><div className="buttons"><button className="ghost" onClick={() => void resolve(item, 'reject')}><X size={15}/> Reject</button><button onClick={() => void resolve(item, 'approve')}><Check size={15}/> Allow once</button></div></div>)}</section>}
      <section className="runs-overview"><div className="panel-head"><div className="section-title"><Clock3/> Run log <span>{visible.length}</span></div><label className="sr-only" htmlFor="run-filter">Filter runs</label><select id="run-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="">Everything</option>{['queued','running','awaiting_approval','completed','failed','cancelled'].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></div><div className="run-list">{visible.map(run => <button className="run" onClick={() => inspectRun(run.id)} key={run.id}><span className={`dot ${run.status}`}/><span><b>{run.workflow}</b><small>{run.task || 'No task description'}</small></span><span className="run-providers">{(run.providers || 'local').split(',').map(provider => <ProviderMark provider={provider} key={provider}/>)}</span><span className={`state ${run.status}`}>{statusLabel(run.status)}</span><time dateTime={new Date(run.updated_at).toISOString()}>{new Date(run.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><ChevronRight size={15}/></button>)}{!visible.length && <div className="empty-state"><Clock3/><b>{filter ? 'No matching runs' : 'No runs yet'}</b><p>{filter ? 'Try another status.' : 'Start a workflow above. Its progress will appear here.'}</p></div>}</div></section>
    </> : view === 'run' ? <section className="run-detail-page">
      <button className="back-button" onClick={() => setView('console')}><ChevronRight/>Back to Control room</button>
      {detail ? <>
        <div className="run-summary"><div><div className="run-title"><span className={`dot ${detail.status}`}/><h2>{detail.workflow}</h2></div><p>{detail.task || 'No task description'}</p></div><span className={`state ${detail.status}`}>{statusLabel(detail.status)}</span></div>
        <div className="run-facts"><div><span>Started</span><b>{new Date(detail.created_at).toLocaleString()}</b></div><div><span>Last update</span><b>{new Date(detail.updated_at).toLocaleString()}</b></div><div><span>Steps</span><b>{detail.phases?.length || 0}</b></div><div><span>Run ID</span><code>{detail.id}</code></div></div>
        <div className="trace-head"><div><span>Execution trace</span><p>Output is redacted before it reaches this console.</p></div>{activeStatuses.has(detail.status) && <button className="danger" onClick={() => void post(`/runs/${detail.id}/cancel`, {}).then(refresh)}>Cancel run</button>}</div>
        <div className="timeline run-timeline">{detail.phases?.map((phase: any, index: number) => <article key={phase.id}><div className={`phase-index ${phase.status}`}>{String(index + 1).padStart(2, '0')}</div><div><div className="phase-heading"><b>{phase.name}</b><span>{statusLabel(phase.status)}</span></div><small><ProviderMark provider={phase.provider}/>{phase.provider || 'local'} · {phase.duration_ms || 0}ms</small>{phase.output && <pre>{phase.output}</pre>}{phase.error && <pre className="error-output">{phase.error}</pre>}</div></article>)}</div>
        {detail.error && <div className="run-error"><ShieldAlert/><div><b>Run failed</b><p>{detail.error}</p></div></div>}
      </> : <div className="empty-state detail-empty"><Activity/><b>Loading run</b><p>The execution trace will appear here.</p></div>}
    </section> : <section className="studio">
      <div className="studio-bar">
        <label className="sr-only" htmlFor="studio-workflow">Workflow file</label>
        <select id="studio-workflow" value={workflowPath} onChange={e => chooseWorkflow(e.target.value)}>{workflows.map(workflow => <option key={workflow.path} value={workflow.path}>{workflow.path}</option>)}</select>
        <div className={`save-state ${notice?.tone || (isDirty ? 'dirty' : 'neutral')}`} role="status"><span/>{notice?.message || (isDirty ? 'Unsaved changes' : 'All changes saved')}</div>
        <button disabled={!isDirty || isSaving} onClick={() => void save()}><Save size={15}/>{isSaving ? 'Saving…' : 'Save'}</button>
      </div>
      <div className="flow-toolbar"><div><b>{workflowData?.name || 'Workflow'}</b><small>{workflowData?.description || 'Runs each step from top to bottom.'}</small></div><button className="outline" onClick={() => addPhase()}><Plus size={15}/> Add step</button></div>
      <div className="flow-editor">
        <section className="sequence" aria-label="Workflow sequence">
          <div className="sequence-head"><span>Execution order</span><em>{workflowData?.phases?.length || 0} steps</em></div>
          <div className="phase-list">{workflowData?.phases?.map((phase: any, index: number) => <React.Fragment key={`${phase.name}-${index}`}>
            <button className={`phase-card ${phase.kind} ${selectedPhase === index ? 'selected' : ''}`} aria-pressed={selectedPhase === index} onClick={() => setSelectedPhase(index)}>
              <span className="phase-order">{String(index + 1).padStart(2, '0')}</span>
              <span className="phase-copy"><small>{phase.kind}</small><b>{phase.name || 'Untitled step'}</b><em>{phase.kind === 'agent' ? (phase.provider || phase.role || 'routed provider') : phase.kind === 'shell' ? 'local command' : phase.kind === 'read-files' ? `${phase.files?.length || 0} files` : `${phase.assertions?.length || 0} rules`}</em></span>
              <ChevronRight size={16}/>
            </button>
            <button className="insert-step" title={`Add a step after ${phase.name}`} aria-label={`Add a step after ${phase.name}`} onClick={() => addPhase(index)}><Plus size={13}/></button>
          </React.Fragment>)}{workflowData && !workflowData.phases?.length && <button className="empty-sequence" onClick={() => addPhase()}><Plus/>Add the first step</button>}</div>
        </section>
        <aside className="inspector">
          {selectedBlock ? <>
            <div className="inspector-heading"><div><span>Step {String(selectedPhase! + 1).padStart(2, '0')}</span><h2>{selectedBlock.name || 'Untitled step'}</h2></div><div className="order-actions"><button title="Move up" aria-label="Move step up" disabled={selectedPhase === 0} onClick={() => movePhase(-1)}><ArrowUp/></button><button title="Move down" aria-label="Move step down" disabled={selectedPhase === workflowData.phases.length - 1} onClick={() => movePhase(1)}><ArrowDown/></button></div></div>
            <div className="field-row"><label>Name<input value={selectedBlock.name || ''} onChange={e => updatePhase('name', e.target.value)}/></label><label>Type<select value={selectedBlock.kind || 'agent'} onChange={e => updatePhase('kind', e.target.value)}>{['agent','shell','read-files','policy'].map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label></div>
            {selectedBlock.kind === 'agent' && <><p className="field-help">Route a prompt to an available coding provider.</p><div className="field-row"><label>Provider<input value={selectedBlock.provider || ''} placeholder="Auto-route" onChange={e => updatePhase('provider', e.target.value)}/></label><label>Role<input value={selectedBlock.role || ''} placeholder="Optional role" onChange={e => updatePhase('role', e.target.value)}/></label></div><label>Prompt<textarea className="primary-editor" value={selectedBlock.prompt || ''} placeholder="Use {{task}}, {{inputs.key}} or {{results.step-name}}" onChange={e => updatePhase('prompt', e.target.value)}/><small>Template values are resolved when the workflow runs.</small></label></>}
            {selectedBlock.kind === 'shell' && <><p className="field-help">Run one command, or one command per line for command lists.</p><label>{Array.isArray(selectedBlock.commands) ? 'Commands' : 'Command'}<textarea className="primary-editor code" value={Array.isArray(selectedBlock.commands) ? selectedBlock.commands.join('\n') : (selectedBlock.command || '')} placeholder="npm test" onChange={e => updateCommands(e.target.value)}/></label></>}
            {selectedBlock.kind === 'read-files' && <><p className="field-help">Read project files and expose their contents to later steps.</p><label>Files<textarea className="primary-editor code" value={(selectedBlock.files || []).join('\n')} placeholder={'README.md\nsrc/**/*.ts'} onChange={e => updateFiles(e.target.value)}/><small>One path or glob per line.</small></label><label className="compact-field">Maximum bytes<input type="number" min="1" value={selectedBlock.maxBytes || ''} placeholder="Default" onChange={e => updatePhase('maxBytes', Number(e.target.value) || undefined)}/></label></>}
            {selectedBlock.kind === 'policy' && <div className="policy-note"><ShieldAlert/><div><b>{selectedBlock.assertions?.length || 0} policy rules</b><p>Policy assertions have a structured shape. Edit them in Advanced source to preserve every condition.</p></div></div>}
            <div className="inspector-actions"><button className="danger" onClick={removePhase}><Trash2 size={14}/> Remove step</button></div>
          </> : <>
            <div className="inspector-heading"><div><span>Workflow</span><h2>Overview</h2></div></div>
            <p className="field-help">Name the workflow by its outcome. Select a step on the left to configure how it runs.</p>
            <label>Name<input value={workflowData?.name || ''} onChange={e => updateWorkflow({ ...workflowData, name: e.target.value })}/></label>
            <label>Description<textarea value={workflowData?.description || ''} placeholder="What does this workflow accomplish?" onChange={e => updateWorkflow({ ...workflowData, description: e.target.value || undefined })}/></label>
            <button className="select-first" disabled={!workflowData?.phases?.length} onClick={() => setSelectedPhase(0)}>Edit first step <ChevronRight/></button>
          </>}
        </aside>
      </div>
      <details><summary>Advanced source <span>{workflowPath.endsWith('.toon') ? 'TOON' : 'JSON'}</span></summary><textarea aria-label="Workflow source" spellCheck="false" value={source} onChange={e => { setSource(e.target.value); setIsDirty(true); setNotice({ message: 'Source changed · update the sequence to preview', tone: 'neutral' }) }}/><button className="source-sync" onClick={syncCanvas}>Update sequence from source</button></details>
      <footer>Changes stay local to this file. The workflow is validated before it is saved.</footer>
    </section>}
    </div>
  </main>
}
async function get<T>(path: string): Promise<T> { const response = await fetch(API + path); if (!response.ok) throw new Error(await response.text()); return response.json() }
async function post(path: string, body: unknown): Promise<any> { const response = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(await response.text()); return response.json() }
async function put(path: string, body: unknown): Promise<any> { const response = await fetch(API + path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(await response.text()); return response.json() }
function parseWorkflow(source: string, workflowPath: string): any { return workflowPath.endsWith('.toon') ? decodeToon(source) : JSON.parse(source) }
function serializeWorkflow(workflow: any, workflowPath: string): string { return workflowPath.endsWith('.toon') ? encodeToon(workflow) : JSON.stringify(workflow, null, 2) }
createRoot(document.getElementById('root')!).render(<App/>)
