# TOON Evaluation Plan

## Fixture Corpus

Use existing project shapes:

- `examples/*.workflow.json` as workflow fixtures.
- `examples/portfolio-blog.routes.json` as route config fixture.
- JSON Schema examples from `test/run-agent.test.mjs` and `test/schema-validation.test.mjs`.
- Normalized envelopes from README examples.

Create TOON mirrors for one small workflow, one larger workflow, and one route config.

## Round-Trip Checks

For each fixture:

1. Parse JSON fixture.
2. Encode to TOON with `@toon-format/toon`.
3. Decode TOON.
4. Assert deep equality with the JSON object.
5. Execute decoded object through the same Zod/AJV validation used in production.

Include edge cases:

- Empty arrays.
- Arrays with uniform objects.
- Arrays with non-uniform objects.
- Nested objects.
- Strings with commas, colons, brackets, and newlines.
- Booleans, nulls, numbers, and empty strings.

## Token And Cost Checks

Add an optional script, not a runtime dependency path:

```bash
node scripts/compare-structured-format-size.mjs examples/headroom-contribution.workflow.json
```

Metrics:

- JSON byte length.
- TOON byte length.
- Approximate token count using a lightweight heuristic first.
- Optional exact tokenizer later if the project already adopts one.

Do not block CI on token savings. Use this as release evidence.

## Reliability Checks

For model-facing experiments, compare JSON vs TOON prompts:

- Ask provider to summarize a workflow.
- Ask provider to identify all phase names and providers.
- Ask provider to rewrite one field and preserve the rest.
- Parse the returned format if generation is requested.

Track:

- Parse failure rate.
- Incorrect field count.
- Missing phase count.
- Extra invented keys.
- Prompt length and output length.

## CI Checks

Required in `npm test`:

- Structured loader unit tests.
- Workflow `.toon` dry-run execution.
- Route config `.toon` provider selection.
- `contractFormat: "toon"` prompt rendering for `{{inputs}}`, `{{results}}`, and structured phase results.
- JSON regression tests.

Optional live validation:

- Provider comprehension tests comparing JSON and TOON prompt context.
- Token/cost summary report.
- Generated TOON parse/retry experiments.

## Release Decision

Ship as opt-in when:

- JSON regression is zero.
- TOON fixture round-trips are lossless.
- `.toon` workflow and route config tests pass in CI.
- Docs make JSON the default and TOON an input-file alternative.

Reject or defer if:

- Official package cannot decode required JSON-equivalent shapes losslessly.
- Errors are too opaque to debug.
- `.toon` fixtures are larger or less readable than JSON for representative clibridge workflows.

Default-on requires a later decision and stronger evidence:

- At least 20% token savings on real workflows/configs.
- No observed parse failures in live validation.
- No degradation in provider comprehension tasks.

The first AutoResearch Step 2 run did not meet the default-on bar: seven real clibridge fixtures round-tripped correctly, but none beat compact JSON by the required margin. That result supports parser-boundary implementation only, not default TOON output or wholesale migration.
