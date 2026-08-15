import path from 'node:path'
import { LocalDaemon, type DaemonOptions, type DaemonExecuteOptions } from './daemon.ts'
import type { RunWorkflowInput, WorkflowRunResult } from '../workflows/workflow-executor.ts'
import { randomUUID } from 'node:crypto'
import { runAgent } from '../broker/run-agent.ts'
import type { AgentInput, Envelope } from '../types.ts'
import type { AdapterEntry } from '../adapters/contract.ts'
import type { BridgeConfig } from '../types.ts'

const daemons = new Map<string, Promise<LocalDaemon>>()

export async function daemonFor(cwd: string, options: DaemonOptions = {}): Promise<LocalDaemon> {
  const key = path.resolve(cwd)
  let daemon = daemons.get(key)
  if (!daemon) {
    daemon = (async () => { const value = new LocalDaemon(key, options); await value.initialize(); return value })()
    daemons.set(key, daemon)
    // Never cache a rejected initialization forever — evict so the next call retries.
    daemon.catch(() => { daemons.delete(key) })
  }
  return daemon
}

export async function runWorkflowThroughDaemon(input: RunWorkflowInput, options: DaemonExecuteOptions = {}): Promise<WorkflowRunResult> {
  const daemon = await daemonFor(input.cwd, options)
  // MCP expects a completed result. Execute on this daemon rather than starting
  // an HTTP job, so its response contract remains unchanged. Apply the same
  // cwd/path validation the HTTP path (startWorkflow) enforces, so this
  // in-process entrypoint can't bypass it.
  const { cwd, workflowPath } = daemon.validateWorkflowRequest(input)
  const runId = randomUUID()
  await daemon.ledger.createRun({ id: runId, workflow: input.workflowPath.split('/').pop() || 'workflow', cwd, task: input.task })
  return daemon.execute({ ...input, cwd, workflowPath, runId }, options)
}

export async function runAgentThroughDaemon(input: AgentInput, options: { adapters?: Record<string, AdapterEntry>; config?: BridgeConfig; dangerouslySkipPermissions?: boolean } = {}): Promise<Envelope> {
  const daemon = await daemonFor(input.cwd, options)
  const runId = randomUUID()
  await daemon.ledger.createRun({ id: runId, workflow: input.workflow, cwd: input.cwd, task: input.prompt })
  await daemon.ledger.setRunStatus(runId, 'running')
  await daemon.ledger.event(runId, 'run.started', { workflow: input.workflow, phases: [input.phase] })
  await daemon.ledger.phaseStart(runId, input.phase, 0, input.provider || 'routed')
  const result = await runAgent({ ...input, label: input.label || `${input.workflow}:${input.phase}` }, options)
  await daemon.ledger.phaseEnd(runId, input.phase, result.ok, result.durationMs, result.ok ? result.text : undefined, result.ok ? undefined : result.message)
  await daemon.ledger.setRunStatus(runId, result.ok ? 'completed' : 'failed', result.ok ? undefined : result.message)
  await daemon.ledger.event(runId, 'run.finished', { ok: result.ok, error: result.ok ? undefined : result.message })
  return result
}
