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

test('runOpenCode places the prompt before repeated file attachments', async () => {
  let capturedArgs
  const mockRunProcess = async (_cmd, args) => {
    capturedArgs = args
    return { stdout: JSON.stringify({ type: 'text', part: { text: 'OK' } }), stderr: '', durationMs: 5 }
  }

  await runOpenCode({
    prompt: 'describe the image',
    cwd: '/workspace/dir',
    model: 'google/gemini-2.5-flash',
    attachments: [
      { type: 'image', path: '/tmp/frame-1.jpg' },
      { type: 'image', path: '/tmp/frame-2.jpg' },
    ],
  }, mockRunProcess)

  assert.equal(capturedArgs[capturedArgs.indexOf('describe the image') + 1], '--file')
  assert.equal(capturedArgs[capturedArgs.indexOf('--file') + 1], '/tmp/frame-1.jpg')
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
    'hello',
    '--add-dir',
    '/other/dir1',
    '--add-dir',
    '/other/dir2',
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
    'hello',
    '--dangerously-skip-permissions',
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
    'hello',
    '--add-dir',
    '/other/dir1',
    '--add-dir',
    '/other/dir2',
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

test('runCodex disables interactive approvals only for read-only sandboxed runs', async () => {
  let capturedArgs
  const mockRunProcess = async (_cmd, args) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  await runCodex({
    prompt: 'inspect without editing',
    cwd: '/workspace/dir',
    access: 'read-only',
    sandbox: 'read-only',
    reasoningEffort: 'high',
  }, mockRunProcess)
  assert.deepEqual(capturedArgs.slice(0, 5), [
    '--config',
    'model_reasoning_effort=high',
    '--ask-for-approval',
    'never',
    'exec',
  ])
  assert.deepEqual(capturedArgs.slice(capturedArgs.indexOf('--ask-for-approval'), capturedArgs.indexOf('--ask-for-approval') + 2), [
    '--ask-for-approval',
    'never',
  ])

  await runCodex({
    prompt: 'prepare a bounded change',
    cwd: '/workspace/dir',
    access: 'workspace-write',
    sandbox: 'workspace-write',
  }, mockRunProcess)
  assert.equal(capturedArgs.includes('--ask-for-approval'), false)
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
    '--print',
    'hello',
    '--model',
    'Gemini 3.5 Flash (High)',
    '--add-dir',
    '/other/dir1',
    '--add-dir',
    '/other/dir2',
  ])
})

test('runGemini appends --dangerously-skip-permissions when skip-permissions is requested', async () => {
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
  assert.ok(capturedArgs.includes('--dangerously-skip-permissions'))
})

test('runGemini uses GEMINI_MODEL env override when request.model is absent', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const previous = process.env.GEMINI_MODEL
  process.env.GEMINI_MODEL = 'Gemini 4.0 Flash'
  try {
    await runGemini({ prompt: 'hello', cwd: '/workspace/dir' }, mockRunProcess)
    assert.ok(capturedArgs.includes('Gemini 4.0 Flash'))
  } finally {
    if (previous === undefined) delete process.env.GEMINI_MODEL
    else process.env.GEMINI_MODEL = previous
  }
})

test('runGemini prefers request.model over GEMINI_MODEL env override', async () => {
  let capturedArgs
  const mockRunProcess = async (cmd, args) => {
    capturedArgs = args
    return { stdout: 'OK', stderr: '', durationMs: 5 }
  }

  const previous = process.env.GEMINI_MODEL
  process.env.GEMINI_MODEL = 'Gemini 4.0 Flash'
  try {
    await runGemini({ prompt: 'hello', cwd: '/workspace/dir', model: 'Gemini Explicit' }, mockRunProcess)
    assert.ok(capturedArgs.includes('Gemini Explicit'))
    assert.ok(!capturedArgs.includes('Gemini 4.0 Flash'))
  } finally {
    if (previous === undefined) delete process.env.GEMINI_MODEL
    else process.env.GEMINI_MODEL = previous
  }
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
    '--dangerously-skip-permissions',
    'hello',
    '--file',
    '/path/to/file.txt'
  ])
})
