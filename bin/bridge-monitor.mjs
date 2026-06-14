#!/usr/bin/env node
// Live TUI monitor for MCP Workflow CLI Bridge runs.
// Zero-dependency ANSI renderer that tails .bridge-runs/<id>.jsonl via the
// run-state contract (listRuns / readRun). Run with the tsx loader:
//   node --import tsx bin/bridge-monitor.mjs            # live
//   node --import tsx bin/bridge-monitor.mjs --once     # single frame, then exit
//   node --import tsx bin/bridge-monitor.mjs --run <id> # focus one run
import { listRuns, readRun } from '../src/workflows/run-state.ts'

const args = process.argv.slice(2)
const once = args.includes('--once')
const runFilter = (() => {
  const i = args.indexOf('--run')
  return i >= 0 ? args[i + 1] : null
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

function phaseIcon(status, tick) {
  switch (status) {
    case 'done': return green('✓')
    case 'failed': return red('✗')
    case 'running': return yellow(SPINNER[tick % SPINNER.length])
    default: return dim('·')
  }
}

function statusBadge(status) {
  if (status === 'done') return green('● done')
  if (status === 'failed') return red('● failed')
  return yellow('● running')
}

function fmtDuration(ms) {
  if (ms == null) return ''
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m${Math.round(s % 60)}s`
}

function renderRun(state, tick) {
  const lines = []
  const done = state.phases.filter(p => p.status === 'done').length
  const total = state.phases.length
  lines.push(
    `${statusBadge(state.status)}  ${bold(state.workflow)} ${dim(state.runId)}`
  )
  const meta = `${dim('phases')} ${done}/${total}   ${dim('elapsed')} ${fmtDuration(state.elapsedMs)}`
  lines.push('  ' + meta)
  if (state.description) {
    const d = state.description.length > 70 ? state.description.slice(0, 67) + '…' : state.description
    lines.push('  ' + dim(d))
  }
  for (const p of state.phases) {
    const icon = phaseIcon(p.status, tick)
    const name = p.status === 'running' ? cyan(p.name) : p.name
    const provider = p.provider ? dim(` [${p.provider}]`) : ''
    const dur = p.durationMs != null ? dim('  ' + fmtDuration(p.durationMs)) : ''
    lines.push(`    ${icon} ${name}${provider}${dur}`)
  }
  return lines.join('\n')
}

function buildFrame(tick) {
  const out = []
  out.push(bold(cyan('▍ MCP Workflow CLI Bridge — live runs')))
  out.push('')

  let runIds
  if (runFilter) {
    runIds = [runFilter]
  } else {
    runIds = listRuns().map(r => r.runId)
  }

  const states = runIds.map(readRun).filter(Boolean)
  if (states.length === 0) {
    out.push(dim(runFilter ? `  run "${runFilter}" not found` : '  no runs yet — start a workflow to see it here'))
  } else {
    for (const s of states) {
      out.push(renderRun(s, tick))
      out.push('')
    }
  }
  out.push(dim(once ? '' : 'ctrl-c to exit'))
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
