#!/usr/bin/env node
// Live TUI monitor for MCP Workflow CLI Bridge runs.
// It prefers the project-local SQLite ledger and keeps the scoped JSONL
// reader as a compatibility path for direct workflow executions.
// Run with the tsx loader:
//   node --import tsx bin/bridge-monitor.mjs
//   node --import tsx bin/bridge-monitor.mjs --once
//   node --import tsx bin/bridge-monitor.mjs --run <id>
//   node --import tsx bin/bridge-monitor.mjs --all
//   node --import tsx bin/bridge-monitor.mjs --cwd <dir>

import fs from 'node:fs'
import path from 'node:path'
import { RunLedger } from '../dist/daemon/ledger.js'
import { readRun } from '../dist/workflows/run-state.js'

const args = process.argv.slice(2)
const once = args.includes('--once')
const showAll = args.includes('--all')
const runFilter = (() => {
  const index = args.indexOf('--run')
  return index >= 0 ? args[index + 1] : null
})()
const cwdArg = (() => {
  const index = args.indexOf('--cwd')
  return index >= 0 ? args[index + 1] || process.cwd() : process.cwd()
})()
const targetCwd = path.resolve(cwdArg)
const intervalArg = (() => {
  const index = args.indexOf('--interval')
  if (index < 0) return 500
  const value = Number(args[index + 1])
  return Number.isFinite(value) && value > 0 ? value : 500
})()

const useColor = process.stdout.isTTY && !args.includes('--no-color')
const c = (code, value) => (useColor ? `\x1b[${code}m${value}\x1b[0m` : value)
const dim = value => c('2', value)
const bold = value => c('1', value)
const green = value => c('32', value)
const red = value => c('31', value)
const yellow = value => c('33', value)
const cyan = value => c('36', value)
const dimRed = value => c('2;31', value)

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const RUN_CAP = 20
const ACTIVE_STATUSES = new Set(['running', 'queued', 'awaiting_approval'])
const runsDir = path.join(targetCwd, '.bridge-runs')
const ledgerPath = path.join(targetCwd, '.clibridge', 'runs.db')
const stateCache = new Map()
let ledger

async function getLedger() {
  if (!fs.existsSync(ledgerPath)) return null
  if (!ledger) {
    ledger = new RunLedger(targetCwd)
    await ledger.migrate()
  }
  return ledger
}

function elapsedMs(row) {
  const end = row.ended_at ?? row.updated_at
  const start = row.started_at ?? row.created_at
  return (end ?? 0) - (start ?? 0)
}

function normalizeLegacyState(state) {
  const phases = state.phases.map(phase => ({
    name: phase.name,
    provider: phase.provider,
    status: phase.status === 'done' ? 'completed' : phase.status,
    duration_ms: phase.durationMs,
  }))
  const providers = [...new Set(phases.map(phase => phase.provider).filter(Boolean))].join(',')
  return {
    id: state.runId,
    workflow: state.workflow,
    status: state.status === 'done' ? 'completed' : state.status,
    task: state.description,
    created_at: state.startedAt,
    started_at: state.startedAt,
    updated_at: state.updatedAt,
    ended_at: state.status === 'running' ? null : state.updatedAt,
    pending_approvals: 0,
    providers,
    phases,
  }
}

function scanLegacyRuns() {
  let files
  try {
    files = fs.readdirSync(runsDir)
  } catch {
    files = []
  }

  const seen = new Set()
  const states = []
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue
    const runId = file.slice(0, -6)
    seen.add(runId)
    let mtimeMs
    try {
      mtimeMs = fs.statSync(path.join(runsDir, file)).mtimeMs
    } catch {
      continue
    }
    const cached = stateCache.get(runId)
    if (cached && cached.mtimeMs === mtimeMs) {
      states.push(cached.state)
      continue
    }
    const state = readRun(runId, { runsDir })
    if (!state) {
      stateCache.delete(runId)
      continue
    }
    const normalized = normalizeLegacyState(state)
    stateCache.set(runId, { mtimeMs, state: normalized })
    states.push(normalized)
  }
  for (const cachedId of stateCache.keys()) {
    if (!seen.has(cachedId)) stateCache.delete(cachedId)
  }
  return states
}

async function listRuns() {
  const activeLedger = await getLedger()
  return activeLedger ? activeLedger.listRuns() : scanLegacyRuns()
}

async function getRun(runId) {
  const activeLedger = await getLedger()
  if (activeLedger) return activeLedger.getRun(runId)
  const state = readRun(runId, { runsDir })
  return state ? normalizeLegacyState(state) : null
}

