import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runWorkflow } from '../src/workflows/workflow-executor.ts'
import { defaultAdapters } from '../src/adapters/registry.ts'
import { classifyFailure, DEFAULT_PROVIDERS, DEFAULT_TIMEOUT_MS } from './lib/live-validation.mjs'

const EXPECTED_MARKER = 'items[2]{name,score}:'
const PASS_TOKEN = 'OK_TOON'

const args = process.argv.slice(2)
const options = parseArgs(args)

if (options.help) {
  printHelp()
  process.exit(0)
}

const results = await runLiveToonContractValidations(options)

if (options.json) {
  console.log(JSON.stringify(results, null, 2))
} else {
  printTable(results)
}

process.exit(results.some((result) => !result.pass) ? 1 : 0)

export function parseArgs(argv) {
  const parsed = {
    providers: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      parsed.help = true
    } else if (arg === '--json') {
      parsed.json = true
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number(argv[index + 1])
      index += 1
    } else if (arg === '--providers') {
      parsed.providers.push(...splitProviders(argv[index + 1] || ''))
      index += 1
    } else if (arg === '--provider') {
      parsed.providers.push(argv[index + 1])
      index += 1
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      parsed.providers.push(...splitProviders(arg))
    }
  }

  parsed.providers = [...new Set(parsed.providers.filter(Boolean))]

  if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms: ${parsed.timeoutMs}`)
  }

  return parsed
}

export async function runLiveToonContractValidations(options = {}) {
  const providers = options.providers?.length ? options.providers : DEFAULT_PROVIDERS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const results = []

  for (const provider of providers) {
    results.push(await validateToonContractProvider({ provider, timeoutMs }))
  }

  return results
}

export async function validateToonContractProvider({ provider, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const startedAt = Date.now()
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `clibridge-toon-live-${provider}-`))

  try {
    if (!defaultAdapters[provider]) {
      return failureRow({
        provider,
        startedAt,
        status: 'unknown-provider',
        errorCode: 'PROVIDER_NOT_FOUND',
        detail: `Provider '${provider}' is not registered.`,
      })
    }

    const workflowPath = path.join(tempDir, 'toon-contract.workflow.json')
    const supportsSkipPermissions = Boolean(defaultAdapters[provider].capabilities.skipPermissions)
    fs.writeFileSync(workflowPath, JSON.stringify(buildWorkflow(provider, supportsSkipPermissions), null, 2))

    const result = await runWorkflow({
      workflowPath,
      cwd: process.cwd(),
      task: 'Validate that the workflow executor rendered inputs with the TOON contract format.',
      inputs: buildInputs(),
      contractFormat: 'toon',
      dangerouslySkipPermissions: supportsSkipPermissions,
      timeoutMs,
    }, {
      config: { defaultProvider: provider },
    })

    const text = compact(result.finalText)
    const pass = result.ok && isPassingText(text)

    if (pass) {
      return {
        provider,
        elapsedMs: Date.now() - startedAt,
        pass: true,
        status: 'ok',
        errorCode: null,
        detail: text,
        durationMs: result.phases[0]?.durationMs ?? Date.now() - startedAt,
        attempts: 1,
      }
    }

    const phase = result.phases.find((item) => !item.ok) || result.phases.at(-1)
    const detail = firstNonEmpty(result.error, phase?.error, text)
    return failureRow({
      provider,
      startedAt,
      status: result.ok ? 'unexpected-output' : classifyFailure({ errorCode: 'WORKFLOW_FAILED', message: detail }, detail),
      errorCode: result.ok ? null : 'WORKFLOW_FAILED',
      detail: result.ok ? `text=${JSON.stringify(text)}` : detail,
      durationMs: phase?.durationMs,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failureRow({
      provider,
      startedAt,
      status: classifyFailure({ errorCode: 'WORKFLOW_EXCEPTION', message }, message),
      errorCode: 'WORKFLOW_EXCEPTION',
      detail: message,
    })
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function buildWorkflow(provider, supportsSkipPermissions) {
  return {
    name: `toon-contract-live-${provider}`,
    contractFormat: 'toon',
    phases: [
      {
        name: 'verify-toon-contract',
        kind: 'agent',
        provider,
        ...(supportsSkipPermissions ? { skipPermissions: true } : {}),
        prompt: [
          'Validate the workflow context contract below.',
          `Reply exactly ${PASS_TOKEN} if the block is TOON and contains ${EXPECTED_MARKER}.`,
          'Reply exactly NOT_TOON otherwise.',
          '',
          '{{inputs}}',
        ].join('\n'),
      },
    ],
  }
}

function buildInputs() {
  return {
    items: [
      { name: 'alpha', score: 1 },
      { name: 'beta', score: 2 },
    ],
    expectedMarker: EXPECTED_MARKER,
  }
}

function isPassingText(text) {
  return text === PASS_TOKEN || (text.includes(PASS_TOKEN) && !text.includes('NOT_TOON'))
}

function failureRow({ provider, startedAt, status, errorCode, detail, durationMs }) {
  return {
    provider,
    elapsedMs: Date.now() - startedAt,
    pass: false,
    status,
    errorCode,
    detail: compact(detail),
    durationMs: durationMs ?? Date.now() - startedAt,
    attempts: 1,
  }
}

function printHelp() {
  console.log(`Usage:
  npm run live:toon-contract
  npm run live:toon-contract -- claude opencode
  npm run live:toon-contract -- --providers claude,codex,gemini --timeout-ms 120000
  npm run live:toon-contract -- --json

Runs real provider CLIs through runWorkflow with contractFormat: "toon".
This validates that each selected client receives and recognizes TOON-rendered
workflow context. It is an environment validation, not a deterministic unit test.`)
}

function printTable(rows) {
  const header = ['provider', 'status', 'pass', 'duration', 'attempts', 'detail']
  const widths = [12, 20, 6, 10, 8, 0]

  console.log(formatRow(header, widths))
  console.log(formatRow(header.map((label) => '-'.repeat(label.length)), widths))

  for (const row of rows) {
    console.log(formatRow([
      row.provider,
      row.status,
      row.pass ? 'yes' : 'no',
      `${row.elapsedMs}ms`,
      String(row.attempts),
      row.detail || row.errorCode || '',
    ], widths))
  }
}

function splitProviders(value) {
  return value.split(',').map((provider) => provider.trim()).filter(Boolean)
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || ''
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200)
}

function formatRow(values, widths) {
  return values.map((value, index) => {
    const text = String(value)
    return widths[index] ? text.padEnd(widths[index]) : text
  }).join('  ')
}
