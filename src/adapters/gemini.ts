import os from 'node:os'
import { BridgeError, ErrorCode } from '../broker/errors.ts'
import { normalizeSuccess, getExtraDirs } from './common.ts'
import { runProcess } from './process-runner.ts'
import type { AdapterFn, ProviderAdapter, RunProcessFn } from './contract.ts'
import type { ResolvedRequest, Envelope } from '../types.ts'

export const runGemini: AdapterFn = async (request: ResolvedRequest, runProcessFn: RunProcessFn = runProcess): Promise<Envelope> => {
  // Use agy (Antigravity CLI) as the engine for gemini provider, specifying a default Gemini model if none is requested.
  // Precedence: explicit request.model > GEMINI_MODEL env override > hardcoded fallback,
  // so a new default model can be rolled out via env without a code change.
  const model = request.model || process.env.GEMINI_MODEL || 'Gemini 3.5 Flash (High)'
  // agy's flag parser only binds the prompt as a positional argument when it
  // directly follows --print; placed after other flags it silently drops the
  // prompt and falls back to open-ended filesystem exploration.
  const args = ['--print', request.prompt, '--model', model]

  const extraDirs = getExtraDirs(request)
  for (const dirPath of extraDirs) {
    args.push('--add-dir', dirPath)
  }

  // Antigravity CLI uses --dangerously-skip-permissions instead of --yolo
  if (request.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions')

  // agy auto-indexes its process working directory as codebase context, so
  // running it inside the project dir causes it to explore the full repo even
  // when no --add-dir flag is given. When no explicit context dirs are
  // requested, use the home dir as a neutral cwd to avoid this.
  const processCwd = extraDirs.length > 0 ? request.cwd : os.homedir()

  const processResult = await runProcessFn('agy', args, {
    cwd: processCwd,
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

// skipPermissions is true: agy's unattended flag (--dangerously-skip-permissions) is wired above, so
// the broker may dispatch skip-permission requests and gemini auto-approves tool
// use and file edits in headless mode.
export const geminiAdapter: ProviderAdapter = {
  command: 'agy',
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

