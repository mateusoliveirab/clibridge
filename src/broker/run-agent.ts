import { randomUUID } from 'node:crypto'
import { defaultAdapters } from '../adapters/registry.ts'
import { normalizeSuccess } from '../adapters/common.ts'
import { loadClaudeAgent } from '../claude/agent-loader.ts'
import { assemblePrompt } from '../claude/prompt-assembler.ts'
import { assertStructuredOutput, assertValidSchema } from './schema-validation.ts'
import { selectRoute } from './routing.ts'
import { requiredCapabilities, resolveAdapterEntry } from '../adapters/contract.ts'
import { assertProviderCommandAvailable, selectOnlyAvailableProviderForDemand, getAvailableProvidersForDemand } from '../adapters/availability.ts'
import type { AdapterEntry, ProviderAdapter, RequiredCapability } from '../adapters/contract.ts'
import { BridgeError, ErrorCode, errorEnvelope } from './errors.ts'
import { DEFAULT_TIMEOUT_MS, DEFAULT_ENV_ALLOWLIST } from '../config/constants.ts'
import type { AgentInput, BridgeConfig, Envelope, ResolvedRequest } from '../types.ts'

export interface RunAgentOptions {
  adapters?: Record<string, AdapterEntry>
  config?: BridgeConfig
  loadAgent?: boolean
  dangerouslySkipPermissions?: boolean
}

// Maps each required capability to the error raised when the chosen provider
// lacks it, so the broker fails fast with a precise code instead of letting the
// CLI fail opaquely downstream.
const CAPABILITY_ERROR: Record<RequiredCapability, { code: string; label: string }> = Object.freeze({
  structuredOutput: { code: ErrorCode.UNSUPPORTED_SCHEMA, label: 'structured JSON output' },
  images: { code: ErrorCode.UNSUPPORTED_ATTACHMENT, label: 'image attachments' },
  sandbox: { code: ErrorCode.UNSUPPORTED_SANDBOX, label: 'sandbox isolation' },
  skipPermissions: { code: ErrorCode.PERMISSION_DENIED, label: 'unattended skip-permissions' },
})

function assertProviderSupports(adapter: ProviderAdapter, request: ResolvedRequest): void {
  for (const capability of requiredCapabilities(request)) {
    if (adapter.capabilities[capability]) continue
    const { code, label } = CAPABILITY_ERROR[capability]
    throw new BridgeError(code, `Provider '${request.provider}' does not support ${label}.`, {
      details: { provider: request.provider, capability },
    })
  }
}

