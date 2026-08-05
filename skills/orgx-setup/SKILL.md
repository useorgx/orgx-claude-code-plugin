---
description: Set up or repair OrgX authentication after installing the OrgX Claude Code plugin. Use when OrgX MCP tools need login, when runtime reporting is not configured, or when the user asks how to connect OrgX.
---

# Set up OrgX

Keep the two authentication paths distinct:

1. For OrgX MCP tools, open `/mcp`, select `orgx`, and choose **Authenticate**.
   Claude Code completes the hosted server's native OAuth flow. Never ask the
   user to paste an access token into chat or into a checked-in file.
2. Verify the MCP server is connected in `/mcp`. A visible server entry alone
   is not proof of authentication; confirm the connected/authenticated state.
3. Core MCP usage is ready at this point.
4. Only when the user wants runtime hooks, direct API reporting, skill/agent
   sync, or autopilot dispatch, run `/orgx-login`. That browser-pairing helper
   stores the resulting machine API key in macOS keychain and writes only
   non-secret metadata to `.claude/orgx.local.json`.
5. Restart or reload the Claude Code session after `/orgx-login` so the
   SessionStart hook can hydrate the key into that session's environment.

If authentication fails, report the exact `/mcp` state or `/orgx-login` error.
Do not claim the plugin is connected based only on installation success.
