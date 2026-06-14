import { agyAdapter } from './agy.ts'
import { claudeAdapter } from './claude.ts'
import { codexAdapter } from './codex.ts'
import { geminiAdapter } from './gemini.ts'
import { opencodeAdapter } from './opencode.ts'
import { createConfigAdapter } from './config-runner.ts'
import type { ProviderAdapter } from './contract.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { CliAdapterConfig } from './config-types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const adaptersConfig = JSON.parse(readFileSync(join(__dirname, 'adapters-config.json'), 'utf8'))

export const defaultAdapters: Readonly<Record<string, ProviderAdapter>> = Object.freeze({
  agy: agyAdapter,
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  ollama: createConfigAdapter(adaptersConfig.ollama as CliAdapterConfig),
  opencode: opencodeAdapter,
})
