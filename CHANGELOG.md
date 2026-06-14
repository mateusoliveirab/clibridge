# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (2026-06-14)


### Features

* default workflow patterns + live run monitor ([#1](https://github.com/mateusoliveirab/mcp-workflow-cli-bridge/issues/1)) ([bfa6a41](https://github.com/mateusoliveirab/mcp-workflow-cli-bridge/commit/bfa6a4189423644b6cc1c91e9410bc967f9fe004))
* implement and validate Ollama provider adapter with dedicated tests ([6d4a45c](https://github.com/mateusoliveirab/mcp-workflow-cli-bridge/commit/6d4a45c76193c0fa919c21b30f7ec04b0cdd273b))
* implement dynamic provider fallback on rate limits and execution errors ([d856bcb](https://github.com/mateusoliveirab/mcp-workflow-cli-bridge/commit/d856bcb5a4a6c296ea6b173084988ca8e2092e1d))
* initial release-ready mcp server implementation ([b74f4d3](https://github.com/mateusoliveirab/mcp-workflow-cli-bridge/commit/b74f4d3dcdd95fa7de711292385e8536fd01e071))

## [0.1.0] - 2026-06-14

### Added
- Initial implementation of the local MCP bridge for routing Claude Dynamic Workflow agent tasks.
- Provider adapters for `claude`, `codex`, `gemini`, `opencode`, and `agy` CLIs.
- Capability-based routing, schema validation, and automatic execution retry broker.
- Test suites covering routing, adapter logic, schema validation, and retry behavior.
