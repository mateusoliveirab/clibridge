import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { encode as encodeToon } from '@toon-format/toon'
import { runAgent } from '../broker/run-agent.ts'
import { defaultAdapters } from '../adapters/registry.ts'
import { loadJsonConfig } from '../config/load-config.ts'
import { loadStructuredDataFileSync } from '../config/structured-data.ts'
import { resolveRole } from './roles.ts'
import { AccessModeSchema } from '../types.ts'
import type { AccessMode, BridgeConfig, Envelope } from '../types.ts'
import type { AdapterEntry } from '../adapters/contract.ts'
import type { RoleDemand } from './workflow-types.ts'

export const RunWorkflowInputSchema = z.object({
  runId: z.string().optional(),
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

const ExecutionPolicyFields = {
  access: AccessModeSchema.optional(),
  allowedWritePaths: z.array(z.string()).optional(),
  allowDangerousPermissions: z.boolean().optional(),
}

const PhaseSchema = z.object({
  name: z.string(),
  kind: z.enum(['agent', 'shell', 'read-files', 'policy', 'write-file']).default('agent'),
  role: z.string().optional(),
  demand: z.unknown().optional(),
  provider: z.string().optional(),
  agentType: z.string().optional(),
  prompt: z.string().optional(),
  mockText: z.string().optional(),
  mockData: z.unknown().optional(),
  schema: z.unknown().optional(),
  command: z.string().optional(),
  commands: z.array(z.string()).optional(),
  runInDryRun: z.boolean().optional(),
  files: z.array(z.string()).optional(),
  file: z.string().optional(),
  sourceResult: z.string().optional(),
  sourceField: z.string().optional(),
  disableFallback: z.boolean().optional(),
  maxBytes: z.number().int().positive().optional(),
  skipPermissions: z.boolean().optional(),
  ...ExecutionPolicyFields,
  skipIf: ConditionSchema.optional(),
  assertions: z.array(AssertionSchema).optional(),
})

export const WorkflowFileSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  contractFormat: z.enum(['json', 'toon']).optional(),
  disableFallback: z.boolean().optional(),
  ...ExecutionPolicyFields,
  inputDefaults: z.record(z.string(), z.unknown()).default({}),
  phases: z.array(PhaseSchema),
})

export type RunWorkflowInput = z.infer<typeof RunWorkflowInputSchema>
type WorkflowFile = z.infer<typeof WorkflowFileSchema>
type WorkflowPhase = z.infer<typeof PhaseSchema>

