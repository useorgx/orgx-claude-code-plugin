---
description: Authenticate the bundled OrgX MCP connection through Claude Code's native OAuth flow.
---

Guide the user through the built-in connection flow:

1. Ask the user to open `/mcp` in Claude Code.
2. Ask them to select `orgx` and choose **Authenticate**.
3. Tell them to complete the OrgX sign-in and consent screen in their browser.
4. After they return, ask them to confirm that `/mcp` reports `orgx` as connected.

Never ask the user to paste an access token, API key, password, cookie, or OAuth
code into chat or a project file. Do not claim authentication succeeded until
Claude Code shows the connected state.
