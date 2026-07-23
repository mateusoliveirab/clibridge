import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { runWorkflow, type RunWorkflowInput, type WorkflowRunObserver, type WorkflowRunResult } from '../workflows/workflow-executor.ts'
import type { AdapterEntry } from '../adapters/contract.ts'
import type { BridgeConfig } from '../types.ts'
import { RunLedger, type LedgerEvent } from './ledger.ts'

interface PendingApproval { runId: string; resolve: (approved: boolean) => void }

const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000
const APPROVAL_POLL_INTERVAL_MS = 500

export interface DaemonOptions {
  adapters?: Record<string, AdapterEntry>
  config?: BridgeConfig
  approvalTimeoutMs?: number
}

/** Per-call execution options. These travel with the call (not the
 * constructor) so a fresh MCP request's config/adapters/approval settings are
 * never silently shadowed by whatever the daemon happened to be built with. */
export interface DaemonExecuteOptions {
  adapters?: Record<string, AdapterEntry>
  config?: BridgeConfig
  autoApprove?: boolean
  approvalTimeoutMs?: number
}

export class LocalDaemon {
  readonly ledger: RunLedger
  readonly events = new EventEmitter()
  private readonly approvals = new Map<string, PendingApproval>()
  private readonly cancelled = new Set<string>()
  private readonly approvalTimeoutMs: number

  constructor(readonly cwd: string, private readonly options: DaemonOptions = {}) {
    this.ledger = new RunLedger(cwd)
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? (Number(process.env.CLIBRIDGE_APPROVAL_TIMEOUT_MS) || DEFAULT_APPROVAL_TIMEOUT_MS)
  }

  async initialize(): Promise<void> { await this.ledger.migrate() }

  /** Shared validation for anything that wants to hand this daemon a workflow
   * request: cwd must match the daemon's project, and the resolved workflow
   * path must stay inside it. Used by both the HTTP path and the in-process
   * (MCP) path so neither can bypass the other's guardrails. */
  validateWorkflowRequest(raw: { cwd?: string; workflowPath: string }): { cwd: string; workflowPath: string } {
    const cwd = path.resolve(raw.cwd || this.cwd)
    if (cwd !== this.cwd) throw new Error('This daemon is scoped to its project directory.')
    const workflowPath = path.resolve(cwd, raw.workflowPath)
    if (!workflowPath.startsWith(`${cwd}${path.sep}`)) throw new Error('Workflow path is outside the project directory.')
    return { cwd, workflowPath }
  }

  async startWorkflow(raw: Omit<RunWorkflowInput, 'runId' | 'cwd'> & { cwd?: string }, options: DaemonExecuteOptions = {}): Promise<{ runId: string }> {
    const runId = randomUUID()
    const { cwd, workflowPath } = this.validateWorkflowRequest(raw)
    const workflow = workflowNameFromPath(raw.workflowPath)
    await this.ledger.createRun({ id: runId, workflow, cwd, task: raw.task })
    this.publish(await this.ledger.event(runId, 'run.accepted', {}))
    // Fire-and-forget: execute() already records failures to the ledger, so
    // swallow the rejection here purely to avoid an unhandled rejection.
    this.execute({ ...raw, workflowPath, cwd, runId }, options).catch(() => {})
    return { runId }
  }

  async execute(input: RunWorkflowInput, options: DaemonExecuteOptions = {}): Promise<WorkflowRunResult> {
    const merged = { adapters: options.adapters ?? this.options.adapters, config: options.config ?? this.options.config }
    const observer: WorkflowRunObserver = {
      runStart: async event => {
        await this.ledger.setRunStatus(event.runId, 'running')
        this.publish(await this.ledger.event(event.runId, 'run.started', { workflow: event.workflow, phases: event.phases }))
      },
      phaseStart: async event => this.publish(await this.ledger.phaseStart(event.runId, event.phase, event.phaseIndex, event.provider)),
      phaseEnd: async event => this.publish(await this.ledger.phaseEnd(event.runId, event.phase, event.ok, event.durationMs, event.text, event.error)),
      runEnd: async event => {
        const status = this.cancelled.has(event.runId) ? 'cancelled' : event.ok ? 'completed' : 'failed'
        await this.ledger.setRunStatus(event.runId, status, event.error)
        this.publish(await this.ledger.event(event.runId, 'run.finished', { ok: event.ok, status, error: event.error }))
      },
      beforePhase: event => this.gatePhase(event, options),
      assertNotCancelled: runId => {
        if (this.cancelled.has(runId)) throw new Error('Run cancelled by user.')
      },
    }
    try { return await runWorkflow(input, { ...merged, observer }) }
    catch (error) {
      await this.ledger.setRunStatus(input.runId!, 'failed', (error as Error).message)
      this.publish(await this.ledger.event(input.runId!, 'run.crashed', { error: (error as Error).message }))
      throw error
    } finally { this.cancelled.delete(input.runId!) }
  }

