import { test } from 'node:test'
import * as assert from 'node:assert'
import { defaultAdapters } from '../src/adapters/registry.ts'
import { resolveRole, listWriters } from '../src/workflows/roles.ts'

test('resolveRole capabilities: skipPermissions', () => {
  const role = resolveRole({ capabilities: ['skipPermissions'] }, defaultAdapters)
  assert.ok(role, 'Should return a role')
  assert.strictEqual(defaultAdapters[role].capabilities.skipPermissions, true)
})

test('resolveRole capabilities: structuredOutput', () => {
  const role = resolveRole({ capabilities: ['structuredOutput'] }, defaultAdapters)
  assert.ok(role, 'Should return a role')
  assert.strictEqual(defaultAdapters[role].capabilities.structuredOutput, true)
})

test('resolveRole with unsatisfied capabilities throws', () => {
  assert.throws(() => {
    resolveRole({ capabilities: ['images'] }, {})
  }, /No provider satisfies demand/)
})

test('listWriters includes skip-capable providers and excludes ollama', () => {
  const writers = listWriters(defaultAdapters)
  assert.ok(writers.length > 0, 'Should return at least one writer')
  for (const writer of writers) {
    assert.strictEqual(defaultAdapters[writer].capabilities.skipPermissions, true)
  }
  
  if (defaultAdapters.ollama && !defaultAdapters.ollama.capabilities.skipPermissions) {
    assert.ok(!writers.includes('ollama'), 'Should exclude ollama since it lacks skipPermissions')
  }
})
