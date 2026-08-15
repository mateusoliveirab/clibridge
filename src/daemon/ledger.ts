import { createClient, type Client } from '@libsql/client'
import fs from 'node:fs'
import path from 'node:path'
import { redact } from './redaction.ts'

export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'cancelled' | 'failed' | 'completed'
export interface LedgerEvent { id?: number; runId: string; type: string; ts: number; payload: Record<string, unknown> }

export class RunLedger {
  private readonly client: Client
  readonly stateDir: string

  constructor(readonly cwd: string) {
    this.stateDir = path.join(cwd, '.clibridge')
    fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 })
    this.client = createClient({ url: `file:${path.join(this.stateDir, 'runs.db')}` })
  }

  async migrate(): Promise<void> {
    await this.client.batch([
      `CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow TEXT NOT NULL, cwd TEXT NOT NULL, task TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER, updated_at INTEGER NOT NULL, ended_at INTEGER, error TEXT, pinned INTEGER NOT NULL DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS phases (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, name TEXT NOT NULL, phase_index INTEGER NOT NULL, provider TEXT, status TEXT NOT NULL, started_at INTEGER, ended_at INTEGER, duration_ms INTEGER, output TEXT, error TEXT)`,
      `CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, phase_id INTEGER, attempt_index INTEGER NOT NULL, provider TEXT, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, output TEXT, error TEXT)`,
      `CREATE TABLE IF NOT EXISTS policy_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, phase TEXT, action TEXT NOT NULL, reason TEXT NOT NULL, scope TEXT, provider TEXT, impact TEXT, created_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, phase TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, scope TEXT, provider TEXT, impact TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER, decision_reason TEXT)`,
      `CREATE TABLE IF NOT EXISTS artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, phase TEXT, kind TEXT NOT NULL, path TEXT, content TEXT, created_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, type TEXT NOT NULL, ts INTEGER NOT NULL, payload TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id, id)`,
      `CREATE INDEX IF NOT EXISTS idx_runs_updated_at ON runs(updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at DESC)`,
    ].map(sql => ({ sql })))
  }

  async createRun(run: { id: string; workflow: string; cwd: string; task: string }): Promise<void> {
    const now = Date.now()
    await this.client.execute({ sql: `INSERT OR REPLACE INTO runs (id,workflow,cwd,task,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, args: [run.id, run.workflow, run.cwd, redact(run.task) as string, 'queued', now, now] })
    await this.event(run.id, 'run.queued', { workflow: run.workflow, cwd: run.cwd })
  }

  async event(runId: string, type: string, payload: Record<string, unknown>): Promise<LedgerEvent> {
    const ts = Date.now()
    const clean = redact(payload) as Record<string, unknown>
    const result = await this.client.execute({ sql: `INSERT INTO events (run_id,type,ts,payload) VALUES (?,?,?,?)`, args: [runId, type, ts, JSON.stringify(clean)] })
    return { id: Number(result.lastInsertRowid), runId, type, ts, payload: clean }
  }

  async setRunStatus(id: string, status: RunStatus, error?: string): Promise<void> {
    const now = Date.now()
    const terminal = ['cancelled', 'failed', 'completed'].includes(status)
    await this.client.execute({ sql: `UPDATE runs SET status=?, updated_at=?, started_at=CASE WHEN ?='running' AND started_at IS NULL THEN ? ELSE started_at END, ended_at=CASE WHEN ? THEN ? ELSE ended_at END, error=COALESCE(?, error) WHERE id=?`, args: [status, now, status, now, terminal ? 1 : 0, now, error ? redact(error) as string : null, id] })
  }

  // Lifecycle inserts return the LedgerEvent they created so callers (the
  // daemon) can publish it without inserting a second, duplicate event row.
  async phaseStart(runId: string, name: string, index: number, provider: string): Promise<LedgerEvent> {
    const now = Date.now()
    await this.client.execute({ sql: `INSERT INTO phases (run_id,name,phase_index,provider,status,started_at) VALUES (?,?,?,?,?,?)`, args: [runId, name, index, provider, 'running', now] })
    return this.event(runId, 'phase.started', { phase: name, phaseIndex: index, provider })
  }

  async phaseEnd(runId: string, name: string, ok: boolean, durationMs: number, output?: string, error?: string): Promise<LedgerEvent> {
    const status = ok ? 'completed' : 'failed'
    const now = Date.now()
    await this.client.execute({ sql: `UPDATE phases SET status=?, ended_at=?, duration_ms=?, output=?, error=? WHERE id=(SELECT id FROM phases WHERE run_id=? AND name=? ORDER BY id DESC LIMIT 1)`, args: [status, now, durationMs, output ? redact(output) as string : null, error ? redact(error) as string : null, runId, name] })
    return this.event(runId, 'phase.finished', { phase: name, ok, durationMs, error })
  }

  async createApproval(approval: { id: string; runId: string; phase: string; action: string; reason: string; scope?: string; provider?: string; impact?: string }): Promise<void> {
    const now = Date.now()
    await this.client.execute({ sql: `INSERT INTO approvals (id,run_id,phase,action,reason,scope,provider,impact,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, args: [approval.id, approval.runId, approval.phase, approval.action, approval.reason, approval.scope || null, approval.provider || null, approval.impact || null, 'pending', now] })
    await this.client.execute({ sql: `INSERT INTO policy_decisions (run_id,phase,action,reason,scope,provider,impact,created_at) VALUES (?,?,?,?,?,?,?,?)`, args: [approval.runId, approval.phase, approval.action, approval.reason, approval.scope || null, approval.provider || null, approval.impact || null, now] })
    await this.event(approval.runId, 'approval.requested', approval)
  }

  async decideApproval(id: string, decision: 'approved' | 'rejected', reason?: string): Promise<{ runId: string } | null> {
    const found = await this.client.execute({ sql: `SELECT run_id FROM approvals WHERE id=? AND status='pending'`, args: [id] })
    if (!found.rows[0]) return null
    const runId = String(found.rows[0].run_id)
    const now = Date.now()
    await this.client.execute({ sql: `UPDATE approvals SET status=?,decided_at=?,decision_reason=? WHERE id=?`, args: [decision, now, reason || null, id] })
    await this.event(runId, `approval.${decision}`, { approvalId: id, reason })
    return { runId }
  }

  async getRun(id: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.execute({ sql: `SELECT * FROM runs WHERE id=?`, args: [id] })
    const run = result.rows[0]
    if (!run) return null
    const [phases, approvals, artifacts] = await Promise.all([
      this.client.execute({ sql: `SELECT * FROM phases WHERE run_id=? ORDER BY phase_index,id`, args: [id] }),
      this.client.execute({ sql: `SELECT * FROM approvals WHERE run_id=? ORDER BY created_at`, args: [id] }),
      this.client.execute({ sql: `SELECT * FROM artifacts WHERE run_id=? ORDER BY id`, args: [id] }),
    ])
    return { ...row(run), phases: phases.rows.map(row), approvals: approvals.rows.map(row), artifacts: artifacts.rows.map(row) }
  }

  async listRuns(filters: { status?: string; workflow?: string; provider?: string; since?: number } = {}): Promise<Record<string, unknown>[]> {
    const clauses: string[] = []
    const args: (string | number)[] = []
    if (filters.status) { clauses.push('r.status=?'); args.push(filters.status) }
    if (filters.workflow) { clauses.push('r.workflow=?'); args.push(filters.workflow) }
    if (filters.since) { clauses.push('r.created_at>=?'); args.push(filters.since) }
    if (filters.provider) { clauses.push(`EXISTS (SELECT 1 FROM phases p WHERE p.run_id=r.id AND p.provider=?)`); args.push(filters.provider) }
    const result = await this.client.execute({ sql: `SELECT r.*, (SELECT count(*) FROM approvals a WHERE a.run_id=r.id AND a.status='pending') AS pending_approvals, (SELECT group_concat(DISTINCT p.provider) FROM phases p WHERE p.run_id=r.id AND p.provider IS NOT NULL) AS providers FROM runs r ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY r.updated_at DESC LIMIT 250`, args })
    return result.rows.map(row)
  }

  async events(runId?: string, after = 0): Promise<LedgerEvent[]> {
    const result = await this.client.execute(runId
      ? { sql: `SELECT * FROM events WHERE run_id=? AND id>? ORDER BY id`, args: [runId, after] }
      : { sql: `SELECT * FROM events WHERE id>? ORDER BY id`, args: [after] })
    return result.rows.map(item => ({ id: Number(item.id), runId: String(item.run_id), type: String(item.type), ts: Number(item.ts), payload: JSON.parse(String(item.payload)) }))
  }

  async pendingApprovals(): Promise<Record<string, unknown>[]> {
    const result = await this.client.execute(`SELECT * FROM approvals WHERE status='pending' ORDER BY created_at`)
    return result.rows.map(row)
  }

  async getApproval(id: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.execute({ sql: `SELECT * FROM approvals WHERE id=?`, args: [id] })
    return result.rows[0] ? row(result.rows[0]) : null
  }

  async purge(days = 30): Promise<number> {
    const cutoff = Date.now() - days * 86_400_000
    const result = await this.client.execute({ sql: `DELETE FROM runs WHERE created_at<? AND pinned=0 AND status='completed'`, args: [cutoff] })
    return Number(result.rowsAffected)
  }
}

function row(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'bigint' ? Number(item) : item]))
}
