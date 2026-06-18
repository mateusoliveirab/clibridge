# TOON AutoResearch Step 2

## Methodology

This adapts Karpathy AutoResearch to clibridge: use a fixed experiment corpus, run bounded automated experiments, score with objective metrics, and keep only changes that improve the baseline without breaking validation. For this step, the editable artifact is the implementation strategy, not runtime code.

The source pattern is Karpathy AutoResearch: keep fixed files, let an agent/run loop edit one bounded surface, evaluate with a comparable score, then keep or discard based on the metric. For clibridge, the bounded surface is TOON adoption scope rather than model training code.

The ratchet metric is:

- round-trip correctness: JSON -> TOON -> JSON must be lossless;
- compression score: TOON bytes vs compact JSON bytes;
- shape fit: uniform object arrays and depth;
- adoption decision: keep, maybe, or discard per fixture.

## Summary

- Generated at: 2026-06-18T12:03:27.278Z
- Fixtures: 7
- Round-trip status: all passed
- Decisions: 0 keep, 0 maybe, 7 discard

## Experiment Log

| Fixture | Round Trip | Compact JSON | TOON | Savings vs Compact | Arrays | Uniform Arrays | Max Depth | Decision |
| :--- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| `examples/greetings-research.workflow.json` | yes | 869 | 864 | 0.6% | 3 | 1 | 5 | discard |
| `examples/headroom-contribution.workflow.json` | yes | 3053 | 3132 | -2.6% | 8 | 0 | 6 | discard |
| `examples/headroom.contribution-workflow.json` | yes | 1052 | 1006 | 4.4% | 6 | 0 | 3 | discard |
| `examples/monitor-ux-refresh.workflow.json` | yes | 5849 | 5861 | -0.2% | 5 | 0 | 4 | discard |
| `examples/oss-best-practices-research.workflow.json` | yes | 3466 | 3474 | -0.2% | 2 | 0 | 4 | discard |
| `examples/portfolio-blog.routes.json` | yes | 703 | 724 | -3.0% | 3 | 0 | 4 | discard |
| `examples/toon-implementation-spec.workflow.json` | yes | 6865 | 6780 | 1.2% | 4 | 1 | 5 | discard |

## Ratchet Decision

Round-trip correctness passes on the selected corpus, so TOON remains viable as an input-file representation.

The measured corpus does not justify making TOON default. The safe ratchet is narrower: keep the v1 implementation scoped to opt-in `.toon` workflow/config files, and reject TOON for MCP envelopes, JSON Schema objects, provider outputs, and `.bridge-runs/*.jsonl`.

## Next Experiment

Implement only the parser boundary and two `.toon` fixtures, then rerun this script plus `npm test`. Accept the implementation only if all JSON regressions pass and the TOON fixtures round-trip losslessly.

## Source Notes

- Karpathy AutoResearch: https://github.com/karpathy/autoresearch
- TOON spec repository: https://github.com/toon-format/spec
- TOON docs: https://toonformat.dev/
- Runtime tool used by this eval: `npx @toon-format/cli` version 2.3.0 at execution time.

