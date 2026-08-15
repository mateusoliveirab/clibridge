import assert from 'node:assert/strict'
import test from 'node:test'
import { selectRoute } from '../src/broker/routing.ts'

test('selectRoute prefers label over agentType and phase', () => {
  const route = selectRoute({
    defaultProvider: 'codex',
    routes: [
      { phase: 'Create', provider: 'gemini' },
      { agentType: 'vastitas-creator', provider: 'opencode' },
      { label: 'create:iter1', provider: 'codex' },
    ],
  }, {
    phase: 'Create',
    agentType: 'vastitas-creator',
    label: 'create:iter1',
  })

  assert.equal(route.provider, 'codex')
})

test('selectRoute falls back to default provider', () => {
  const route = selectRoute({
    defaultProvider: 'codex',
    routes: [],
  }, {
    phase: 'Extract',
    label: 'extract-conflict',
  })

  assert.equal(route.provider, 'codex')
})

test('selectRoute still matches on model without an override present', () => {
  const route = selectRoute({
    defaultProvider: 'codex',
    routes: [
      { model: 'gpt-4o-mini', provider: 'claude' },
    ],
  }, {
    phase: 'Extract',
    label: 'extract-conflict',
    model: 'gpt-4o-mini',
  })

  assert.equal(route.provider, 'claude')
  assert.equal(route.useModel, undefined)
})

test('selectRoute exposes useModel override distinct from the model match field', () => {
  const route = selectRoute({
    defaultProvider: 'codex',
    routes: [
      { phase: 'Cheap', provider: 'gemini', useModel: 'gemini-2.0-flash' },
    ],
  }, {
    phase: 'Cheap',
    label: 'cheap:iter1',
    model: 'requested-model-ignored-by-match',
  })

  assert.equal(route.provider, 'gemini')
  assert.equal(route.useModel, 'gemini-2.0-flash')
})

test('selectRoute does not select a route whose model match differs from the request model', () => {
  const route = selectRoute({
    defaultProvider: 'codex',
    routes: [
      { model: 'gpt-4o-mini', provider: 'claude', useModel: 'should-not-apply' },
    ],
  }, {
    phase: 'Extract',
    label: 'extract-conflict',
    model: 'a-different-model',
  })

  // No route matched (model mismatch) -> falls back to defaultProvider, no override applied.
  assert.equal(route.provider, 'codex')
  assert.equal(route.useModel, undefined)
})

test('selectRoute can require image attachments', () => {
  const route = selectRoute({
    defaultProvider: 'codex',
    routes: [
      { phase: 'Critique', requiresImages: true, provider: 'codex' },
      { phase: 'Critique', provider: 'claude' },
    ],
  }, {
    phase: 'Critique',
    label: 'critique:iter1',
    attachments: [{ type: 'image', path: 'iter1.png' }],
  })

  assert.equal(route.provider, 'codex')
})

