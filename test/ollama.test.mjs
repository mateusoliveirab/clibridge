import assert from 'node:assert/strict'
import test from 'node:test'
import { runOllama, ollamaAdapter } from '../src/adapters/ollama.ts'

test('ollamaAdapter declares all capabilities as false', () => {
  assert.equal(ollamaAdapter.capabilities.structuredOutput, false)
  assert.equal(ollamaAdapter.capabilities.images, false)
  assert.equal(ollamaAdapter.capabilities.sandbox, false)
  assert.equal(ollamaAdapter.capabilities.skipPermissions, false)
  assert.equal(ollamaAdapter.run, runOllama)
})

test('runOllama builds correct arguments with default model', async () => {
  let capturedArgs
  let capturedCommand
  const mockRunProcess = async (cmd, args) => {
    capturedCommand = cmd
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const result = await runOllama({
    prompt: 'hello',
    cwd: '/workspace/dir',
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.equal(capturedCommand, 'ollama')
  assert.deepEqual(capturedArgs, ['run', 'llama3', 'hello'])
})

test('runOllama uses provided model when specified', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const result = await runOllama({
    prompt: 'hello',
    model: 'mistral',
    cwd: '/workspace/dir',
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.deepEqual(capturedArgs, ['run', 'mistral', 'hello'])
})

test('runOllama respects OLLAMA_MODEL from request environment or process environment', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const result = await runOllama({
    prompt: 'hello',
    cwd: '/workspace/dir',
    env: { OLLAMA_MODEL: 'qwen3.5:9b' }
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.deepEqual(capturedArgs, ['run', 'qwen3.5:9b', 'hello'])
})
