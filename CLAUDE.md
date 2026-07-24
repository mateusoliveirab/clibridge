# CLAUDE.md

## Stack
Node.js >=20.19.4 · TypeScript · @modelcontextprotocol/sdk · tsx · node:test

## Gotchas
- **Fallback Masquerading**: Broker-level fallbacks can mask API/credential failures during tests/validations. Always set `disableFallback: true` in diagnostics, matrix, or environment check scripts to expose genuine rate limits, auth errors, or credit exhaustion.
- **Workflow Template Interpolation**: Shell validation commands in workflows (not just agent prompts) must render template variables (e.g. `{{inputs.filename}}`) before execution.
- **Gemini Structured Output** — Gemini CLI does not support JSON Schema output natively. The broker must perform client-side schema validation on the stdout payload.
- **Agy Capabilities** — Agy CLI does not support schemas or images. Reject requests requesting these capabilities in the broker before dispatch.
- **CLI Path Validation** — Always assert that provider binaries are on the user's `PATH` before invoking them to avoid cryptic execution failures.
- **Read-Only Enforcement** — `access: 'read-only'` on a provider without sandbox support is rejected with `UNSUPPORTED_SANDBOX`. Only the workflow executor may set `allowUnenforcedAccess: true` (it detects mutations via per-phase git-state snapshots, including HEAD/stash laundering); never expose that option to direct `run_agent` callers.
- **Safe Pushing & Clean** — Git push or branch reset/clean commands require explicit user confirmation.

## Commands
- `npm run build` — Compile TypeScript to JavaScript using esbuild.
- `npm test` — Run all unit tests.
- `npm run test:coverage` — Run unit tests with code coverage report.
- `npm run typecheck` — Run TypeScript type checking.
- `npm run live:validate` — Run strict validation against local CLI binaries (with fallbacks disabled).
- `npm run smoke` — Dry-run validation of provider configurations.


