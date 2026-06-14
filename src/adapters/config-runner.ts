import { normalizeSuccess, getExtraDirs } from './common.ts'
import { runProcess } from './process-runner.ts'
import type { ProviderAdapter, RunProcessFn } from './contract.ts'
import type { ResolvedRequest } from '../types.ts'
import type { CliAdapterConfig, ArgToken, OutputParser } from './config-types.ts'

export function resolveTemplateArgs(tokens: ArgToken[], request: ResolvedRequest): string[] {
  const result: string[] = []

  for (const token of tokens) {
    if ('lit' in token) {
      result.push(token.lit)
    } else if ('flag' in token) {
      if ('repeat' in token) {
        if (token.repeat === 'extraDirs') {
          const dirs = getExtraDirs(request)
          for (const dir of dirs) {
            result.push(token.flag, dir)
          }
        } else if (token.repeat === 'attachments') {
          for (const attachment of request.attachments || []) {
            if (attachment.path) {
              result.push(token.flag, attachment.path)
            }
          }
        }
      } else if ('var' in token) {
        const val = (request as any)[token.var]
        if (val !== undefined && val !== null && val !== '') {
          result.push(token.flag, String(val))
        }
      }
    } else if ('when' in token) {
      if ((request as any)[token.when]) {
        result.push(...token.emit)
      }
    } else if ('var' in token) {
      let val: string | undefined
      if (token.var === 'model') {
        const envVal = token.env ? (request.env?.[token.env] || process.env[token.env]) : undefined
        val = request.model || envVal || token.default
      } else if (token.var === 'prompt') {
        val = request.prompt || token.default
      } else if (token.var === 'cwd') {
        val = request.cwd || token.default
      }
      if (val !== undefined) {
        result.push(val)
      }
    }
  }

  return result
}

export function parseOutput(stdout: string, parser: OutputParser): string {
  if (parser.type === 'raw') {
    return parser.trim ? stdout.trim() : stdout
  }
  return stdout
}

export function createConfigAdapter(config: CliAdapterConfig): ProviderAdapter {
  return {
    command: config.command,
    capabilities: config.capabilities,
    run: async (request: ResolvedRequest, runProcessFn: RunProcessFn = runProcess) => {
      const args = resolveTemplateArgs(config.args, request)

      const processResult = await runProcessFn(config.command, args, {
        cwd: request.cwd,
        env: request.env,
        timeoutMs: request.timeoutMs,
      })

      const text = parseOutput(processResult.stdout, config.output)

      return normalizeSuccess(request, {
        text,
        durationMs: processResult.durationMs,
      })
    },
  }
}
