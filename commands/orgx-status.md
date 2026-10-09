---
description: Get an OrgX initiative pulse after the user requests a status snapshot.
allowed-tools: mcp__plugin_orgx-claude-code-plugin_orgx__orgx_get_initiative_progress
---

If the user did not name an initiative, ask which one to inspect. Then call
`orgx_get_initiative_progress` once with its required `initiative_id` and summarize:

- initiative progress
- active blockers
- active work
- pending decisions

Use only the result returned by this command's current MCP call. Do not reuse an
earlier command result as current organizational authority. If the current call
reports expired, invalid, or missing authorization, stop and require native
OAuth reauthentication. Do not read, derive, transmit, or use a
working-directory or project-path alias as authority.

If the MCP call fails, report the exact error and direct
the user to `/orgx-login`; do not infer live status from anything outside the
returned MCP result.
