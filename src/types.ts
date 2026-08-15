// Shared domain types for the bridge. These describe the contract between the
// MCP surface, the broker, and the provider adapters — the part of the system
// whose whole job is normalizing heterogeneous CLIs into one stable shape.

import { z } from 'zod'
import type { CliAdapterConfig } from './adapters/config-types.ts'

export const AccessModeSchema = z.enum(['read-only', 'workspace-write', 'unrestricted'])
export const ReasoningEffortSchema = z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max'])

export const AttachmentSchema = z.object({
  type: z.string(),
  path: z.string(),
})

/** What a caller (MCP tool / workflow) sends in. */
export const AgentInputSchema = z.object({
  runId: z.string().optional(),
  workflow: z.string(),
  phase: z.string(),
  label: z.string(),
  cwd: z.string(),
  prompt: z.string(),
  agentType: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  schema: z.any().optional(),
  attachments: z.array(AttachmentSchema).default([]),
  sandbox: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  maxRetries: z.number().int().min(0).optional(),
  dryRun: z.boolean().optional(),
  mockData: z.any().optional(),
  mockText: z.string().optional(),
  routeConfigPath: z.string().optional(),
  dangerouslySkipPermissions: z.boolean().optional(),
  addDir: z.string().optional(),
  addDirs: z.array(z.string()).optional(),
  envAllowlist: z.array(z.string()).optional(),
  disableFallback: z.boolean().optional(),
  access: AccessModeSchema.optional(),
})

export type Attachment = z.infer<typeof AttachmentSchema>
export type AgentInput = z.infer<typeof AgentInputSchema>
export type AccessMode = z.infer<typeof AccessModeSchema>


/** A routing rule from config: match criteria plus the overrides it applies. */
export interface Route {
  // match criteria
  label?: string
  agentType?: string
  phase?: string
  model?: string
  requiresImages?: boolean
  // overrides applied on match
  provider?: string
  // Forces the dispatched model regardless of request.model or the `model`
  // match criterion above (which only filters candidates, never overrides).
  useModel?: string
  sandbox?: string
  timeoutMs?: number
  maxRetries?: number
  envAllowlist?: string[]
  reasoningEffort?: z.infer<typeof ReasoningEffortSchema>
}

export interface BridgeConfig {
  defaultProvider?: string
  routes?: Route[]
  /** User-declared provider CLIs, resolved via createConfigAdapter — config-only, no rebuild required. */
  adapters?: Record<string, CliAdapterConfig>
  /** Overrides the built-in STRENGTH_PREFERENCE/COST_PREFERENCE provider rankings used by resolveRole. */
  rolePreferences?: {
    strength?: string[]
    cost?: string[]
  }
}

/** What the broker hands an adapter: input with routing + defaults resolved. */
export interface ResolvedRequest extends AgentInput {
  runId: string
  provider: string
  timeoutMs: number
  maxRetries: number
  env: Record<string, string | undefined>
  dangerouslySkipPermissions: boolean
  disableFallback?: boolean
}

export interface SuccessEnvelope {
  ok: true
  runId: string
  provider: string
  model?: string
  phase: string
  label: string
  durationMs: number
  attempts: number
  structured: boolean
  data?: unknown
  text: string
  usage: Record<string, unknown>
  artifacts: unknown[]
  warnings: unknown[]
}

export interface ErrorEnvelope {
  ok: false
  runId: string
  provider: string
  phase: string
  label: string
  durationMs: number
  attempts: number
  errorCode: string
  message: string
  recoverable: boolean
  details: unknown
  stderrTail: string
  stdoutTail: string
  rawOutputPath?: string
}

export type Envelope = SuccessEnvelope | ErrorEnvelope
