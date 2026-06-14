import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { BridgeError, ErrorCode } from '../broker/errors.ts'
import { requiredCapabilities, resolveAdapterEntry } from './contract.ts'
import type { AdapterEntry, ProviderCapabilities } from './contract.ts'
import type { AgentInput } from '../types.ts'

const execFileAsync = promisify(execFile)

export interface ProviderStatus {
  provider: string
  available: boolean | null
  command?: string
  path?: string
  capabilities: ProviderCapabilities
}

export async function commandPath(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('sh', ['-lc', `command -v ${shellQuote(command)}`], {
      timeout: 5000,
    })
    return stdout.trim().split('\n')[0] || null
  } catch {
    return null
  }
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  return Boolean(await commandPath(command))
}

export async function providerStatus(provider: string, entry: AdapterEntry): Promise<ProviderStatus> {
  const adapter = resolveAdapterEntry(entry)
  const path = adapter.command ? await commandPath(adapter.command) : null

  return {
    provider,
    command: adapter.command,
    available: adapter.command ? Boolean(path) : null,
    path: path || undefined,
    capabilities: adapter.capabilities,
  }
}

export async function providerStatuses(adapters: Record<string, AdapterEntry>): Promise<ProviderStatus[]> {
  const entries = await Promise.all(
    Object.entries(adapters).map(([provider, entry]) => providerStatus(provider, entry)),
  )
  return entries.sort((a, b) => a.provider.localeCompare(b.provider))
}

export async function assertProviderCommandAvailable(provider: string, entry: AdapterEntry): Promise<void> {
  const adapter = resolveAdapterEntry(entry)
  if (!adapter.command) return

  if (await isCommandAvailable(adapter.command)) return

  throw new BridgeError(ErrorCode.PROVIDER_UNAVAILABLE, `Provider '${provider}' CLI command '${adapter.command}' is not available on PATH.`, {
    details: { provider, command: adapter.command },
  })
}

export async function getAvailableProvidersForDemand(
  input: AgentInput,
  adapters: Record<string, AdapterEntry>,
): Promise<string[]> {
  const required = requiredCapabilities(input)
  const candidates: string[] = []

  for (const [provider, entry] of Object.entries(adapters)) {
    const adapter = resolveAdapterEntry(entry)
    if (!required.every((capability) => adapter.capabilities[capability])) continue
    if (adapter.command && !(await isCommandAvailable(adapter.command))) continue
    candidates.push(provider)
  }

  return candidates
}

export async function selectOnlyAvailableProviderForDemand(
  input: AgentInput,
  adapters: Record<string, AdapterEntry>,
): Promise<string> {
  const required = requiredCapabilities(input)
  const candidates = await getAvailableProvidersForDemand(input, adapters)

  if (candidates.length === 1) return candidates[0]

  const reason = candidates.length === 0
    ? 'No available provider satisfies the requested capabilities.'
    : 'Multiple available providers satisfy the requested capabilities; choose one explicitly.'

  throw new BridgeError(ErrorCode.PROVIDER_NOT_FOUND, reason, {
    details: {
      requiredCapabilities: required,
      candidates,
    },
  })
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
