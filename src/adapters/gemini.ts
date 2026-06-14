import { BridgeError, ErrorCode } from '../broker/errors.ts'
import { normalizeSuccess, getExtraDirs } from './common.ts'
import { runProcess } from './process-runner.ts'
import type { AdapterFn, ProviderAdapter, RunProcessFn } from './contract.ts'
import type { ResolvedRequest, Envelope } from '../types.ts'

export const runGemini: AdapterFn = async (request: ResolvedRequest, runProcessFn: RunProcessFn = runProcess): Promise<Envelope> => {
  const args = ['--prompt', request.prompt, '--output-format', request.schema ? 'json' : 'text']
  if (request.model) args.push('--model', request.model)

  for (const dirPath of getExtraDirs(request)) {
    args.push('--include-directories', dirPath)
  }

  // Unattended auto-approval so gemini can run tools / write files in headless
  // mode. Only emitted when the request explicitly opts in.
  if (request.dangerouslySkipPermissions) args.push('--yolo')

  const processResult = await runProcessFn('gemini', args, {
    cwd: request.cwd,
    env: request.env,
    timeoutMs: request.timeoutMs,
  })

  if (!request.schema) {
    return normalizeSuccess(request, {
      text: processResult.stdout.trim(),
      durationMs: processResult.durationMs,
    })
  }

  const data = parseGeminiStructuredResponse(processResult.stdout)
  return normalizeSuccess(request, {
    data,
    durationMs: processResult.durationMs,
  })
}

// skipPermissions is true: gemini's unattended flag (--yolo) is wired above, so
// the broker may dispatch skip-permission requests and gemini auto-approves tool
// use and file edits in headless mode.
export const geminiAdapter: ProviderAdapter = {
  command: 'gemini',
  capabilities: { structuredOutput: true, images: false, sandbox: false, skipPermissions: true },
  run: runGemini,
}

function parseGeminiStructuredResponse(stdout: string): unknown {
  let envelope: unknown
  try {
    envelope = JSON.parse(stdout)
  } catch (error) {
    throw new BridgeError(ErrorCode.OUTPUT_PARSE_FAILED, `Gemini JSON envelope parse failed: ${(error as Error).message}`, {
      recoverable: true,
      cause: error as Error,
    })
  }

  // envelope is parsed JSON — cast to access properties
  const env = envelope as Record<string, unknown>
  const response = env.response ?? env.text ?? env.output
  if (typeof response === 'object' && response !== null) return response
  if (typeof response !== 'string') return envelope

  try {
    return JSON.parse(response)
  } catch (error) {
    throw new BridgeError(ErrorCode.OUTPUT_PARSE_FAILED, `Gemini response payload parse failed: ${(error as Error).message}`, {
      recoverable: true,
      cause: error as Error,
    })
  }
}
