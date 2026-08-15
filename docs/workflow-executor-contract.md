# Workflow Executor Contract

The bridge has two layers:

1. `run_agent` is the low-level broker primitive. It runs one agent phase through one local CLI provider.
2. `run_workflow` is the workflow executor. It receives a workflow file, interprets phases, gates, and policies, then delegates agent phases through `run_agent`.

The MCP server must not grow one tool per workflow. Headroom contribution, release validation, docs review, and future repo-specific flows are workflow files/configs passed into the generic executor.

## Non-Goals

- Do not create tools named after a specific repository or workflow, such as `run_headroom_contribution`.
- Do not make Claude Code `.claude/workflows/*.mjs` the only workflow source format.
- Do not treat `run_agent` as a full workflow executor.
- Do not hide repository contribution rules inside prompts when they can be represented as workflow phases or policy assertions.

## MCP Tool Shape

Canonical tool:

```text
run_workflow
```

Input:

```json
{
  "workflowPath": "/path/to/workflow.json",
  "cwd": "/path/to/repository",
  "task": "fix wrap prepare-only path",
  "dryRun": true,
  "contractFormat": "toon",
  "timeoutMs": 90000,
  "dangerouslySkipPermissions": true,
  "inputs": {
    "changeType": "bugfix",
    "publishTarget": "pr",
    "issue": "",
    "maintainerOk": false
  }
}
```

The executor loads `workflowPath`, runs phases in order, records run-state under `<cwd>/.bridge-runs/`, and returns structured phase results.

`contractFormat` is optional and defaults to `json`. When set to `toon`, object-valued template variables in agent prompts, such as `{{inputs}}` or `{{results}}`, render as TOON instead of pretty JSON. Shell command templates keep JSON-style rendering to avoid changing command semantics.

`timeoutMs` is optional and is forwarded to each delegated `run_agent` call. It is useful for live validation workflows that exercise multiple real provider CLIs.

An agent phase may set `mockText` or `mockData` for `dryRun` execution. `mockData` is passed to the broker as the dry-run structured result and is validated against the phase `schema`, allowing schema-bearing workflows to test their complete control flow without invoking a provider CLI.

`dangerouslySkipPermissions` is optional and requests unattended permission skipping for providers that support it. The CLI exposes this as `--dangerously-skip-permissions`. A workflow or phase must also set `allowDangerousPermissions: true`; otherwise the executor rejects the phase before dispatching a provider.

## Execution Policy

Workflow and phase objects may declare execution policy fields:

```json
{
  "access": "read-only",
  "allowedWritePaths": ["docs/research/**"],
  "allowDangerousPermissions": false
}
```

`access` may be:

- `read-only`: no file changes are allowed. This is the default for `agent` phases.
- `workspace-write`: file changes are allowed. If `allowedWritePaths` is present, writes outside those repo-relative glob patterns fail the phase.
- `unrestricted`: the executor does not audit file changes for that phase.

Top-level policy applies to all phases and phase-level policy overrides it. The executor snapshots Git status before and after audited phases. It does not automatically revert files; on violation it fails the phase and reports the changed paths so the caller can decide how to recover without clobbering unrelated local work.

For read-only agent phases, providers that support sandboxing receive a read-only sandbox request automatically. Providers without sandbox support are still audited by the Git snapshot guard.

## Workflow File Shape

Workflow files may be encoded as `.json` or `.toon`. Both formats decode into the same internal JSON-compatible object model before Zod validation and execution. JSON remains the canonical documented format; TOON is an opt-in input representation for workflow and route config files only.

Workflow files may also set a top-level `contractFormat` of `json` or `toon`. A `run_workflow` input value overrides the file default.

The current workflow object format supports these phase kinds:

- `read-files`: reads repo-local rule/context files into phase results.
- `policy`: applies structured assertions to `inputs` before mutating work starts.
- `agent`: renders a prompt template and delegates to a provider through `run_agent`.
- `shell`: runs one or more repo-local validation commands.
- `write-file`: writes a prior result (or one JSON field from it) to one explicit, repo-local path. It is the preferred way to publish generated text; provider agents should remain read-only.

Agent phases may define `schema`, `mockText`, and `mockData`. `mockData` is only used when the workflow input has `dryRun: true`; it does not bypass schema validation.

`write-file` phases require `file`, `sourceResult`, and optionally `sourceField`. The target must remain inside the real path of `cwd` (symlink escapes are rejected) and, when `allowedWritePaths` is set, match one of those patterns. In `dryRun`, the phase validates the source and reports what it would write without creating a file.

Shell phases are skipped in `dryRun` unless they set `runInDryRun: true`. Use that flag only for idempotent, read-only preflight checks such as `test -s`.

Template variables available in agent prompts:

- `{{task}}`
- `{{cwd}}`
- `{{inputs}}`
- `{{inputs.changeType}}`
- `{{results.rules}}`
- `{{results.plan}}`

## Headroom Example

`examples/headroom-contribution.workflow.json` is a concrete workflow file for the public Headroom repo. It encodes the observed Headroom rules:

- bug fixes can proceed to PR with reproduction and tests;
- features, architecture changes, and dependency changes are issue-first unless there is maintainer approval;
- refactor-only and test/CI-only changes are blocked unless requested by a maintainer;
- validation uses `uv`, `ruff`, `mypy`, and `pytest`;
- stress validation uses `uv run make ci-precheck`;
- final PR descriptions must include real behavior proof.

The older `examples/headroom.contribution-workflow.json` remains a repo-specific contribution config/preset. The executable workflow file is `examples/headroom-contribution.workflow.json`.
