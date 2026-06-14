<h1 align="center">MCP Workflow CLI Bridge</h1>

<p align="center">
  <img src="https://github.com/mateusoliveirab/mcp-workflow-cli-bridge/actions/workflows/ci.yml/badge.svg" alt="CI" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-blue" alt="node" />
  <img src="https://img.shields.io/badge/typescript-5.x-blue" alt="typescript" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
  <img src="https://img.shields.io/badge/mcp-supported-orange" alt="mcp" />
</p>

A local Model Context Protocol (MCP) server that acts as a dispatch hub, routing tasks to coding agent CLIs installed on your local machine (`claude`, `codex`, `opencode`, `gemini`, `agy`).

It provides capability-based routing, CLI availability discovery, strict JSON Schema output validation, automatic execution retries, and a normalized response envelope.

---

## Table of Contents

- [Problem & Context](#problem--context)
- [How It Works](#how-it-works)
- [Supported Providers & Capabilities](#supported-providers--capabilities)
- [Installation & Client Configuration](#installation--client-configuration)
  - [Claude Desktop](#1-claude-desktop)
  - [Claude Code](#2-claude-code)
  - [Codex Plugin](#3-codex-plugin)
  - [Cursor / Windsurf](#4-cursor--windsurf)
- [MCP Tools Spec](#mcp-tools-spec)
  - [`code_cli_bridge.providers`](#code_cli_bridgeproviders)
  - [`code_cli_bridge.run_agent`](#code_cli_bridgerun_agent)
- [Routing Configuration](#routing-configuration)
- [Security & Sandbox Guidelines](#security--sandbox-guidelines)
- [Development & Testing](#development--testing)
- [Contributing](#contributing)
- [Changelog](#changelog)

---

## Problem & Context

Claude Code Dynamic Workflows (`.claude/workflows/*.js`) and other MCP clients often need to delegate sub-tasks to specialized CLI engines—e.g., Codex for structured output with image analysis, or OpenCode for lightweight generation—without hardcoding provider-specific APIs or rewriting execution logic for each different client environment.

The **MCP Workflow CLI Bridge** solves this by abstracting local CLI tool execution behind a standardized MCP interface.

---

## How It Works

```
Claude Dynamic Workflow (.claude/workflows/*.js)
  -> agent() call with agentType: "workflow-cli-router"
  -> .claude/agents/workflow-cli-router.md (Claude subagent)
  -> MCP tool: code_cli_bridge.run_agent
  -> broker: routing + schema validation + retry
  -> provider adapter (claude | codex | opencode | gemini | agy)
  -> local CLI process
  -> normalized response envelope
```

> [!NOTE]
> **What this project is not:**
> - It does **not** port the Claude workflow runtime to other clients; `.claude/workflows/*.js` continues to run natively within Claude Code.
> - It is **not** a persistent background daemon. One process is spawned per MCP session.

---

## Supported Providers & Capabilities

Below is the capabilities matrix for the supported local CLI engines:

| Provider CLI | structuredOutput | images | sandbox | skipPermissions |
| :--- | :---: | :---: | :---: | :---: |
| **claude** | Yes | - | - | Yes |
| **codex** | Yes | Yes | Yes | Yes |
| **gemini** | Yes | - | - | - |
| **opencode** | Yes | Yes | - | Yes |
| **agy** | - | - | Yes | Yes |

*If a call requires a capability the target provider does not support (e.g., passing a `schema` to `agy`), the broker rejects the request with a validation error before spawning any process.*

---

## Installation & Client Configuration

### Prerequisites
- Node.js >= 20.19.4
- Local installation of the CLI engines you plan to use (e.g., `claude`, `codex`, etc.) available on your system `PATH`.

```bash
git clone https://github.com/mateusoliveirab/mcp-workflow-cli-bridge.git
cd mcp-workflow-cli-bridge
npm install
```

### 1. Claude Desktop
Add the server configuration to your `claude_desktop_config.json`:

**MacOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-workflow-cli-bridge": {
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/to/mcp-workflow-cli-bridge/src/mcp-server.ts"]
    }
  }
}
```

### 2. Claude Code
To use this inside Claude Code, define the server in your project's local `.mcp.json` configuration file:

```json
{
  "mcpServers": {
    "mcp-workflow-cli-bridge": {
      "cwd": ".",
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/to/mcp-workflow-cli-bridge/src/mcp-server.ts"]
    }
  }
}
```
Then, create `.claude/agents/workflow-cli-router.md` to map agent work to `code_cli_bridge.run_agent`.

### 3. Codex Plugin
You can add the bridge directly as a Codex plugin:

```bash
codex plugin marketplace add /path/to/mcp-workflow-cli-bridge
codex plugin add mcp-workflow-cli-bridge@mcp-workflow-cli-bridge-local
```

### 4. Cursor / Windsurf
In Cursor/Windsurf, navigate to **Settings** -> **Features** -> **MCP** and add a new MCP Server:
- **Name**: `mcp-workflow-cli-bridge`
- **Type**: `command`
- **Command**: `node --import tsx /absolute/path/to/mcp-workflow-cli-bridge/src/mcp-server.ts`

---

## MCP Tools Spec

### `code_cli_bridge.providers`
Returns all registered provider adapters, their capabilities, and whether their CLI binaries are available on the user's `PATH`.

### `code_cli_bridge.run_agent`
Runs a task on the targeted provider.

#### Parameters:

| Field | Type | Required | Description |
| :--- | :---: | :---: | :--- |
| `prompt` | `string` | **Yes** | Task instruction/prompt |
| `cwd` | `string` | **Yes** | Working directory for the CLI process |
| `workflow` | `string` | **Yes** | Name of the active workflow (for logging) |
| `phase` | `string` | **Yes** | Active workflow phase (used for route matching) |
| `label` | `string` | **Yes** | Step label (for logging) |
| `provider` | `string` | No | Overrides routing config to target a specific provider |
| `schema` | `object` | No | JSON Schema to strictly validate provider output against |
| `attachments` | `object[]` | No | List of attachment inputs, e.g. `[{"type": "image", "path": "path/to/img.png"}]` |

#### Example Call:
```json
{
  "workflow": "blog-pipeline",
  "phase": "Generate",
  "label": "generate:iter1",
  "cwd": "/path/to/project",
  "prompt": "Generate a blog post about TypeScript performance",
  "provider": "codex",
  "schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "body": { "type": "string" }
    },
    "required": ["title", "body"]
  }
}
```

---

## Routing Configuration

Create a `route-config.json` at your repository root to govern automatic tool execution routing:

```json
{
  "defaultProvider": "opencode",
  "routes": [
    { "phase": "Extract", "provider": "codex" },
    { "phase": "Generate", "provider": "opencode" }
  ]
}
```
If no route configuration matches, the broker will auto-select a provider *only* if exactly one available CLI satisfies the requested capabilities.

---

## Security & Sandbox Guidelines

> [!WARNING]
> Because this bridge executes local CLI commands on your host system:
> 1. Use providers supporting sandboxing (e.g., `codex`, `agy` with sandbox flags) when executing untrusted workflow instructions.
> 2. Ensure sensitive files (`.env`, `credentials.json`) are excluded in your project configurations.
> 3. Limit the permissions granted to local agent sessions.

---

## Development & Testing

Run the local test suite using:
```bash
npm install
npm test          # Runs 50 deterministic tests via node:test
npm run typecheck # Strict TypeScript check
```

Validate provider connectivity without spawning actual CLI tasks:
```bash
npm run smoke
```

Validate live provider adapters (requires the corresponding CLI binaries installed and configured):
```bash
npm run live:validate
npm run live:validate:claude
```

---

## Contributing

See our [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on developer setup, coding style, and test validations.

---

## Changelog

For a full list of changes and releases, see [CHANGELOG.md](CHANGELOG.md).
