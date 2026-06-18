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
  "inputs": {
    "changeType": "bugfix",
    "publishTarget": "pr",
    "issue": "",
    "maintainerOk": false
  }
}
```

The executor loads `workflowPath`, runs phases in order, records run-state under the target `cwd`, and returns structured phase results.

`contractFormat` is optional and defaults to `json`. When set to `toon`, object-valued template variables in agent prompts, such as `{{inputs}}` or `{{results}}`, render as TOON instead of pretty JSON. Shell command templates keep JSON-style rendering to avoid changing command semantics.

`timeoutMs` is optional and is forwarded to each delegated `run_agent` call. It is useful for live validation workflows that exercise multiple real provider CLIs.

## Workflow File Shape

Workflow files may be encoded as `.json` or `.toon`. Both formats decode into the same internal JSON-compatible object model before Zod validation and execution. JSON remains the canonical documented format; TOON is an opt-in input representation for workflow and route config files only.

Workflow files may also set a top-level `contractFormat` of `json` or `toon`. A `run_workflow` input value overrides the file default.

The current workflow object format supports these phase kinds:

- `read-files`: reads repo-local rule/context files into phase results.
- `policy`: applies structured assertions to `inputs` before mutating work starts.
- `agent`: renders a prompt template and delegates to a provider through `run_agent`.
- `shell`: runs one or more repo-local validation commands.

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
