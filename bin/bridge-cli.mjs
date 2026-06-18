#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWorkflow } from '../dist/workflows/workflow-executor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workflowsConfigPath = path.join(__dirname, '..', 'dist', 'workflows', 'workflows-config.json')
const contractPath = path.join(__dirname, '..', 'docs', 'workflow-executor-contract.md')

const args = process.argv.slice(2)
const command = args[0]

if (!command || command === '--help' || command === '-h' || command === 'help') {
  printHelp()
  process.exit(0)
}

switch (command) {
  case 'list': {
    listWorkflows()
    break
  }
  case 'info': {
    const name = args[1]
    if (!name) {
      console.error('Error: Please specify a workflow name. Example: bridge-cli info headroom-contribution')
      process.exit(1)
    }
    showWorkflowInfo(name)
    break
  }
  case 'doc': {
    showContractDoc()
    break
  }
  case 'run': {
    await runWorkflowCmd()
    break
  }
  default: {
    console.error(`Unknown command: ${command}`)
    printHelp()
    process.exit(1)
  }
}

function printHelp() {
  console.log(`
MCP Workflow CLI Bridge CLI
===========================
Usage:
  node --import tsx bin/bridge-cli.mjs <command> [arguments]

Commands:
  list                  List all registered workflow configurations.
  info <name>           Show detailed phase information for a registered workflow.
  doc                   Print the generic workflow executor contract and specification.
  run <workflow-path>   Run a declarative workflow JSON file.
                        Options:
                          --cwd <path>          Set target directory (default: current directory).
                          --task <prompt>       Set the main task/prompt for the workflow.
                          --dry-run             Run in dry-run mode (does not mutate files).
                          --inputs <json>       JSON string of workflow input variables.
                          --contract-format <format>
                                                Render agent-to-agent object context as json or toon.
                          --timeout-ms <ms>     Timeout passed to agent phases.
  help                  Show this help menu.
`)
}

function listWorkflows() {
  if (!fs.existsSync(workflowsConfigPath)) {
    console.log('No registered workflows config found.')
    return
  }
  const config = JSON.parse(fs.readFileSync(workflowsConfigPath, 'utf8'))
  console.log('\nRegistered Workflows:')
  console.log('=====================')
  for (const [key, wf] of Object.entries(config)) {
    console.log(`- ${key}: ${wf.description || 'No description'}`)
  }
  console.log('\nUse "bridge-cli info <name>" to inspect a workflow\'s phases.\n')
}

function showWorkflowInfo(name) {
  if (!fs.existsSync(workflowsConfigPath)) {
    console.log('No registered workflows config found.')
    return
  }
  const config = JSON.parse(fs.readFileSync(workflowsConfigPath, 'utf8'))
  const wf = config[name]
  if (!wf) {
    console.error(`Error: Workflow "${name}" not found.`)
    process.exit(1)
  }

  console.log(`\nWorkflow: ${name}`)
  console.log(`Description: ${wf.description || 'None'}`)
  console.log(`When to use: ${wf.whenToUse || 'N/A'}`)
  console.log(`Anti-pattern: ${wf.antiPattern || 'N/A'}`)
  console.log('\nPhases:')
  wf.phases.forEach((p, idx) => {
    console.log(`  ${idx + 1}. [${p.kind || 'agent'}] ${p.name}`)
    if (p.role) console.log(`     Role: ${p.role}`)
    if (p.provider) console.log(`     Provider: ${p.provider}`)
  })
  console.log('')
}

function showContractDoc() {
  if (!fs.existsSync(contractPath)) {
    console.log('Contract documentation file not found.')
    return
  }
  console.log(fs.readFileSync(contractPath, 'utf8'))
}

async function runWorkflowCmd() {
  const workflowPath = args[1]
  if (!workflowPath) {
    console.error('Error: Please specify a workflow path. Example: bridge-cli run examples/headroom-contribution.workflow.json')
    process.exit(1)
  }

  // Parse options
  let cwd = process.cwd()
  let task = ''
  let dryRun = false
  let inputs = {}
  let contractFormat
  let timeoutMs

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--cwd') {
      cwd = args[i + 1]
      i++
    } else if (args[i] === '--task') {
      task = args[i + 1]
      i++
    } else if (args[i] === '--dry-run') {
      dryRun = true
    } else if (args[i] === '--inputs') {
      inputs = JSON.parse(args[i + 1])
      i++
    } else if (args[i] === '--contract-format') {
      contractFormat = args[i + 1]
      if (!['json', 'toon'].includes(contractFormat)) {
        console.error('Error: --contract-format must be "json" or "toon"')
        process.exit(1)
      }
      i++
    } else if (args[i] === '--timeout-ms') {
      timeoutMs = Number(args[i + 1])
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        console.error('Error: --timeout-ms must be a positive integer')
        process.exit(1)
      }
      i++
    }
  }

  if (!task) {
    console.error('Error: A task description is required. Use --task "your task"')
    process.exit(1)
  }

  console.log(`Starting workflow: ${workflowPath}`)
  console.log(`Cwd: ${cwd}`)
  console.log(`Task: ${task}`)
  console.log(`Dry-run: ${dryRun}`)
  if (contractFormat) console.log(`Contract format: ${contractFormat}`)
  if (timeoutMs) console.log(`Timeout: ${timeoutMs}ms`)

  try {
    const result = await runWorkflow({
      workflowPath,
      cwd,
      task,
      dryRun,
      inputs,
      contractFormat,
      timeoutMs,
      dangerouslySkipPermissions: true
    })

    console.log('\n======================================')
    console.log('Workflow Finished. Result:')
    console.log(JSON.stringify(result, null, 2))
    console.log('======================================')
    process.exit(result.ok ? 0 : 1)
  } catch (error) {
    console.error('Workflow failed to execute:', error.message)
    process.exit(1)
  }
}
