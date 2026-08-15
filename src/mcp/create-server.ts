import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { runAgent } from '../broker/run-agent.ts'
import { runWorkflow } from '../workflows/workflow-executor.ts'
import { daemonFor, runWorkflowThroughDaemon } from '../daemon/client.ts'
import { runAgentThroughDaemon } from '../daemon/client.ts'
import { defaultAdapters } from '../adapters/registry.ts'
import { providerStatuses } from '../adapters/availability.ts'
import { loadJsonConfig } from '../config/load-config.ts'
import type { RunAgentOptions } from '../broker/run-agent.ts'
import { AgentInputSchema } from '../types.ts'
import { RunWorkflowInputSchema } from '../workflows/workflow-executor.ts'
import type { AgentInput, BridgeConfig } from '../types.ts'

export interface CreateMcpServerOptions {
  config?: BridgeConfig
  adapters?: RunAgentOptions['adapters']
  dangerouslySkipPermissions?: boolean
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageJsonPath = existsSync(join(__dirname, '../../package.json'))
  ? join(__dirname, '../../package.json')
  : join(__dirname, '../package.json')
const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: pkg.name || 'clibridge',
    version: pkg.version || '0.0.0',
  })

  server.registerTool('run_agent', {
    title: 'Run a workflow agent through a local coding CLI',
    description: 'Routes a Claude workflow agent request to Codex, OpenCode, Gemini, or Claude through the local bridge.',
    inputSchema: AgentInputSchema.shape,
  }, async (input) => {
    const daemon = await daemonFor(input.cwd, { adapters: options.adapters, config: options.config })
    const routeConfigPath = input.routeConfigPath
      ? daemon.validateRouteConfigPath(input.routeConfigPath)
      : undefined
    const config = routeConfigPath
      ? await loadJsonConfig(routeConfigPath)
      : (options.config || {})

    const result = await runAgentThroughDaemon({ ...input, routeConfigPath } as AgentInput, {
      config,
      adapters: options.adapters,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
    })

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
      structuredContent: result as unknown as Record<string, unknown>,
    }
  })

  server.registerTool('run_workflow', {
    title: 'Run a workflow file through local coding CLIs',
    description: 'Loads a declarative workflow file, executes its phases, and delegates agent phases through the local bridge providers.',
    inputSchema: RunWorkflowInputSchema.shape,
  }, async (input) => {
    const result = await runWorkflowThroughDaemon(input, {
      config: options.config,
      adapters: options.adapters,
    })

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
      structuredContent: result as unknown as Record<string, unknown>,
    }
  })

  server.registerTool('providers', {
    title: 'List registered provider adapters',
    description: 'Lists provider adapters, capabilities, and whether their CLI command is available on PATH.',
    inputSchema: {},
  }, async () => {
    const providers = await providerStatuses(options.adapters || defaultAdapters)

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(providers, null, 2) }],
      structuredContent: { providers },
    }
  })

  return server
}