function fmtDuration(ms) {
  if (ms == null) return ''
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${Math.round(seconds % 60)}s`
}

function truncateDescription(description) {
  const value = String(description || '')
  return value.length > 80 ? value.slice(0, 79) + '…' : value
}

function runStatusText(status) {
  if (status === 'completed') return green('done')
  if (status === 'failed') return red('failed')
  if (status === 'cancelled') return dimRed('cancelled')
  if (status === 'awaiting_approval') return yellow('awaiting approval')
  return yellow('running')
}

function renderRunTitle(row, phases, focused) {
  const idPart = focused ? row.id : String(row.id).slice(-8)
  const parts = [bold(row.workflow), runStatusText(row.status)]
  if (phases) {
    const done = phases.filter(phase => phase.status === 'completed').length
    parts.push(`${done}/${phases.length} phases`)
  } else if (row.providers) {
    parts.push(dim(row.providers))
  }
  parts.push(fmtDuration(elapsedMs(row)))
  if (row.pending_approvals) {
    parts.push(yellow(`${row.pending_approvals} pending approval${row.pending_approvals === 1 ? '' : 's'}`))
  }
  parts.push(dim(idPart))
  return parts.join(' · ')
}

function renderPhases(phases, tick) {
  const maxName = phases.reduce((max, phase) => Math.max(max, String(phase.name).length), 0)
  return phases.map((phase, index) => {
    const connector = index === phases.length - 1 ? '└─' : '├─'
    const plainStatus = phase.status === 'running' ? `${SPINNER[tick % SPINNER.length]} running` : phase.status
    const paddedStatus = plainStatus.padEnd(9)
    const status = phase.status === 'completed' ? green(paddedStatus)
      : phase.status === 'failed' ? red(paddedStatus)
        : phase.status === 'running' ? yellow(paddedStatus)
          : dim(paddedStatus)
    const durationPart = phase.duration_ms != null ? dim(`  ${fmtDuration(phase.duration_ms)}`) : ''
    const providerPart = phase.provider ? dim(`  [${phase.provider}]`) : ''
    return `  ${connector} ${String(phase.name).padEnd(maxName)}  ${status}${durationPart}${providerPart}`
  })
}

function selectVisible(rows, all) {
  const active = rows.filter(row => ACTIVE_STATUSES.has(row.status)).sort((a, b) => b.updated_at - a.updated_at)
  const others = rows.filter(row => !ACTIVE_STATUSES.has(row.status)).sort((a, b) => b.updated_at - a.updated_at)
  if (all) return { visible: [...active, ...others], hiddenRunning: 0, hiddenOlder: 0 }

  let visibleActive
  let hiddenRunning
  let visibleOther
  let hiddenOlder
  if (active.length > RUN_CAP) {
    visibleActive = active.slice(0, RUN_CAP)
    hiddenRunning = active.length - RUN_CAP
    visibleOther = []
    hiddenOlder = others.length
  } else {
    visibleActive = active
    hiddenRunning = 0
    const remaining = RUN_CAP - visibleActive.length
    visibleOther = others.slice(0, remaining)
    hiddenOlder = others.length - visibleOther.length
  }
  return { visible: [...visibleActive, ...visibleOther], hiddenRunning, hiddenOlder }
}

async function buildFrame(tick) {
  const out = []
  if (runFilter) {
    out.push(bold(cyan(`clibridge run · ${runFilter}`)), '')
    const run = await getRun(runFilter)
    if (!run) {
      out.push(dim(`  run "${runFilter}" not found`))
    } else {
      out.push(renderRunTitle(run, run.phases, true))
      if (run.task) out.push('  ' + dim(truncateDescription(run.task)))
      if (run.phases?.length) out.push(...renderPhases(run.phases, tick))
      out.push('')
    }
    if (!once) out.push(dim('ctrl-c to exit'))
    return out.join('\n')
  }

  const rows = await listRuns()
  const activeCount = rows.filter(row => ACTIVE_STATUSES.has(row.status)).length
  const archivedCount = rows.length - activeCount
  out.push(bold(cyan(`clibridge runs · ${activeCount} running · ${archivedCount} archived`)), '')
  const { visible, hiddenRunning, hiddenOlder } = selectVisible(rows, showAll)

  if (visible.length === 0) {
    out.push(dim('  no runs yet — start a workflow to see it here'))
  } else {
    const phasesByRunId = new Map()
    await Promise.all(visible.filter(row => ACTIVE_STATUSES.has(row.status)).map(async row => {
      const detail = await getRun(row.id)
      if (detail) phasesByRunId.set(row.id, detail.phases)
    }))
    for (const row of visible) {
      const phases = row.phases || phasesByRunId.get(row.id)
      out.push(renderRunTitle(row, phases, false))
      if (row.task) out.push('  ' + dim(truncateDescription(row.task)))
      if (phases?.length) out.push(...renderPhases(phases, tick))
      out.push('')
    }
  }

  if (once) {
    const totalHidden = hiddenRunning + hiddenOlder
    if (totalHidden > 0) out.push(`${totalHidden} older runs hidden · use --all to show`)
  } else {
    let footer = 'ctrl-c to exit'
    if (hiddenRunning > 0) footer += ` · ${hiddenRunning} more running hidden · ${hiddenOlder} older runs hidden · use --all to show`
    else if (hiddenOlder > 0) footer += ` · ${hiddenOlder} older runs hidden · use --all to show`
    out.push(dim(footer))
  }
  return out.join('\n')
}

if (once) {
  process.stdout.write(await buildFrame(0) + '\n')
  process.exit(0)
}

let tick = 0
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR = '\x1b[2J\x1b[H'

async function draw() {
  const frame = await buildFrame(tick)
  process.stdout.write(CLEAR + frame + '\n')
  tick++
}

process.stdout.write(HIDE_CURSOR)
await draw()
const timer = setInterval(() => { void draw() }, Math.max(100, intervalArg))

function shutdown() {
  clearInterval(timer)
  process.stdout.write(SHOW_CURSOR + '\n')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
