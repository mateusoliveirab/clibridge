import type { BridgeConfig } from '../types.ts'
import { loadStructuredDataFile } from './structured-data.ts'

export async function loadJsonConfig(path: string): Promise<BridgeConfig> {
  const config = await loadStructuredDataFile(path)
  return config as BridgeConfig
}
