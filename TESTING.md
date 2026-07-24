# Testing Clibridge

## Fast, offline gate

```bash
npm run ci
```

This is the required pull-request gate. It runs strict TypeScript, the
production build, the offline `node:test` suite, and a dry-run provider smoke
check. Tests are explicitly scoped to `test/*.test.mjs`; nested Git
worktrees and generated output are intentionally excluded.

For a faster iteration loop:

```bash
npm run verify:fast
```

Install repository hooks once per clone with `npm run hooks:install`.

## Coverage

```bash
npm run test:coverage
```

Coverage is a diagnostic, not a merge target yet. Establish a clean baseline
before adding a threshold; prioritize the daemon, ledger, redaction, broker,
and provider adapters because they execute or record local work.

## Live provider validation

Live checks exercise installed local CLIs and can consume provider quota. They
are deliberately not part of CI and must keep fallbacks disabled.

```bash
npm run live:validate
npm run live:validate:claude
npm run live:validate:codex
npm run live:toon-contract -- --providers claude,codex --timeout-ms 120000
```

Record the command, provider, and meaningful result in the pull request. If a
provider is unavailable, state that boundary rather than replacing it with a
fallback result.

## Change-specific evidence

- Adapter or routing change: offline contract tests plus the relevant live
  validation when available.
- Daemon, ledger, approval, or redaction change: add or update a `test/daemon-`
  or `test/redaction-` case that exercises the public behavior.
- Dashboard change: run the daemon console test and manually verify the
  affected browser flow against a local `bridge serve` session. Include a
  screenshot for a material UI change.
- Security fix: add a regression test that fails before the fix, without
  committing a real secret or exploit payload.
