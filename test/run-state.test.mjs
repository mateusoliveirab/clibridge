import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {
  newRunId,
  startRun,
  phaseStart,
  phaseEnd,
  endRun,
  readRun,
  listRuns,
  latestRunId
} from '../src/workflows/run-state.ts'

test('run-state complete lifecycle', () => {
  const workflow = 'test-workflow'
  const runId = newRunId(workflow)
  const phases = ['phase1', 'phase2', 'phase3']

  try {
    // 1. Start run
    startRun({
      runId,
      workflow,
      description: 'A test run',
      phases
    })

    // 2. Simulate phases
    for (let i = 0; i < phases.length; i++) {
      const phaseName = phases[i]
      phaseStart(runId, phaseName, i, 'mock-provider')
      phaseEnd(runId, phaseName, true, 100 + i * 10) // Mock duration
    }

    // 3. End run
    endRun(runId, true)

    // 4. Read back and assert
    const state = readRun(runId)
    assert.ok(state, 'RunState should not be null')
    assert.strictEqual(state.runId, runId)
    assert.strictEqual(state.workflow, workflow)
    assert.strictEqual(state.description, 'A test run')
    assert.strictEqual(state.status, 'done')
    assert.ok(state.elapsedMs >= 0, 'elapsedMs should be >= 0')
    assert.strictEqual(state.phases.length, 3, 'Should have 3 phases')

    state.phases.forEach((p, i) => {
      assert.strictEqual(p.name, phases[i])
      assert.strictEqual(p.index, i)
      assert.strictEqual(p.provider, 'mock-provider')
      assert.strictEqual(p.status, 'done')
      assert.strictEqual(p.durationMs, 100 + i * 10)
    })

    // 5. Test listRuns and latestRunId
    const allRuns = listRuns()
    const found = allRuns.find(r => r.runId === runId)
    assert.ok(found, 'Run should be in listRuns')
    assert.strictEqual(found.workflow, workflow)
    assert.strictEqual(found.status, 'done')

    const latestId = latestRunId()
    // It's possible other tests ran, but at least latestId should be a string
    assert.ok(typeof latestId === 'string', 'latestRunId should return a string')
    
  } finally {
    // Cleanup
    const runFilePath = path.join(process.cwd(), '.bridge-runs', `${runId}.jsonl`)
    if (fs.existsSync(runFilePath)) {
      fs.unlinkSync(runFilePath)
    }
  }
})
