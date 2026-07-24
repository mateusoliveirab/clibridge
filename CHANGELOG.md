# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/mateusoliveirab/clibridge/compare/v1.0.0...v1.1.0) (2026-07-11)


### Features

* **readme:** add npm version badge ([476d83c](https://github.com/mateusoliveirab/clibridge/commit/476d83c0acc64ad1d9af5d55b877e1063a2ba384))
* **toon:** add selectable workflow contract format ([aed0db8](https://github.com/mateusoliveirab/clibridge/commit/aed0db8319b82048e8952e75dcb6b2a7aa4df0b2))
* **toon:** support toon workflow inputs ([f1506ec](https://github.com/mateusoliveirab/clibridge/commit/f1506ec7d56b965b676412ab2801736dad844579))
* **workflows:** add execution policy (read-only/workspace-write/unrestricted) ([7456a09](https://github.com/mateusoliveirab/clibridge/commit/7456a0965982a8383c72eeba8d447b495dca5b82))


### Bug Fixes

* **adapters:** migrate gemini provider to agy (Antigravity) CLI ([4ed4c47](https://github.com/mateusoliveirab/clibridge/commit/4ed4c4745beb37b2c36fda194502e39399a210ca))
* **adapters:** place agy prompt immediately after --print ([b1ac36c](https://github.com/mateusoliveirab/clibridge/commit/b1ac36cd246188a00926384fa5c6d7ba4a963bbe))
* **cli:** make skip permissions explicit ([629c031](https://github.com/mateusoliveirab/clibridge/commit/629c031269dbc9f7627083ce451f2e2a04b2bb05))

## 1.0.0 (2026-06-18)


### Features

* **adapters:** detect rate-limit errors instead of generic exit failure ([1633412](https://github.com/mateusoliveirab/clibridge/commit/16334129829b84f34daf766ea802d7e910e89c32))
* default workflow patterns + live run monitor ([#1](https://github.com/mateusoliveirab/clibridge/issues/1)) ([bfa6a41](https://github.com/mateusoliveirab/clibridge/commit/bfa6a4189423644b6cc1c91e9410bc967f9fe004))
* implement and validate Ollama provider adapter with dedicated tests ([6d4a45c](https://github.com/mateusoliveirab/clibridge/commit/6d4a45c76193c0fa919c21b30f7ec04b0cdd273b))
* implement dynamic provider fallback on rate limits and execution errors ([d856bcb](https://github.com/mateusoliveirab/clibridge/commit/d856bcb5a4a6c296ea6b173084988ca8e2092e1d))
* initial release-ready mcp server implementation ([b74f4d3](https://github.com/mateusoliveirab/clibridge/commit/b74f4d3dcdd95fa7de711292385e8536fd01e071))


### Bug Fixes

* **mcp:** drop dot from MCP tool names to match client naming rules ([db7f703](https://github.com/mateusoliveirab/clibridge/commit/db7f703ffeae9ce97b1f7daceb9eb0717a5d6959))
* **mcp:** resolve package.json path correctly from bundled dist build ([28809af](https://github.com/mateusoliveirab/clibridge/commit/28809af5efb9aa6385703ab87571add2c59b80b6))

## [0.1.0] - 2026-06-14

### Added
- Initial implementation of the local MCP bridge for routing Claude Dynamic Workflow agent tasks.
- Provider adapters for `claude`, `codex`, `gemini`, `opencode`, and `agy` CLIs.
- Capability-based routing, schema validation, and automatic execution retry broker.
- Test suites covering routing, adapter logic, schema validation, and retry behavior.
