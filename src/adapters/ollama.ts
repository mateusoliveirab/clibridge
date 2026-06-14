import { normalizeSuccess } from './common.ts'
import { runProcess } from './process-runner.ts'
import type { AdapterFn, ProviderAdapter, RunProcessFn } from './contract.ts'
import type { ResolvedRequest, Envelope } from '../types.ts'

export const runOllama: AdapterFn = async (request: ResolvedRequest, runProcessFn: RunProcessFn = runProcess): Promise<Envelope> => {
  const model = request.model || request.env?.OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'llama3'
  const args = ['run', model, request.prompt]

  const processResult = await runProcessFn('ollama', args, {
    cwd: request.cwd,
    env: request.env,
    timeoutMs: request.timeoutMs,
  })

  return normalizeSuccess(request, {
    text: processResult.stdout.trim(),
    durationMs: processResult.durationMs,
  })
}

export const ollamaAdapter: ProviderAdapter = {
  command: 'ollama',
  capabilities: { structuredOutput: false, images: false, sandbox: false, skipPermissions: false },
  run: runOllama,
}
