# TOON Format Research Report

This report evaluates TOON (Token-Oriented Object Notation) for the `clibridge` dispatcher project, focusing on integration strategies, risks, and implementation details for supporting `.toon` alongside `.json`.

## 1. Specification & Stability
- **Spec Version**: The spec repository README lists **SPEC v3.2** / Version 3.2 (2026-05-20), while the same repository shows a later **v3.3.0** release. Treat this as a spec/release distinction that must be pinned deliberately during implementation.
- **Package Version**: The npm packages `@toon-format/toon` and `@toon-format/cli` are currently **2.3.0**.
- **Stability Status**: The spec repository describes the format as a **Working Draft**. Use TOON as opt-in until clibridge has its own fixture and regression evidence.
- **File Extension**: `.toon`
- **Media Type**: `text/toon` (provisional, UTF-8)
- **Compatibility Promises**: Follows MAJOR.MINOR versioning where major versions imply breaking changes to grammar/encoding rules, and minor versions are additive/non-breaking.

## 2. Official TypeScript Package (`@toon-format/toon`)
- **API Exposes**:
  - `encode(data, options?)`: JSON-to-TOON conversion (supports `replacer` function).
  - `decode(string)`: Lossless TOON-to-JSON conversion.
  - `encodeLines(data)` / `decodeFromLines(lines)`: Memory-efficient streaming APIs.
  - `decodeStream(stream)`: For real-time data flows.
- **CLI Usage**:
  - `npx @toon-format/cli input.json -o output.toon`
  - Pipe support: `cat data.json | npx @toon-format/cli`
  - `--stats`: Shows token savings vs JSON/YAML.
- **Validation Behavior**: Employs explicit guardrails such as `[N]` (array length) and `{fields}` (header templates). The parser validates row counts against `N` and row conformity to declared fields.

## 3. Shape Optimization: TOON vs. JSON
- **Benefits from TOON**:
  - **Uniform Arrays of Objects**: The format's sweet spot. It collapses objects into CSV-like tables with single-declared keys.
  - **Large Datasets**: High "tabular eligibility" (identical fields) yields ~40-60% token savings.
- **Should Stay JSON**:
  - **Deeply Nested Structures**: If tabular eligibility is near 0%, compact JSON is more token-efficient.
  - **Non-Uniform Arrays**: Overhead of headers negates savings if every object has different keys.
  - **Latency-Critical Apps**: Raw processing speed of compact JSON might outweigh TOON token savings on local/quantized models.

## 4. Known Risks (Benchmarks & LLM Generation)
- **Generation Reliability (`arXiv:2603.03306`)**:
  - **Prompt Tax**: Explaining TOON rules to the model can exceed token savings for short contexts.
  - **One-Shot Superiority**: Plain JSON still beats TOON in one-shot generation accuracy for most models.
  - **Scaling**: TOON's token efficiency amortizes the prompt overhead only for larger data volumes.
- **Agentic Risks (`arXiv:2605.29676`)**:
  - **Cascading Failures**: A single parsing error in a multi-turn agent loop can cascade into subsequent failures.
  - **Parallel Tool-Call Collapse**: Models struggle to emit multiple parallel tool calls in TOON, sometimes collapsing them into malformed entries.
  - **Accuracy Cost**: Benchmark studies highlight a ~9 percentage point accuracy drop compared to JSON in complex agentic tasks.

## 5. Safe Integration Strategy (AJV + MCP)
For a project validating JSON Schema with AJV and exposing MCP `structuredContent`:
1. **JSON as Source of Truth**: Always run AJV validations on the internal JSON data model, not the TOON string. Treat TOON purely as a representation layer.
2. **Selective Encoding**: Check for "Tabular Eligibility" and only encode arrays with uniform items (e.g., 3-5+ items) to TOON; otherwise fallback to JSON.
3. **MCP `structuredContent` Integration**:
   - Return responses as JSON and use a "Tooner" proxy/middleware to serialize to TOON if appropriate.
   - Expose the content using `mimeType: text/toon`.
4. **Prompting Best Practices**: Use one-shot examples instead of verbose rule descriptions. A clear `JSON -> TOON` example is highly effective.
5. **Fallback Mechanism**: Implement an auto-fallback for multi-turn agents. If a TOON parsing failure occurs, retry the prompt using JSON to break any failure cascade.

## Source Notes
- [TOON Format GitHub Repository](https://github.com/toon-format/toon) and npm package metadata for `@toon-format/toon` / `@toon-format/cli` (verified package version 2.3.0 and CLI behavior).
- [TOON Specification](https://github.com/toon-format/spec) (verified SPEC v3.2 in README, v3.3.0 release listing, `.toon` extension, and `text/toon` media type).
- [arXiv:2603.03306 - Token-Oriented Object Notation vs JSON](https://arxiv.org/abs/2603.03306) (Verified Prompt tax, JSON superiority for one-shots)
- [arXiv:2605.29676 - Notation Matters](https://arxiv.org/abs/2605.29676) (Verified 9pp accuracy drop, cascading failures in multi-turn agents)
- [TOON Official Site / npm](https://toonformat.dev/) / [@toon-format/toon](https://www.npmjs.com/package/@toon-format/toon)
