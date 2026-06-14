import { agyAdapter } from './agy.ts'
import { claudeAdapter } from './claude.ts'
import { codexAdapter } from './codex.ts'
import { geminiAdapter } from './gemini.ts'
import { ollamaAdapter } from './ollama.ts'
import { opencodeAdapter } from './opencode.ts'
import type { ProviderAdapter } from './contract.ts'

export const defaultAdapters: Readonly<Record<string, ProviderAdapter>> = Object.freeze({
  agy: agyAdapter,
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
  opencode: opencodeAdapter,
})
