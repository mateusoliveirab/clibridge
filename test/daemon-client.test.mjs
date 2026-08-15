import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runWorkflowThroughDaemon, daemonFor } from '../src/daemon/client.ts'

function project() { return fs.mkdtempSync(path.join(os.tmpdir(), 'clibridge-daemon-client-')) }

test('runWorkflowThroughDaemon happy path executes a trivial workflow end to end', async () => {
  const cwd = project()
  try {
    fs.writeFileSync(path.join(cwd, 'safe.workflow.json'), JSON.stringify({
      name: 'safe',
      phases: [{ name: 'inspect', kind: 'shell', command: 'echo hello-from-daemon' }],
    }))
    const result = await runWorkflowThroughDaemon({ workflowPath: 'safe.workflow.json', cwd, task: 'say hello', inputs: {} })
    assert.equal(result.ok, true)
    assert.match(result.finalText, /hello-from-daemon/)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('missing workflow file surfaces the real load error, not a generic "stopped unexpectedly"', async () => {
  const cwd = project()
  try {
    await assert.rejects(
      () => runWorkflowThroughDaemon({ workflowPath: 'does-not-exist.workflow.json', cwd, task: 'x', inputs: {} }),
      (error) => {
        assert.match(error.message, /Failed to read workflow file/)
        assert.doesNotMatch(error.message, /stopped unexpectedly/)
        return true
      },
    )
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('daemonFor normalizes cwd so trailing slashes share one cached instance', async () => {
  const cwd = project()
  try {
    const a = await daemonFor(cwd)
    const b = await daemonFor(`${cwd}${path.sep}`)
    assert.strictEqual(a, b)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('a gated phase fails with a timeout message instead of hanging when nobody approves it', async () => {
  const cwd = project()
  try {
    fs.writeFileSync(path.join(cwd, 'gated.workflow.json'), JSON.stringify({
      name: 'gated',
      phases: [{ name: 'publish', kind: 'shell', command: 'git push origin main' }],
    }))
    const result = await runWorkflowThroughDaemon(
      { workflowPath: 'gated.workflow.json', cwd, task: 'publish', dryRun: true, inputs: {} },
      { approvalTimeoutMs: 200 },
    )
    assert.equal(result.ok, false)
    assert.match(result.error, /Approval timed out after \d+s/)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('runWorkflowThroughDaemon rejects a workflow path outside the project directory', async () => {
  const cwd = project()
  try {
    await assert.rejects(
      () => runWorkflowThroughDaemon({ workflowPath: '../outside.workflow.json', cwd, task: 'x', inputs: {} }),
      /outside the project directory/,
    )
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
