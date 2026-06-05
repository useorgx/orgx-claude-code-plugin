---
description: Show the OrgX operator chronicle for decisions, proof, goals, initiatives, gaps, and priorities.
allowed-tools: mcp__orgx__*
---

Prefer `get_operator_chronicle` with `period: "30d"` when Claude Code exposes
it in the OrgX MCP tool list.

If the Claude Code MCP tool list is stale and `get_operator_chronicle` is not
callable, use `orgx_recommend` with `mode: "morning_brief"` as the compatibility
fallback.

Lead with `reportingNarrative.briefMarkdown`, then call out:

- decision chronology for yesterday, the past week, and the past 30 days
- artifact ledger
- PR velocity
- goals and initiatives
- data gaps
- first recommended action

Be explicit when goals are provisional signals from `decision_requests` rather
than accepted OrgX goals. Do not treat Claude hook outbox records as live
reporting proof; hooks are only a reconciliation backstop.
