#!/usr/bin/env node
import path from 'node:path'
import { RunLedger } from '../dist/daemon/ledger.js'

const [command, ...args] = process.argv.slice(2)
if (!command || command === 'help' || command === '--help') {
  console.log('Usage: bridge serve [--cwd <repo>] [--port <port>]\n       bridge runs purge [--cwd <repo>] [--days <n>]')
  process.exit(0)
}
if (command === 'serve') {
  await import('../dist/daemon/serve.js')
} else if (command === 'runs' && args[0] === 'purge') {
  const cwdAt = args.indexOf('--cwd'), daysAt = args.indexOf('--days')
  const cwd = path.resolve(cwdAt >= 0 ? args[cwdAt + 1] || process.cwd() : process.cwd())
  const days = daysAt >= 0 ? Number(args[daysAt + 1]) || 30 : 30
  const ledger = new RunLedger(cwd); await ledger.migrate()
  console.log(`Purged ${await ledger.purge(days)} completed runs older than ${days} days.`)
} else {
  console.error(`Unknown command: ${command}`); process.exit(1)
}
