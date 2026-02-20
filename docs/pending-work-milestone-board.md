# Pending Work Milestone Board (P0-P3)

Date drafted: 2026-02-20  
Repo: `/Users/hopeatina/Code/orgx-claude-code-plugin`

## Goal

Close the explicitly pending work called out in:
- `README.md` ("Next Steps")
- `docs/adr-0001-openclaw-to-claude-plugin.md` ("Follow-up")

This board focuses on:
1. Claude CLI E2E verification
2. Marketplace metadata + publish pipeline
3. Shared core extraction from OpenClaw plugin into reusable package

## Ownership Model

- `Platform Eng`: plugin runtime, hooks, API integration, shared core
- `DevEx`: CI, release pipeline, packaging, automation
- `QA`: E2E harness design, fixtures, verification evidence
- `Tech Lead`: scope decisions, acceptance sign-off

## Milestones

1. `P0` Scope Lock + Acceptance Contract (0.5 day)
2. `P1` Real Claude CLI E2E Harness (2-4 days)
3. `P2` Marketplace Metadata + Publishing Pipeline (1-2 days)
4. `P3` Shared Core Extraction (4-6 days)

## Milestone Details

### P0: Scope Lock + Acceptance Contract

- Owner: `Tech Lead`
- Dependencies: none
- Deliverables:
  - `docs/parity-target.md`
  - signed-off definition of done for `P1-P3`
  - explicit "won't port OpenClaw-only surfaces" note (unless changed)

Issue backlog:

1. `P0-1` Create parity target doc (`must/should/won't`)
Owner: `Tech Lead`
Estimate: `2h`
Acceptance tests:
- `docs/parity-target.md` exists with `Must / Should / Won't`
- references `README.md` and `docs/adr-0001-openclaw-to-claude-plugin.md`

2. `P0-2` Freeze acceptance criteria for each milestone
Owner: `Tech Lead`
Estimate: `2h`
Acceptance tests:
- each milestone in this file has measurable pass/fail criteria
- criteria mapped to runnable checks

### P1: Real Claude CLI E2E Harness

- Owner: `QA` (implementation with `Platform Eng`)
- Dependencies: `P0`
- Deliverables:
  - `tests/e2e/` harness and fixtures
  - deterministic local/mock OrgX test server
  - CI job running E2E on push/PR
  - verification docs with evidence logs

Issue backlog:

1. `P1-1` Add E2E test runner scaffold and folder layout
Owner: `QA`
Estimate: `0.5d`
Dependencies: `P0-2`
Acceptance tests:
- `tests/e2e/` exists with at least one executable test
- `npm run verify:e2e:claude` command added

2. `P1-2` Build OrgX mock server fixtures for hook assertions
Owner: `Platform Eng`
Estimate: `0.5d`
Dependencies: `P1-1`
Acceptance tests:
- fixture server captures requests for:
  - `/api/client/live/activity`
  - `/api/client/live/changesets/apply`
- assertions validate required fields (`initiative_id`, `source_client`, phase/event)

3. `P1-3` E2E: SessionStart env hydration + skill sync behavior
Owner: `QA`
Estimate: `0.5d`
Dependencies: `P1-2`
Acceptance tests:
- simulated session writes expected exports to `CLAUDE_ENV_FILE`
- skill sync behavior verified for `200` and `304` responses

4. `P1-4` E2E: PostToolUse + Stop hook reporting path
Owner: `QA`
Estimate: `0.5d`
Dependencies: `P1-2`
Acceptance tests:
- `post_tool_use` creates activity event
- `stop` with `apply_completion=true` emits changeset for `task.update -> done`

5. `P1-5` E2E: autopilot start/resume smoke with captured state
Owner: `Platform Eng`
Estimate: `1d`
Dependencies: `P1-3`, `P1-4`
Acceptance tests:
- `scripts/run-claude-dispatch-job.mjs` start mode creates state file
- resume mode picks most recent state and re-enters run loop

6. `P1-6` Wire E2E into CI and publish evidence artifact
Owner: `DevEx`
Estimate: `0.5d`
Dependencies: `P1-5`
Acceptance tests:
- workflow includes E2E job
- failing E2E blocks PR
- logs uploaded as workflow artifact

Milestone exit criteria:
- `npm run check` passes
- `npm run verify:e2e:claude` passes in CI on `ubuntu-latest`
- no flaky retries required for two consecutive runs

### P2: Marketplace Metadata + Publishing Pipeline

- Owner: `DevEx`
- Dependencies: `P1`
- Deliverables:
  - completed plugin metadata for marketplace distribution
  - repeatable release workflow (tag -> build -> package -> publish)
  - release checklist updated with actual commands and artifacts

Issue backlog:

1. `P2-1` Finalize marketplace metadata and validation script
Owner: `DevEx`
Estimate: `0.5d`
Dependencies: `P1-6`
Acceptance tests:
- metadata fields are complete and validated by script
- `npm run verify` checks metadata presence and format

2. `P2-2` Add release workflow (tag-triggered) with gated checks
Owner: `DevEx`
Estimate: `0.5d`
Dependencies: `P2-1`
Acceptance tests:
- tag push runs: install -> typecheck -> tests -> verify -> package
- workflow produces distributable artifact

3. `P2-3` Add dry-run release command + docs
Owner: `DevEx`
Estimate: `0.5d`
Dependencies: `P2-2`
Acceptance tests:
- `npm run release:dry-run` executes locally without publish side effects
- `docs/release-checklist.md` includes step-by-step release flow

Milestone exit criteria:
- one dry-run release passes end-to-end
- one real version tag build succeeds in CI

### P3: Shared Core Extraction (from OpenClaw plugin)

- Owner: `Platform Eng`
- Dependencies: `P2`
- Deliverables:
  - shared package with common OrgX client + payload + skill-sync primitives
  - Claude plugin migrated to shared package
  - OpenClaw plugin migration follow-up plan (or partial migration if in scope)

Issue backlog:

1. `P3-1` Inventory duplicate logic and define shared package API
Owner: `Platform Eng`
Estimate: `1d`
Dependencies: `P2-3`
Acceptance tests:
- duplication matrix doc created (`claude` vs `openclaw` modules)
- API proposal reviewed and approved

2. `P3-2` Create shared package skeleton with test harness
Owner: `Platform Eng`
Estimate: `1d`
Dependencies: `P3-1`
Acceptance tests:
- package compiles independently
- unit tests run in package scope

3. `P3-3` Migrate Claude plugin to shared package
Owner: `Platform Eng`
Estimate: `1d`
Dependencies: `P3-2`
Acceptance tests:
- Claude plugin runtime/tests unchanged functionally
- `npm run check` still passes

4. `P3-4` Add compatibility adapter notes for OpenClaw plugin
Owner: `Platform Eng`
Estimate: `1d`
Dependencies: `P3-3`
Acceptance tests:
- migration notes include exact module mapping and risk flags
- no OpenClaw-only HTTP/dashboard code moved into shared package

5. `P3-5` Optional: migrate OpenClaw plugin selected modules
Owner: `Platform Eng`
Estimate: `1-2d`
Dependencies: `P3-4`
Acceptance tests:
- OpenClaw plugin build/tests still pass for migrated modules
- behavior parity validated against existing tests

Milestone exit criteria:
- Claude plugin consumes shared package for agreed modules
- regression checks pass in Claude plugin
- OpenClaw migration status explicitly documented (done/partial/deferred)

## Cross-Milestone Acceptance Commands

Run for every PR in this initiative:

```bash
npm run typecheck
npm run test
npm run verify
npm run check
```

Run once P1 lands:

```bash
npm run verify:e2e:claude
```

Run once P2 lands:

```bash
npm run release:dry-run
```

## Suggested GitHub Issue Titles

1. `[P0] Define Claude Plugin Parity Target and Done Criteria`
2. `[P1] Add Claude CLI E2E Harness Scaffold`
3. `[P1] Add OrgX Mock Server for Hook Payload Assertions`
4. `[P1] Verify SessionStart Hydration and Skill Sync (200/304)`
5. `[P1] Verify PostToolUse/Stop Hook Reporting and Completion Changeset`
6. `[P1] Add Autopilot Start/Resume E2E Smoke`
7. `[P1] Wire Claude E2E into CI with Artifacts`
8. `[P2] Finalize Marketplace Metadata and Validation`
9. `[P2] Add Tag-Based Release Workflow`
10. `[P2] Add Release Dry-Run Command and Update Release Checklist`
11. `[P3] Build Shared Core Duplication Matrix and API Contract`
12. `[P3] Create Shared Core Package Skeleton + Tests`
13. `[P3] Migrate Claude Plugin to Shared Core`
14. `[P3] Document OpenClaw Compatibility Adapters`
15. `[P3] Migrate Selected OpenClaw Modules to Shared Core (Optional)`

## Risk Register

1. `E2E flakiness`
Mitigation: mock server + deterministic fixtures + retry-free pass requirement.

2. `Scope creep into OpenClaw-only surfaces`
Mitigation: enforce `P0` scope contract in every PR template/checklist.

3. `Release pipeline drift from actual install path`
Mitigation: require clean-environment smoke command in release checklist.

4. `Shared core abstraction too broad`
Mitigation: extract only duplicated modules with active consumers; defer speculative APIs.