function newRunId(workflow: string): string {
  const ts = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${workflow}-${ts}-${random}`
}

interface ExecutionPolicy {
  access: AccessMode
  allowedWritePaths: string[]
  allowDangerousPermissions: boolean
}

interface MutationSnapshot {
  files: Map<string, string>
  /** HEAD commit SHA, or null on an unborn branch. Catches phases that commit/reset to hide edits. */
  head: string | null
  /** refs/stash SHA, or null when no stash exists. Catches phases that stash edits away. */
  stashRef: string | null
}

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
  observer?: WorkflowRunObserver
}

/** Optional lifecycle bridge used by the local daemon.  Keeping it optional
 * preserves the library and CLI contract for embedders. */
export interface WorkflowRunObserver {
  runStart?(event: { runId: string; workflow: string; description: string; phases: string[]; cwd: string; runsDir?: string }): Promise<void> | void
  phaseStart?(event: { runId: string; phase: string; phaseIndex: number; provider: string }): Promise<void> | void
  phaseEnd?(event: { runId: string; phase: string; ok: boolean; durationMs: number; text?: string; error?: string }): Promise<void> | void
  runEnd?(event: { runId: string; ok: boolean; error?: string }): Promise<void> | void
  beforePhase?(event: { runId: string; workflow: string; phase: WorkflowPhase; cwd: string; provider?: string; policy: ExecutionPolicy }): Promise<void> | void
  assertNotCancelled?(runId: string): Promise<void> | void
}

export async function runWorkflow(
  rawInput: RunWorkflowInput,
  options: RunWorkflowOptions = {},
): Promise<WorkflowRunResult> {
  const input = RunWorkflowInputSchema.parse(rawInput)
  const workflow = loadWorkflowFile(input.workflowPath)
  const contractFormat = input.contractFormat || workflow.contractFormat || 'json'
  const runId = input.runId || newRunId(workflow.name)
  const inputs = { ...workflow.inputDefaults, ...input.inputs }
  const phaseResults: WorkflowPhaseResult[] = []
  const results: Record<string, string> = {}
  const runsDir = path.join(input.cwd, '.bridge-runs')
  const config = input.routeConfigPath
    ? await loadJsonConfig(input.routeConfigPath)
    : (options.config || {})

  await options.observer?.runStart?.({
    runId,
    workflow: workflow.name,
    description: input.task,
    phases: workflow.phases.map(phase => phase.name),
    cwd: input.cwd,
    runsDir,
  })

  try {
    for (let index = 0; index < workflow.phases.length; index++) {
      const phase = workflow.phases[index]!
      const phaseName = phase.name as string
      const provider = phase.kind === 'agent'
        ? resolvePhaseProvider(phase, options.adapters, config)
        : undefined
      const providerLabel = provider || 'local'
      const startedAt = Date.now()
      phaseStart(runId, phaseName, index, providerLabel, { runsDir })
      const policy = resolveExecutionPolicy(workflow, phase)
      let before: MutationSnapshot | null = null

      try {
        await options.observer?.assertNotCancelled?.(runId)
        await options.observer?.beforePhase?.({ runId, workflow: workflow.name, phase, cwd: input.cwd, provider: providerLabel, policy })
        await options.observer?.assertNotCancelled?.(runId)
        await options.observer?.phaseStart?.({ runId, phase: phaseName, phaseIndex: index, provider: providerLabel })
        assertDangerousPermissionsAllowed(phase, input, policy)
        before = beginMutationSnapshot(input.cwd, policy)
        const text = await executePhase(phase, {
          input,
          workflow,
          policy,
          contractFormat,
          inputs,
          results,
          provider,
          config,
          adapters: options.adapters,
        })
        assertMutationPolicy(input.cwd, policy, before)
        const durationMs = Date.now() - startedAt
        results[phaseName] = text
        phaseEnd(runId, phaseName, true, durationMs, { runsDir })
        await options.observer?.phaseEnd?.({ runId, phase: phaseName, ok: true, durationMs, text })
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
        let message = (error as Error).message
        try {
          assertMutationPolicy(input.cwd, policy, before)
        } catch (policyError) {
          message = `${(policyError as Error).message}\nOriginal phase error: ${message}`
        }
        phaseEnd(runId, phaseName, false, durationMs, { runsDir })
        await options.observer?.phaseEnd?.({ runId, phase: phaseName, ok: false, durationMs, error: message })
        phaseResults.push({
          name: phaseName,
          kind: phase.kind,
          ok: false,
          durationMs,
          provider: providerLabel,
          text: '',
          error: message,
        })
        endRun(runId, false, { runsDir })
        await options.observer?.runEnd?.({ runId, ok: false, error: message })
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

    endRun(runId, true, { runsDir })
    await options.observer?.runEnd?.({ runId, ok: true })
    return {
      ok: true,
      runId,
      workflow: workflow.name,
      phases: phaseResults,
      results,
      finalText: latestResult(results),
    }
  } catch (error) {
    endRun(runId, false, { runsDir })
    await options.observer?.runEnd?.({ runId, ok: false, error: (error as Error).message })
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
    policy: ExecutionPolicy
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
  if (phase.kind === 'write-file') return writeFilePhase(phase, context)
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

    if (context.input.dryRun && !phase.runInDryRun) {
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

function writeFilePhase(
  phase: WorkflowPhase,
  context: {
    input: RunWorkflowInput
    policy: ExecutionPolicy
    inputs: Record<string, unknown>
    results: Record<string, string>
  },
): string {
  if (context.policy.access !== 'workspace-write' && context.policy.access !== 'unrestricted') {
    throw new Error(`write-file phase '${phase.name}' requires workspace-write access.`)
  }
  if (!phase.file) throw new Error(`write-file phase '${phase.name}' needs a file.`)
  if (!phase.sourceResult) throw new Error(`write-file phase '${phase.name}' needs sourceResult.`)

  const renderedFile = renderTemplate(phase.file, {
    cwd: context.input.cwd,
    inputs: context.inputs,
    results: context.results,
  })
  if (!renderedFile || path.isAbsolute(renderedFile)) {
    throw new Error(`write-file phase '${phase.name}' requires a relative file path.`)
  }

  const target = path.resolve(context.input.cwd, renderedFile)
  const relativeTarget = normalizeRepoPath(path.relative(context.input.cwd, target))
  if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith('../')) {
    throw new Error(`write-file phase '${phase.name}' cannot write outside cwd: ${renderedFile}`)
  }
  if (!isRealPathInsideCwd(context.input.cwd, target)) {
    throw new Error(`write-file phase '${phase.name}' cannot write outside cwd: ${renderedFile}`)
  }
  if (
    context.policy.allowedWritePaths.length &&
    !matchesAnyAllowedPath(relativeTarget, context.policy.allowedWritePaths)
  ) {
    throw new Error(
      `write-file phase '${phase.name}' is outside allowedWritePaths: ${relativeTarget}`
    )
  }

  const rawSource = context.results[phase.sourceResult]
  if (rawSource === undefined) {
    throw new Error(`write-file phase '${phase.name}' cannot find result '${phase.sourceResult}'.`)
  }
  let content = rawSource
  if (phase.sourceField) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawSource)
    } catch {
      throw new Error(`write-file phase '${phase.name}' needs JSON in result '${phase.sourceResult}'.`)
    }
    const selected = getPath(
      parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {},
      phase.sourceField,
    )
    if (typeof selected !== 'string') {
      throw new Error(
        `write-file phase '${phase.name}' expected string field '${phase.sourceField}' in '${phase.sourceResult}'.`
      )
    }
    content = selected
  }

  if (context.input.dryRun) {
    return `[dry-run] would write ${relativeTarget} (${Buffer.byteLength(content, 'utf8')} bytes)`
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
  return `Wrote ${relativeTarget} (${Buffer.byteLength(content, 'utf8')} bytes)`
}

function isRealPathInsideCwd(cwd: string, target: string): boolean {
  try {
    const realCwd = fs.realpathSync(cwd)
    let existing = target
    while (!pathEntryExists(existing)) {
      const parent = path.dirname(existing)
      if (parent === existing) return false
      existing = parent
    }

    const realExisting = fs.realpathSync(existing)
    const unresolvedSuffix = path.relative(existing, target)
    const realTarget = path.resolve(realExisting, unresolvedSuffix)
    const relativeTarget = path.relative(realCwd, realTarget)
    return relativeTarget !== '..'
      && !relativeTarget.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeTarget)
  } catch {
    return false
  }
}

function pathEntryExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath)
    return true
  } catch {
    return false
  }
}

async function agentPhase(
  phase: WorkflowPhase,
  context: {
    input: RunWorkflowInput
    workflow: WorkflowFile
    policy: ExecutionPolicy
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
    mockData: phase.mockData,
    access: context.policy.access,
    timeoutMs: context.input.timeoutMs,
    dryRun: context.input.dryRun,
    mockText: phase.mockText || `[dry-run ${phase.name}]`,
    disableFallback: phase.disableFallback ?? context.workflow.disableFallback,
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

function resolveExecutionPolicy(workflow: WorkflowFile, phase: WorkflowPhase): ExecutionPolicy {
  return {
    access: phase.access || workflow.access || (phase.kind === 'agent' ? 'read-only' : 'workspace-write'),
    allowedWritePaths: phase.allowedWritePaths || workflow.allowedWritePaths || [],
    allowDangerousPermissions: Boolean(phase.allowDangerousPermissions || workflow.allowDangerousPermissions),
  }
}

function assertDangerousPermissionsAllowed(
  phase: WorkflowPhase,
  input: RunWorkflowInput,
  policy: ExecutionPolicy,
): void {
  const requested = Boolean(phase.skipPermissions || input.dangerouslySkipPermissions)
  if (!requested || policy.allowDangerousPermissions) return

  throw new Error(
    `Phase '${phase.name}' requested dangerouslySkipPermissions, but this phase/workflow does not set allowDangerousPermissions=true.`
  )
}

function beginMutationSnapshot(cwd: string, policy: ExecutionPolicy): MutationSnapshot | null {
  if (policy.access === 'unrestricted') return null
  // workspace-write with no path restrictions never violates — skip the audit.
  if (policy.access === 'workspace-write' && !policy.allowedWritePaths.length) return null
  try {
    return {
      files: snapshotChangedFiles(cwd),
      head: gitRevParse(cwd, 'HEAD'),
      stashRef: gitRevParse(cwd, 'refs/stash'),
    }
  } catch {
    return null // not a git repository — nothing to audit against
  }
}

// Limitation: paths matched by .gitignore are invisible to both the porcelain
// snapshot and the ref checks, so mutations confined to ignored paths (e.g.
// node_modules, build output) go undetected. Fingerprinting every ignored file
// per phase is prohibitively expensive, so this is a deliberate trade-off.
function assertMutationPolicy(cwd: string, policy: ExecutionPolicy, before: MutationSnapshot | null): void {
  if (!before) return

  const changedSet = new Set(changedSince(before.files, snapshotChangedFiles(cwd)))

  // A phase can leave `git status` clean by committing or stashing its edits;
  // compare tree-level refs so laundered mutations still surface.
  const headAfter = gitRevParse(cwd, 'HEAD')
  if (before.head !== headAfter) {
    if (before.head && headAfter) {
      for (const file of diffCommitPaths(cwd, before.head, headAfter)) changedSet.add(file)
    }
    changedSet.add('<git HEAD moved>')
  }
  if (before.stashRef !== gitRevParse(cwd, 'refs/stash')) {
    changedSet.add('<git stash changed>')
  }

  const changed = Array.from(changedSet).sort()
  if (!changed.length) return

  if (policy.access === 'read-only') {
    throw new Error(`Execution policy violation: read-only phase changed files: ${changed.join(', ')}`)
  }

  if (policy.allowedWritePaths.length) {
    const disallowed = changed.filter(file => !matchesAnyAllowedPath(file, policy.allowedWritePaths))
    if (disallowed.length) {
      throw new Error(
        `Execution policy violation: phase changed files outside allowedWritePaths: ${disallowed.join(', ')}`
      )
    }
  }
}

function gitRevParse(cwd: string, ref: string): string | null {
  try {
    const output = execFileSync('git', ['-C', cwd, 'rev-parse', '--verify', '--quiet', ref], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return output || null
  } catch {
    return null
  }
}

function diffCommitPaths(cwd: string, fromRef: string, toRef: string): string[] {
  try {
    const output = execFileSync('git', ['-C', cwd, 'diff', '--name-only', fromRef, toRef], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.split('\n').map(line => line.trim()).filter(Boolean).map(normalizeRepoPath)
  } catch {
    return []
  }
}

function snapshotChangedFiles(cwd: string): Map<string, string> {
  const files = listGitStatusPaths(cwd)
  const snapshot = new Map<string, string>()
  for (const file of files) {
    snapshot.set(file, fileFingerprint(cwd, file))
  }
  return snapshot
}

function listGitStatusPaths(cwd: string): string[] {
  const output = execFileSync('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const files = new Set<string>()
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    const rawPath = line.slice(3)
    const renamedPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop()! : rawPath
    files.add(normalizeRepoPath(renamedPath))
  }
  return Array.from(files).sort()
}

function fileFingerprint(cwd: string, file: string): string {
  const filePath = path.join(cwd, file)
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return '<deleted>'
  }
  if (!stat.isFile()) return `<${stat.isDirectory() ? 'dir' : 'special'}>`
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function changedSince(before: Map<string, string>, after: Map<string, string>): string[] {
  const files = new Set([...before.keys(), ...after.keys()])
  return Array.from(files)
    .filter(file => before.get(file) !== after.get(file))
    .sort()
}

function matchesAnyAllowedPath(file: string, allowedPaths: string[]): boolean {
  return allowedPaths.some(pattern => path.matchesGlob(normalizeRepoPath(file), normalizeRepoPath(pattern)))
}

function normalizeRepoPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function resolvePhaseProvider(phase: WorkflowPhase, adapters?: Record<string, AdapterEntry>, config?: BridgeConfig): string | undefined {
  if (phase.provider) return phase.provider
  if (!phase.demand) return undefined

  try {
    return resolveRole(phase.demand as RoleDemand, (adapters || defaultAdapters) as any, config)
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
