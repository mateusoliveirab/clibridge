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
  console.error('Usage: node --import tsx .claude/workflows/describe-after-apply.mjs [--dry-run] "<the task prompt>"')
  process.exit(1)
}

const configPath = new URL('../../src/workflows/workflows-config.json', import.meta.url)
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const pattern = config['describe-after-apply']

const results = {}
const summaryPhases = []
let finalText = ''

const runId = newRunId('describe-after-apply')

async function run() {
  startRun({ runId, workflow: 'describe-after-apply', description: taskPrompt, phases: pattern.phases.map(p => p.name) })

  for (let phaseIndex = 0; phaseIndex < pattern.phases.length; phaseIndex++) {
    const phase = pattern.phases[phaseIndex]
    const provider = resolveRole(phase.demand, defaultAdapters)
    phaseStart(runId, phase.name, phaseIndex, provider)
    let prompt = taskPrompt

    if (phase.name === 'describe') {
      const jobResult = results['job']
      prompt = `Context from job phase:
${jobResult.text}

Captured outputs from actual changes:
${jobResult.capturedOutputs}

Original task:
${taskPrompt}

Please generate a PR/report description generated FROM the real changes (not a pre-written template).`
    }

    const result = await runAgent({
      workflow: 'describe-after-apply',
      phase: phase.name,
      label: `describe-after-apply:${phase.name}`,
      cwd: process.cwd(),
      provider,
      prompt,
      dangerouslySkipPermissions: Boolean(phase.skipPermissions),
      ...(dryRun ? { dryRun: true, mockText: `[dry-run ${phase.name}]` } : {})
    })

    results[phase.name] = result
    phaseEnd(runId, phase.name, result.ok, result.durationMs)
    summaryPhases.push({
      name: phase.name,
      provider: provider,
      ok: result.ok,
      durationMs: result.durationMs
    })

    if (!result.ok) break

    if (phase.name === 'job') {
      let capturedOutputs = ''
      if (dryRun) {
        capturedOutputs = '[dry-run: skipped git diff --stat and git status --short]'
      } else {
        try {
          const stat = execSync('git diff --stat', { encoding: 'utf8' })
          const short = execSync('git status --short', { encoding: 'utf8' })
          capturedOutputs = `--- git diff --stat ---\n${stat}\n--- git status --short ---\n${short}`
        } catch (err) {
          capturedOutputs = `Failed to capture git output: ${err.message}`
        }
      }
      results['job'].capturedOutputs = capturedOutputs
    }

    if (phase.name === 'describe') {
      finalText = result.text
    }
  }

  endRun(runId, summaryPhases.length === pattern.phases.length && summaryPhases.every(p => p.ok))

  console.log(JSON.stringify({
    pattern: 'describe-after-apply',
    phases: summaryPhases,
    finalText
  }, null, 2))
}

run().catch(err => {
  endRun(runId, false)
  console.error(err)
  process.exit(1)
})
