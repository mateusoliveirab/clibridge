import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalDaemon } from './daemon.ts'
import { daemonFor } from './client.ts'
import { providerStatuses } from '../adapters/availability.ts'
import { defaultAdapters } from '../adapters/registry.ts'
import { WorkflowFileSchema } from '../workflows/workflow-executor.ts'
import { decode as decodeToon } from '@toon-format/toon'

export interface ServingDaemon { daemon: LocalDaemon; server: http.Server; port: number; url: string; close(): Promise<void> }

export async function serveProject(cwd: string, requestedPort = 0): Promise<ServingDaemon> {
  const daemon = await daemonFor(cwd)
  const server = http.createServer()
  const sockets = new Set<import('node:net').Socket>()
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(requestedPort, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Daemon did not receive a TCP address.')
  const port = address.port
  const url = `http://127.0.0.1:${port}`
  server.on('request', (request, response) => void handle(daemon, port, request, response))
  writeMetadata(daemon, { pid: process.pid, port, url, cwd, startedAt: Date.now() })
  return {
    daemon, server, port, url,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      for (const socket of sockets) socket.destroy()
    })
  }
}

function isTrustedRequest(port: number, request: http.IncomingMessage): boolean {
  const host = request.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false
  const origin = request.headers.origin
  if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return false
  return true
}

async function handle(daemon: LocalDaemon, port: number, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  try {
    if (!isTrustedRequest(port, request)) return json(response, 403, { error: 'Forbidden' })
    if ((request.method === 'POST' || request.method === 'PUT') && !String(request.headers['content-type'] || '').startsWith('application/json')) return json(response, 415, { error: 'Content-Type must be application/json' })
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/api/events') return streamEvents(daemon, request, response)
    if (url.pathname === '/api/runs' && request.method === 'GET') return json(response, 200, await daemon.ledger.listRuns({ status: url.searchParams.get('status') || undefined, workflow: url.searchParams.get('workflow') || undefined, provider: url.searchParams.get('provider') || undefined, since: numberParam(url.searchParams.get('since')) }))
    if (url.pathname === '/api/approvals' && request.method === 'GET') return json(response, 200, await daemon.ledger.pendingApprovals())
    if (url.pathname === '/api/providers' && request.method === 'GET') return json(response, 200, await providerStatuses(defaultAdapters))
    if (url.pathname === '/api/runs' && request.method === 'POST') {
      const body = await bodyJson(request)
      return json(response, 202, await daemon.startWorkflow(body))
    }
    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
    if (runMatch && request.method === 'GET') {
      const run = await daemon.ledger.getRun(decodeURIComponent(runMatch[1]!))
      return run ? json(response, 200, run) : json(response, 404, { error: 'Run not found' })
    }
    const eventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/)
    if (eventMatch && request.method === 'GET') return json(response, 200, await daemon.ledger.events(decodeURIComponent(eventMatch[1]!)))
    const approvalMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/approvals\/([^/]+)$/)
    if (approvalMatch && request.method === 'POST') {
      const body = await bodyJson(request)
      const decision = body.decision === 'approve' ? 'approve' : 'reject'
      const ok = await daemon.decideApproval(decodeURIComponent(approvalMatch[1]!), decodeURIComponent(approvalMatch[2]!), decision, typeof body.reason === 'string' ? body.reason : undefined)
      return json(response, ok ? 200 : 404, ok ? { ok: true } : { error: 'Approval not found' })
    }
    const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/)
    if (cancelMatch && request.method === 'POST') {
      const body = await bodyJson(request)
      const ok = await daemon.cancel(decodeURIComponent(cancelMatch[1]!), typeof body.reason === 'string' ? body.reason : undefined)
      return json(response, ok ? 200 : 404, ok ? { ok: true } : { error: 'Run not found' })
    }
    if (url.pathname === '/api/workflows' && request.method === 'GET') return json(response, 200, listWorkflows(daemon.cwd))
    const workflowMatch = url.pathname.match(/^\/api\/workflows\/(.+)$/)
    if (workflowMatch) return await workflowFile(daemon.cwd, decodeURIComponent(workflowMatch[1]!), request, response)
    return staticFile(request, response)
  } catch (error) {
    json(response, 400, { error: (error as Error).message })
  }
}

