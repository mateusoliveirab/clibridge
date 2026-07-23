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

test('resolveRole uses config.rolePreferences.strength when present, overriding STRENGTH_PREFERENCE', () => {
  const adapters = {
    codex: { capabilities: { structuredOutput: false, images: false, sandbox: false, skipPermissions: false } },
    claude: { capabilities: { structuredOutput: false, images: false, sandbox: false, skipPermissions: false } },
  }

  // Built-in order ranks claude above codex; config override reverses it.
  const builtin = resolveRole({ strength: 'high' }, adapters)
  assert.strictEqual(builtin, 'claude')

  const overridden = resolveRole({ strength: 'high' }, adapters, {
    rolePreferences: { strength: ['codex', 'claude'] },
  })
  assert.strictEqual(overridden, 'codex')
})

test('resolveRole uses config.rolePreferences.cost when present, overriding COST_PREFERENCE', () => {
  const adapters = {
    codex: { capabilities: { structuredOutput: false, images: false, sandbox: false, skipPermissions: false } },
    ollama: { capabilities: { structuredOutput: false, images: false, sandbox: false, skipPermissions: false } },
  }

  const builtin = resolveRole({ cost: 'cheap' }, adapters)
  assert.strictEqual(builtin, 'ollama')

  const overridden = resolveRole({ cost: 'cheap' }, adapters, {
    rolePreferences: { cost: ['codex', 'ollama'] },
  })
  assert.strictEqual(overridden, 'codex')
})

test('resolveRole falls back to built-in preference lists when config has no rolePreferences', () => {
  const role = resolveRole({ strength: 'high' }, defaultAdapters, {})
  assert.ok(role)
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
