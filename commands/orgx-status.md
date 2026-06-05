---
description: Get a structured OrgX status snapshot for the current initiative.
allowed-tools: mcp__orgx__*
---

For broad operator reporting, prefer `get_operator_chronicle` with
`period: "30d"`. If the Claude Code MCP tool list is stale and that tool is not
callable, use `orgx_recommend` with `mode: "morning_brief"` and present
`reportingNarrative.briefMarkdown`.

For the narrower current initiative snapshot, run `orgx_status_json` and summarize:
- initiative progress
- active blockers
- tasks in `todo` or `in_progress`
- pending decisions

If `ORGX_INITIATIVE_ID` is set, prioritize that initiative in the summary.
