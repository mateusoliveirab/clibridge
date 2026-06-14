import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { runAgent } from '../../src/broker/run-agent.ts'
import { defaultAdapters } from '../../src/adapters/registry.ts'
import { resolveRole } from '../../src/workflows/roles.ts'
import { newRunId, startRun, phaseStart, phaseEnd, endRun } from '../../src/workflows/run-state.ts'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const taskPromptIndex = args.findLastIndex(a => !a.startsWith('--'))
const taskPrompt = taskPromptIndex >= 0 ? args[taskPromptIndex] : ''

if (!taskPrompt) {
  console.error('Usage: node --import tsx .claude/workflows/gate-job-gate.mjs [--dry-run] "<the task prompt>"')
  process.exit(1)
}

const configPath = new URL('../../src/workflows/workflows-config.json', import.meta.url)
const configStr = readFileSync(configPath, 'utf8')
const config = JSON.parse(configStr)
const patternKey = 'gate-job-gate'
const pattern = config[patternKey]

const runId = newRunId(patternKey)

async function run() {
  const results = {}
  const phasesSummary = []

  startRun({ runId, workflow: patternKey, description: taskPrompt, phases: pattern.phases.map(p => p.name) })

  // Phase: pre
  const prePhase = pattern.phases.find(p => p.name === 'pre')
  const preProvider = resolveRole(prePhase.demand, defaultAdapters)
  const prePrompt = `Task: ${taskPrompt}\n\nAssert: ${prePhase.gate.assert}\nPlease evaluate the preconditions. If they fail, return ok: false.`
  phaseStart(runId, prePhase.name, 0, preProvider)

  const preRes = await runAgent({
    workflow: patternKey,
    phase: prePhase.name,
    label: `${patternKey}:${prePhase.name}`,
    cwd: process.cwd(),
    provider: preProvider,
    prompt: prePrompt,
    dangerouslySkipPermissions: Boolean(prePhase.skipPermissions),
    ...(dryRun ? { dryRun: true, mockText: `[dry-run ${prePhase.name}] gate asserted` } : {})
  })

  results[prePhase.name] = preRes
  phaseEnd(runId, prePhase.name, preRes.ok, preRes.durationMs)
  phasesSummary.push({ name: prePhase.name, provider: preProvider, ok: preRes.ok, durationMs: preRes.durationMs })

  if (!preRes.ok) {
    if (prePhase.gate && prePhase.gate.onFail === 'stop') {
      throw new Error(`Gate assert failed in phase ${prePhase.name}: ${preRes.text}`)
    }
  }

  // Phase: job
  const jobPhase = pattern.phases.find(p => p.name === 'job')
  if (jobPhase.confirmIfDestructive && !dryRun && process.env.WORKFLOW_CONFIRM !== '1') {
    console.warn(`WARNING: Phase '${jobPhase.name}' is destructive.`)
    throw new Error('WORKFLOW_CONFIRM=1 is required for destructive job phase')
  }

  const jobProvider = resolveRole(jobPhase.demand, defaultAdapters)
  const jobPrompt = `Task: ${taskPrompt}\n\nContext from pre phase:\n${preRes.text}\n`
  phaseStart(runId, jobPhase.name, 1, jobProvider)

  const jobRes = await runAgent({
    workflow: patternKey,
    phase: jobPhase.name,
    label: `${patternKey}:${jobPhase.name}`,
    cwd: process.cwd(),
    provider: jobProvider,
    prompt: jobPrompt,
    dangerouslySkipPermissions: Boolean(jobPhase.skipPermissions),
    ...(dryRun ? { dryRun: true, mockText: `[dry-run ${jobPhase.name}] job done` } : {})
  })

  results[jobPhase.name] = jobRes
  phaseEnd(runId, jobPhase.name, jobRes.ok, jobRes.durationMs)
  phasesSummary.push({ name: jobPhase.name, provider: jobProvider, ok: jobRes.ok, durationMs: jobRes.durationMs })

  // Phase: post
  const postPhase = pattern.phases.find(p => p.name === 'post')
  const postProvider = resolveRole(postPhase.demand, defaultAdapters)
  const postPrompt = `Task: ${taskPrompt}\n\nContext from job phase:\n${jobRes.text}\n`
  phaseStart(runId, postPhase.name, 2, postProvider)

  const postRes = await runAgent({
    workflow: patternKey,
    phase: postPhase.name,
    label: `${patternKey}:${postPhase.name}`,
    cwd: process.cwd(),
    provider: postProvider,
    prompt: postPrompt,
    dangerouslySkipPermissions: Boolean(postPhase.skipPermissions),
    ...(dryRun ? { dryRun: true, mockText: `[dry-run ${postPhase.name}] post checks` } : {})
  })

  let verifyOk = postRes.ok
  if (postPhase.gate && postPhase.gate.verify) {
    if (dryRun) {
      console.log(`[dry-run] Would execute gate.verify command: ${postPhase.gate.verify}`)
    } else {
      try {
        execSync(postPhase.gate.verify, { stdio: 'pipe' })
      } catch (err) {
        verifyOk = false
        if (postPhase.gate.onFail === 'stop') {
          phaseEnd(runId, postPhase.name, false, postRes.durationMs)
          throw new Error(`Gate verify failed in phase ${postPhase.name}: ${err.message}`)
        } else if (postPhase.gate.onFail === 'report') {
          postRes.data = { ...(postRes.data || {}), verifyError: err.message }
        }
      }
    }
  }

  results[postPhase.name] = postRes
  phaseEnd(runId, postPhase.name, verifyOk, postRes.durationMs)
  phasesSummary.push({ name: postPhase.name, provider: postProvider, ok: verifyOk, durationMs: postRes.durationMs })

  endRun(runId, phasesSummary.every(p => p.ok))

  console.log(JSON.stringify({
    pattern: patternKey,
    phases: phasesSummary,
    finalText: postRes.text
  }, null, 2))
}

run().catch(err => {
  endRun(runId, false)
  console.error(err.message)
  process.exit(1)
})
