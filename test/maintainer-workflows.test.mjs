import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runWorkflow, WorkflowFileSchema } from '../src/workflows/workflow-executor.ts'

const repo = path.resolve('.')
const auditPath = path.join(repo, 'examples', 'maintainer-component-audit.workflow.json')
const focusedPath = path.join(repo, 'examples', 'maintainer-component-review.workflow.json')
const routesPath = path.join(repo, 'examples', 'maintainer-review.routes.json')
const registryPath = path.join(repo, 'src', 'workflows', 'workflows-config.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clibridge-maintainer-workflow-'))
}

test('maintainer workflows are strict read-only, structured, and no-fallback contracts', () => {
  for (const workflowPath of [auditPath, focusedPath]) {
    const workflow = WorkflowFileSchema.parse(readJson(workflowPath))
    const agentPhases = workflow.phases.filter(phase => phase.kind === 'agent')

    assert.equal(workflow.access, 'read-only')
    assert.equal(workflow.disableFallback, true)
    assert.ok(agentPhases.length >= 2)
    for (const phase of agentPhases) {
      assert.equal(phase.access, 'read-only')
      assert.equal(phase.disableFallback, true)
      assert.equal(typeof phase.provider, 'string')
      assert.equal(phase.reasoningEffort, 'high')
      assert.ok(phase.schema)
      assert.ok(phase.mockData)
    }
  }

  const routes = readJson(routesPath)
  assert.equal(routes.defaultProvider, 'codex')
  assert.ok(routes.routes.length >= 2)
  assert.ok(routes.routes.every(route => route.sandbox === 'read-only'))
  assert.ok(routes.routes.every(route => route.reasoningEffort === 'high'))

  const registry = readJson(registryPath)
  for (const name of ['maintainer-component-audit', 'maintainer-component-review']) {
    assert.ok(registry[name])
    assert.ok(registry[name].phases.length >= 2)
    assert.ok(registry[name].phases
      .filter(phase => phase.output === 'structured')
      .every(phase => phase.readOnly && phase.demand.capabilities.includes('sandbox')))
  }
})

test('maintainer audit and focused review complete their structured dry-runs through the route config', async () => {
  const cwd = tempDir()
  try {
    const audit = await runWorkflow({
      workflowPath: auditPath,
      cwd,
      task: 'validate the broad maintainer audit contract',
      dryRun: true,
      routeConfigPath: routesPath,
    })
    assert.equal(audit.ok, true, audit.error)
    assert.equal(audit.phases.length, 9)
    assert.equal(JSON.parse(audit.results.synthesis).releaseReadiness, 'needs-work')
    assert.equal(JSON.parse(audit.results['validation-plan']).externalGates.length, 1)

    const focused = await runWorkflow({
      workflowPath: focusedPath,
      cwd,
      task: 'validate a focused component review contract',
      dryRun: true,
      inputs: {
        component: 'workflows-tooling',
        paths: 'src/workflows bin test',
        focus: 'workflow/runtime contract and regression coverage',
      },
      routeConfigPath: routesPath,
    })
    assert.equal(focused.ok, true, focused.error)
    assert.equal(focused.phases.length, 4)
    assert.equal(JSON.parse(focused.results['improvement-plan']).priority, 'none')
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('maintainer workflows reject an accidental write-enabled input', async () => {
  const cwd = tempDir()
  try {
    const result = await runWorkflow({
      workflowPath: focusedPath,
      cwd,
      task: 'ensure review cannot become an implementation run',
      dryRun: true,
      inputs: { allowWrite: true },
      routeConfigPath: routesPath,
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /read-only/)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
