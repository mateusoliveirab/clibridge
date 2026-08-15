import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { runAgent } from '../src/index.ts'

// Ad-hoc single-agent CLI entrypoint for non-MCP callers (e.g. a Python daemon
// shelling out via subprocess). Prints the envelope JSON to stdout.
//
// Usage:
//   tsx scripts/run-agent-adhoc.mjs --prompt "..." --provider claude --model claude-sonnet-4-6 \
//     [--attachment /path/to/image.png ...] [--timeout-ms 90000] [--cwd /path] \
//     [--access read-only] [--env-allowlist NAME ...] [--disable-fallback] \
//     [--dangerously-skip-permissions]

export function parseAdhocArgs(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      prompt: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      phase: { type: 'string', default: 'agent' },
      label: { type: 'string', default: 'adhoc:1' },
      cwd: { type: 'string', default: process.cwd() },
      access: { type: 'string' },
      attachment: { type: 'string', multiple: true },
      'env-allowlist': { type: 'string', multiple: true },
      'timeout-ms': { type: 'string', default: '120000' },
      'disable-fallback': { type: 'boolean', default: false },
      'dangerously-skip-permissions': { type: 'boolean', default: false },
    },
  })

  if (!values.prompt) {
    throw new Error('--prompt is required')
  }

  return values
}

export function buildAdhocInput(args) {
  return {
    workflow: 'adhoc',
    phase: args.phase,
    label: args.label,
    cwd: args.cwd,
    prompt: args.prompt,
    provider: args.provider,
    model: args.model,
    access: args.access,
    attachments: (args.attachment ?? []).map((path) => ({ type: 'image', path })),
    envAllowlist: args['env-allowlist'] ?? [],
    timeoutMs: Number(args['timeout-ms']),
    disableFallback: args['disable-fallback'],
    dangerouslySkipPermissions: args['dangerously-skip-permissions'],
  }
}

export async function runAdhoc(argv = process.argv.slice(2), runAgentFn = runAgent) {
  const args = parseAdhocArgs(argv)
  return runAgentFn(buildAdhocInput(args), { loadAgent: false })
}

async function main() {
  try {
    const result = await runAdhoc()
    console.log(JSON.stringify(result))
    process.exitCode = result.ok ? 0 : 1
  } catch (error) {
    console.error(JSON.stringify({ ok: false, message: error.message }))
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
