# fan-out-judge

Attempt the task in parallel across multiple providers and evaluate the results.

## When to use
Unknown-best-approach problems where independent attempts from different providers can be compared; catching shortcuts a single run would hide.

## Anti-pattern
Deterministic tasks with one correct output; when running N providers adds cost without signal.

## How it works

This workflow implements a two-phase `fan-out` -> `judge` shape. 

1. **Attempts (Fan-out)**: The pattern leverages the `all-writers` count, which expands dynamically via `listWriters(defaultAdapters)`. It fires off the same prompt in parallel to every configured provider capable of acting as a writer. This concurrent execution yields multiple, completely independent solutions to the same problem.
2. **Judge**: A stronger, evaluator model is given a prompt containing all the distinct attempts. It is forced to produce a structured JSON output (`winner` and `reason`) picking the best approach.

### Why it helps
Running a single agent can sometimes result in a superficially "correct" answer that takes shortcuts or misses edge cases. By forcing multiple independent agents to solve the task and pitting them against each other, the judge can easily spot the robust solution and discard the brittle ones.

## Usage Example

```bash
node --import tsx .claude/workflows/fan-out-judge.mjs --dry-run "Write a generic retry function in TypeScript"
```
