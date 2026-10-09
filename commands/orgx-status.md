---
description: Get an OrgX initiative pulse after the user requests a status snapshot.
allowed-tools: mcp__plugin_orgx-claude-code-plugin_orgx__orgx_get_initiative_progress
---

Use the initiative UUID supplied by the user or identified in the current
authorized context. If only a title is known, ask for its OrgX initiative link
or UUID; do not send the title as an ID or call an unlisted lookup tool. Then call
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
