import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { runAgent } from '../src/broker/run-agent.ts'
import { BridgeError, ErrorCode } from '../src/broker/errors.ts'
import { agyAdapter } from '../src/adapters/agy.ts'

const cwd = join(import.meta.dirname, 'fixtures', 'workspace')

function successEnvelope(request) {
  return {
    ok: true,
    runId: request.runId,
    provider: request.provider,
    phase: request.phase,
    label: request.label,
    durationMs: 1,
    attempts: 1,
    structured: false,
    text: 'done',
    usage: {},
    artifacts: [],
    warnings: [],
  }
}

test('runAgent routes to adapter and returns schema-validated data', async () => {
  const seen = []
  const result = await runAgent({
    workflow: 'generate-blog-image',
    phase: 'Create',
    label: 'create:iter1',
    agentType: 'vastitas-creator',
    cwd,
    prompt: 'Create a prompt.',
    schema: {
      type: 'object',
      required: ['artisticPrompt'],
      properties: {
        artisticPrompt: { type: 'string' },
      },
    },
  }, {
    config: {
      defaultProvider: 'codex',
      routes: [
        { agentType: 'vastitas-creator', provider: 'mock' },
      ],
    },
    adapters: {
      mock: async (request) => {
        seen.push(request)
        return {
          ok: true,
          runId: request.runId,
          provider: request.provider,
          phase: request.phase,
          label: request.label,
          durationMs: 1,
          attempts: 1,
          structured: true,
          data: { artisticPrompt: 'A vast scene.' },
          text: '',
          usage: {},
          artifacts: [],
          warnings: [],
        }
      },
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.provider, 'mock')
  assert.deepEqual(result.data, { artisticPrompt: 'A vast scene.' })
  assert.match(seen[0].prompt, /Agent Instructions/)
  assert.match(seen[0].prompt, /test creator agent/)
})

test('runAgent returns normalized error when adapter is missing', async () => {
  const result = await runAgent({
    workflow: 'generate-blog-image',
    phase: 'Create',
    label: 'create:iter1',
    cwd,
    prompt: 'Create a prompt.',
  }, {
    config: { defaultProvider: 'missing' },
    adapters: {},
  })

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'PROVIDER_NOT_FOUND')
})

test('runAgent returns normalized schema error when dry-run adapter data is invalid', async () => {
  const result = await runAgent({
    workflow: 'generate-blog-image',
    phase: 'Extract',
    label: 'extract-conflict',
    cwd,
    prompt: 'Extract.',
    dryRun: true,
    mockData: { slug: 123 },
    schema: {
      type: 'object',
      required: ['slug'],
      properties: { slug: { type: 'string' } },
    },
  }, {
    config: { defaultProvider: 'codex' },
    loadAgent: false,
  })

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'SCHEMA_VALIDATION_FAILED')
})

