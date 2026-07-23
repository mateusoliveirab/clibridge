#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './mcp/create-server.ts'
import { serveProject } from './daemon/http-server.ts'

// The stdio MCP process also hosts the project-local console. This gives MCP
// calls and the browser one daemon and one event ledger. Console startup must
// never take the broker down with it — e.g. a read-only .clibridge/ dir, a
// TCP bind failure, or a native @libsql/client load failure should just mean
// "no console", not "no MCP server".
try {
  const serving = await serveProject(process.cwd())
  console.error(`Clibridge console available at ${serving.url}`)
} catch (error) {
  console.error(`Clibridge console failed to start, continuing without it: ${(error as Error).message}`)
}
const server = createMcpServer()
const transport = new StdioServerTransport()

await server.connect(transport)
