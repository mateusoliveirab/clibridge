# Gate-Job-Gate Workflow Pattern

**Purpose**: Pre-flight validation, job execution, and post-flight verification.

## When to use
Mutating or destructive operations; production changes needing before/after confirmation; any op where a silent failure is worse than a blocked run.

## Anti-pattern
Read-only operations; single pre-check without meaningful post-verification; ops so fast and reversible the two gates exceed the risk.

## Shape
This workflow runs in three phases:
1. **pre**: A read-only phase (role: `explorer`) that gathers and asserts preconditions (`gate.assert`). If the gate cannot be asserted (`onFail: "stop"`), the workflow halts.
2. **job**: A mutating phase (role: `writer`) that executes the actual task. Because this is destructive, it honors `confirmIfDestructive`.
3. **post**: A read-only phase (role: `explorer`) that runs a post-execution shell command (`gate.verify`, e.g., `npm run typecheck && npm test`). Results are captured as data.

## Human-on-the-loop (Blast Radius)
This pattern directly maps to the project's "push/clean requires confirmation" rule. Because the `job` phase is marked `confirmIfDestructive: true`, it requires human confirmation via the `WORKFLOW_CONFIRM=1` environment variable when not run in `--dry-run`. This limits the blast radius of unsafe actions by forcing explicit approval.

## Usage
Run with dry-run to safely see how it works:
```bash
node --import tsx .claude/workflows/gate-job-gate.mjs --dry-run "Delete old log files"
```
