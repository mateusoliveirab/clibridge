# research-plan-implement

**Purpose**: Research code, plan changes, and implement.

## When to use
Tasks with multiple unknowns resolved only through investigation; cross-repo changes; diagnostic work before designing a fix.

## Anti-pattern
Simple linear tasks where the path is already clear; unknowns trivial enough to resolve inline.

## 3-Phase Shape
This workflow operates in three linear phases:
1. **research**: The "explorer" role investigates the user's task to gather context.
2. **plan**: The "architect" role receives the context from the research phase and drafts a step-by-step implementation plan.
3. **implement**: The "writer" role takes the plan and implements the changes. It inherently skips permissions (writes code directly). After execution, a pre-defined gate (`npm run typecheck && npm test`) verifies the work and reports on failures.

## Resolving Roles to Providers
Roles are resolved to the best available provider based on the configured "demand" mapping:
- `research` demands a `cheap` provider.
- `plan` demands a provider with `high` strength.
- `implement` demands a provider capable of `skipPermissions`.

## Usage Example
```bash
node --import tsx .claude/workflows/research-plan-implement.mjs --dry-run "add retry to the http client"
```
