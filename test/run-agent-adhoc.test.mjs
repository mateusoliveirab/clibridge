import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAdhocInput,
  parseAdhocArgs,
  runAdhoc,
} from '../scripts/run-agent-adhoc.mjs'

test('parseAdhocArgs collects repeated --attachment values in order', () => {
  const args = parseAdhocArgs([
    '--prompt',
    'Inspect the screenshots.',
    '--attachment',
    '/tmp/first.png',
    '--attachment',
    'relative/second.jpg',
  ])

  assert.deepEqual(args.attachment, ['/tmp/first.png', 'relative/second.jpg'])
})

test('buildAdhocInput maps attachments to image inputs', () => {
  const args = parseAdhocArgs([
    '--prompt',
    'Inspect this image.',
    '--attachment',
    '/tmp/screen.png',
  ])

  assert.deepEqual(buildAdhocInput(args).attachments, [
    { type: 'image', path: '/tmp/screen.png' },
  ])
})

test('buildAdhocInput uses an empty attachment list when the flag is omitted', () => {
  const args = parseAdhocArgs(['--prompt', 'Text-only task.'])

  assert.deepEqual(buildAdhocInput(args).attachments, [])
})

test('buildAdhocInput disables provider fallback when requested', () => {
  const args = parseAdhocArgs([
    '--prompt',
    'Use only the selected provider.',
    '--disable-fallback',
  ])

  assert.equal(buildAdhocInput(args).disableFallback, true)
})

test('buildAdhocInput forwards explicitly allowlisted environment variable names', () => {
  const args = parseAdhocArgs([
    '--prompt',
    'Use the configured provider credential.',
    '--env-allowlist',
    'GOOGLE_GENERATIVE_AI_API_KEY',
  ])

  assert.deepEqual(buildAdhocInput(args).envAllowlist, ['GOOGLE_GENERATIVE_AI_API_KEY'])
})

test('runAdhoc forwards repeated image attachments to runAgent', async () => {
  const calls = []
  const expectedResult = { ok: true, text: 'done' }

  const result = await runAdhoc([
    '--prompt',
    'Compare these frames.',
    '--provider',
    'codex',
    '--attachment',
    '/tmp/frame-1.png',
    '--attachment',
    '/tmp/frame-2.png',
  ], async (input, options) => {
    calls.push({ input, options })
    return expectedResult
  })

  assert.equal(result, expectedResult)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].input.attachments, [
    { type: 'image', path: '/tmp/frame-1.png' },
    { type: 'image', path: '/tmp/frame-2.png' },
  ])
  assert.deepEqual(calls[0].options, { loadAgent: false })
})
