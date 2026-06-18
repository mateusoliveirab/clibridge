<div align="center"><pre>
  ██████╗██╗     ██╗██████╗ ██████╗ ██╗██████╗  ██████╗ ███████╗
 ██╔════╝██║     ██║██╔══██╗██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝
 ██║     ██║     ██║██████╔╝██████╔╝██║██║  ██║██║  ███╗█████╗  
 ██║     ██║     ██║██╔══██╗██╔══██╗██║██║  ██║██║   ██║██╔══╝  
 ╚██████╗███████╗██║██████╔╝██║  ██║██║██████╔╝╚██████╔╝███████╗
  ╚═════╝╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ╚═════╝ ╚══════╝
            The local CLI dispatcher and router for AI agents
</pre></div>

<p align="center"><strong>local-first · MCP standard · capability routing · strict JSON validation · auto-discovery · CLI wrapper</strong></p>

<p align="center">
  <a href="https://github.com/mateusoliveirab/clibridge/actions/workflows/ci.yml"><img src="https://github.com/mateusoliveirab/clibridge/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/clibridge"><img src="https://img.shields.io/npm/v/clibridge.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D20-blue.svg" alt="Node Compatibility"></a>
  <a href="tsconfig.json"><img src="https://img.shields.io/badge/typescript-5.x-blue.svg" alt="TypeScript"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/mcp-supported-orange.svg" alt="MCP Supported"></a>
</p>

<p align="center">
  <a href="#how-it-works">How It Works</a> ·
  <a href="#supported-providers--capabilities">Capabilities</a> ·
  <a href="#get-started-60-seconds">Install</a> ·
  <a href="#mcp-tools-spec">MCP Spec</a> ·
  <a href="#routing-configuration">Routing</a> ·
  <a href="#cli-utilities">CLI Utilities</a> ·
  <a href="CLAUDE.md">CLAUDE.md</a>
</p>

<p align="center"><sub>
  <b>AI agents / LLMs:</b> read <a href="CLAUDE.md"><code>/CLAUDE.md</code></a> for the development cookbook and local command guidelines.
</sub></p>

---

**clibridge** is a lightweight, local-first Model Context Protocol (MCP) server that acts as a dispatch hub, routing agentic coding tasks to local CLI tools (`claude`, `codex`, `opencode`, `gemini`, `agy`, `ollama`). Instead of hardcoding vendor APIs or writing execution wrappers for different IDEs and frameworks, you delegate tasks to standard local engines with full capability-based routing and output schema validation.

---

## How It Works

```
  MCP Client (Claude Desktop, Claude Code, Cursor, Windsurf…)
        │
        │  run_agent (prompt, schema, cwd, attachments)
        ▼
  ┌─────────────────────────────────────────────────────────┐
  │  clibridge (Local Process Broker & Dispatch Hub)        │
  │  ─────────────────────────────────────────────────────  │
  │  1. Capability Matcher (matches requirements)           │
  │  2. Router Engine      (selects best provider)          │
  │  3. Adapter Broker     (spawns subprocess)              │
  │                        ├── claude / gemini              │
  │                        ├── codex  / opencode (images)   │
  │                        └── agy    / ollama   (sandbox)  │
  │  4. Output Parser      (checks JSON Schema & retries)   │
  └─────────────────────────────────────────────────────────┘
        │
        ▼  Normalized Response Envelope (Success / Error)
  MCP Client
```

---

## Core Features

- **Unified MCP Interface** — Exposes standard tools (`run_agent`, `run_workflow`, `providers`) to any MCP client.
- **Dynamic Adapter Broker** — Runs local binaries (`claude`, `codex`, `opencode`, `gemini`, `agy`, `ollama`) as subprocesses.
- **Capability-Based Routing** — Matches requirements (structured outputs, image support, sandboxing) to available local engines.
- **Strict JSON Validation** — Enforces user-defined JSON schemas on the final response to guarantee structured outputs.
- **Declarative Workflows** — Orchestrates multi-phase developer workflows from JSON files, with opt-in `.toon` input support for workflow and route config files.
- **Live Terminal Monitor** — Provides a real-time TUI dashboard (`bridge-monitor`) to tail executions.

---

## Get Started (60 seconds)

