# AGENTS.md (OrgX Claude Plugin)

This repo uses a two-mode execution model to support long-running implementation without losing release quality.

## Default Mode: Build Mode
Build mode is the default unless explicitly switched to release mode.

### Purpose
- Maximize delivery speed for multi-hour implementation.
- Avoid unnecessary stop-and-wait loops.
- Keep work continuously shippable via checkpoints.

### Build-mode Rules
- Confirm repo and branch once at session start.
- Re-check `git status -sb` only before commits, branch switches, or destructive operations.
- Batch related tasks (FE + BE + tests) when they share the same outcome.
- Use requested tools when possible; if blocked, use a reliable fallback and note it briefly.
- Solve-first behavior: attempt practical fixes and verification before asking for more user input.
- Prefer small, progressive commits for long-running work.
- Run targeted verification for touched files/surfaces only.
- Do not block on full-suite checks during iterative development.

### Problem-Solving-First Policy
- Default posture is persistence: try to solve the issue end-to-end in the current turn.
- When blocked, attempt at least one concrete fallback path before escalating.
- Escalate early only for high-risk actions or true external blockers (permissions, missing credentials, production-risk decisions).
- Do not stop at analysis if implementation is feasible; implement, verify, then report.

### Build-mode Verification
- Backend changes: run targeted tests for changed modules.
- Frontend changes: run focused desktop/mobile smoke checks for changed flows.
- Always label verification scope explicitly: `targeted`, `partial`, or `full`.

## Codex Cloud Environment

Use the checked-in setup scripts when configuring this repo in Codex cloud:

```bash
bash .codex/setup-cloud.sh
```

Use this as the cached-environment maintenance script:

```bash
bash .codex/maintenance-cloud.sh
```

The setup script installs from `package-lock.json` with `npm ci --include=dev`
and runs `npm run check`. No OrgX API secrets are required for static plugin
verification.

## Strict Mode: Release Mode
Release mode applies to tags/releases and production rollouts. Routine PR merges use checks appropriate to the diff and the repository's required CI.

### Release-mode Triggers
- User asks to tag, release, or deploy a production change.
- User requests final verification sign-off.

### Release-mode Gates
- Run `typecheck` when code or typed configuration changes.
- Run relevant unit/integration tests for all touched domains.
- Verify impacted UI flows on desktop and mobile (375px for mobile surfaces), when UI behavior changes.
- Provide a short verification summary in PR/release notes.
- Investigate failing checks relevant to the change and satisfy required CI before merge/release. Report unrelated failures accurately; do not turn an unavailable optional local check into an automatic work stoppage.

## Decision and Approval Policy
- Continue autonomously by default.
- Existing user authorization persists through implementation, verification, PR updates, and requested merges/releases; do not ask again for an already authorized action.
- Ask only for a consequential action outside that scope, such as an unapproved destructive git/database operation or production data change, or a material product decision with no safe default.
- Missing OrgX context, reporting, or optional tooling does not block local repo work. Continue independent work while describing the actual limitation.

## Evidence Standard
- Never claim “done” or “verified” without executed commands/checks.
- For workflow/timeline systems, include proof pointers when available (log path, artifact path, command result).
- If proof is incomplete, state exactly what is missing.

## Tooling and Editing Discipline
- Use `apply_patch` tool for direct file edits when appropriate.
- Do not invoke `apply_patch` via shell wrappers.
- Prefer MCP/system APIs for supported systems; avoid ad-hoc reimplementation unless necessary.

## Scope and Repo Hygiene
- Operate only in the explicitly requested repo.
- If multiple repos are involved, state current repo before making edits.
- Never revert unrelated user changes unless explicitly requested.

## Safety
- Never expose secrets/tokens in terminal output, code, or PR text.
- Avoid irreversible operations without authorization; use explicit authorization already provided in the session.

## Reporting Format
- Keep updates concise and evidence-based.
- For long-running tasks, report:
  - `implemented`
  - `verified`
  - `remaining`
