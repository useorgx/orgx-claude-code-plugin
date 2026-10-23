---
name: orgx-setup
description: Set up or repair the bundled OrgX MCP connection. Use only when the user asks to connect OrgX or when an OrgX MCP call reports an authentication error.
---

# Set up OrgX

Use only Claude Code's native OAuth connection flow:

1. For OrgX MCP tools, open `/mcp`, select `orgx`, and choose **Authenticate**.
   Claude Code completes the hosted server's native OAuth flow. Never ask the
   user to paste an access token into chat or into a checked-in file.
2. Verify the MCP server is connected in `/mcp`. A visible server entry alone
   is not proof of authentication; confirm the connected/authenticated state.
   This package requests `profile=claude-code`, using seven status operations
   and the existing `orgx_update_work` operation for explicit user requests.
   Read-only grants hide writes; use the native consent flow for the needed
   write grant. A missing tool or profile mismatch requires a connection
   refresh or a matching plugin/server update. Never switch to a broader profile
   or invent a tool alias to make the command work.
3. Retry only the OrgX action the user requested.

The hosted profile permits bounded content updates and output attachment,
without approval or completion authority. Standard OrgX MCP usage may be recorded by the hosted service;
the installed plugin has no local telemetry or background process.

If authentication fails, use only the `/mcp` state and its returned error for
troubleshooting. Do not inspect unrelated local or Claude data. Do not claim the
plugin is connected based only on installation.
