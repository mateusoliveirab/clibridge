import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLiveValidationInput,
  classifyFailure,
  parseLiveValidationArgs,
  summarizeResult,
} from '../scripts/lib/live-validation.mjs'

test('parseLiveValidationArgs supports positional and comma-separated providers', () => {
  assert.deepEqual(parseLiveValidationArgs(['claude', 'opencode']).providers, ['claude', 'opencode'])
  assert.deepEqual(parseLiveValidationArgs(['--providers', 'claude,codex']).providers, ['claude', 'codex'])
  assert.deepEqual(parseLiveValidationArgs(['--provider', 'agy', '--provider', 'gemini']).providers, ['agy', 'gemini'])
})

test('summarizeResult accepts exactly OK as a passing live validation', () => {
  const summary = summarizeResult({
    ok: true,
    text: 'OK',
    durationMs: 10,
    attempts: 1,
  })

  assert.equal(summary.pass, true)
  assert.equal(summary.status, 'ok')
})

test('buildLiveValidationInput requests skip-permissions only for providers that support it', () => {
  assert.equal(buildLiveValidationInput({ provider: 'claude' }).dangerouslySkipPermissions, true)
  assert.equal(buildLiveValidationInput({ provider: 'gemini' }).dangerouslySkipPermissions, true)
  assert.equal(buildLiveValidationInput({ provider: 'ollama' }).dangerouslySkipPermissions, false)
})

test('summarizeResult marks successful but unexpected output as failure', () => {
  const summary = summarizeResult({
    ok: true,
    text: 'OK, done.',
    durationMs: 10,
    attempts: 1,
  })

  assert.equal(summary.pass, false)
  assert.equal(summary.status, 'unexpected-output')
})

test('classifyFailure recognizes common live provider environment failures', () => {
  assert.equal(classifyFailure({ errorCode: 'PROVIDER_UNAVAILABLE' }), 'cli-unavailable')
  assert.equal(classifyFailure({ errorCode: 'TIMEOUT' }), 'timeout')
  assert.equal(classifyFailure({ errorCode: 'UNSUPPORTED_SCHEMA' }), 'unsupported')
  assert.equal(classifyFailure({ errorCode: 'PROCESS_EXIT_NONZERO' }, "You've hit your session limit"), 'session-limit')
  assert.equal(classifyFailure({ errorCode: 'PROCESS_EXIT_NONZERO' }, 'OpenAI usage quota exceeded'), 'quota-or-rate-limit')
  assert.equal(classifyFailure({ errorCode: 'PROCESS_EXIT_NONZERO' }, 'Please login first'), 'auth')
})

test('summarizeResult prefers stdoutTail for failed live validations', () => {
  const summary = summarizeResult({
    ok: false,
    errorCode: 'PROCESS_EXIT_NONZERO',
    message: 'claude exited with code 1.',
    stdoutTail: "You've hit your session limit",
    stderrTail: '',
    details: { code: 1 },
    durationMs: 10,
    attempts: 1,
  })

  assert.equal(summary.pass, false)
  assert.equal(summary.status, 'session-limit')
  assert.equal(summary.detail, "You've hit your session limit")
})
