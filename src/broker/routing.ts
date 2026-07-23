import { BridgeError, ErrorCode } from './errors.ts'
import type { AgentInput, BridgeConfig, Route } from '../types.ts'

type MatchField = 'label' | 'agentType' | 'phase' | 'model'

// `model` here only filters candidate routes (request.model must equal it).
// Forcing a different dispatched model is a separate override field,
// Route.useModel, applied by the caller (see run-agent.ts) — never derived
// from this match field, so a route can match on one model and force another.
const MATCH_FIELDS: MatchField[] = ['label', 'agentType', 'phase', 'model']

export type SelectedRoute = Route & { provider: string }

export function selectRoute(config: BridgeConfig, request: AgentInput): SelectedRoute {
  const routes = config.routes || []
  const matches = routes
    .map((route, index) => ({
      route,
      index,
      score: scoreRoute(route, request),
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)

  const selected: Route = matches[0]?.route || {}
  const provider = selected.provider || request.provider || config.defaultProvider

  if (!provider) {
    throw new BridgeError(ErrorCode.PROVIDER_NOT_FOUND, 'No provider configured for request.', {
      details: { request },
    })
  }

  return {
    ...selected,
    provider,
  }
}

function scoreRoute(route: Route, request: AgentInput): number {
  let score = 0
  let hasCriterion = false

  for (const field of MATCH_FIELDS) {
    if (route[field] === undefined) continue
    hasCriterion = true
    if (route[field] !== request[field]) return -1
    score += fieldWeight(field)
  }

  if (route.requiresImages !== undefined) {
    hasCriterion = true
    const hasImage = (request.attachments || []).some((attachment) => attachment.type === 'image')
    if (Boolean(route.requiresImages) !== hasImage) return -1
    score += 10
  }

  return hasCriterion ? score : 0
}

function fieldWeight(field: MatchField): number {
  switch (field) {
    case 'label': return 100
    case 'agentType': return 70
    case 'phase': return 50
    case 'model': return 20
    default: return 1
  }
}
