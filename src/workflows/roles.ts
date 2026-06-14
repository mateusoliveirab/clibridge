import type { ProviderAdapter } from '../adapters/contract.ts'
import type { RoleDemand } from './workflow-types.ts'

// STRENGTH_PREFERENCE is a documented policy list.
// This is the ONLY place provider names may appear for strength ranking.
// It is an overridable policy, not a capability hardcoding.
export const STRENGTH_PREFERENCE: string[] = ['claude', 'gemini', 'opencode', 'agy', 'codex', 'ollama']

// COST_PREFERENCE is a documented policy list.
// This is the ONLY place provider names may appear for cost ranking.
// It is an overridable policy, not a capability hardcoding.
export const COST_PREFERENCE: string[] = ['ollama', 'gemini', 'claude', 'opencode', 'agy', 'codex']

export function resolveRole(demand: RoleDemand, adapters: Record<string, ProviderAdapter>): string {
  const capabilities = demand.capabilities || []

  // Filter candidates by capability requirements
  const candidates = Object.keys(adapters).filter((name) => {
    const adapter = adapters[name]
    return capabilities.every((cap) => adapter.capabilities[cap] === true)
  })

  if (candidates.length === 0) {
    throw new Error(`No provider satisfies demand: ${JSON.stringify(demand)}. Available: ${Object.keys(adapters).join(', ')}`)
  }

  // Sort by policy if needed
  if (demand.strength === 'high') {
    candidates.sort((a, b) => {
      const idxA = STRENGTH_PREFERENCE.indexOf(a)
      const idxB = STRENGTH_PREFERENCE.indexOf(b)
      const weightA = idxA !== -1 ? idxA : Infinity
      const weightB = idxB !== -1 ? idxB : Infinity
      return weightA - weightB
    })
  } else if (demand.cost === 'cheap') {
    candidates.sort((a, b) => {
      const idxA = COST_PREFERENCE.indexOf(a)
      const idxB = COST_PREFERENCE.indexOf(b)
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
