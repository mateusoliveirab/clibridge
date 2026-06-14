import os from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseOpenCodeOutput, runOpenCode } from '../src/adapters/opencode.ts'
import { runAgy, agyAdapter } from '../src/adapters/agy.ts'
import { runCodex } from '../src/adapters/codex.ts'
import { runClaude } from '../src/adapters/claude.ts'
import { runGemini } from '../src/adapters/gemini.ts'


test('parseOpenCodeOutput extracts text from part.text JSONL events', () => {
  const stdout = [
    JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
    JSON.stringify({ type: 'text', part: { type: 'text', text: 'OK' } }),
  ].join('\n')

  const { text } = parseOpenCodeOutput(stdout)
  assert.equal(text, 'OK')
})

test('parseOpenCodeOutput concatenates multiple text parts in order', () => {
  const stdout = [
    JSON.stringify({ type: 'text', part: { type: 'text', text: 'Hello ' } }),
    JSON.stringify({ type: 'text', part: { type: 'text', text: 'world' } }),
  ].join('\n')

  const { text } = parseOpenCodeOutput(stdout)
  assert.equal(text, 'Hello world')
})

test('parseOpenCodeOutput parses JSON payload as data when text is JSON', () => {
  const stdout = JSON.stringify({
    type: 'text',
    part: { type: 'text', text: '{"slug":"a-post"}' },
  })

  const { data } = parseOpenCodeOutput(stdout)
  assert.deepEqual(data, { slug: 'a-post' })
})

test('parseOpenCodeOutput falls back to raw stdout when no text event', () => {
  const { text } = parseOpenCodeOutput('plain non-json line')
  assert.equal(text, 'plain non-json line')
})

test('agyAdapter declares no structured-output capability', () => {
  // Schema rejection is enforced by the broker against this declaration
  // (see run-agent.test.mjs), not by a check inside the adapter itself.
  assert.equal(agyAdapter.capabilities.structuredOutput, false)
  assert.equal(agyAdapter.run, runAgy)
})