```bash
# 1 — Clone & Install
git clone https://github.com/mateusoliveirab/clibridge.git
cd clibridge && npm install

# 2 — Configure MCP Client
node --import tsx src/mcp-server.ts     # Run the MCP server via stdio

# 3 — Run a Workflow (Optional CLI wrapper)
node bin/bridge-contribute.mjs --dry-run "add route selection tests"
```

---

## Supported Providers & Capabilities

Below is the capabilities matrix for the supported local CLI engines:

<!-- CAPABILITIES_TABLE:START (generated by scripts/generate-capabilities-table.mjs — do not edit by hand) -->
| Provider CLI | Structured Output | Image Analysis | Sandboxed Mode | Skip Permissions |
| :--- | :---: | :---: | :---: | :---: |
| **agy** | - | - | Yes | Yes |
| **claude** | Yes | - | - | Yes |
| **codex** | Yes | Yes | Yes | Yes |
| **gemini** | Yes | - | - | Yes |
| **ollama** | - | - | - | - |
| **opencode** | Yes | Yes | - | Yes |
<!-- CAPABILITIES_TABLE:END -->

*If a call requires a capability the target provider does not support (e.g., passing a `schema` to `agy`), the broker rejects the request with a validation error before spawning any process.*

---

## Normalized Response Envelope

`clibridge` normalizes output from different CLI clients into a unified response shape. Success and error states follow strict JSON models.

### Success Envelope

Returned when the provider executes successfully and passes schema validation.

```json
{
  "ok": true,
  "runId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "provider": "codex",
  "phase": "Generate",
  "label": "generate:iter1",
  "durationMs": 1420,
  "attempts": 1,
  "structured": true,
  "data": {
    "title": "TypeScript Performance",
    "body": "Optimize your code using..."
  },
  "text": "{\n  \"title\": \"TypeScript Performance\",\n  \"body\": \"Optimize your code using...\"\n}",
  "usage": { "inputTokens": 120, "outputTokens": 240 },
  "artifacts": [],
  "warnings": []
}
```

### Error Envelope

Returned on subprocess timeouts, parse failures, schema validation errors, or execution aborts.

```json
{
  "ok": false,
  "runId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "provider": "gemini",
  "phase": "Generate",
  "label": "generate:iter1",
  "durationMs": 850,
  "attempts": 3,
  "errorCode": "SCHEMA_VALIDATION_FAILED",
  "message": "Output failed JSON Schema validation.",
  "recoverable": true,
  "details": {
    "errors": [
      {
        "instancePath": "/body",
        "message": "must be string"
      }
    ]
  },
  "stderrTail": "Gemini process output...",
  "stdoutTail": ""
}
```

---

## Installation & Setup

> [!IMPORTANT]
> **Prerequisites:**
> - **Node.js** >= 20.19.4
> - **Local CLI engines** (e.g., `claude`, `codex`, `gemini`) must be installed and available on your system `PATH`.

### Client Integration

#### 1. Claude Desktop
Add the server configuration to your `claude_desktop_config.json`:

