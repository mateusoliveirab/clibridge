import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  detectStructuredDataFormat,
  loadStructuredDataFileSync,
  parseStructuredData,
} from '../src/config/structured-data.ts'
import { loadJsonConfig } from '../src/config/load-config.ts'
import { runWorkflow } from '../src/workflows/workflow-executor.ts'

test('detectStructuredDataFormat supports json and toon only', () => {
  assert.equal(detectStructuredDataFormat('workflow.json'), 'json')
  assert.equal(detectStructuredDataFormat('workflow.toon'), 'toon')
  assert.throws(
    () => detectStructuredDataFormat('workflow.yaml'),
    /Expected \.json or \.toon/,
  )
})

test('parseStructuredData decodes JSON and TOON to equivalent objects', () => {
  const expected = {
    defaultProvider: 'agy',
    routes: [
      { phase: 'Create', provider: 'codex' },
    ],
  }

  assert.deepEqual(parseStructuredData(JSON.stringify(expected), 'json'), expected)
  assert.deepEqual(
    parseStructuredData(fs.readFileSync('test/fixtures/route-config.toon', 'utf8'), 'toon'),
    expected,
  )
})

test('loadJsonConfig accepts .toon route configs', async () => {
  const config = await loadJsonConfig('test/fixtures/route-config.toon')
  assert.equal(config.defaultProvider, 'agy')
  assert.deepEqual(config.routes, [
    { phase: 'Create', provider: 'codex' },
  ])
})

test('runWorkflow accepts .toon workflow files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-toon-workflow-'))
  try {
    const result = await runWorkflow({
      workflowPath: path.resolve('test/fixtures/simple-workflow.toon'),
      cwd: dir,
      task: 'plan from toon',
      dryRun: true,
    })

    assert.equal(result.ok, true)
    assert.equal(result.workflow, 'toon-workflow')
    assert.equal(result.results.plan, 'planned from toon')
    assert.equal(result.results.validate, '[dry-run] echo bugfix')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('loadStructuredDataFileSync reports parser and path context', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-toon-invalid-'))
  try {
    const filePath = path.join(dir, 'invalid.toon')
    fs.writeFileSync(filePath, 'routes[2]{phase,provider}:\n  Create,codex\n')

    assert.throws(
      () => loadStructuredDataFileSync(filePath),
      new RegExp(`Failed to parse TOON file at ${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
