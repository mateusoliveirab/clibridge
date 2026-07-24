import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadContributionConfig,
  resolveContributionConfigPath
} from '../src/workflows/contribution-config.ts'

test('loadContributionConfig returns defaults when config is absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-contrib-config-'))
  try {
    const config = loadContributionConfig(dir)
    assert.strictEqual(config.repository.defaultBranch, 'main')
    assert.strictEqual(config.contribution.branchPrefix, 'contrib/')
    assert.deepStrictEqual(config.validation.commands, ['npm run ci'])
    assert.deepStrictEqual(config.validation.stressCommands, ['npm run smoke'])
    assert.ok(config.rules.files.includes('CONTRIBUTING.md'))
    assert.ok(config.rules.files.includes('AGENTS.md'))
    assert.ok(config.policy.issueFirstChangeTypes.includes('feature'))
    assert.strictEqual(config.contribution.allowPublish, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('loadContributionConfig merges repo overrides with defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-contrib-config-'))
  try {
    fs.mkdirSync(path.join(dir, '.bridge'))
    fs.writeFileSync(path.join(dir, '.bridge', 'contribution-workflow.json'), JSON.stringify({
      repository: {
        name: 'example',
        defaultBranch: 'trunk'
      },
      contribution: {
        allowPublish: true
      },
      validation: {
        commands: ['npm test'],
        stressCommands: ['npm run smoke']
      },
      policy: {
        blockedChangeTypes: ['refactor-only']
      },
      pr: {
        labels: ['automation']
      }
    }))

    const config = loadContributionConfig(dir)
    assert.strictEqual(config.repository.name, 'example')
    assert.strictEqual(config.repository.defaultBranch, 'trunk')
    assert.strictEqual(config.repository.publicRepo, true)
    assert.strictEqual(config.contribution.branchPrefix, 'contrib/')
    assert.strictEqual(config.contribution.allowPublish, true)
    assert.deepStrictEqual(config.validation.commands, ['npm test'])
    assert.deepStrictEqual(config.validation.stressCommands, ['npm run smoke'])
    assert.deepStrictEqual(config.policy.blockedChangeTypes, ['refactor-only'])
    assert.deepStrictEqual(config.pr.labels, ['automation'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveContributionConfigPath supports explicit relative config paths', () => {
  assert.strictEqual(
    resolveContributionConfigPath('/repo', 'custom/config.json'),
    path.join('/repo', 'custom/config.json')
  )
})
