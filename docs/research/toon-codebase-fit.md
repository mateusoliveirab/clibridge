# TOON Codebase Fit Analysis

## Summary

TOON should be added to clibridge as an input-file representation layer, not as a new runtime data model. The current code already has a clean object boundary: workflow files and route configs are parsed into JavaScript objects, then Zod/AJV validate those objects and providers receive normalized requests. TOON can fit safely if `.toon` files are decoded to that same object model before existing validation runs.

The first useful scope is opt-in support for `.toon` workflow files and route config files. MCP tool inputs, structuredContent, normalized envelopes, JSONL run logs, JSON Schema objects, `package.json`, and npm metadata should remain JSON.

## Current JSON Touchpoints

- `src/workflows/workflow-executor.ts`: `loadWorkflowFile()` reads a workflow path and calls `JSON.parse`, then validates with `WorkflowFileSchema`.
- `src/config/load-config.ts`: `loadJsonConfig()` reads route config and calls `JSON.parse`.
- `src/types.ts`: MCP `AgentInputSchema` and envelope types model structured runtime objects.
- `src/broker/schema-validation.ts`: AJV validates JSON Schema and structured provider data.
- `src/mcp/create-server.ts`: MCP tools return JSON text plus `structuredContent`; clients expect JSON-compatible values.
- `src/workflows/run-state.ts`: run-state is persisted as `.jsonl`; the monitor and existing tests assume newline-delimited JSON.
- `README.md` and `docs/workflow-executor-contract.md`: public contract says declarative workflows are JSON today.

## Good V1 TOON Surfaces

- `.toon` workflow files passed to `run_workflow.workflowPath`.
- `.toon` route config files passed to `routeConfigPath`.
- CLI examples and docs showing `.json` and `.toon` as equivalent input formats.
- Test fixtures proving `.json` and `.toon` decode to the same internal object shape.

These surfaces are file-native, already parsed at the boundary, and can preserve all downstream behavior.

## Surfaces To Keep JSON-Only

- MCP tool input schemas and `structuredContent`: MCP clients and SDK schemas are JSON-object based.
- Provider output envelopes: existing consumers and tests expect JSON-compatible envelopes.
- JSON Schema literals: AJV consumes JSON Schema objects; TOON should not reinterpret schema semantics.
- `.bridge-runs/*.jsonl`: monitor and run-state tooling rely on JSONL append semantics.
- `package.json`, `.mcp.json`, npm metadata, and GitHub workflow YAML.

## Recommended Module Boundary

Add a small serialization boundary instead of spreading TOON checks through runtime code:

- `src/config/structured-data.ts`
  - `parseStructuredDataFile(filePath: string): unknown`
  - `parseStructuredData(text: string, format: 'json' | 'toon'): unknown`
  - `detectStructuredDataFormat(filePath: string): 'json' | 'toon'`

Then update:

- `loadWorkflowFile()` to use `parseStructuredDataFile()`.
- `loadJsonConfig()` or a renamed `loadConfig()` to use `parseStructuredDataFile()`.

After decoding, existing Zod/AJV validation remains unchanged.

## Migration Path

1. Add TOON dependency and parser boundary.
2. Keep every current `.json` path working exactly as before.
3. Add `.toon` fixtures mirroring one existing workflow and one route config.
4. Update docs to say TOON is opt-in for input files only.
5. Do not auto-convert existing files or emit TOON by default.

## Open Questions

- Should the package be `@toon-format/toon` only, or also `@toon-format/cli` for docs/examples?
- Does the current SDK package expose stable TypeScript types for decoded output?
- Should malformed `.toon` errors get a dedicated `CONFIG_PARSE_FAILED`/`WORKFLOW_PARSE_FAILED` code?
- Should `bridge-cli` gain a `convert` command, or should conversion stay outside v1?
