#!/usr/bin/env node
// Live TUI monitor for MCP Workflow CLI Bridge runs.
// Zero-dependency ANSI renderer that tails .bridge-runs/<id>.jsonl via the
// run-state contract (readRun). Run with the tsx loader:
//   node --import tsx bin/bridge-monitor.mjs            # live
//   node --import tsx bin/bridge-monitor.mjs --once     # single frame, then exit
//   node --import tsx bin/bridge-monitor.mjs --run <id> # focus one run
//   node --import tsx bin/bridge-monitor.mjs --all      # disable the 20-run cap
//   node --import tsx bin/bridge-monitor.mjs --cwd <dir> # monitor a target Store
import fs from 'node:fs'
import path from 'node:path'
import { readRun } from '../dist/workflows/run-state.js'

const args = process.argv.slice(2)
const once = args.includes('--once')
const showAll = args.includes('--all')
const runFilter = (() => {
  const i = args.indexOf('--run')
  return i >= 0 ? args[i + 1] : null
})()
const cwdArg = (() => {
  const i = args.indexOf('--cwd')
  return i >= 0 ? args[i + 1] : process.cwd()
})()
const intervalArg = (() => {
  const i = args.indexOf('--interval')
  if (i < 0) return 500
  const v = Number(args[i + 1])
  return Number.isFinite(v) && v > 0 ? v : 500
})()

const useColor = process.stdout.isTTY && !args.includes('--no-color')
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const dim = s => c('2', s)
const bold = s => c('1', s)
const green = s => c('32', s)
const red = s => c('31', s)
const yellow = s => c('33', s)
const cyan = s => c('36', s)

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const RUN_CAP = 20

// readRun() fully parses a run's .jsonl every call. Re-reading every file on
// every frame is wasteful once history grows, so we cache parsed state per
// runId keyed by the file's mtimeMs and only re-read files that changed.
const runsDir = path.join(path.resolve(cwdArg), '.bridge-runs')
const stateCache = new Map()

function scanRuns() {
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
    if (state) {
      stateCache.set(runId, { mtimeMs, state })
      states.push(state)
    } else {
      stateCache.delete(runId)
    }
  }
  for (const cachedId of stateCache.keys()) {
    if (!seen.has(cachedId)) stateCache.delete(cachedId)
  }
  return states
}

function selectVisible(states, all) {
  const running = states.filter(s => s.status === 'running').sort((a, b) => b.updatedAt - a.updatedAt)
  const others = states.filter(s => s.status !== 'running').sort((a, b) => b.updatedAt - a.updatedAt)

  if (all) {
    return { visible: [...running, ...others], hiddenRunning: 0, hiddenOlder: 0 }
  }

  let visibleRunning
  let hiddenRunning
  let visibleOther
  let hiddenOlder
  if (running.length > RUN_CAP) {
    visibleRunning = running.slice(0, RUN_CAP)
    hiddenRunning = running.length - RUN_CAP
    visibleOther = []
    hiddenOlder = others.length
  } else {
    visibleRunning = running
    hiddenRunning = 0
    const remaining = RUN_CAP - visibleRunning.length
    visibleOther = others.slice(0, remaining)
    hiddenOlder = others.length - visibleOther.length
  }
  return { visible: [...visibleRunning, ...visibleOther], hiddenRunning, hiddenOlder }
}

function fmtDuration(ms) {
  if (ms == null) return ''
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m${Math.round(s % 60)}s`
}

function truncateDescription(d) {
  return d.length > 80 ? d.slice(0, 79) + '…' : d
}

function runStatusText(status) {
  if (status === 'done') return green('done')
  if (status === 'failed') return red('failed')
  return yellow('running')
}

function renderRunTitle(state, focused) {
  const done = state.phases.filter(p => p.status === 'done').length
  const total = state.phases.length
  const idPart = focused ? state.runId : state.runId.slice(-8)
  return `${bold(state.workflow)} · ${runStatusText(state.status)} · ${done}/${total} phases · ${fmtDuration(state.elapsedMs)} · ${dim(idPart)}`
}

function renderPhases(phases, tick) {
  const maxName = phases.reduce((m, p) => Math.max(m, p.name.length), 0)
  return phases.map((p, i) => {
    const connector = i === phases.length - 1 ? '└─' : '├─'
    const plainStatus = p.status === 'running' ? `${SPINNER[tick % SPINNER.length]} running` : p.status
    const paddedStatus = plainStatus.padEnd(9)
    const status =
      p.status === 'done' ? green(paddedStatus)
      : p.status === 'failed' ? red(paddedStatus)
      : p.status === 'running' ? yellow(paddedStatus)
      : dim(paddedStatus)
    const durationPart = p.durationMs != null ? dim(`  ${fmtDuration(p.durationMs)}`) : ''
    const providerPart = p.provider ? dim(`  [${p.provider}]`) : ''
    return `  ${connector} ${p.name.padEnd(maxName)}  ${status}${durationPart}${providerPart}`
  })
}

function visiblePhasesFor(state) {
  if (state.status === 'running') return state.phases
  if (state.status === 'failed') return state.phases.filter(p => p.status !== 'pending')
  return []
}

function buildFrame(tick) {
  const out = []

  if (runFilter) {
    out.push(bold(cyan(`clibridge run · ${runFilter}`)))
    out.push('')
    const state = readRun(runFilter, { runsDir })
    if (!state) {
      out.push(dim(`  run "${runFilter}" not found`))
    } else {
      out.push(renderRunTitle(state, true))
      if (state.description) out.push('  ' + dim(truncateDescription(state.description)))
      out.push(...renderPhases(state.phases, tick))
      out.push('')
    }
    if (!once) out.push(dim('ctrl-c to exit'))
    return out.join('\n')
  }

  const states = scanRuns()
  const runningCount = states.filter(s => s.status === 'running').length
  const archivedCount = states.length - runningCount
  out.push(bold(cyan(`clibridge runs · ${runningCount} running · ${archivedCount} archived`)))
  out.push('')

  const { visible, hiddenRunning, hiddenOlder } = selectVisible(states, showAll)

  if (visible.length === 0) {
    out.push(dim('  no runs yet — start a workflow to see it here'))
  } else {
    for (const s of visible) {
      out.push(renderRunTitle(s, false))
      if (s.description) out.push('  ' + dim(truncateDescription(s.description)))
      const phases = visiblePhasesFor(s)
      if (phases.length) out.push(...renderPhases(phases, tick))
      out.push('')
    }
  }

  if (once) {
    const totalHidden = hiddenRunning + hiddenOlder
    if (totalHidden > 0) out.push(`${totalHidden} older runs hidden · use --all to show`)
  } else {
    let footer = 'ctrl-c to exit'
    if (hiddenRunning > 0) {
      footer += ` · ${hiddenRunning} more running hidden · ${hiddenOlder} older runs hidden · use --all to show`
    } else if (hiddenOlder > 0) {
      footer += ` · ${hiddenOlder} older runs hidden · use --all to show`
    }
    out.push(dim(footer))
  }
  return out.join('\n')
}

if (once) {
  process.stdout.write(buildFrame(0) + '\n')
  process.exit(0)
}

let tick = 0
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR = '\x1b[2J\x1b[H'

function draw() {
  process.stdout.write(CLEAR + buildFrame(tick) + '\n')
  tick++
}

process.stdout.write(HIDE_CURSOR)
draw()
const timer = setInterval(draw, Math.max(100, intervalArg))

function shutdown() {
  clearInterval(timer)
  process.stdout.write(SHOW_CURSOR + '\n')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
