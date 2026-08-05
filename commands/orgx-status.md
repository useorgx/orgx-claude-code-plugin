---
description: Read an OrgX initiative pulse after the user requests a status snapshot.
allowed-tools: mcp__plugin_orgx-claude-code-plugin_orgx__get_initiative_pulse
---

Call `get_initiative_pulse` once after the user invokes this command and summarize:

- initiative progress
- active blockers
- active work
- pending decisions

If the tool requires an initiative and the user did not name one, ask which
initiative to inspect. If the MCP call fails, report the exact error and direct
the user to `/orgx-login`; do not infer live status from anything outside the
returned MCP result.
