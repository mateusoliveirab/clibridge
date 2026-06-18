import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { encode as encodeToon } from '@toon-format/toon'
import { runAgent } from '../broker/run-agent.ts'
import { defaultAdapters } from '../adapters/registry.ts'
import { loadJsonConfig } from '../config/load-config.ts'
import { loadStructuredDataFileSync } from '../config/structured-data.ts'
import { newRunId, startRun, phaseStart, phaseEnd, endRun } from './run-state.ts'
import { resolveRole } from './roles.ts'
import type { BridgeConfig, Envelope } from '../types.ts'
import type { AdapterEntry } from '../adapters/contract.ts'
import type { RoleDemand } from './workflow-types.ts'

export const RunWorkflowInputSchema = z.object({
  workflowPath: z.string(),
  cwd: z.string(),
  task: z.string(),
  dryRun: z.boolean().optional(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  routeConfigPath: z.string().optional(),
  dangerouslySkipPermissions: z.boolean().optional(),
  contractFormat: z.enum(['json', 'toon']).optional(),
  timeoutMs: z.number().int().positive().optional(),
})

const ConditionSchema = z.object({
  input: z.string(),
  equals: z.unknown().optional(),
  notEquals: z.unknown().optional(),
  truthy: z.boolean().optional(),
})

const AssertionSchema = z.object({
  input: z.string(),
  in: z.array(z.unknown()).optional(),
  notIn: z.array(z.unknown()).optional(),
  equals: z.unknown().optional(),
  notEquals: z.unknown().optional(),
  requiresAnyInput: z.array(z.string()).optional(),
  unless: ConditionSchema.optional(),
  unlessInputTruthy: z.string().optional(),
  message: z.string().optional(),
})

const PhaseSchema = z.object({
  name: z.string(),
  kind: z.enum(['agent', 'shell', 'read-files', 'policy']).default('agent'),
  role: z.string().optional(),
  demand: z.unknown().optional(),
  provider: z.string().optional(),
  agentType: z.string().optional(),
  prompt: z.string().optional(),
  mockText: z.string().optional(),
  schema: z.unknown().optional(),
  command: z.string().optional(),
  commands: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  maxBytes: z.number().int().positive().optional(),
  skipPermissions: z.boolean().optional(),
  skipIf: ConditionSchema.optional(),
  assertions: z.array(AssertionSchema).optional(),
})

const WorkflowFileSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  contractFormat: z.enum(['json', 'toon']).optional(),
  inputDefaults: z.record(z.string(), z.unknown()).default({}),
  phases: z.array(PhaseSchema),
})

export type RunWorkflowInput = z.infer<typeof RunWorkflowInputSchema>
type WorkflowFile = z.infer<typeof WorkflowFileSchema>
type WorkflowPhase = z.infer<typeof PhaseSchema>

export interface WorkflowPhaseResult {
  name: string
  kind: string
  ok: boolean
  durationMs: number
  provider?: string
  text: string
  error?: string
}

export interface WorkflowRunResult {
  ok: boolean
  runId: string
  workflow: string
  phases: WorkflowPhaseResult[]
  results: Record<string, string>
  finalText: string
  error?: string
}

export interface RunWorkflowOptions {
  adapters?: Record<string, AdapterEntry>
  config?: BridgeConfig
}

