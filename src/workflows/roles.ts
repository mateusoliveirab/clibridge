import type { ProviderAdapter } from '../adapters/contract.ts'
import type { BridgeConfig } from '../types.ts'
import type { RoleDemand } from './workflow-types.ts'

// STRENGTH_PREFERENCE is a documented policy list.
// This is the ONLY place provider names may appear for strength ranking.
// It is an overridable policy, not a capability hardcoding.
export const STRENGTH_PREFERENCE: string[] = ['claude', 'gemini', 'opencode', 'agy', 'codex', 'ollama']

// COST_PREFERENCE is a documented policy list.
// This is the ONLY place provider names may appear for cost ranking.
// It is an overridable policy, not a capability hardcoding.
export const COST_PREFERENCE: string[] = ['ollama', 'gemini', 'claude', 'opencode', 'agy', 'codex']

export function resolveRole(demand: RoleDemand, adapters: Record<string, ProviderAdapter>, config?: BridgeConfig): string {
  const capabilities = demand.capabilities || []

  // Filter candidates by capability requirements
  const candidates = Object.keys(adapters).filter((name) => {
    const adapter = adapters[name]
    return capabilities.every((cap) => adapter.capabilities[cap] === true)
  })

  if (candidates.length === 0) {
    throw new Error(`No provider satisfies demand: ${JSON.stringify(demand)}. Available: ${Object.keys(adapters).join(', ')}`)
  }

  // Config-declared rankings take precedence over the built-in policy lists,
  // so a new provider can be ranked without a code change.
  const strengthPreference = config?.rolePreferences?.strength ?? STRENGTH_PREFERENCE
  const costPreference = config?.rolePreferences?.cost ?? COST_PREFERENCE

  // Sort by policy if needed
  if (demand.strength === 'high') {
    candidates.sort((a, b) => {
      const idxA = strengthPreference.indexOf(a)
      const idxB = strengthPreference.indexOf(b)
      const weightA = idxA !== -1 ? idxA : Infinity
      const weightB = idxB !== -1 ? idxB : Infinity
      return weightA - weightB
    })
  } else if (demand.cost === 'cheap') {
    candidates.sort((a, b) => {
      const idxA = costPreference.indexOf(a)
      const idxB = costPreference.indexOf(b)
      const weightA = idxA !== -1 ? idxA : Infinity
      const weightB = idxB !== -1 ? idxB : Infinity
      return weightA - weightB
    })
  }

  return candidates[0]
}

export function listWriters(adapters: Record<string, ProviderAdapter>): string[] {
  return Object.keys(adapters).filter((name) => adapters[name].capabilities.skipPermissions === true)
}
