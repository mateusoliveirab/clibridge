import type { PrTemplateValidationConfig } from './pr-template-validator.ts'
import fs from 'node:fs'
import path from 'node:path'

export interface ContributionWorkflowConfig {
  repository: {
    name?: string
    defaultBranch: string
    publicRepo: boolean
  }
  contribution: {
    branchPrefix: string
    requireCleanWorktree: boolean
    allowPublish: boolean
    draftPr: boolean
  }
  rules: {
    files: string[]
    requireDiscovery: boolean
  }
  validation: {
    commands: string[]
    stressCommands: string[]
  }
  policy: {
    issueFirstChangeTypes: string[]
    blockedChangeTypes: string[]
    requireMaintainerOkForIssueFirst: boolean
    requireRealBehaviorProof: boolean
    requireReproductionForBugfix: boolean
    requireChangelogForUserFacing: boolean
  }
  review: {
    provider?: string
    requireReview: boolean
  }
  pr: {
    titlePrefix: string
    labels: string[]
    templateValidation: PrTemplateValidationConfig
  }
}

export const DEFAULT_PR_TEMPLATE_VALIDATION: PrTemplateValidationConfig = Object.freeze({
  enabled: true,
  onFail: 'block',
})

export const DEFAULT_CONTRIBUTION_CONFIG: ContributionWorkflowConfig = Object.freeze({
  repository: {
    defaultBranch: 'main',
    publicRepo: true,
  },
  contribution: {
    branchPrefix: 'contrib/',
    requireCleanWorktree: true,
    allowPublish: false,
    draftPr: true,
  },
  rules: {
    files: [
      'CONTRIBUTING.md',
      '.github/PULL_REQUEST_TEMPLATE.md',
      'README.md',
      'AGENTS.md',
      'CLAUDE.md',
      'TESTING.md',
      'SECURITY.md',
    ],
    requireDiscovery: true,
  },
  validation: {
    commands: ['npm run ci'],
    stressCommands: ['npm run smoke'],
  },
  policy: {
    issueFirstChangeTypes: ['feature', 'architecture', 'dependency'],
    blockedChangeTypes: ['refactor-only', 'test-ci-only'],
    requireMaintainerOkForIssueFirst: true,
    requireRealBehaviorProof: true,
    requireReproductionForBugfix: true,
    requireChangelogForUserFacing: false,
  },
  review: {
    requireReview: true,
  },
  pr: {
    titlePrefix: '',
    labels: [],
    templateValidation: DEFAULT_PR_TEMPLATE_VALIDATION,
  },
})

export function resolveContributionConfigPath(cwd: string, configPath?: string): string {
  if (configPath) {
    return path.isAbsolute(configPath) ? configPath : path.join(cwd, configPath)
  }
  return path.join(cwd, '.bridge', 'contribution-workflow.json')
}

export function loadContributionConfig(cwd: string, configPath?: string): ContributionWorkflowConfig {
  const resolvedPath = resolveContributionConfigPath(cwd, configPath)
  if (!fs.existsSync(resolvedPath)) {
    return structuredClone(DEFAULT_CONTRIBUTION_CONFIG)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to read contribution workflow config at ${resolvedPath}: ${(error as Error).message}`)
  }

  return mergeContributionConfig(DEFAULT_CONTRIBUTION_CONFIG, parsed)
}

function mergeContributionConfig(
  defaults: ContributionWorkflowConfig,
  override: unknown,
): ContributionWorkflowConfig {
  const value = isRecord(override) ? override : {}
  const repository = isRecord(value.repository) ? value.repository : {}
  const contribution = isRecord(value.contribution) ? value.contribution : {}
  const rules = isRecord(value.rules) ? value.rules : {}
  const validation = isRecord(value.validation) ? value.validation : {}
  const policy = isRecord(value.policy) ? value.policy : {}
  const review = isRecord(value.review) ? value.review : {}
  const pr = isRecord(value.pr) ? value.pr : {}

  return {
    repository: {
      name: optionalStringOr(repository.name, defaults.repository.name),
      defaultBranch: stringOr(repository.defaultBranch, defaults.repository.defaultBranch),
      publicRepo: booleanOr(repository.publicRepo, defaults.repository.publicRepo),
    },
    contribution: {
      branchPrefix: stringOr(contribution.branchPrefix, defaults.contribution.branchPrefix),
      requireCleanWorktree: booleanOr(contribution.requireCleanWorktree, defaults.contribution.requireCleanWorktree),
      allowPublish: booleanOr(contribution.allowPublish, defaults.contribution.allowPublish),
      draftPr: booleanOr(contribution.draftPr, defaults.contribution.draftPr),
    },
    rules: {
      files: stringArrayOr(rules.files, defaults.rules.files),
      requireDiscovery: booleanOr(rules.requireDiscovery, defaults.rules.requireDiscovery),
    },
    validation: {
      commands: stringArrayOr(validation.commands, defaults.validation.commands),
      stressCommands: stringArrayOr(validation.stressCommands, defaults.validation.stressCommands),
    },
    policy: {
      issueFirstChangeTypes: stringArrayOr(policy.issueFirstChangeTypes, defaults.policy.issueFirstChangeTypes),
      blockedChangeTypes: stringArrayOr(policy.blockedChangeTypes, defaults.policy.blockedChangeTypes),
      requireMaintainerOkForIssueFirst: booleanOr(
        policy.requireMaintainerOkForIssueFirst,
        defaults.policy.requireMaintainerOkForIssueFirst,
      ),
      requireRealBehaviorProof: booleanOr(policy.requireRealBehaviorProof, defaults.policy.requireRealBehaviorProof),
      requireReproductionForBugfix: booleanOr(
        policy.requireReproductionForBugfix,
        defaults.policy.requireReproductionForBugfix,
      ),
      requireChangelogForUserFacing: booleanOr(
        policy.requireChangelogForUserFacing,
        defaults.policy.requireChangelogForUserFacing,
      ),
    },
    review: {
      provider: optionalStringOr(review.provider, defaults.review.provider),
      requireReview: booleanOr(review.requireReview, defaults.review.requireReview),
    },
    pr: {
      titlePrefix: stringOr(pr.titlePrefix, defaults.pr.titlePrefix),
      labels: stringArrayOr(pr.labels, defaults.pr.labels),
      templateValidation: mergeTemplateValidation(pr.templateValidation, defaults.pr.templateValidation),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function optionalStringOr(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === 'string' ? value : fallback
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? [...value]
    : [...fallback]
}

function mergeTemplateValidation(
  value: unknown, fallback: PrTemplateValidationConfig,
): PrTemplateValidationConfig {
  if (!isRecord(value)) return { ...fallback }
  const result: PrTemplateValidationConfig = {
    enabled: booleanOr(value.enabled, fallback.enabled),
    onFail: value.onFail === 'warn' ? 'warn' : 'block',
  }
  const rawIgnore = value.ignoreSections
  const fallbackIgnore = fallback.ignoreSections ?? []
  result.ignoreSections = Array.isArray(rawIgnore) && rawIgnore.every(i => typeof i === 'string')
    ? [...rawIgnore]
    : [...fallbackIgnore]

  const rawCheckbox = value.requireAllCheckboxSections
  const fallbackCheckbox = fallback.requireAllCheckboxSections ?? []
  result.requireAllCheckboxSections = Array.isArray(rawCheckbox) && rawCheckbox.every(i => typeof i === 'string')
    ? [...rawCheckbox]
    : [...fallbackCheckbox]

  return result
}
