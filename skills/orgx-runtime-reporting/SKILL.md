# OrgX Runtime Reporting

Use this skill when a Claude Code session must report execution state to OrgX.

## Reporting contract

There are two reporting paths:

- **Active path:** call OrgX MCP tools or client APIs during the work when you
  know the initiative, task, decision, blocker, or artifact context.
- **Passive backstop:** Claude Code runtime hooks record compact session events
  into the local OrgX wizard outbox for later Work Graph reconciliation.

Do not treat hook presence as a substitute for intentional OrgX writes. Hooks
answer whether OrgX was used; MCP/API calls make the work durable while the
session is still fresh.

## Workflow

1. Resolve context IDs from env/args:
- `ORGX_INITIATIVE_ID`
- `ORGX_WORKSTREAM_ID`
- `ORGX_TASK_ID`
- `ORGX_RUN_ID` or `ORGX_CORRELATION_ID`

2. Emit execution activity:
- phase: `intent`, `execution`, `handoff`, `completed`, or `blocked`
- message: concrete, evidence-based

3. If a file/artifact is produced:
- register artifact with summary and path

4. If blocked:
- request a decision with explicit options and impact

5. On completion:
- mark task done using a changeset when task id is known

6. If no OrgX IDs are available:
- Continue the work, but make the final response easy for the hook reconciler to
  classify: name decisions, artifacts, blockers, next actions, and verification.
- Do not claim OrgX was updated unless an MCP tool or API call actually
  succeeded.

7. Preserve Work Graph continuity:
- When a Work Graph report is generated, include its `work_graph_fingerprint`
  and `signup_hydration.hydration_key` in summaries or artifacts that are safe
  to store.
- Treat the fingerprint as the durable claim key that lets OrgX hydrate
  pre-signup audit value into a user's future workspace.
- Never derive the fingerprint from secrets or raw transcripts that would need
  to leave the local machine.

## Quality Bar

- Never post empty or generic updates.
- Include IDs whenever available.
- Use `source_client=claude-code`.
- Preserve secrets: never emit tokens, cookies, API keys, or storage state into
  activity, retro, hook summaries, or final reports.
