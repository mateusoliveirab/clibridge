import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTemplateArgs, parseOutput } from '../src/adapters/config-runner.ts'

test('resolveTemplateArgs - lit token', () => {
  const tokens = [{ lit: 'run' }]
  const result = resolveTemplateArgs(tokens, {})
  assert.deepEqual(result, ['run'])
})

test('resolveTemplateArgs - var token (model)', () => {
  const tokens = [{ var: 'model', default: 'llama3' }]
  const result1 = resolveTemplateArgs(tokens, {})
  assert.deepEqual(result1, ['llama3'])

  const result2 = resolveTemplateArgs(tokens, { model: 'mistral' })
  assert.deepEqual(result2, ['mistral'])
})

test('resolveTemplateArgs - flag var token', () => {
  const tokens = [{ flag: '--temperature', var: 'temperature' }]
  const result1 = resolveTemplateArgs(tokens, {})
  assert.deepEqual(result1, [])

  const result2 = resolveTemplateArgs(tokens, { temperature: 0.5 })
  assert.deepEqual(result2, ['--temperature', '0.5'])
})

test('resolveTemplateArgs - when token', () => {
  const tokens = [{ when: 'sandbox', emit: ['--sandbox'] }]
  const result1 = resolveTemplateArgs(tokens, {})
  assert.deepEqual(result1, [])

  const result2 = resolveTemplateArgs(tokens, { sandbox: true })
  assert.deepEqual(result2, ['--sandbox'])
})

test('resolveTemplateArgs - repeat token (extraDirs)', () => {
  const tokens = [{ repeat: 'extraDirs', flag: '--dir' }]
  const result = resolveTemplateArgs(tokens, {
    addDir: '/var/log',
    addDirs: ['/tmp', '/var/log'] // tests deduping via getExtraDirs
  })
  assert.deepEqual(result, ['--dir', '/var/log', '--dir', '/tmp'])
})

test('resolveTemplateArgs - repeat token (attachments)', () => {
  const tokens = [{ repeat: 'attachments', flag: '--file' }]
  const result = resolveTemplateArgs(tokens, {
    attachments: [{ path: '/tmp/test.txt', type: 'text' }]
  })
  assert.deepEqual(result, ['--file', '/tmp/test.txt'])
})

test('parseOutput - raw trim=true', () => {
  const result = parseOutput('  hello world  \n', { type: 'raw', trim: true })
  assert.equal(result, 'hello world')
})

test('parseOutput - raw trim=false', () => {
  const result = parseOutput('  hello world  \n', { type: 'raw', trim: false })
  assert.equal(result, '  hello world  \n')
})