  async decideApproval(runId: string, approvalId: string, decision: 'approve' | 'reject', reason?: string): Promise<boolean> {
    const result = await this.ledger.decideApproval(approvalId, decision === 'approve' ? 'approved' : 'rejected', reason)
    if (!result || result.runId !== runId) return false
    const pending = this.approvals.get(approvalId)
    if (pending) {
      this.approvals.delete(approvalId)
      pending.resolve(decision === 'approve')
    } else if (decision === 'reject') {
      await this.ledger.setRunStatus(runId, 'failed', reason || 'Approval rejected')
    }
    if (decision === 'approve') await this.ledger.setRunStatus(runId, 'running')
    return true
  }

  async cancel(runId: string, reason = 'Cancelled by user'): Promise<boolean> {
    const run = await this.ledger.getRun(runId)
    if (!run) return false
    this.cancelled.add(runId)
    for (const [approvalId, pending] of this.approvals) {
      if (pending.runId === runId) {
        this.approvals.delete(approvalId)
        pending.resolve(false)
      }
    }
    await this.ledger.setRunStatus(runId, 'cancelled', reason)
    this.publish(await this.ledger.event(runId, 'run.cancelled', { reason }))
    return true
  }

  private async gatePhase(event: Parameters<NonNullable<WorkflowRunObserver['beforePhase']>>[0], options: DaemonExecuteOptions): Promise<void> {
    const risk = assessRisk(event)
    if (!risk) return
    const approvalId = randomUUID()
    await this.ledger.setRunStatus(event.runId, 'awaiting_approval')
    await this.ledger.createApproval({ id: approvalId, runId: event.runId, phase: String(event.phase.name), ...risk, provider: event.provider })
    this.publish(await this.ledger.event(event.runId, 'run.awaiting_approval', { approvalId, phase: event.phase.name, ...risk }))

    if (options.autoApprove) {
      await this.decideApproval(event.runId, approvalId, 'approve', 'pre-approved via --approve')
      return
    }

    const timeoutMs = options.approvalTimeoutMs ?? this.approvalTimeoutMs
    const outcome = await this.waitForApproval(event.runId, approvalId, timeoutMs)
    if (outcome === 'timeout') {
      const seconds = Math.round(timeoutMs / 1000)
      await this.ledger.decideApproval(approvalId, 'rejected', `Approval timed out after ${seconds}s`)
      throw new Error(`Approval timed out after ${seconds}s — approve in the console or rerun with --approve`)
    }
    if (outcome === 'rejected') throw new Error('Approval rejected or run cancelled.')
  }

  /** Waits for an approval to be decided either in-process (decideApproval on
   * this same daemon instance) or out-of-process — a separate `bridge serve`
   * dashboard sharing the same .clibridge/runs.db — by polling the ledger.
   * Always settles: after `timeoutMs` it resolves 'timeout' rather than
   * hanging forever. */
  private waitForApproval(runId: string, approvalId: string, timeoutMs: number): Promise<'approved' | 'rejected' | 'timeout'> {
    return new Promise(resolve => {
      let settled = false
      const finish = (outcome: 'approved' | 'rejected' | 'timeout') => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearTimeout(timer)
        this.approvals.delete(approvalId)
        resolve(outcome)
      }
      this.approvals.set(approvalId, { runId, resolve: approved => finish(approved ? 'approved' : 'rejected') })
      const poll = setInterval(() => {
        void this.ledger.getApproval(approvalId).then(row => {
          if (row && row.status !== 'pending') finish(row.status === 'approved' ? 'approved' : 'rejected')
        })
      }, APPROVAL_POLL_INTERVAL_MS)
      const timer = setTimeout(() => finish('timeout'), timeoutMs)
    })
  }

  private publish(event: LedgerEvent): void { this.events.emit('event', event) }
}

function workflowNameFromPath(workflowPath: string): string {
  return path.basename(workflowPath).replace(/\.(workflow\.)?(json|toon)$/i, '')
}

function assessRisk(event: Parameters<NonNullable<WorkflowRunObserver['beforePhase']>>[0]): { action: string; reason: string; scope?: string; impact: string } | null {
  const phase = event.phase as Record<string, unknown>
  const command = [...(Array.isArray(phase.commands) ? phase.commands : []), phase.command].filter((item): item is string => typeof item === 'string').join('\n')
  if (phase.skipPermissions) return { action: 'bypass_provider_permissions', reason: 'The phase requests to bypass provider permission prompts.', impact: 'high' }
  if (event.policy.access === 'unrestricted') return { action: 'unrestricted_access', reason: 'The phase requests unrestricted filesystem access.', impact: 'high' }
  if (/\b(git\s+(push|fetch|pull|config)|curl|wget|npm\s+(install|publish)|pnpm\s+(add|publish)|yarn\s+(add|publish)|pip\s+install|ssh|scp)\b/i.test(command)) return { action: 'network_or_config', reason: 'The command can access a network, install software, or alter Git configuration.', scope: command, impact: 'high' }
  if (/\b(rm\s+-[rf]|git\s+reset\s+--hard|git\s+clean|DROP\s+TABLE)\b/i.test(command)) return { action: 'destructive_command', reason: 'The command can destroy existing files or data.', scope: command, impact: 'high' }
  return null
}
