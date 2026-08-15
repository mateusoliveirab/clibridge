import fs from 'node:fs'
import path from 'node:path'

const defaultBridgeRunsDir = path.join(process.cwd(), '.bridge-runs')

export interface RunStateOptions {
  runsDir?: string
}

export interface RunEvent {
  ts: number
  type: 'run-start' | 'phase-start' | 'phase-end' | 'run-end'
  runId: string
  workflow?: string
  description?: string
  totalPhases?: number
  phases?: string[]
  phaseIndex?: number
  phase?: string
  provider?: string
  ok?: boolean
  durationMs?: number
  error?: string
}

export interface PhaseState {
  name: string
  index: number
  provider?: string
  status: 'pending' | 'running' | 'done' | 'failed'
  durationMs?: number
}

export interface RunState {
  runId: string
  workflow: string
  description?: string
  phases: PhaseState[]
  status: 'running' | 'done' | 'failed'
  startedAt: number
  updatedAt: number
  elapsedMs: number
}

function resolveRunsDir(options: RunStateOptions = {}): string {
  return options.runsDir ? path.resolve(options.runsDir) : defaultBridgeRunsDir
}

function getRunFilePath(runId: string, options: RunStateOptions = {}): string {
  return path.join(resolveRunsDir(options), `${runId}.jsonl`)
}

function appendEvent(runId: string, event: RunEvent, options: RunStateOptions = {}): void {
  const runsDir = resolveRunsDir(options)
  try {
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true })
    }
    const filePath = getRunFilePath(runId, options)
    fs.appendFileSync(filePath, JSON.stringify(event) + '\n')
  } catch (err) {
    // Degrade silently
  }
}

export function newRunId(workflow: string): string {
  const ts = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${workflow}-${ts}-${random}`
}

export function startRun(opts: { runId: string; workflow: string; description?: string; phases: string[] } & RunStateOptions): void {
  appendEvent(opts.runId, {
    ts: Date.now(),
    type: 'run-start',
    runId: opts.runId,
    workflow: opts.workflow,
    description: opts.description,
    totalPhases: opts.phases.length,
    phases: opts.phases
  }, opts)
}

export function phaseStart(runId: string, phase: string, phaseIndex: number, provider: string, options: RunStateOptions = {}): void {
  appendEvent(runId, {
    ts: Date.now(),
    type: 'phase-start',
    runId,
    phase,
    phaseIndex,
    provider
  }, options)
}

export function phaseEnd(runId: string, phase: string, ok: boolean, durationMs: number, options: RunStateOptions = {}): void {
  appendEvent(runId, {
    ts: Date.now(),
    type: 'phase-end',
    runId,
    phase,
    ok,
    durationMs
  }, options)
}

export function endRun(runId: string, ok: boolean, options: RunStateOptions = {}): void {
  appendEvent(runId, {
    ts: Date.now(),
    type: 'run-end',
    runId,
    ok
  }, options)
}

export function readRun(runId: string, options: RunStateOptions = {}): RunState | null {
  const filePath = getRunFilePath(runId, options)
  if (!fs.existsSync(filePath)) {
    return null
  }

  let lines: string[]
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    lines = content.split('\n').filter(Boolean)
  } catch (err) {
    return null
  }

  if (lines.length === 0) return null

  let state: RunState | null = null

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as RunEvent
      if (event.type === 'run-start') {
        state = {
          runId: event.runId,
          workflow: event.workflow || '',
          description: event.description,
          phases: (event.phases || []).map((p, i) => ({
            name: p,
            index: i,
            status: 'pending'
          })),
          status: 'running',
          startedAt: event.ts,
          updatedAt: event.ts,
          elapsedMs: 0
        }
      } else if (state && event.type === 'phase-start') {
        state.updatedAt = event.ts
        state.elapsedMs = state.updatedAt - state.startedAt
        const p = state.phases.find(x => x.name === event.phase)
        if (p) {
          p.status = 'running'
          p.provider = event.provider
        }
      } else if (state && event.type === 'phase-end') {
        state.updatedAt = event.ts
        state.elapsedMs = state.updatedAt - state.startedAt
        const p = state.phases.find(x => x.name === event.phase)
        if (p) {
          p.status = event.ok ? 'done' : 'failed'
          p.durationMs = event.durationMs
        }
      } else if (state && event.type === 'run-end') {
        state.updatedAt = event.ts
        state.elapsedMs = state.updatedAt - state.startedAt
        state.status = event.ok ? 'done' : 'failed'
      }
    } catch (e) {
      // ignore parsing error for line
    }
  }

  return state
}

export function listRuns(options: RunStateOptions = {}): Array<{ runId: string; workflow: string; status: string; startedAt: number }> {
  const runsDir = resolveRunsDir(options)
  if (!fs.existsSync(runsDir)) return []

  let files: string[]
  try {
    files = fs.readdirSync(runsDir)
  } catch (e) {
    return []
  }

  const runs: Array<{ runId: string; workflow: string; status: string; startedAt: number; mtime: number }> = []

  for (const file of files) {
    if (file.endsWith('.jsonl')) {
      const runId = file.slice(0, -6)
      const state = readRun(runId, options)
      if (state) {
        const filePath = getRunFilePath(runId, options)
        let mtime = 0
        try {
          const stats = fs.statSync(filePath)
          mtime = stats.mtimeMs
        } catch (e) {
          // ignore stat error
        }

        runs.push({
          runId: state.runId,
          workflow: state.workflow,
          status: state.status,
          startedAt: state.startedAt,
          mtime
        })
      }
    }
  }

  runs.sort((a, b) => b.mtime - a.mtime)

  return runs.map(r => ({
    runId: r.runId,
    workflow: r.workflow,
    status: r.status,
    startedAt: r.startedAt
  }))
}

export function latestRunId(options: RunStateOptions = {}): string | null {
  const runs = listRuns(options)
  if (runs.length > 0) {
    return runs[0].runId
  }
  return null
}
