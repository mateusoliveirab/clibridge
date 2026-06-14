# Describe After Apply Workflow

**Purpose:** Perform task first, describe the result.

## When to Use
Resources with outputs only known post-execution (IDs, URLs, diffs); PR/report text that must reflect what really happened.

## Anti-Pattern
Pre-defining the description before execution; one-off ops where refining the description has no future payoff.

## Architecture

This workflow follows a simple `job` → `capture` → `describe` shape:

1. **Job Phase:** A writer role executes the task (with permissions skipped to allow mutation).
2. **Capture Phase:** Real outputs are captured directly from the system (e.g., `git diff --stat` and `git status --short`) directly after the job phase completes.
3. **Describe Phase:** An architect role takes the captured context and generates an accurate PR/report description of the changes.

## Why Real Outputs Matter

Describing changes from real outputs beats a pre-scripted template because:
- **Accuracy:** It documents what actually happened, not what was planned to happen.
- **Context:** It includes unexpected changes or side effects that occurred during execution.
- **Clarity:** It grounds PRs and reports in factual reality (diffs, statuses) rather than hypotheticals.

## Usage Example

```bash
node --import tsx .claude/workflows/describe-after-apply.mjs --dry-run "Update the README with the new installation steps"
```