* **MacOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "clibridge": {
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/to/clibridge/src/mcp-server.ts"]
    }
  }
}
```

#### 2. Claude Code
To use this inside Claude Code, define the server in your project's local `.mcp.json` configuration file:

```json
{
  "mcpServers": {
    "clibridge": {
      "cwd": ".",
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/to/clibridge/src/mcp-server.ts"]
    }
  }
}
```
Then, create `.claude/agents/workflow-cli-router.md` to map agent work to `run_agent`.

#### 3. Cursor & Windsurf
In Cursor or Windsurf, navigate to **Settings** -> **Features** -> **MCP** and add a new MCP Server:
- **Name**: `clibridge`
- **Type**: `command`
- **Command**: `node --import tsx /absolute/path/to/clibridge/src/mcp-server.ts`

#### 4. Codex Plugin
You can add the bridge directly as a Codex plugin:

```bash
codex plugin marketplace add /path/to/clibridge
codex plugin add clibridge@clibridge-local
```

> [!TIP]
> Always replace `/absolute/path/to/clibridge/...` with the actual path where you cloned the repository.

---

## MCP Tools Spec

### `providers`
Returns all registered provider adapters, their capabilities, and whether their CLI binaries are available on the user's `PATH`.

### `run_agent`
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

### `run_workflow`
Runs a declarative workflow file through the generic MCP workflow executor. This is the preferred interface when a client wants to execute a full workflow instead of a single provider task.

#### Parameters:

| Field | Type | Required | Description |
| :--- | :---: | :---: | :--- |
| `workflowPath` | `string` | **Yes** | Absolute or caller-resolvable path to a `.json` or `.toon` workflow file |
| `cwd` | `string` | **Yes** | Target repository where phases and shell commands run |
| `task` | `string` | **Yes** | User task or contribution objective |
| `dryRun` | `boolean` | No | If true, agent phases and shell commands are simulated |
| `inputs` | `object` | No | Workflow-specific inputs such as `changeType`, `publishTarget`, or `issue` |
| `routeConfigPath` | `string` | No | Optional `.json` or `.toon` route config for provider selection |

#### Example Call:
```json
{
  "workflowPath": "/home/ubuntu/repos/clibridge/examples/headroom-contribution.workflow.json",
  "cwd": "/home/ubuntu/repos/workbench-claude/headroom",
  "task": "fix the wrap prepare-only path",
  "dryRun": true,
  "inputs": {
    "changeType": "bugfix",
    "publishTarget": "pr"
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

*If no route configuration matches, the broker will auto-select a provider only if exactly one available CLI satisfies the requested capabilities.*

`routeConfigPath` also accepts `.toon` files. TOON is decoded at the file boundary and then validated as the same internal JSON-compatible object model; MCP responses, JSON Schema payloads, and `.bridge-runs/*.jsonl` remain JSON.

---

## Contribution Workflow

For repository contribution work, the bridge includes a client-neutral workflow entrypoint:

```bash
node bin/bridge-contribute.mjs --dry-run "add a focused test for route selection"
```

This runs the reference `github-contribution` CLI workflow as a code architecture developer. For MCP clients, prefer `run_workflow` with a JSON workflow file such as `examples/headroom-contribution.workflow.json`. `.toon` workflow files are supported as an opt-in input representation, but JSON remains the canonical documented format.

---

## CLI Utilities

`clibridge` includes command-line tools to monitor executions and discover workflows dynamically:

### 1. Generic CLI (`bridge-cli`)
Inspect and execute workflows natively:
```bash
node --import tsx bin/bridge-cli.mjs list                  # List registered workflows
node --import tsx bin/bridge-cli.mjs info <workflow-name>  # Inspect phase details
node --import tsx bin/bridge-cli.mjs doc                   # View the generic executor specification
node --import tsx bin/bridge-cli.mjs run <workflow-path> --task "prompt"  # Run a workflow directly
```

### 2. Live Run TUI Monitor (`bridge-monitor`)
Tails and visualizes the state of current or past runs in your terminal:
```bash
node --import tsx bin/bridge-monitor.mjs            # Live TUI tailing active runs
node --import tsx bin/bridge-monitor.mjs --once     # Single terminal frame print
node --import tsx bin/bridge-monitor.mjs --run <id> # Focus a specific run
```

---

## Security & Sandbox Guidelines

> [!WARNING]
> Because this bridge executes local CLI commands on your host system:
> 1. Use providers supporting sandboxing (e.g., `codex`, `agy` with sandbox flags) when executing untrusted workflow instructions.
> 2. Ensure sensitive files (`.env`, `credentials.json`) are excluded in your project configurations.
> 3. Limit the permissions granted to local agent sessions.

---

## Development & Testing

Run the local test suite and static checks:
```bash
npm install
npm test                   # Run unit tests via node:test
npm run test:coverage      # Run unit tests with a code coverage report
npm run typecheck          # Strict TypeScript checks
npm run smoke              # Validate provider connectivity without spawning CLI tasks
```

Validate provider connectivity without spawning actual CLI tasks:
```bash
npm run smoke
```

Validate live provider adapters strictly (tests the actual binary directly, bypassing fallbacks):
```bash
npm run live:validate
npm run live:validate:claude
```

---

## Contributing & Changelog

See our [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on developer setup and code validation.
See [CHANGELOG.md](CHANGELOG.md) for release history.
