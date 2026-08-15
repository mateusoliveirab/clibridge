# Maintainer component review workflows

These workflows keep the improvement loop inside Clibridge while preserving a
strict read-only boundary. They inspect the real checkout, return structured
evidence, and leave implementation to a later, separately gated change.

## Workflows

`examples/maintainer-component-audit.workflow.json` is the broad pass:

1. reads the repository rules and architecture baseline;
2. inventories the remaining components;
3. independently reviews adapters/broker, daemon/dashboard,
   workflows/tooling, and contribution/release boundaries;
4. synthesizes a prioritized backlog; and
5. produces an ordered validation plan.

`examples/maintainer-component-review.workflow.json` is the short loop for one
component. Set `inputs.component`, `inputs.paths`, and `inputs.focus`; it returns
findings followed by at most three scoped recommendations.

Both workflows set `access: "read-only"` and `disableFallback: true` at the
workflow and agent phase level. They do not write reports, edit code, publish,
push, change credentials, or hide provider failures in a fallback.

## Dry-run first

From this checkout:

```bash
npm run build
node bin/bridge-cli.mjs run \
  examples/maintainer-component-audit.workflow.json \
  --cwd /home/ubuntu/repos/clibridge \
  --task "Map and prioritize the remaining Clibridge component improvements" \
  --dry-run
```

For a focused pass:

```bash
node bin/bridge-cli.mjs run \
  examples/maintainer-component-review.workflow.json \
  --cwd /home/ubuntu/repos/clibridge \
  --task "Review daemon and dashboard readiness" \
  --inputs '{"component":"daemon-dashboard","paths":"src/daemon dashboard test/daemon-console.test.mjs test/redaction.test.mjs","focus":"project scoping, approval state, redaction, and persisted UI truth"}' \
  --dry-run
```

The dry-run validates workflow parsing, phase ordering, templates, and every
structured mock contract without starting a provider CLI.

## MCP/Clibridge routing

The optional `examples/maintainer-review.routes.json` makes the route boundary
explicit. Pass it as `routeConfigPath` to `run_workflow`:

```json
{
  "workflowPath": "/home/ubuntu/repos/clibridge/examples/maintainer-component-audit.workflow.json",
  "cwd": "/home/ubuntu/repos/clibridge",
  "task": "Review the remaining components and prepare the next improvement backlog",
  "routeConfigPath": "/home/ubuntu/repos/clibridge/examples/maintainer-review.routes.json",
  "timeoutMs": 180000
}
```

Check `providers` before replacing a route provider. A read-only structured
phase requires both `structuredOutput` and `sandbox`; the current built-in
matrix intentionally makes Codex the safe default for this audit. If another
model is configured through Clibridge, it must truthfully declare and enforce
those capabilities or the broker will fail closed. Do not weaken the workflow
to accommodate a provider that cannot guarantee read-only execution.

The workflow's phase results are recorded through the normal daemon/ledger path
when called through MCP, while the direct executor also keeps `.bridge-runs`
run-state evidence. Inspect the returned structured result and use the first
P1/P0 recommendation as the input to a later implementation workflow.

## Next gate

This is a review workflow, not an implementation workflow. After a finding is
verified, the maintainer should create a narrow branch, implement only that
finding, run the focused test plus `npm run ci`, and then perform the normal
GitHub review/release checks. External npm, credential, provider, and protected
branch gates remain external and are not silently bypassed here.