export async function runWorkflow(
  rawInput: RunWorkflowInput,
  options: RunWorkflowOptions = {},
): Promise<WorkflowRunResult> {
  const input = RunWorkflowInputSchema.parse(rawInput)
  const workflow = loadWorkflowFile(input.workflowPath)
  const contractFormat = input.contractFormat || workflow.contractFormat || 'json'
  const runId = newRunId(workflow.name)
  const inputs = { ...workflow.inputDefaults, ...input.inputs }
  const phaseResults: WorkflowPhaseResult[] = []
  const results: Record<string, string> = {}
  const config = input.routeConfigPath
    ? await loadJsonConfig(input.routeConfigPath)
    : (options.config || {})

  startRun({
    runId,
    workflow: workflow.name,
    description: input.task,
    phases: workflow.phases.map(phase => phase.name),
  })

  try {
    for (let index = 0; index < workflow.phases.length; index++) {
      const phase = workflow.phases[index]!
      const phaseName = phase.name as string
      const provider = phase.kind === 'agent'
        ? resolvePhaseProvider(phase, options.adapters)
        : undefined
      const providerLabel = provider || 'local'
      const startedAt = Date.now()
      phaseStart(runId, phaseName, index, providerLabel)

      try {
        const text = await executePhase(phase, {
          input,
          workflow,
          contractFormat,
          inputs,
          results,
          provider,
          config,
          adapters: options.adapters,
        })
        const durationMs = Date.now() - startedAt
        results[phaseName] = text
        phaseEnd(runId, phaseName, true, durationMs)
        phaseResults.push({
          name: phaseName,
          kind: phase.kind,
          ok: true,
          durationMs,
          provider: providerLabel,
          text,
        })
      } catch (error) {
        const durationMs = Date.now() - startedAt
        const message = (error as Error).message
        phaseEnd(runId, phaseName, false, durationMs)
        phaseResults.push({
          name: phaseName,
          kind: phase.kind,
          ok: false,
          durationMs,
          provider: providerLabel,
          text: '',
          error: message,
        })
        endRun(runId, false)
        return {
          ok: false,
          runId,
          workflow: workflow.name,
          phases: phaseResults,
          results,
          finalText: latestResult(results),
          error: message,
        }
      }
    }

    endRun(runId, true)
    return {
      ok: true,
      runId,
      workflow: workflow.name,
      phases: phaseResults,
      results,
      finalText: latestResult(results),
    }
  } catch (error) {
    endRun(runId, false)
    return {
      ok: false,
      runId,
      workflow: workflow.name,
      phases: phaseResults,
      results,
      finalText: latestResult(results),
      error: (error as Error).message,
    }
  }
}

function loadWorkflowFile(workflowPath: string): WorkflowFile {
  const resolvedPath = path.resolve(workflowPath)
  let parsed: unknown
  try {
    parsed = loadStructuredDataFileSync(resolvedPath)
  } catch (error) {
    throw new Error(`Failed to read workflow file at ${resolvedPath}: ${(error as Error).message}`)
  }
  return WorkflowFileSchema.parse(parsed)
}

async function executePhase(
  phase: WorkflowPhase,
  context: {
    input: RunWorkflowInput
    workflow: WorkflowFile
    contractFormat: ContractFormat
    inputs: Record<string, unknown>
    results: Record<string, string>
    provider?: string
    config: BridgeConfig
    adapters?: Record<string, AdapterEntry>
  },
): Promise<string> {
  if (phase.skipIf && conditionMatches(phase.skipIf, context.inputs)) {
    return `Skipped because condition matched: ${JSON.stringify(phase.skipIf)}`
  }

  if (phase.kind === 'read-files') return readFilesPhase(phase, context.input.cwd)
  if (phase.kind === 'policy') return policyPhase(phase, context.inputs)
  if (phase.kind === 'shell') return shellPhase(phase, context)
  return agentPhase(phase, context)
}

type ContractFormat = 'json' | 'toon'

function readFilesPhase(phase: WorkflowPhase, cwd: string): string {
  const maxBytes = phase.maxBytes || 12000
  const files = phase.files || []
  if (!files.length) return 'No files configured.'

  return files.map((file) => {
    const filePath = path.join(cwd, file)
    if (!fs.existsSync(filePath)) return `--- ${file} ---\n(missing)`
    const text = fs.readFileSync(filePath, 'utf8').slice(0, maxBytes)
    return `--- ${file} ---\n${text.trim() || '(empty file)'}`
  }).join('\n\n')
}

function policyPhase(phase: WorkflowPhase, inputs: Record<string, unknown>): string {
  const assertions = phase.assertions || []
  for (const assertion of assertions) {
    if (assertion.unless && conditionMatches(assertion.unless, inputs)) continue
    if (assertion.unlessInputTruthy && Boolean(inputs[assertion.unlessInputTruthy])) continue

    const value = inputs[assertion.input]
    if (assertion.in && !includesValue(assertion.in, value)) continue
    if (assertion.notIn && includesValue(assertion.notIn, value)) {
      throw new Error(assertion.message || `Policy rejected ${assertion.input}=${String(value)}`)
    }
    if ('equals' in assertion && value !== assertion.equals) {
      throw new Error(assertion.message || `Policy expected ${assertion.input}=${String(assertion.equals)}`)
    }
    if ('notEquals' in assertion && value === assertion.notEquals) {
      throw new Error(assertion.message || `Policy rejected ${assertion.input}=${String(value)}`)
    }
    if (assertion.requiresAnyInput && !assertion.requiresAnyInput.some(key => Boolean(inputs[key]))) {
      throw new Error(assertion.message || `Policy requires one of: ${assertion.requiresAnyInput.join(', ')}`)
    }
  }

  return assertions.length
    ? `Policy passed (${assertions.length} assertions).`
    : 'Policy phase had no assertions.'
}

