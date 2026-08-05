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
3. Retry only the OrgX action the user requested.

If authentication fails, use only the `/mcp` state and its returned error for
troubleshooting. Do not inspect unrelated local or Claude data. Do not claim the
plugin is connected based only on installation.
