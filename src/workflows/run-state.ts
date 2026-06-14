import fs from 'node:fs'
import path from 'node:path'

const bridgeRunsDir = path.join(process.cwd(), '.bridge-runs')

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

function getRunFilePath(runId: string): string {
  return path.join(bridgeRunsDir, `${runId}.jsonl`)
}

function appendEvent(runId: string, event: RunEvent): void {
  try {
    if (!fs.existsSync(bridgeRunsDir)) {
      fs.mkdirSync(bridgeRunsDir, { recursive: true })
    }
    const filePath = getRunFilePath(runId)
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

export function startRun(opts: { runId: string; workflow: string; description?: string; phases: string[] }): void {
  appendEvent(opts.runId, {
    ts: Date.now(),
    type: 'run-start',
    runId: opts.runId,
    workflow: opts.workflow,
    description: opts.description,
    totalPhases: opts.phases.length,
    phases: opts.phases
  })
}

export function phaseStart(runId: string, phase: string, phaseIndex: number, provider: string): void {
  appendEvent(runId, {
    ts: Date.now(),
    type: 'phase-start',
    runId,
    phase,
    phaseIndex,
    provider
  })
}

export function phaseEnd(runId: string, phase: string, ok: boolean, durationMs: number): void {
  appendEvent(runId, {
    ts: Date.now(),
    type: 'phase-end',
    runId,
    phase,
    ok,
    durationMs
  })
}

export function endRun(runId: string, ok: boolean): void {
  appendEvent(runId, {
    ts: Date.now(),
    type: 'run-end',
    runId,
    ok
  })
}

export function readRun(runId: string): RunState | null {
  const filePath = getRunFilePath(runId)
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

export function listRuns(): Array<{ runId: string; workflow: string; status: string; startedAt: number }> {
  if (!fs.existsSync(bridgeRunsDir)) return []

  let files: string[]
  try {
    files = fs.readdirSync(bridgeRunsDir)
  } catch (e) {
    return []
  }

  const runs: Array<{ runId: string; workflow: string; status: string; startedAt: number; mtime: number }> = []

  for (const file of files) {
    if (file.endsWith('.jsonl')) {
      const runId = file.slice(0, -6)
      const state = readRun(runId)
      if (state) {
        const filePath = getRunFilePath(runId)
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

export function latestRunId(): string | null {
  const runs = listRuns()
  if (runs.length > 0) {
    return runs[0].runId
  }
  return null
}