test('runAgent validates final adapter envelope before returning success', async () => {
  const result = await runAgent({
    workflow: 'generate-blog-image',
    phase: 'Extract',
    label: 'extract-conflict',
    cwd,
    prompt: 'Extract.',
    schema: {
      type: 'object',
      required: ['slug'],
      properties: { slug: { type: 'string' } },
    },
  }, {
    config: { defaultProvider: 'mock' },
    loadAgent: false,
    adapters: {
      mock: async (request) => ({
        ok: true,
        runId: request.runId,
        provider: request.provider,
        phase: request.phase,
        label: request.label,
        durationMs: 1,
        attempts: 1,
        structured: true,
        data: { slug: 123 },
        text: '',
        usage: {},
        artifacts: [],
        warnings: [],
      }),
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'SCHEMA_VALIDATION_FAILED')
})

test('runAgent retries recoverable failures then succeeds', async () => {
  let calls = 0
  const result = await runAgent({
    workflow: 'w', phase: 'Create', label: 'l', cwd, prompt: 'go', maxRetries: 2,
  }, {
    config: { defaultProvider: 'mock' },
    loadAgent: false,
    adapters: {
      mock: async (request) => {
        calls += 1
        if (calls < 3) {
          throw new BridgeError(ErrorCode.TIMEOUT, 'slow', { recoverable: true })
        }
        return successEnvelope(request)
      },
    },
  })

  assert.equal(result.ok, true)
  assert.equal(calls, 3)
  assert.equal(result.attempts, 3)
})

test('runAgent exhausts retries and returns normalized error with attempt count', async () => {
  let calls = 0
  const result = await runAgent({
    workflow: 'w', phase: 'Create', label: 'l', cwd, prompt: 'go', maxRetries: 1,
  }, {
    config: { defaultProvider: 'mock' },
    loadAgent: false,
    adapters: {
      mock: async () => {
        calls += 1
        throw new BridgeError(ErrorCode.PROCESS_EXIT_NONZERO, 'boom', {
          recoverable: true,
          details: { stderrTail: 'stack trace tail' },
        })
      },
    },
  })

  assert.equal(result.ok, false)
  assert.equal(calls, 2)
  assert.equal(result.attempts, 2)
  assert.equal(result.errorCode, 'PROCESS_EXIT_NONZERO')
  assert.equal(result.stderrTail, 'stack trace tail')
})

test('runAgent does not retry non-recoverable failures', async () => {
  let calls = 0
  const result = await runAgent({
    workflow: 'w', phase: 'Create', label: 'l', cwd, prompt: 'go', maxRetries: 5,
  }, {
    config: { defaultProvider: 'mock' },
    loadAgent: false,
    adapters: {
      mock: async () => {
        calls += 1
        throw new BridgeError(ErrorCode.AUTH_MISSING, 'no auth', { recoverable: false })
      },
    },
  })

  assert.equal(result.ok, false)
  assert.equal(calls, 1)
  assert.equal(result.attempts, 1)
})

test('runAgent returns normalized envelope when route selection fails', async () => {
  const result = await runAgent({
    workflow: 'w', phase: 'Create', label: 'l', cwd, prompt: 'go',
  }, {
    config: {},
    loadAgent: false,
    adapters: {},
  })

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'PROVIDER_NOT_FOUND')
  assert.equal(typeof result.runId, 'string')
})

test('runAgent propagates addDir and addDirs to adapter', async () => {
  let seenRequest
  const result = await runAgent({
    workflow: 'w',
    phase: 'Create',
    label: 'l',
    cwd,
    prompt: 'go',
    addDir: '/extra/dir',
    addDirs: ['/extra/dirs/1', '/extra/dirs/2'],
  }, {
    config: { defaultProvider: 'mock' },
    loadAgent: false,
    adapters: {
      mock: async (request) => {
        seenRequest = request
        return successEnvelope(request)
      },
    },
  })

  assert.equal(result.ok, true)
  assert.equal(seenRequest.addDir, '/extra/dir')
  assert.deepEqual(seenRequest.addDirs, ['/extra/dirs/1', '/extra/dirs/2'])
})

test('runAgent rejects schema requests for a provider that lacks structuredOutput', async () => {
  let dispatched = false
  const guardedAgy = {
    capabilities: agyAdapter.capabilities,
    run: async (request) => {
      dispatched = true
      return successEnvelope(request)
    },
  }

  const result = await runAgent({
    workflow: 'w', phase: 'Create', label: 'l', cwd, prompt: 'go',
    schema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
  }, {
    config: { defaultProvider: 'agy' },
    loadAgent: false,
    adapters: { agy: guardedAgy },
  })

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'UNSUPPORTED_SCHEMA')
  assert.equal(result.details.capability, 'structuredOutput')
  assert.equal(dispatched, false, 'capability check must reject before dispatch')
})

test('runAgent rejects sandbox requests for a provider that lacks sandbox', async () => {
  let dispatched = false
  const result = await runAgent({
    workflow: 'w', phase: 'Create', label: 'l', cwd, prompt: 'go', sandbox: 'workspace-write',
  }, {
    config: { defaultProvider: 'mock' },
    loadAgent: false,
    adapters: {
      mock: {
        capabilities: { structuredOutput: true, images: true, sandbox: false, skipPermissions: true },
        run: async (request) => {
          dispatched = true
          return successEnvelope(request)
        },
      },
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'UNSUPPORTED_SANDBOX')
  assert.equal(dispatched, false)
})

test('runAgent dispatches to an object-shaped adapter when capabilities are satisfied', async () => {
  let seenRequest
  const result = await runAgent({
    workflow: 'w', phase: 'Create', label: 'l', cwd, prompt: 'go', dangerouslySkipPermissions: true,
  }, {
    config: { defaultProvider: 'mock' },
    loadAgent: false,
    adapters: {
      mock: {
        capabilities: { structuredOutput: true, images: true, sandbox: true, skipPermissions: true },
        run: async (request) => {
          seenRequest = request
          return successEnvelope(request)
        },
      },
    },
  })

  assert.equal(result.ok, true)
  assert.equal(seenRequest.dangerouslySkipPermissions, true)
})

test('runAgent falls back to another compatible available provider when primary provider fails with eligible error', async () => {
  const result = await runAgent({
    workflow: 'w',
    phase: 'Create',
    label: 'l',
    cwd,
    prompt: 'go',
  }, {
    config: { defaultProvider: 'primary' },
    loadAgent: false,
    adapters: {
      primary: {
        capabilities: { structuredOutput: false, images: false, sandbox: false, skipPermissions: false },
        run: async (request) => {
          throw new BridgeError(ErrorCode.PROCESS_EXIT_NONZERO, 'Mock primary rate limit or crash', { recoverable: false })
        },
      },
      fallback: {
        capabilities: { structuredOutput: false, images: false, sandbox: false, skipPermissions: false },
        run: async (request) => {
          return {
            ok: true,
            runId: request.runId,
            provider: 'fallback',
            phase: request.phase,
            label: request.label,
            durationMs: 1,
            attempts: 1,
            structured: false,
            text: 'fallback success text',
            usage: {},
            artifacts: [],
            warnings: [],
          }
        },
      },
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.provider, 'fallback')
  assert.equal(result.text, 'fallback success text')
  assert.ok(result.warnings.some((w) => w.includes("Fallback triggered from 'primary' to 'fallback'")))
})

