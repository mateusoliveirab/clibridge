import fs from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { decode } from '@toon-format/toon'

export type StructuredDataFormat = 'json' | 'toon'

export function detectStructuredDataFormat(filePath: string): StructuredDataFormat {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.json') return 'json'
  if (extension === '.toon') return 'toon'
  throw new Error(`Unsupported structured data format for ${filePath}. Expected .json or .toon.`)
}

export function parseStructuredData(contents: string, format: StructuredDataFormat): unknown {
  if (format === 'json') return JSON.parse(contents)
  return decode(contents)
}

export async function loadStructuredDataFile(filePath: string): Promise<unknown> {
  const resolvedPath = path.resolve(filePath)
  const format = detectStructuredDataFormat(resolvedPath)
  try {
    return parseStructuredData(await readFile(resolvedPath, 'utf8'), format)
  } catch (error) {
    throw structuredDataError(resolvedPath, format, error)
  }
}

export function loadStructuredDataFileSync(filePath: string): unknown {
  const resolvedPath = path.resolve(filePath)
  const format = detectStructuredDataFormat(resolvedPath)
  try {
    return parseStructuredData(fs.readFileSync(resolvedPath, 'utf8'), format)
  } catch (error) {
    throw structuredDataError(resolvedPath, format, error)
  }
}

function structuredDataError(filePath: string, format: StructuredDataFormat, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`Failed to parse ${format.toUpperCase()} file at ${filePath}: ${message}`)
}