function shellPhase(
  phase: WorkflowPhase,
  context: {
    input: RunWorkflowInput
    inputs: Record<string, unknown>
    results: Record<string, string>
  },
): string {
  const commands = phase.commands || (phase.command ? [phase.command] : [])
  if (!commands.length) return 'No commands configured.'

  const outputs: string[] = []
  for (const command of commands) {
    const renderedCommand = renderTemplate(command, {
      task: context.input.task,
      cwd: context.input.cwd,
      inputs: context.inputs,
      results: context.results,
    })

    if (context.input.dryRun) {
      outputs.push(`[dry-run] ${renderedCommand}`)
      continue
    }
    try {
      const output = execSync(renderedCommand, {
        cwd: context.input.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      outputs.push(`$ ${renderedCommand}\n${output.trim()}`)
    } catch (error) {
      const stdout = (error as { stdout?: Buffer }).stdout?.toString() || ''
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() || ''
      throw new Error(`Command failed: ${renderedCommand}\n${stdout}${stderr}`)
    }
  }
  return outputs.join('\n\n')
}

async function agentPhase(
  phase: WorkflowPhase,
  context: {
    input: RunWorkflowInput
    workflow: WorkflowFile
    contractFormat: ContractFormat
    inputs: Record<string, unknown>
    results: Record<string, string>
    provider?: string
    config: BridgeConfig
    adapters?: Record<string, AdapterEntry>
  },
): Promise<string> {
  const prompt = renderTemplate(phase.prompt || '{{task}}', {
    task: context.input.task,
    cwd: context.input.cwd,
    inputs: context.inputs,
    results: context.results,
  }, context.contractFormat)

  const result: Envelope = await runAgent({
    workflow: context.workflow.name,
    phase: phase.name,
    label: `${context.workflow.name}:${phase.name}`,
    cwd: context.input.cwd,
    prompt,
    attachments: [],
    provider: phase.provider || context.provider || (context.input.dryRun ? 'agy' : undefined),
    agentType: phase.agentType,
    schema: phase.schema,
    timeoutMs: context.input.timeoutMs,
    dryRun: context.input.dryRun,
    mockText: phase.mockText || `[dry-run ${phase.name}]`,
    dangerouslySkipPermissions: phase.skipPermissions || context.input.dangerouslySkipPermissions,
  }, {
    config: context.config,
    adapters: context.adapters,
    dangerouslySkipPermissions: context.input.dangerouslySkipPermissions,
  })

  if (!result.ok) {
    const detail = [
      result.message,
      result.stdoutTail,
      result.stderrTail,
      typeof result.details === 'object' && result.details ? JSON.stringify(result.details) : '',
    ].filter(Boolean).join('\n')
    throw new Error(`${phase.name} failed: ${result.errorCode} ${detail}`)
  }
  if (result.structured) {
    return formatContractValue(result.data, context.contractFormat)
  }
  return result.text
}

function resolvePhaseProvider(phase: WorkflowPhase, adapters?: Record<string, AdapterEntry>): string | undefined {
  if (phase.provider) return phase.provider
  if (!phase.demand) return undefined

  try {
    return resolveRole(phase.demand as RoleDemand, (adapters || defaultAdapters) as any)
  } catch {
    return undefined
  }
}

function renderTemplate(
  template: string,
  context: Record<string, unknown>,
  contractFormat: ContractFormat = 'json',
): string {
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_match, expression: string) => {
    const value = getPath(context, expression.trim())
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') return value
    return formatContractValue(value, contractFormat)
  })
}

function formatContractValue(value: unknown, contractFormat: ContractFormat): string {
  if (contractFormat === 'toon') return encodeToon(value)
  return JSON.stringify(value, null, 2)
}

function getPath(source: Record<string, unknown>, expression: string): unknown {
  return expression.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, source)
}

function conditionMatches(condition: z.infer<typeof ConditionSchema>, inputs: Record<string, unknown>): boolean {
  const value = inputs[condition.input]
  if ('equals' in condition) return value === condition.equals
  if ('notEquals' in condition) return value !== condition.notEquals
  if (condition.truthy) return Boolean(value)
  return false
}

function includesValue(values: unknown[], value: unknown): boolean {
  return values.some(item => item === value)
}

function latestResult(results: Record<string, string>): string {
  const values = Object.values(results)
  return values[values.length - 1] || ''
}
