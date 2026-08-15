import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { runWorkflow } from '../src/workflows/workflow-executor.ts'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-workflow-executor-'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function gitInit(dir) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
}

test('runWorkflow executes read-files, policy, agent dry-run, and shell dry-run phases', async () => {
  const dir = tempDir()
  try {
    fs.writeFileSync(path.join(dir, 'CONTRIBUTING.md'), 'Bug fixes need tests.')
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'test-workflow',
      inputDefaults: {
        changeType: 'bugfix',
      },
      phases: [
        {
          name: 'rules',
          kind: 'read-files',
          files: ['CONTRIBUTING.md'],
        },
        {
          name: 'policy',
          kind: 'policy',
          assertions: [
            {
              input: 'changeType',
              notIn: ['refactor-only'],
              message: 'blocked',
            },
          ],
        },
        {
          name: 'plan',
          kind: 'agent',
          prompt: 'Task={{task}}\nRules={{results.rules}}\nType={{inputs.changeType}}',
          mockText: 'planned',
        },
        {
          name: 'validate',
          kind: 'shell',
          commands: ['npm test'],
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'fix a bug',
      dryRun: true,
      inputs: {},
    })

    assert.equal(result.ok, true)
    assert.equal(result.workflow, 'test-workflow')
    assert.equal(result.results.plan, 'planned')
    assert.match(result.results.rules, /Bug fixes need tests/)
    assert.equal(result.results.validate, '[dry-run] npm test')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow can execute an explicitly safe shell phase during dry-run', async () => {
  const dir = tempDir()
  try {
    fs.writeFileSync(path.join(dir, 'required.txt'), 'present')
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'safe-preflight-workflow',
      phases: [{
        name: 'preflight',
        kind: 'shell',
        runInDryRun: true,
        command: 'test -s required.txt',
      }],
    })

    const result = await runWorkflow({ workflowPath, cwd: dir, task: 'preflight', dryRun: true })
    assert.equal(result.ok, true)
    assert.match(result.results.preflight, /\$ test -s required\.txt/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow validates schema-compatible mockData during dry-run', async () => {
  const dir = tempDir()
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'mock-data-workflow',
      phases: [
        {
          name: 'plan',
          kind: 'agent',
          provider: 'codex',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { status: { type: 'string' } },
            required: ['status'],
          },
          mockData: { status: 'ok' },
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'dry-run with structured data',
      dryRun: true,
    })

    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(result.results.plan), { status: 'ok' })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('write-file publishes a structured field inside the allowed path without a git repository', async () => {
  const dir = tempDir()
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'controlled-publish-workflow',
      phases: [
        {
          name: 'draft',
          kind: 'agent',
          provider: 'mock',
          schema: {
            type: 'object',
            required: ['report_markdown'],
            properties: { report_markdown: { type: 'string' } },
          },
        },
        {
          name: 'publish',
          kind: 'write-file',
          access: 'workspace-write',
          allowedWritePaths: ['reports/**'],
          file: 'reports/result.md',
          sourceResult: 'draft',
          sourceField: 'report_markdown',
        },
      ],
    })

    const result = await runWorkflow({ workflowPath, cwd: dir, task: 'publish' }, {
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
          data: { report_markdown: '# controlled report' },
          text: '',
          usage: {},
          artifacts: [],
          warnings: [],
        }),
      },
    })

    assert.equal(result.ok, true)
    assert.equal(fs.readFileSync(path.join(dir, 'reports', 'result.md'), 'utf8'), '# controlled report\n')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('write-file rejects a path outside cwd before writing', async () => {
  const dir = tempDir()
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'reject-escape-workflow',
      phases: [{
        name: 'publish',
        kind: 'write-file',
        access: 'workspace-write',
        allowedWritePaths: ['reports/**'],
        file: '../escaped.md',
        sourceResult: 'draft',
      }],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'reject escape',
      inputs: {},
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /cannot write outside cwd/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('write-file rejects a symlink path that resolves outside cwd', async () => {
  const dir = tempDir()
  const outside = tempDir()
  try {
    fs.symlinkSync(outside, path.join(dir, 'reports'), 'dir')
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'reject-symlink-escape-workflow',
      phases: [
        {
          name: 'draft',
          kind: 'agent',
          provider: 'mock',
        },
        {
          name: 'publish',
          kind: 'write-file',
          access: 'workspace-write',
          allowedWritePaths: ['reports/**'],
          file: 'reports/result.md',
          sourceResult: 'draft',
        },
      ],
    })

    const result = await runWorkflow({ workflowPath, cwd: dir, task: 'reject symlink escape' }, {
      adapters: {
        mock: async (request) => ({
          ok: true,
          runId: request.runId,
          provider: request.provider,
          phase: request.phase,
          label: request.label,
          durationMs: 1,
          attempts: 1,
          structured: false,
          text: '# escaped report',
          usage: {},
          artifacts: [],
          warnings: [],
        }),
      },
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /cannot write outside cwd/)
    assert.equal(fs.existsSync(path.join(outside, 'result.md')), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('runWorkflow returns ok=false when a policy assertion rejects inputs', async () => {
  const dir = tempDir()
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'policy-workflow',
      phases: [
        {
          name: 'policy',
          kind: 'policy',
          assertions: [
            {
              input: 'changeType',
              notIn: ['refactor-only'],
              message: 'refactor-only is blocked',
            },
          ],
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'cleanup only',
      inputs: {
        changeType: 'refactor-only',
      },
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /refactor-only is blocked/)
    assert.equal(result.phases[0].name, 'policy')
    assert.equal(result.phases[0].ok, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow executes shell phases when dryRun is false', async () => {
  const dir = tempDir()
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'shell-workflow',
      phases: [
        {
          name: 'validate',
          kind: 'shell',
          command: 'node -e "console.log(\\"shell-ok\\")"',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'validate',
    })

    assert.equal(result.ok, true)
    assert.match(result.results.validate, /shell-ok/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow renders template variables in shell commands', async () => {
  const dir = tempDir()
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'template-shell-workflow',
      phases: [
        {
          name: 'validate',
          kind: 'shell',
          command: 'node -e "console.log(\\"{{inputs.filename}}:{{task}}\\")"',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'say hello',
      inputs: {
        filename: 'greetings.txt',
      },
    })

    assert.equal(result.ok, true)
    assert.match(result.results.validate, /greetings.txt:say hello/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow renders agent contract objects as TOON when requested', async () => {
  const dir = tempDir()
  const prompts = []
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'toon-contract-workflow',
      phases: [
        {
          name: 'plan',
          kind: 'agent',
          provider: 'mock',
          prompt: 'Inputs:\n{{inputs}}',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'contract',
      inputs: {
        changeType: 'feature',
        publishTarget: 'pr',
      },
      contractFormat: 'toon',
    }, {
      adapters: {
        mock: async (request) => {
          prompts.push(request.prompt)
          return {
            ok: true,
            runId: request.runId,
            provider: request.provider,
            phase: request.phase,
            label: request.label,
            durationMs: 1,
            attempts: 1,
            structured: false,
            text: 'ok',
            usage: {},
            artifacts: [],
            warnings: [],
          }
        },
      },
    })

    assert.equal(result.ok, true)
    assert.match(prompts[0], /changeType: feature/)
    assert.match(prompts[0], /publishTarget: pr/)
    assert.doesNotMatch(prompts[0], /"changeType"/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow stores structured phase results using the selected contract format', async () => {
  const dir = tempDir()
  const prompts = []
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'structured-toon-contract',
      contractFormat: 'toon',
      phases: [
        {
          name: 'extract',
          kind: 'agent',
          provider: 'mock',
          schema: {
            type: 'object',
            required: ['items'],
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'score'],
                  properties: {
                    name: { type: 'string' },
                    score: { type: 'number' },
                  },
                },
              },
            },
          },
          prompt: 'extract',
        },
        {
          name: 'review',
          kind: 'agent',
          provider: 'mock',
          prompt: 'Previous:\n{{results.extract}}',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'contract',
    }, {
      adapters: {
        mock: async (request) => {
          prompts.push(request.prompt)
          if (request.phase === 'extract') {
            return {
              ok: true,
              runId: request.runId,
              provider: request.provider,
              phase: request.phase,
              label: request.label,
              durationMs: 1,
              attempts: 1,
              structured: true,
              data: {
                items: [
                  { name: 'alpha', score: 1 },
                  { name: 'beta', score: 2 },
                ],
              },
              text: '',
              usage: {},
              artifacts: [],
              warnings: [],
            }
          }
          return {
            ok: true,
            runId: request.runId,
            provider: request.provider,
            phase: request.phase,
            label: request.label,
            durationMs: 1,
            attempts: 1,
            structured: false,
            text: 'reviewed',
            usage: {},
            artifacts: [],
            warnings: [],
          }
        },
      },
    })

    assert.equal(result.ok, true)
    assert.match(result.results.extract, /items\[2\]\{name,score\}:/)
    assert.match(result.results.extract, /alpha,1/)
    assert.match(prompts[1], /items\[2\]\{name,score\}:/)
    assert.doesNotMatch(prompts[1], /"items"/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow forwards timeoutMs to agent phases', async () => {
  const dir = tempDir()
  const requests = []
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'timeout-workflow',
      phases: [
        {
          name: 'plan',
          kind: 'agent',
          provider: 'mock',
          prompt: 'plan',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'timeout',
      timeoutMs: 12345,
    }, {
      adapters: {
        mock: async (request) => {
          requests.push(request)
          return {
            ok: true,
            runId: request.runId,
            provider: request.provider,
            phase: request.phase,
            label: request.label,
            durationMs: 1,
            attempts: 1,
            structured: false,
            text: 'ok',
            usage: {},
            artifacts: [],
            warnings: [],
          }
        },
      },
    })

    assert.equal(result.ok, true)
    assert.equal(requests[0].timeoutMs, 12345)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow blocks dangerous permissions unless explicitly allowed', async () => {
  const dir = tempDir()
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'dangerous-permissions-workflow',
      phases: [
        {
          name: 'research',
          kind: 'agent',
          provider: 'mock',
          prompt: 'research only',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'research',
      dangerouslySkipPermissions: true,
    }, {
      adapters: {
        mock: async () => {
          throw new Error('should not dispatch')
        },
      },
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /does not set allowDangerousPermissions=true/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow forwards dangerous permissions when phase opts in', async () => {
  const dir = tempDir()
  let seenRequest
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'dangerous-permissions-opt-in',
      phases: [
        {
          name: 'apply',
          kind: 'agent',
          provider: 'mock',
          access: 'workspace-write',
          allowDangerousPermissions: true,
          prompt: 'apply',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'apply',
      dangerouslySkipPermissions: true,
    }, {
      adapters: {
        mock: async (request) => {
          seenRequest = request
          return {
            ok: true,
            runId: request.runId,
            provider: request.provider,
            phase: request.phase,
            label: request.label,
            durationMs: 1,
            attempts: 1,
            structured: false,
            text: 'ok',
            usage: {},
            artifacts: [],
            warnings: [],
          }
        },
      },
    })

    assert.equal(result.ok, true)
    assert.equal(seenRequest.dangerouslySkipPermissions, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow detects writes from a read-only agent phase in git repos', async () => {
  const dir = tempDir()
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo)
  gitInit(repo)
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'read-only-guard',
      phases: [
        {
          name: 'research',
          kind: 'agent',
          provider: 'mock',
          prompt: 'research',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: repo,
      task: 'research',
    }, {
      adapters: {
        mock: async (request) => {
          fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
          fs.writeFileSync(path.join(repo, 'src', 'adapters.ts'), 'changed')
          return {
            ok: true,
            runId: request.runId,
            provider: request.provider,
            phase: request.phase,
            label: request.label,
            durationMs: 1,
            attempts: 1,
            structured: false,
            text: 'ok',
            usage: {},
            artifacts: [],
            warnings: [],
          }
        },
      },
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /read-only phase changed files/)
    assert.match(result.error, /src\/adapters\.ts/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow rejects an unsandboxed read-only agent before dispatch outside a git repository', async () => {
  const dir = tempDir()
  let dispatched = false
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'non-git-read-only-guard',
      phases: [{ name: 'research', kind: 'agent', provider: 'mock', prompt: 'research' }],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'research',
    }, {
      adapters: {
        mock: {
          capabilities: { structuredOutput: true, images: true, sandbox: false, skipPermissions: true },
          run: async () => {
            dispatched = true
            throw new Error('must not dispatch')
          },
        },
      },
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /UNSUPPORTED_SANDBOX/)
    assert.equal(dispatched, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow reports read-only writes even when the agent phase fails', async () => {
  const dir = tempDir()
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo)
  gitInit(repo)
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'read-only-failed-guard',
      phases: [
        {
          name: 'research',
          kind: 'agent',
          provider: 'mock',
          prompt: 'research',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: repo,
      task: 'research',
    }, {
      adapters: {
        mock: async () => {
          fs.writeFileSync(path.join(repo, 'unexpected.ts'), 'changed')
          throw new Error('provider failed')
        },
      },
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /read-only phase changed files/)
    assert.match(result.error, /unexpected\.ts/)
    assert.match(result.error, /Original phase error: research failed: UNKNOWN_PROVIDER_ERROR provider failed/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow detects read-only writes laundered through a git commit', async () => {
  const dir = tempDir()
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo)
  gitInit(repo)
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo, stdio: 'ignore' })
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed')
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: repo, stdio: 'ignore' })
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'read-only-commit-guard',
      phases: [
        {
          name: 'research',
          kind: 'agent',
          provider: 'mock',
          prompt: 'research',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: repo,
      task: 'research',
    }, {
      adapters: {
        mock: async (request) => {
          fs.writeFileSync(path.join(repo, 'smuggled.ts'), 'changed')
          execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' })
          execFileSync('git', ['commit', '-m', 'hide the edit'], { cwd: repo, stdio: 'ignore' })
          return {
            ok: true,
            runId: request.runId,
            provider: request.provider,
            phase: request.phase,
            label: request.label,
            durationMs: 1,
            attempts: 1,
            structured: false,
            text: 'ok',
            usage: {},
            artifacts: [],
            warnings: [],
          }
        },
      },
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /read-only phase changed files/)
    assert.match(result.error, /smuggled\.ts/)
    assert.match(result.error, /<git HEAD moved>/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow detects read-only writes laundered through git stash', async () => {
  const dir = tempDir()
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo)
  gitInit(repo)
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo, stdio: 'ignore' })
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed')
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: repo, stdio: 'ignore' })
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'read-only-stash-guard',
      phases: [
        {
          name: 'research',
          kind: 'agent',
          provider: 'mock',
          prompt: 'research',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: repo,
      task: 'research',
    }, {
      adapters: {
        mock: async (request) => {
          fs.writeFileSync(path.join(repo, 'seed.txt'), 'tampered')
          execFileSync('git', ['stash', 'push', '-m', 'hide the edit'], { cwd: repo, stdio: 'ignore' })
          return {
            ok: true,
            runId: request.runId,
            provider: request.provider,
            phase: request.phase,
            label: request.label,
            durationMs: 1,
            attempts: 1,
            structured: false,
            text: 'ok',
            usage: {},
            artifacts: [],
            warnings: [],
          }
        },
      },
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /read-only phase changed files/)
    assert.match(result.error, /<git stash changed>/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runWorkflow allows workspace writes inside allowedWritePaths', async () => {
  const dir = tempDir()
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo)
  gitInit(repo)
  try {
    const workflowPath = path.join(dir, 'workflow.json')
    writeJson(workflowPath, {
      name: 'allowed-write-guard',
      phases: [
        {
          name: 'synthesis',
          kind: 'agent',
          provider: 'mock',
          access: 'workspace-write',
          allowedWritePaths: ['docs/research/**'],
          prompt: 'write synthesis',
        },
      ],
    })

    const result = await runWorkflow({
      workflowPath,
      cwd: repo,
      task: 'write synthesis',
    }, {
      adapters: {
        mock: async (request) => {
          fs.mkdirSync(path.join(repo, 'docs', 'research'), { recursive: true })
          fs.writeFileSync(path.join(repo, 'docs', 'research', 'out.md'), 'ok')
          return {
            ok: true,
            runId: request.runId,
            provider: request.provider,
            phase: request.phase,
            label: request.label,
            durationMs: 1,
            attempts: 1,
            structured: false,
            text: 'ok',
            usage: {},
            artifacts: [],
            warnings: [],
          }
        },
      },
    })

    assert.equal(result.ok, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Headroom workflow blocks architecture PR work without issue or maintainer approval', async () => {
  const dir = tempDir()
  try {
    fs.writeFileSync(path.join(dir, 'CONTRIBUTING.md'), 'Feature work is issue-first.')
    const workflowPath = path.resolve('examples/headroom-contribution.workflow.json')

    const result = await runWorkflow({
      workflowPath,
      cwd: dir,
      task: 'propose architecture change',
      dryRun: true,
      inputs: {
        changeType: 'architecture',
        publishTarget: 'pr',
      },
    })

    assert.equal(result.ok, false)
    assert.match(result.error, /requires an issue or maintainer approval/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
