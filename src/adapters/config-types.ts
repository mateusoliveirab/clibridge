import { z } from 'zod'
import type { ProviderCapabilities } from './contract.ts'

export type ArgToken =
  | { lit: string }
  | { var: 'prompt' | 'model' | 'cwd'; default?: string; env?: string }
  | { flag: string; var: string }
  | { when: string; emit: string[] }
  | { repeat: 'extraDirs' | 'attachments'; flag: string }

export interface OutputParser {
  type: 'raw'
  trim?: boolean
}

export interface CliAdapterConfig {
  command: string
  capabilities: ProviderCapabilities
  args: ArgToken[]
  output: OutputParser
}

// Validates user-supplied (config.adapters) adapter definitions before they
// reach createConfigAdapter, so a malformed entry fails with a clear message
// at config-load time instead of a cryptic error mid-run.
const ProviderCapabilitiesSchema = z.object({
  structuredOutput: z.boolean(),
  images: z.boolean(),
  sandbox: z.boolean(),
  skipPermissions: z.boolean(),
})

const ArgTokenSchema = z.union([
  z.object({ lit: z.string() }),
  z.object({ var: z.enum(['prompt', 'model', 'cwd']), default: z.string().optional(), env: z.string().optional() }),
  z.object({ flag: z.string(), var: z.string() }),
  z.object({ when: z.string(), emit: z.array(z.string()) }),
  z.object({ repeat: z.enum(['extraDirs', 'attachments']), flag: z.string() }),
])

const OutputParserSchema = z.object({
  type: z.literal('raw'),
  trim: z.boolean().optional(),
})

export const CliAdapterConfigSchema = z.object({
  command: z.string().min(1),
  capabilities: ProviderCapabilitiesSchema,
  args: z.array(ArgTokenSchema),
  output: OutputParserSchema,
})

export function validateCliAdapterConfig(name: string, raw: unknown): CliAdapterConfig {
  const result = CliAdapterConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
    throw new Error(`Invalid adapter config for '${name}': ${issues}`)
  }
  return result.data as CliAdapterConfig
}
