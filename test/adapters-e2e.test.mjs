import assert from 'node:assert/strict'
import test from 'node:test'
import { runProcess } from '../src/adapters/process-runner.ts'
import { runClaude } from '../src/adapters/claude.ts'
import { runCodex } from '../src/adapters/codex.ts'
import { runGemini } from '../src/adapters/gemini.ts'
import { runOpenCode } from '../src/adapters/opencode.ts'
import { runAgy } from '../src/adapters/agy.ts'
import { BridgeError, ErrorCode } from '../src/broker/errors.ts'

// Re-exec pattern (same technique as test/process-runner.test.mjs): route
// each adapter's argv through a real spawned Node process instead of an
// in-memory mock, so timeout handling, exit codes, and stdout/stderr capture
// are exercised through the true runProcess I/O boundary — not just argv
// construction, which is all the mocked adapter tests cover.
function reExecAs(scriptBody) {
  return (_command, _args, options) => runProcess(process.execPath, ['-e', scriptBody], options)
}

test('runClaude parses real stdout from a spawned process', async () => {
  const result = await runClaude(
    { prompt: 'hello', cwd: process.cwd() },
    reExecAs("process.stdout.write('real claude output')"),
  )
  assert.equal(result.ok, true)
  assert.equal(result.text, 'real claude output')
})

test('runClaude surfaces RATE_LIMITED from a real non-zero exit', async () => {
  await assert.rejects(
    runClaude(
      { prompt: 'hello', cwd: process.cwd() },
      reExecAs("process.stderr.write('Error: 429 rate limit exceeded'); process.exit(1)"),
    ),
    (error) => {
      assert.equal(error instanceof BridgeError, true)
      assert.equal(error.code, ErrorCode.RATE_LIMITED)
      return true
    },
  )
})

test('runCodex parses real stdout from a spawned process', async () => {
  const result = await runCodex(
    { prompt: 'hello', cwd: process.cwd() },
    reExecAs("process.stdout.write('real codex output')"),
  )
  assert.equal(result.ok, true)
  assert.equal(result.text, 'real codex output')
})

test('runGemini parses real stdout from a spawned process', async () => {
  const result = await runGemini(
    { prompt: 'hello', cwd: process.cwd() },
    reExecAs("process.stdout.write('real gemini output')"),
  )
  assert.equal(result.ok, true)
  assert.equal(result.text, 'real gemini output')
})

test('runOpenCode parses real JSONL stdout from a spawned process', async () => {
  const payload = JSON.stringify({ type: 'text', part: { type: 'text', text: 'real opencode output' } })
  const result = await runOpenCode(
    { prompt: 'hello', cwd: process.cwd() },
    reExecAs(`process.stdout.write(${JSON.stringify(payload)})`),
  )
  assert.equal(result.ok, true)
  assert.equal(result.text, 'real opencode output')
})

test('runAgy parses real stdout from a spawned process', async () => {
  const result = await runAgy(
    { prompt: 'hello', cwd: process.cwd() },
    reExecAs("process.stdout.write('real agy output')"),
  )
  assert.equal(result.ok, true)
  assert.equal(result.text, 'real agy output')
})