function streamEvents(daemon: LocalDaemon, request: http.IncomingMessage, response: http.ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' })
  response.flushHeaders()
  let last = Number(request.headers['last-event-id'] || 0)
  const write = (event: any) => { if (event.id > last) { last = event.id; response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`) } }
  void daemon.ledger.events(undefined, last).then(events => events.forEach(write))
  daemon.events.on('event', write)
  const interval = setInterval(() => void daemon.ledger.events(undefined, last).then(events => events.forEach(write)), 1_000)
  request.on('close', () => { clearInterval(interval); daemon.events.off('event', write) })
}

function listWorkflows(cwd: string): Array<{ path: string; format: string }> {
  const ignored = new Set(['node_modules', '.git', '.clibridge', '.claude', 'dist'])
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return ignored.has(entry.name) ? [] : walk(full)
    return /\.(json|toon)$/.test(entry.name) && /workflow|workflows/.test(full) ? [path.relative(cwd, full)] : []
  })
  return walk(cwd).filter(file => {
    try {
      const source = fs.readFileSync(safeProjectPath(cwd, file), 'utf8')
      WorkflowFileSchema.parse(file.endsWith('.toon') ? decodeToon(source) : JSON.parse(source))
      return true
    } catch { return false }
  }).sort().map(file => ({ path: file, format: file.endsWith('.toon') ? 'toon' : 'json' }))
}

async function workflowFile(cwd: string, relative: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const file = safeProjectPath(cwd, relative)
  if (!/\.(json|toon)$/.test(file)) throw new Error('Workflows must be JSON or TOON files.')
  if (request.method === 'GET') return json(response, 200, { path: relative, content: fs.readFileSync(file, 'utf8') })
  if (request.method === 'PUT') {
    if (!/workflow|workflows/.test(relative)) throw new Error('Workflow path must contain "workflow" or "workflows".')
    const body = await bodyJson(request)
    if (typeof body.content !== 'string') throw new Error('content must be a string')
    // Validate source through the executor loader without modifying it.
    const parsed = file.endsWith('.json') ? JSON.parse(body.content) : decodeToon(body.content)
    WorkflowFileSchema.parse(parsed)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body.content)
    return json(response, 200, { ok: true, path: relative })
  }
  json(response, 405, { error: 'Method not allowed' })
}

function staticFile(request: http.IncomingMessage, response: http.ServerResponse): void {
  const dirname = path.dirname(fileURLToPath(import.meta.url))
  const roots = [path.resolve(dirname, '../dashboard'), path.resolve(dirname, '../../dist/dashboard')]
  const root = roots.find(candidate => fs.existsSync(candidate)) || roots[0]!
  const relative = (request.url || '/').split('?')[0]!.replace(/^\/+/, '') || 'index.html'
  const target = path.resolve(root, relative)
  const file = target.startsWith(root) && fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(root, 'index.html')
  if (!fs.existsSync(file)) return json(response, 503, { error: 'Dashboard assets are not built. Run npm run build.' })
  const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream'
  response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' })
  fs.createReadStream(file).pipe(response)
}

function safeProjectPath(cwd: string, relative: string): string {
  const realCwd = fs.realpathSync(cwd)
  const target = path.resolve(cwd, relative)
  if (target !== cwd && !target.startsWith(`${cwd}${path.sep}`)) throw new Error('Path is outside the project.')

  // Lexical containment is not enough for the console API: a workflow file or
  // one of its parent directories can be a symlink to another project.
  let existing = target
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  const realExisting = fs.realpathSync(existing)
  const unresolvedSuffix = path.relative(existing, target)
  const realTarget = path.resolve(realExisting, unresolvedSuffix)
  const relativeTarget = path.relative(realCwd, realTarget)
  if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
    throw new Error('Path resolves outside the project.')
  }
  return target
}
function writeMetadata(daemon: LocalDaemon, metadata: object): void { fs.writeFileSync(path.join(daemon.ledger.stateDir, 'daemon.json'), JSON.stringify(metadata, null, 2), { mode: 0o600 }) }
function numberParam(value: string | null): number | undefined { return value && Number.isFinite(Number(value)) ? Number(value) : undefined }
function json(response: http.ServerResponse, status: number, value: unknown): void { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)) }
async function bodyJson(request: http.IncomingMessage): Promise<any> { let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 1_000_000) throw new Error('Request body is too large.') } return raw ? JSON.parse(raw) : {} }
