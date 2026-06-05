# OrgX Runtime Reporting

Use this skill when a Claude Code session must report execution state to OrgX.

## Reporting contract

There are two reporting paths:

- **Active path:** call OrgX MCP tools or client APIs during the work when you
  know the initiative, task, decision, blocker, or artifact context.
- **Chronicle readout:** for operator reporting, call
  `get_operator_chronicle` first when Claude Code exposes it. Its
  `reportingNarrative.briefMarkdown` is the canonical concise answer for
  yesterday, week, 30-day decision chronology, artifacts, PR velocity, goals,
  initiatives, gaps, and top priorities.
- **Stale-client fallback:** if the hosted OrgX MCP server advertises
  `get_operator_chronicle` but Claude Code has not refreshed its callable tool
  list, immediately call `orgx_recommend` with `mode: "morning_brief"` and
  present the returned `reportingNarrative.briefMarkdown`. Do not ask the user
  to reconnect before giving the report.
- **Passive backstop:** Claude Code runtime hooks record compact session events
  into the local OrgX wizard outbox and run summary-only local Work Graph
  reconciliation on `Stop`.

Do not treat hook presence as a substitute for intentional OrgX writes. Hooks
answer whether OrgX was used; MCP/API calls make the work durable while the
session is still fresh.

## Workflow

1. Resolve context IDs from env/args:
- `ORGX_INITIATIVE_ID`
- `ORGX_WORKSTREAM_ID`
- `ORGX_TASK_ID`
- `ORGX_RUN_ID` or `ORGX_CORRELATION_ID`

2. For reporting questions, retrieve the operator chronicle:
- Use `get_operator_chronicle` with `period: "30d"` for broad clarity when it
  is callable in Claude Code.
- Use `period: "day"` or `period: "week"` when the user asks for yesterday or
  this week.
- If `get_operator_chronicle` is not callable in the current Claude Code
  session, use `orgx_recommend` with `mode: "morning_brief"` and treat the
  response as a stale-client fallback.
- Lead with `reportingNarrative.briefMarkdown`, then drill into decisions,
  artifacts, PR velocity, goals, initiatives, data gaps, and first action.
- If goals are provisional signals from `decision_requests`, say so; do not
  present them as accepted goals.

3. Emit execution activity:
- phase: `intent`, `execution`, `handoff`, `completed`, or `blocked`
- message: concrete, evidence-based

4. If a file/artifact is produced:
- register artifact with summary and path

5. If blocked:
- request a decision with explicit options and impact

6. On completion:
- mark task done using a changeset when task id is known

7. If no OrgX IDs are available:
- Continue the work, but make the final response easy for the hook reconciler to
  classify: name decisions, artifacts, blockers, next actions, and verification.
- Do not claim OrgX was updated unless an MCP tool or API call actually
  succeeded.

8. Preserve Work Graph continuity:
- When a Work Graph report is generated, include its `work_graph_fingerprint`
  and `signup_hydration.hydration_key` in summaries or artifacts that are safe
  to store.
- Claude Code Stop-hook reconciliation writes
  `~/.config/useorgx/wizard/hooks/reports/latest-work-graph-report.json` by
  default. Posting that report to OrgX is opt-in and requires both an OrgX API
  key and `ORGX_CLAUDE_HOOK_RECONCILE_POST=true`,
  `ORGX_HOOK_RECONCILE_POST=true`, or `ORGX_WIZARD_HOOK_RECONCILE_POST=true`.
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
