import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { serveProject } from '../src/daemon/http-server.ts'

function project() { return fs.mkdtempSync(path.join(os.tmpdir(), 'clibridge-console-')) }
async function waitFor(runUrl, predicate) {
  for (let index = 0; index < 30; index++) {
    const run = await (await fetch(runUrl)).json()
    if (predicate(run)) return run
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${runUrl}`)
}
async function request(url, method, body) {
  return fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}
function rawRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = http.request(target, { method, headers }, response => {
      let raw = ''
      response.on('data', chunk => { raw += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body: raw }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

test('local console persists runs, redacts output, and streams an approval gate', async () => {
  const cwd = project()
  let serving
  try {
    fs.writeFileSync(path.join(cwd, 'safe.workflow.json'), JSON.stringify({ name: 'safe', phases: [{ name: 'inspect', kind: 'shell', command: 'node -e "console.log(\'sk-123456789012345\')"' }] }))
    fs.writeFileSync(path.join(cwd, 'gated.workflow.json'), JSON.stringify({ name: 'gated', phases: [{ name: 'publish', kind: 'shell', command: 'git push origin main' }] }))
    serving = await serveProject(cwd)

    const started = await request(`${serving.url}/api/runs`, 'POST', { workflowPath: 'safe.workflow.json', task: 'run a safe check' })
    assert.equal(started.status, 202)
    const { runId } = await started.json()
    const completed = await waitFor(`${serving.url}/api/runs/${runId}`, run => run.status === 'completed')
    assert.match(completed.phases[0].output, /\[REDACTED\]/)
    assert.doesNotMatch(completed.phases[0].output, /sk-123456789012345/)

    const gated = await request(`${serving.url}/api/runs`, 'POST', { workflowPath: 'gated.workflow.json', task: 'publish', dryRun: true })
    const { runId: gatedId } = await gated.json()
    const waiting = await waitFor(`${serving.url}/api/runs/${gatedId}`, run => run.status === 'awaiting_approval')
    assert.equal(waiting.approvals.length, 1)
    const approval = waiting.approvals[0]
    const approved = await request(`${serving.url}/api/runs/${gatedId}/approvals/${approval.id}`, 'POST', { decision: 'approve' })
    assert.equal(approved.status, 200)
    assert.equal((await waitFor(`${serving.url}/api/runs/${gatedId}`, run => run.status === 'completed')).status, 'completed')

    const invalid = await request(`${serving.url}/api/workflows/safe.workflow.json`, 'PUT', { content: '{"name":"missing phases"}' })
    assert.equal(invalid.status, 400)
    const source = await (await fetch(`${serving.url}/api/workflows/safe.workflow.json`)).json()
    assert.match(source.content, /safe/)
  } finally {
    await serving?.close()
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('local console rejects untrusted requests and restricts workflow writes', async () => {
  const cwd = project()
  let serving
  try {
    fs.writeFileSync(path.join(cwd, 'safe.workflow.json'), JSON.stringify({ name: 'safe', phases: [{ name: 'inspect', kind: 'shell', command: 'node -e "1"' }] }))
    serving = await serveProject(cwd)

    const textPlain = await rawRequest(`${serving.url}/api/runs`, 'POST', { host: `127.0.0.1:${serving.port}`, 'content-type': 'text/plain' }, JSON.stringify({ workflowPath: 'safe.workflow.json', task: 'x' }))
    assert.equal(textPlain.status, 415)

    const forgedHost = await rawRequest(`${serving.url}/api/runs`, 'GET', { host: 'evil.com' })
    assert.equal(forgedHost.status, 403)

    const forgedOrigin = await rawRequest(`${serving.url}/api/runs`, 'GET', { host: `127.0.0.1:${serving.port}`, origin: 'http://evil.com' })
    assert.equal(forgedOrigin.status, 403)

    const badPath = await request(`${serving.url}/api/workflows/config.json`, 'PUT', { content: JSON.stringify({ name: 'x', phases: [] }) })
    assert.equal(badPath.status, 400)
  } finally {
    await serving?.close()
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('local console rejects workflow symlinks that resolve outside the project', async () => {
  const cwd = project()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'clibridge-console-outside-'))
  let serving
  try {
    fs.writeFileSync(path.join(outside, 'outside.workflow.json'), JSON.stringify({ name: 'outside', phases: [] }))
    fs.symlinkSync(path.join(outside, 'outside.workflow.json'), path.join(cwd, 'linked.workflow.json'))
    serving = await serveProject(cwd)

    const response = await request(`${serving.url}/api/workflows/linked.workflow.json`, 'GET')
    assert.equal(response.status, 400)
  } finally {
    await serving?.close()
    fs.rmSync(cwd, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('serveProject.close() resolves promptly with an open SSE connection', async () => {
  const cwd = project()
  let serving
  try {
    serving = await serveProject(cwd)
    const sse = http.request(new URL(`${serving.url}/api/events`), { method: 'GET' })
    sse.on('error', () => {})
    sse.end()
    await new Promise(resolve => sse.once('response', response => { response.on('error', () => {}); resolve() }))

    const closed = await Promise.race([
      serving.close().then(() => 'closed'),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 2_000))
    ])
    assert.equal(closed, 'closed')
    serving = undefined
  } finally {
    await serving?.close()
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
