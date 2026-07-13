import { parseArgs } from 'node:util'
import { runAgent } from '../src/index.ts'

// Ad-hoc single-agent CLI entrypoint for non-MCP callers (e.g. a Python daemon
// shelling out via subprocess). Prints the envelope JSON to stdout.
//
// Usage:
//   tsx scripts/run-agent-adhoc.mjs --prompt "..." --provider claude --model claude-sonnet-4-6 \
//     [--timeout-ms 90000] [--cwd /path] [--access read-only] [--dangerously-skip-permissions]

let args
try {
  ({ values: args } = parseArgs({
    options: {
      prompt: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      phase: { type: 'string', default: 'agent' },
      label: { type: 'string', default: 'adhoc:1' },
      cwd: { type: 'string', default: process.cwd() },
      access: { type: 'string' },
      'timeout-ms': { type: 'string', default: '120000' },
      'dangerously-skip-permissions': { type: 'boolean', default: false },
    },
  }))
} catch (error) {
  console.error(JSON.stringify({ ok: false, message: error.message }))
  process.exit(1)
}

if (!args.prompt) {
  console.error(JSON.stringify({ ok: false, message: '--prompt is required' }))
  process.exit(1)
}

const input = {
  workflow: 'adhoc',
  phase: args.phase,
  label: args.label,
  cwd: args.cwd,
  prompt: args.prompt,
  provider: args.provider,
  model: args.model,
  access: args.access,
  timeoutMs: Number(args['timeout-ms']),
  dangerouslySkipPermissions: args['dangerously-skip-permissions'],
}

const result = await runAgent(input, { loadAgent: false })
console.log(JSON.stringify(result))
process.exit(result.ok ? 0 : 1)