test('runAgy does not add cwd as --add-dir automatically', async () => {
  let capturedArgs
  let capturedOptions
  const mockRunProcess = async (cmd, args, options) => {
    capturedArgs = args
    capturedOptions = options
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const result = await runAgy({
    prompt: 'hello',
    cwd: '/workspace/dir',
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.deepEqual(capturedArgs, ['--print', 'hello'])
  // no explicit dirs → runs from home dir, not the project cwd
  assert.equal(capturedOptions.cwd, os.homedir())
})

test('runAgy builds correct arguments with addDirs (cwd not duplicated)', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args, options) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const result = await runAgy({
    prompt: 'hello',
    cwd: '/workspace/dir',
    addDirs: ['/other/dir1', '/other/dir2'],
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.deepEqual(capturedArgs, [
    '--print',
    '--add-dir',
    '/other/dir1',
    '--add-dir',
    '/other/dir2',
    'hello'
  ])
})

test('runAgy omits skip-permissions by default and adds it only when opted in', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  await runAgy({ prompt: 'hello', cwd: '/workspace/dir' }, mockRunProcess)
  assert.equal(capturedArgs.includes('--dangerously-skip-permissions'), false)

  await runAgy({
    prompt: 'hello',
    cwd: '/workspace/dir',
    dangerouslySkipPermissions: true,
  }, mockRunProcess)
  assert.deepEqual(capturedArgs, [
    '--print',
    '--dangerously-skip-permissions',
    'hello'
  ])
})

test('runAgy builds correct arguments with addDir and addDirs (cwd not included)', async () => {
  let capturedArgs
  let capturedOptions
  const mockRunProcess = async (cmd, args, options) => {
    capturedArgs = args
    capturedOptions = options
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const result = await runAgy({
    prompt: 'hello',
    cwd: '/workspace/dir',
    addDir: '/other/dir1',
    addDirs: ['/other/dir2'],
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.deepEqual(capturedArgs, [
    '--print',
    '--add-dir',
    '/other/dir1',
    '--add-dir',
    '/other/dir2',
    'hello'
  ])
  // explicit dirs requested → use the project cwd so relative paths resolve
  assert.equal(capturedOptions.cwd, '/workspace/dir')
})

test('runCodex builds correct arguments with addDir and addDirs', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args, options) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const result = await runCodex({
    prompt: 'hello',
    cwd: '/workspace/dir',
    addDir: '/other/dir1',
    addDirs: ['/other/dir2', '/other/dir1'], // duplicate to test Set deduplication
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.equal(capturedArgs[0], 'exec')
  assert.equal(capturedArgs[1], '--cd')
  assert.equal(capturedArgs[2], '/workspace/dir')
  assert.ok(capturedArgs.includes('--add-dir'))
  const addDirIndices = []
  capturedArgs.forEach((arg, idx) => {
    if (arg === '--add-dir') addDirIndices.push(idx)
  })
  assert.equal(addDirIndices.length, 2)
  assert.equal(capturedArgs[addDirIndices[0] + 1], '/other/dir1')
  assert.equal(capturedArgs[addDirIndices[1] + 1], '/other/dir2')
  assert.equal(capturedArgs[capturedArgs.length - 1], 'hello')
})

test('runClaude builds correct arguments with addDir and addDirs', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args, options) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const result = await runClaude({
    prompt: 'hello',
    cwd: '/workspace/dir',
    addDir: '/other/dir1',
    addDirs: ['/other/dir2'],
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.deepEqual(capturedArgs, [
    '-p',
    '--output-format',
    'text',
    '--add-dir',
    '/other/dir1',
    '--add-dir',
    '/other/dir2',
    'hello'
  ])
})

test('runGemini builds correct arguments with addDir and addDirs', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args, options) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const result = await runGemini({
    prompt: 'hello',
    cwd: '/workspace/dir',
    addDir: '/other/dir1',
    addDirs: ['/other/dir2'],
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.deepEqual(capturedArgs, [
    '--prompt',
    'hello',
    '--output-format',
    'text',
    '--include-directories',
    '/other/dir1',
    '--include-directories',
    '/other/dir2'
  ])
})

test('runGemini appends --yolo when skip-permissions is requested', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const result = await runGemini({
    prompt: 'hello',
    cwd: '/workspace/dir',
    dangerouslySkipPermissions: true,
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.ok(capturedArgs.includes('--yolo'))
})

test('runOpenCode builds correct arguments with addDir and addDirs', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args, options) => {
    capturedArgs = args
    return { stdout: '{"type":"text","part":{"type":"text","text":"OK"}}', stderr: '', durationMs: 5 }
  }

  const result = await runOpenCode({
    prompt: 'hello',
    cwd: '/workspace/dir',
    addDir: '/other/dir1',
    addDirs: ['/other/dir2'],
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.deepEqual(capturedArgs, [
    'run',
    '--dir',
    '/workspace/dir',
    '--format',
    'json',
    '--add-dir',
    '/other/dir1',
    '--add-dir',
    '/other/dir2',
    'hello'
  ])
})

test('runOpenCode builds correct arguments with dangerouslySkipPermissions and attachments', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args, options) => {
    capturedArgs = args
    return { stdout: '{"type":"text","part":{"type":"text","text":"OK"}}', stderr: '', durationMs: 5 }
  }

  const result = await runOpenCode({
    prompt: 'hello',
    cwd: '/workspace/dir',
    dangerouslySkipPermissions: true,
    attachments: [{ type: 'file', path: '/path/to/file.txt' }],
  }, mockRunProcess)

  assert.equal(result.ok, true)
  assert.deepEqual(capturedArgs, [
    'run',
    '--dir',
    '/workspace/dir',
    '--format',
    'json',
    '--file',
    '/path/to/file.txt',
    '--dangerously-skip-permissions',
    'hello'
  ])
})


