# toon-implementation-spec

**Purpose:** research TOON, evaluate where it belongs in clibridge, and produce a concrete implementation spec before runtime changes.

## When To Use

Use this workflow before adding TOON support to clibridge. It is designed for the question: "Can TOON be used the same way JSON is used here, and what is the safest implementation shape?"

## Outputs

By default, the workflow writes:

- `docs/research/toon-format-research.md`
- `docs/research/toon-codebase-fit.md`
- `docs/research/toon-implementation-spec.md`
- `docs/research/toon-evaluation-plan.md`

## Workflow Shape

1. **policy**: checks required output paths.
2. **code_context**: reads the current JSON-related contracts and implementation points.
3. **format_research**: researches current TOON spec/package/benchmark sources.
4. **codebase_fit**: maps TOON onto clibridge's existing JSON contracts.
5. **implementation_spec**: writes the implementation spec without changing runtime code.
6. **evaluation_plan**: defines round-trip, token, reliability, CI, and release gates.
7. **validate**: checks that the expected docs were produced.

## Usage

```bash
npm run build
node bin/bridge-cli.mjs run examples/toon-implementation-spec.workflow.json \
  --task "Evaluate and specify TOON support for clibridge" \
  --inputs '{"targetUse":"Support .toon workflow/config inputs alongside existing .json files, while preserving JSON as the canonical internal representation."}'
```

For a no-write shape check:

```bash
npm run build
node bin/bridge-cli.mjs run examples/toon-implementation-spec.workflow.json \
  --dry-run \
  --task "Evaluate and specify TOON support for clibridge"
```

## Implementation Boundary

This workflow must not implement TOON. Its job is to create the evidence and spec needed for a follow-up implementation PR.
