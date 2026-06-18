# TOON Implementation Spec

## Decision Summary

Implemented TOON as an opt-in input file format for workflows and route configs. JSON remains the canonical in-memory and external MCP representation. The implementation decodes `.toon` to plain JavaScript values, then reuses the existing Zod and AJV validation paths.

The follow-up implementation adds `contractFormat: "json" | "toon"` so users can choose how object-valued context is rendered between workflow agent phases. JSON remains the default; TOON is opt-in for token-efficiency experiments.

Do not return TOON from MCP tools, do not store run logs as TOON, and do not ask providers to emit TOON in v1.

## Goals

- Allow `run_workflow.workflowPath` to point at `.toon` files.
- Allow `routeConfigPath` to point at `.toon` route configs.
- Allow users to set `contractFormat: "toon"` for agent-to-agent prompt context.
- Preserve all existing `.json` workflows, route configs, tests, and docs.
- Keep JSON Schema validation unchanged by validating decoded objects.
- Provide clear parse errors that name the file and detected format.

## Non-Goals

- Replacing JSON in MCP tool schemas or `structuredContent`.
- Changing normalized success/error envelope shapes.
- Changing `.bridge-runs/*.jsonl`.
- Supporting TOON provider outputs or model-generated TOON as a structured-output mode.
- Auto-converting existing files or making TOON the default.

## Current JSON Contract

`run_workflow` currently loads workflow files with `JSON.parse` in `src/workflows/workflow-executor.ts`, then validates with `WorkflowFileSchema`. Route configs are loaded with `loadJsonConfig()` in `src/config/load-config.ts`. Provider outputs are normalized into JSON-compatible envelopes and structured outputs are validated with AJV in `src/broker/schema-validation.ts`.

This contract should remain: all runtime code sees JSON-compatible JavaScript objects.

## Proposed User-Facing Contract

- Files ending in `.json` parse as JSON.
- Files ending in `.toon` parse as TOON.
- Unknown extensions are rejected with a clear unsupported-format error.
- `.toon` support is limited to workflow files and route config files.
- Docs describe TOON as useful for larger, human-edited workflow/config data, not as universally better than JSON.

Example:

```bash
node bin/bridge-cli.mjs run examples/toon-implementation-spec.workflow.toon \
  --task "Evaluate TOON"
```

## Internal Architecture

Added `src/config/structured-data.ts`:

```ts
export type StructuredFormat = 'json' | 'toon'

export function detectStructuredDataFormat(filePath: string): StructuredFormat
export function parseStructuredData(text: string, format: StructuredFormat): unknown
export async function loadStructuredDataFile(filePath: string): Promise<unknown>
export function loadStructuredDataFileSync(filePath: string): unknown
```

Use `@toon-format/toon` for TOON decoding. Keep the dependency in `dependencies`, not `devDependencies`, because runtime CLI/MCP parsing needs it.

Updated call sites:

- `src/workflows/workflow-executor.ts`: replace `JSON.parse(fs.readFileSync(...))` with sync structured loader.
- `src/config/load-config.ts`: either rename to `loadConfig()` or keep `loadJsonConfig()` as a compatibility wrapper while delegating to structured loader.
- `docs/workflow-executor-contract.md` and `README.md`: document `.toon` input support as opt-in.

## Parsing And Validation Rules

- Decode first, validate second.
- Zod remains responsible for workflow shape validation.
- AJV remains responsible for JSON Schema validation.
- TOON decode errors should include:
  - absolute resolved path,
  - detected format,
  - original parser message.
- Do not infer TOON from content in v1; use extension-based detection only.

## Implementation Steps

1. Add `@toon-format/toon`. Done.
2. Add `src/config/structured-data.ts` with extension detection and JSON/TOON parse helpers. Done.
3. Update workflow loading to support `.json` and `.toon`. Done.
4. Update route config loading to support `.json` and `.toon`. Done.
5. Add fixtures:
   - `test/fixtures/simple-workflow.toon`
   - `test/fixtures/route-config.toon`
6. Add tests proving decoded objects are equal and existing validations still run. Done.
7. Update docs and CLI examples. Done.

## Test Plan

- Unit tests for `detectStructuredFormat()`.
- Unit tests for JSON parse success/failure.
- Unit tests for TOON parse success/failure.
- Workflow executor test: `.toon` workflow runs in dry-run mode.
- Route config test: `.toon` route config influences provider selection.
- Regression test: existing `.json` workflows/configs still pass unchanged.
- Error test: `.yaml` or extensionless path returns unsupported-format error.

## Evaluation Criteria

Ship as opt-in if:

- All existing tests pass.
- `.json` and `.toon` fixtures decode to deeply equal objects.
- A `.toon` workflow can execute through `runWorkflow()` in dry-run mode.
- TOON docs explicitly state when JSON is preferred.

Do not enable by default unless a later benchmark shows meaningful token savings for real clibridge workflows without reliability loss. The Step 2 AutoResearch run on seven current fixtures showed lossless round-trips but 0 accepted fixtures by compact-JSON savings, so the ratchet decision is opt-in parser support only. Keep generated provider output JSON-only until model-generated TOON reliability is proven in live validation.

## Risks And Rollback

- Risk: TOON package/spec changes. Mitigation: pin semver and isolate parser usage in one module.
- Risk: confusing users into replacing all JSON. Mitigation: docs call it opt-in and input-file-only.
- Risk: poor fit for nested/non-uniform workflows. Mitigation: keep JSON examples canonical.
- Rollback: remove `.toon` docs/tests, remove parser branch, keep JSON path untouched.

## Open Questions

- Should clibridge include a `bridge-cli convert` command for JSON -> TOON?
- Should TOON support apply to `.mcp.json`? Current answer: no, because MCP clients expect `.mcp.json`.
- Should route config loader be renamed from `loadJsonConfig()`? Prefer yes in implementation, with export compatibility if public.
