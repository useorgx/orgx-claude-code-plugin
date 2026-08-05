---
description: Get the OrgX operator chronicle for decisions, proof, goals, initiatives, gaps, and priorities.
allowed-tools: mcp__plugin_orgx-claude-code-plugin_orgx__get_operator_chronicle
---

Call `get_operator_chronicle` with `period: "30d"` after the user invokes this
command. Do not call other external tools unless the user separately asks.

Lead with `reportingNarrative.briefMarkdown`, then call out:

- decision chronology for yesterday, the past week, and the past 30 days
- artifact ledger
- PR velocity
- goals and initiatives
- data gaps
- the first recommended action

Be explicit when goals are provisional signals rather than accepted OrgX goals.
If the MCP call fails, report the exact connection or tool error and direct the
user to `/orgx-login`; do not fabricate a briefing.
