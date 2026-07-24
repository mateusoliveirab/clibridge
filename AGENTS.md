# Clibridge contributor guide for coding agents

This is the tool-neutral entry point for AI contributors. Read this file before
changing code; use [CONTRIBUTING.md](CONTRIBUTING.md) for the human workflow and
[docs/architecture.md](docs/architecture.md) for the system contract.

## Repository map

- `src/adapters/` — provider-specific command construction and capability checks.
- `src/broker/` — routing, normalized errors, schema validation, and dispatch.
- `src/daemon/` — localhost-only control plane, SQLite ledger, approvals, SSE,
  and secret redaction.
- `src/workflows/` — workflow parsing, execution, and contribution policy.
- `dashboard/` — local operator console; it shares the daemon API and ledger.
- `test/` — offline node:test suite. Keep tests in this directory so the test
  command cannot accidentally collect nested worktrees.

## Non-negotiable rules

1. Never persist, log, or display raw credentials, tokens, prompts containing
   secrets, or unredacted provider output. Use the redaction boundary in
   `src/daemon/redaction.ts`.
2. Diagnostics and live validation must set `disableFallback: true`; a fallback
   may hide an authentication, credit, or provider failure.
3. New provider behavior requires an adapter contract, capability validation,
   offline tests, and a documented live-validation command when a local binary
   is involved.
4. New daemon mutations must retain project scoping, the approval gate for
   risky work, ledger evidence, and the shared `src/daemon/client.ts` path.
5. Do not publish packages, push branches, reset/clean Git state, or alter
   credentials without explicit user or maintainer authorization.

## Required validation

Run `npm run ci` before opening a pull request. It runs TypeScript, the build,
the scoped offline test suite, and the dry-run smoke check. Run a relevant
`live:validate:*` command only when its provider binary
and credentials are available; never treat a skipped live check as proof.

Use `npm run hooks:install` once per clone to enable local pre-commit and
pre-push checks. See [TESTING.md](TESTING.md) for the evidence expected for
daemon, provider, and dashboard changes.