export async function runAgent(input: AgentInput, options: RunAgentOptions = {}): Promise<Envelope> {
  const startedAt = Date.now()
  const adapters: Record<string, AdapterEntry> = options.adapters || defaultAdapters

  // Minimal request so the catch can always build a normalized envelope, even
  // if route selection itself fails before the full request is assembled.
  let request: ResolvedRequest = { ...input, runId: input.runId || randomUUID() } as ResolvedRequest
  let attempts = 1

  try {
    const route = await selectRouteOrAvailableProvider(options.config || {}, input, adapters)
    const agent = options.loadAgent === false
      ? null
      : await maybeLoadAgent(input.cwd, input.agentType)

    request = {
      ...input,
      runId: request.runId,
      provider: route.provider,
      model: route.model || input.model,
      sandbox: route.sandbox || input.sandbox,
      timeoutMs: route.timeoutMs || input.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxRetries: route.maxRetries ?? input.maxRetries ?? 0,
      env: filterEnv(process.env, route.envAllowlist || input.envAllowlist || []),
      prompt: assemblePrompt({ prompt: input.prompt, agent }),
      dangerouslySkipPermissions: input.dangerouslySkipPermissions ?? options.dangerouslySkipPermissions ?? false,
    }

    assertValidSchema(request.schema)

    if (request.dryRun) {
      return normalizeSuccess(request, {
        data: request.mockData ?? {},
        text: request.mockText ?? '',
      })
    }

    const adapterEntry = adapters[request.provider]
    if (!adapterEntry) {
      throw new BridgeError(ErrorCode.PROVIDER_NOT_FOUND, `Provider '${request.provider}' is not registered.`, {
        details: { provider: request.provider },
      })
    }

    const adapter = resolveAdapterEntry(adapterEntry)

    // Reject requests the chosen provider can't satisfy (e.g. a schema for a
    // text-only CLI) before dispatch, with a precise UNSUPPORTED_* code.
    assertProviderSupports(adapter, request)
    await assertProviderCommandAvailable(request.provider, adapterEntry)

    // Retry recoverable failures (timeout, non-zero exit, parse/schema misses)
    // up to maxRetries times. Non-recoverable errors fail immediately.
    const maxAttempts = request.maxRetries + 1
    let executionError: unknown = null
    for (attempts = 1; ; attempts++) {
      try {
        const result = await adapter.run(request)
        if (result?.ok && request.schema) {
          assertStructuredOutput(request.schema, result.data)
        }
        return result?.ok ? { ...result, attempts } : result
      } catch (error) {
        const recoverable = error instanceof BridgeError && error.recoverable
        if (!recoverable || attempts >= maxAttempts) {
          executionError = error
          break
        }
      }
    }

    // If execution failed, try fallback providers before throwing
    if (executionError) {
      const candidates = await getAvailableProvidersForDemand(input, adapters)
      const fallbacks = candidates.filter((p) => p !== request.provider)

      const eligibleCodes: string[] = [
        ErrorCode.PROVIDER_UNAVAILABLE,
        ErrorCode.TIMEOUT,
        ErrorCode.PROCESS_EXIT_NONZERO,
        ErrorCode.OUTPUT_PARSE_FAILED,
        ErrorCode.RATE_LIMITED,
        ErrorCode.UNKNOWN_PROVIDER_ERROR,
      ]

      const isEligibleForFallback = executionError instanceof BridgeError && eligibleCodes.includes(executionError.code)

      if (isEligibleForFallback && fallbacks.length > 0) {
        let lastError: any = executionError
        for (const fallbackProvider of fallbacks) {
          try {
            const fallbackAdapterEntry = adapters[fallbackProvider]
            const fallbackAdapter = resolveAdapterEntry(fallbackAdapterEntry)
            const fallbackRequest = {
              ...request,
              provider: fallbackProvider,
              model: undefined, // Let fallback use its default model
            }

            await assertProviderCommandAvailable(fallbackProvider, fallbackAdapterEntry)

            const fMaxAttempts = fallbackRequest.maxRetries + 1
            for (let fAttempts = 1; ; fAttempts++) {
              try {
                const result = await fallbackAdapter.run(fallbackRequest)
                if (result?.ok && fallbackRequest.schema) {
                  assertStructuredOutput(fallbackRequest.schema, result.data)
                }
                if (result?.ok) {
                  result.warnings = result.warnings || []
                  result.warnings.push(
                    `Fallback triggered from '${request.provider}' to '${fallbackProvider}' due to error: ${(executionError as Error).message}`
                  )
                  return { ...result, attempts: attempts + fAttempts }
                }
                return result
              } catch (fError) {
                const recoverable = fError instanceof BridgeError && fError.recoverable
                if (!recoverable || fAttempts >= fMaxAttempts) throw fError
              }
            }
          } catch (fError) {
            lastError = fError
          }
        }
        throw lastError
      } else {
        throw executionError
      }
    }

    throw executionError || new Error('Unexpected end of agent execution loop')
  } catch (error) {
    return errorEnvelope(error, request, {
      durationMs: Date.now() - startedAt,
      attempts,
    })
  }
}

async function selectRouteOrAvailableProvider(
  config: BridgeConfig,
  input: AgentInput,
  adapters: Record<string, AdapterEntry>,
) {
  try {
    return selectRoute(config, input)
  } catch (error) {
    if (!(error instanceof BridgeError) || error.code !== ErrorCode.PROVIDER_NOT_FOUND) throw error
    return {
      provider: await selectOnlyAvailableProviderForDemand(input, adapters),
    }
  }
}

async function maybeLoadAgent(cwd: string, agentType?: string) {
  if (!cwd || !agentType) return null

  try {
    return await loadClaudeAgent(cwd, agentType)
  } catch {
    return null
  }
}

function filterEnv(env: NodeJS.ProcessEnv, allowlist: string[]): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {}

  for (const key of DEFAULT_ENV_ALLOWLIST) {
    next[key] = env[key]
  }

  for (const key of allowlist) {
    if (env[key] !== undefined) next[key] = env[key]
  }

  return next
}
