import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { runAgent } from '../../src/broker/run-agent.ts'
import { defaultAdapters } from '../../src/adapters/registry.ts'
import { resolveRole } from '../../src/workflows/roles.ts'
import { newRunId, startRun, phaseStart, phaseEnd, endRun } from '../../src/workflows/run-state.ts'

const configPath = new URL('../../src/workflows/workflows-config.json', import.meta.url)
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const patternConfig = config['research-plan-implement']

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const taskPromptIndex = args.findLastIndex(a => !a.startsWith('--'))
const userTask = taskPromptIndex >= 0 ? args[taskPromptIndex] : ''

if (!userTask) {
  console.error('Please provide a task prompt.')
  process.exit(1)
}

const results = {}
const summaryPhases = []

const workflowName = 'research-plan-implement'
const phaseNames = patternConfig.phases.map(p => p.name)
const runId = newRunId(workflowName)

async function run() {
  startRun({ runId, workflow: workflowName, description: userTask, phases: phaseNames })
  for (let phaseIndex = 0; phaseIndex < patternConfig.phases.length; phaseIndex++) {
    const phase = patternConfig.phases[phaseIndex]
    const provider = resolveRole(phase.demand, defaultAdapters)
    phaseStart(runId, phase.name, phaseIndex, provider)

    let currentPrompt = ''
    if (phase.name === 'research') {
      currentPrompt = `Investigate and gather context for: ${userTask}`
    } else if (phase.name === 'plan') {
      currentPrompt = `Context from research phase:\n${results['research'].text}\n\nBased on the context, provide a step-by-step implementation plan for the following task: ${userTask}`
    } else if (phase.name === 'implement') {
      currentPrompt = `Context from plan phase:\n${results['plan'].text}\n\nPlease implement the plan for the following task: ${userTask}`
    }
    
    const runOpts = {
      workflow: 'research-plan-implement',
      phase: phase.name,
      label: `research-plan-implement:${phase.name}`,
      cwd: process.cwd(),
      provider,
      prompt: currentPrompt,
      dangerouslySkipPermissions: Boolean(phase.skipPermissions),
      ...(dryRun ? { dryRun: true, mockText: `[dry-run ${phase.name}]` } : {})
    }
    
    const result = await runAgent(runOpts)
    results[phase.name] = result
    
    let finalOk = result.ok
    
    if (phase.gate && phase.gate.verify) {
      if (dryRun) {
        console.log(`[Gate] Would run verify command: ${phase.gate.verify}`)
      } else {
        try {
          execSync(phase.gate.verify, { stdio: 'pipe', cwd: process.cwd() })
        } catch (error) {
          const verifyOutput = error.stdout?.toString() || error.message
          if (phase.gate.onFail === 'stop') {
            phaseEnd(runId, phase.name, false, result.durationMs)
            throw new Error(`Gate verify failed: ${verifyOutput}`)
          } else if (phase.gate.onFail === 'report') {
            finalOk = false
            results[phase.name].gateError = verifyOutput
          }
        }
      }
    }
    
    phaseEnd(runId, phase.name, finalOk, result.durationMs)
    summaryPhases.push({
      name: phase.name,
      provider,
      ok: finalOk,
      durationMs: result.durationMs
    })
  }

  endRun(runId, summaryPhases.every(p => p.ok))

  const summary = {
    pattern: 'research-plan-implement',
    phases: summaryPhases,
    finalText: results['implement'].text
  }
  
  console.log(JSON.stringify(summary, null, 2))
}

run().catch(err => {
  endRun(runId, false)
  console.error(err)
  process.exit(1)
})
