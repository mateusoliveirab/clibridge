import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('bridge-monitor reads a focused run from the --cwd ledger', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clibridge-monitor-'))
  const runId = 'target-run-1'
  try {
    const runsDir = path.join(cwd, '.bridge-runs')
    fs.mkdirSync(runsDir, { recursive: true })
    fs.writeFileSync(path.join(runsDir, `${runId}.jsonl`), [
      JSON.stringify({
        ts: Date.now(),
        type: 'run-start',
        runId,
        workflow: 'target-workflow',
        description: 'focused target run',
        phases: ['inspect'],
      }),
      JSON.stringify({ ts: Date.now(), type: 'phase-start', runId, phase: 'inspect', phaseIndex: 0, provider: 'mock' }),
    ].join('\n') + '\n')

    const output = execFileSync(process.execPath, [
      '--import',
      'tsx',
      'bin/bridge-monitor.mjs',
      '--once',
      '--no-color',
      '--cwd',
      cwd,
      '--run',
      runId,
    ], { encoding: 'utf8' })

    assert.match(output, /target-workflow/)
    assert.match(output, /focused target run/)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
