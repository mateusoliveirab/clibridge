# Contributing to MCP Workflow CLI Bridge

Thank you for your interest in contributing! This document provides instructions for setting up and working on this project.

## Getting Started

### Prerequisites
- Node.js >= 20.19.4
- npm >= 10.x

### Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Enable the optional local quality hooks:
   ```bash
   npm run hooks:install
   ```

## Development Workflow

### Dev Container Setup
- This project supports VS Code Dev Containers. If you open this project in VS Code with the Dev Containers extension installed, it will prompt you to reopen inside the container, automatically configuring Node, git, and all extensions.

### Coding Standards
- Read [AGENTS.md](AGENTS.md) for the repository map and safety invariants.
- This project uses TypeScript. All TypeScript compiler checks must pass cleanly.
- Avoid editing `.env` or other credential files directly in version control.
- Do not commit provider tokens, private prompts, or unredacted CLI output.
- Typecheck, build, test, and smoke-check before proposing changes:
  ```bash
  npm run ci
  ```

### Testing
We use the native `node:test` runner. The command explicitly scopes discovery
to `test/`, so nested worktrees are not collected. Run all offline tests with:
```bash
npm test
```

See [TESTING.md](TESTING.md) for coverage, live-provider checks, and evidence
expected for daemon, provider, and dashboard changes.

### Code CLI Smoke Validation
To perform dry-run and live validations of the provider integrations:
```bash
npm run smoke
npm run live:validate
```

## Submitting Changes
- Please ensure all tests pass and TypeScript compiles strictly before opening a pull request.
- Use the pull-request template to record the actual validation commands and
  any live checks that could not be run. Feature, provider, policy, and public
  contract changes should begin with an issue or discussion.
- Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, etc.). This repo's `release-please` workflow (`.github/workflows/release-please.yml`) parses commit messages on `main` to decide the next version bump and generate the changelog — non-conforming messages are silently skipped and won't trigger a release.
