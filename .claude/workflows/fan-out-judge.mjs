import { readFileSync } from 'node:fs'
import { runAgent } from '../../src/broker/run-agent.ts'
import { defaultAdapters } from '../../src/adapters/registry.ts'
import { resolveRole, listWriters } from '../../src/workflows/roles.ts'
import { newRunId, startRun, phaseStart, phaseEnd, endRun } from '../../src/workflows/run-state.ts'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const taskPrompt = args.find(a => !a.startsWith('--'))

if (!taskPrompt) {
  console.error('Usage: node --import tsx .claude/workflows/fan-out-judge.mjs [--dry-run] "<the task prompt>"')
  process.exit(1)
}

const configRaw = readFileSync(new URL('../../src/workflows/workflows-config.json', import.meta.url), 'utf8')
const config = JSON.parse(configRaw)
const pattern = config['fan-out-judge']

const summary = { pattern: pattern.name, phases: [], finalText: '' }
const results = {}

const runId = newRunId(pattern.name)

async function run() {
  startRun({ runId, workflow: pattern.name, description: taskPrompt, phases: pattern.phases.map(p => p.name) })

  // Phase 1: attempts (fan-out)
  const attemptsPhase = pattern.phases.find(p => p.name === 'attempts')
  const writers = listWriters(defaultAdapters)
  phaseStart(runId, attemptsPhase.name, 0, writers.join(','))

  const attemptPromises = writers.map(provider => {
    return runAgent({
      workflow: pattern.name,
      phase: attemptsPhase.name,
      label: `${pattern.name}:${attemptsPhase.name}`,
      cwd: process.cwd(),
      provider,
      prompt: taskPrompt,
      dangerouslySkipPermissions: true,
      ...(dryRun ? { dryRun: true, mockText: `[dry-run output from ${provider}]` } : {})
    }).then(res => ({ provider, res }))
  })

  const allAttempts = await Promise.all(attemptPromises)
  const attemptsData = allAttempts.map(a => ({
    provider: a.provider,
    text: a.res.text
  }))
  results[attemptsPhase.name] = attemptsData

  let attemptsMaxDuration = 0
  for (const a of allAttempts) {
    attemptsMaxDuration = Math.max(attemptsMaxDuration, a.res.durationMs || 0)
    summary.phases.push({
      name: `${attemptsPhase.name}-${a.provider}`,
      provider: a.provider,
      ok: a.res.ok,
      durationMs: a.res.durationMs
    })
  }
  phaseEnd(runId, attemptsPhase.name, allAttempts.every(a => a.res.ok), attemptsMaxDuration)

  // Phase 2: judge
  const judgePhase = pattern.phases.find(p => p.name === 'judge')
  const judgeProvider = resolveRole(judgePhase.demand, defaultAdapters)
  phaseStart(runId, judgePhase.name, 1, judgeProvider)

  let judgePrompt = `Task:\n${taskPrompt}\n\nHere are the attempts:\n\n`
  for (const a of attemptsData) {
    judgePrompt += `--- Attempt by ${a.provider} ---\n${a.text}\n\n`
  }
  judgePrompt += 'Evaluate these attempts and pick the best one.'

  const schema = {
    type: 'object',
    properties: {
      winner: { type: 'string' },
      reason: { type: 'string' }
    },
    required: ['winner', 'reason']
  }

  const mockJudgeData = {
    winner: writers[0] || 'none',
    reason: 'Best dry-run output'
  }

  const judgeResult = await runAgent({
    workflow: pattern.name,
    phase: judgePhase.name,
    label: `${pattern.name}:${judgePhase.name}`,
    cwd: process.cwd(),
    provider: judgeProvider,
    prompt: judgePrompt,
    dangerouslySkipPermissions: Boolean(judgePhase.skipPermissions),
    schema,
    ...(dryRun ? { dryRun: true, mockText: JSON.stringify(mockJudgeData), mockData: mockJudgeData } : {})
  })

  phaseEnd(runId, judgePhase.name, judgeResult.ok, judgeResult.durationMs)
  summary.phases.push({
    name: judgePhase.name,
    provider: judgeProvider,
    ok: judgeResult.ok,
    durationMs: judgeResult.durationMs
  })

  const finalJudgeOutput = judgeResult.structured ? JSON.stringify(judgeResult.data, null, 2) : judgeResult.text
  results[judgePhase.name] = finalJudgeOutput

  summary.finalText = finalJudgeOutput

  endRun(runId, summary.phases.every(p => p.ok))

  console.log(JSON.stringify(summary, null, 2))
}

run().catch(err => {
  endRun(runId, false)
  console.error(err)
  process.exit(1)
})
