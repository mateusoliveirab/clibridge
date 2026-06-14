# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (2026-06-14)


### Features

* initial release-ready mcp server implementation ([b74f4d3](https://github.com/mateusoliveirab/claude-workflow-cli-bridge/commit/b74f4d3dcdd95fa7de711292385e8536fd01e071))

## [0.1.0] - 2026-06-14

### Added
- Initial implementation of the local MCP bridge for routing Claude Dynamic Workflow agent tasks.
- Provider adapters for `claude`, `codex`, `gemini`, `opencode`, and `agy` CLIs.
- Capability-based routing, schema validation, and automatic execution retry broker.
- Test suites covering routing, adapter logic, schema validation, and retry behavior.
