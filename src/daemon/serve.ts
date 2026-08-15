#!/usr/bin/env node
import path from 'node:path'
import { serveProject } from './http-server.ts'

const args = process.argv.slice(2)
const cwdAt = args.indexOf('--cwd')
const portAt = args.indexOf('--port')
const cwd = path.resolve(cwdAt >= 0 ? args[cwdAt + 1] || process.cwd() : process.cwd())
const port = portAt >= 0 ? Number(args[portAt + 1]) || 0 : 0
const serving = await serveProject(cwd, port)
console.log(`Clibridge console: ${serving.url}`)
console.log(`Project: ${cwd}`)
process.on('SIGINT', () => void serving.close().then(() => process.exit(0)))
process.on('SIGTERM', () => void serving.close().then(() => process.exit(0)))
