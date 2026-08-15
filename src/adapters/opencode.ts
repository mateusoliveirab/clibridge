import { normalizeSuccess, getExtraDirs } from './common.ts'
import { runProcess } from './process-runner.ts'
import type { AdapterFn, ProviderAdapter, RunProcessFn } from './contract.ts'
import type { ResolvedRequest, Envelope } from '../types.ts'

export const runOpenCode: AdapterFn = async (request: ResolvedRequest, runProcessFn: RunProcessFn = runProcess): Promise<Envelope> => {
  const args = ['run', '--dir', request.cwd, '--format', 'json']
  if (request.model) args.push('--model', request.model)
  if (request.agentType) args.push('--agent', request.agentType)

  for (const dirPath of getExtraDirs(request)) {
    args.push('--add-dir', dirPath)
  }

  if (request.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions')

  // OpenCode's variadic positional `message` parser consumes values after a
  // repeated `--file` flag. Put the prompt first, then append attachments so
  // the prompt is not misread as a second file path.
  args.push(request.prompt)

  for (const attachment of request.attachments || []) {
    args.push('--file', attachment.path)
  }

  const processResult = await runProcessFn('opencode', args, {
    cwd: request.cwd,
    env: request.env,
    timeoutMs: request.timeoutMs,
  })

  const { text, data } = parseOpenCodeOutput(processResult.stdout)

  return normalizeSuccess(request, {
    data: request.schema ? data : undefined,
    text: request.schema ? '' : text,
    durationMs: processResult.durationMs,
  })
}

export const opencodeAdapter: ProviderAdapter = {
  command: 'opencode',
  capabilities: { structuredOutput: true, images: true, sandbox: false, skipPermissions: true },
  run: runOpenCode,
}

interface ParsedOutput {
  text: string
  data: unknown
}

// opencode --format json emits a JSONL event stream. Assistant text lives in
// `part.text` of `type: "text"` events, which may be split across several
// parts; concatenate them in order. Falls back to the raw stdout if no text
// event is found. For schema requests the joined text is the JSON payload.
export function parseOpenCodeOutput(stdout: string): ParsedOutput {
  const events: unknown[] = []
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // Skip non-JSON lines; the stream may interleave plain log output.
    }
  }

  const chunks = events.map(textOf).filter(Boolean)
  const text = chunks.length ? chunks.join('') : stdout.trim()

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = undefined
  }

  return { text, data }
}

function textOf(event: unknown): string {
  // event is an opaque JSON object — cast to access fields
  const e = event as Record<string, unknown>
  if (typeof e.text === 'string') return e.text
  if (e.part && typeof (e.part as Record<string, unknown>).text === 'string') {
    return (e.part as Record<string, unknown>).text as string
  }
  if (typeof e.message === 'string') return e.message
  if (typeof e.output === 'string') return e.output
  return ''
}
