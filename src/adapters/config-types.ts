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
