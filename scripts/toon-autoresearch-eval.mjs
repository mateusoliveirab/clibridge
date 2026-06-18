#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

const defaultFixtures = [
  'examples/greetings-research.workflow.json',
  'examples/headroom-contribution.workflow.json',
  'examples/headroom.contribution-workflow.json',
  'examples/monitor-ux-refresh.workflow.json',
  'examples/oss-best-practices-research.workflow.json',
  'examples/portfolio-blog.routes.json',
  'examples/toon-implementation-spec.workflow.json',
]

const outputPath = 'docs/research/toon-autoresearch-step2.md'
const jsonOutputPath = 'docs/research/toon-autoresearch-step2.json'

const fixtures = process.argv.slice(2).length ? process.argv.slice(2) : defaultFixtures

function runToonCli(args, input) {
  return execFileSync('npx', ['--yes', '@toon-format/cli', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
    maxBuffer: 10 * 1024 * 1024,
  })
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`
}

function estimateTokens(value) {
  return Math.ceil(value.length / 4)
}

function analyzeShape(value) {
  const stats = {
    arrays: 0,
    uniformObjectArrays: 0,
    largestUniformArray: 0,
    maxDepth: 0,
  }

  function visit(node, depth) {
    stats.maxDepth = Math.max(stats.maxDepth, depth)
    if (Array.isArray(node)) {
      stats.arrays += 1
      const objectItems = node.filter(item => item && typeof item === 'object' && !Array.isArray(item))
      if (objectItems.length === node.length && objectItems.length > 0) {
        const keys = objectItems.map(item => Object.keys(item).sort().join('\0'))
        if (keys.every(key => key === keys[0])) {
          stats.uniformObjectArrays += 1
          stats.largestUniformArray = Math.max(stats.largestUniformArray, node.length)
        }
      }
      node.forEach(item => visit(item, depth + 1))
      return
    }

    if (node && typeof node === 'object') {
      Object.values(node).forEach(item => visit(item, depth + 1))
    }
  }

  visit(value, 0)
  return stats
}

function decisionFor(result) {
  if (!result.roundTripOk) return 'discard'
  if (result.savingsVsCompact >= 0.15 && result.shape.uniformObjectArrays > 0) return 'keep'
  if (result.savingsVsCompact >= 0.05 && result.shape.largestUniformArray >= 3) return 'maybe'
  return 'discard'
}

const experiments = fixtures.map((fixture) => {
  const sourceText = fs.readFileSync(fixture, 'utf8')
  const parsed = JSON.parse(sourceText)
  const compactJson = JSON.stringify(parsed)
  const prettyJson = JSON.stringify(parsed, null, 2)
  const toon = runToonCli([fixture, '--encode'])
  const decodedText = runToonCli(['--decode'], toon)
  const decoded = JSON.parse(decodedText)
  const roundTripOk = util.isDeepStrictEqual(parsed, decoded)
  const result = {
    fixture,
    sourceBytes: byteLength(sourceText),
    compactJsonBytes: byteLength(compactJson),
    prettyJsonBytes: byteLength(prettyJson),
    toonBytes: byteLength(toon),
    estimatedJsonTokens: estimateTokens(compactJson),
    estimatedToonTokens: estimateTokens(toon),
    roundTripOk,
    shape: analyzeShape(parsed),
  }
  result.savingsVsSource = (result.sourceBytes - result.toonBytes) / result.sourceBytes
  result.savingsVsCompact = (result.compactJsonBytes - result.toonBytes) / result.compactJsonBytes
  result.decision = decisionFor(result)
  return result
})

const summary = {
  generatedAt: new Date().toISOString(),
  methodology: 'Karpathy AutoResearch adaptation: fixed corpus, bounded experiments, objective score, keep/discard ratchet.',
  fixtures: experiments.length,
  kept: experiments.filter(item => item.decision === 'keep').length,
  maybe: experiments.filter(item => item.decision === 'maybe').length,
  discarded: experiments.filter(item => item.decision === 'discard').length,
  allRoundTripsOk: experiments.every(item => item.roundTripOk),
}

const markdown = [
  '# TOON AutoResearch Step 2',
  '',
  '## Methodology',
  '',
  'This adapts Karpathy AutoResearch to clibridge: use a fixed experiment corpus, run bounded automated experiments, score with objective metrics, and keep only changes that improve the baseline without breaking validation. For this step, the editable artifact is the implementation strategy, not runtime code.',
  '',
  'The source pattern is Karpathy AutoResearch: keep fixed files, let an agent/run loop edit one bounded surface, evaluate with a comparable score, then keep or discard based on the metric. For clibridge, the bounded surface is TOON adoption scope rather than model training code.',
  '',
  'The ratchet metric is:',
  '',
  '- round-trip correctness: JSON -> TOON -> JSON must be lossless;',
  '- compression score: TOON bytes vs compact JSON bytes;',
  '- shape fit: uniform object arrays and depth;',
  '- adoption decision: keep, maybe, or discard per fixture.',
  '',
  '## Summary',
  '',
  `- Generated at: ${summary.generatedAt}`,
  `- Fixtures: ${summary.fixtures}`,
  `- Round-trip status: ${summary.allRoundTripsOk ? 'all passed' : 'one or more failed'}`,
  `- Decisions: ${summary.kept} keep, ${summary.maybe} maybe, ${summary.discarded} discard`,
  '',
  '## Experiment Log',
  '',
  '| Fixture | Round Trip | Compact JSON | TOON | Savings vs Compact | Arrays | Uniform Arrays | Max Depth | Decision |',
  '| :--- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |',
  ...experiments.map(item => [
    `\`${item.fixture}\``,
    item.roundTripOk ? 'yes' : 'no',
    item.compactJsonBytes,
    item.toonBytes,
    pct(item.savingsVsCompact),
    item.shape.arrays,
    item.shape.uniformObjectArrays,
    item.shape.maxDepth,
    item.decision,
  ].join(' | ')).map(row => `| ${row} |`),
  '',
  '## Ratchet Decision',
  '',
  summary.allRoundTripsOk
    ? 'Round-trip correctness passes on the selected corpus, so TOON remains viable as an input-file representation.'
    : 'Round-trip correctness failed, so TOON should not be implemented until the failing cases are understood.',
  '',
  'The measured corpus does not justify making TOON default. The safe ratchet is narrower: keep the v1 implementation scoped to opt-in `.toon` workflow/config files, and reject TOON for MCP envelopes, JSON Schema objects, provider outputs, and `.bridge-runs/*.jsonl`.',
  '',
  'Follow-up implementation keeps that boundary and adds `contractFormat: "toon"` as an explicit user choice for agent-to-agent workflow context. This lets users test token-efficiency gains in prompts without changing the default runtime contract or external MCP JSON envelopes.',
  '',
  '## Next Experiment',
  '',
  'Implement only the parser boundary and two `.toon` fixtures, then rerun this script plus `npm test`. Accept the implementation only if all JSON regressions pass and the TOON fixtures round-trip losslessly.',
  '',
  '## Source Notes',
  '',
  '- Karpathy AutoResearch: https://github.com/karpathy/autoresearch',
  '- TOON spec repository: https://github.com/toon-format/spec',
  '- TOON docs: https://toonformat.dev/',
  '- Runtime tool used by this eval: `npx @toon-format/cli` version 2.3.0 at execution time.',
  '',
]

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${markdown.join('\n')}\n`)
fs.writeFileSync(jsonOutputPath, `${JSON.stringify({ summary, experiments }, null, 2)}\n`)

console.log(JSON.stringify({ summary, outputPath, jsonOutputPath }, null, 2))
