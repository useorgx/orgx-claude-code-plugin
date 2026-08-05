# OrgX for Claude Code

OrgX is a public Claude Code plugin that connects Claude to a focused,
non-destructive, closed-world OrgX status profile through Claude Code's native
OAuth flow.

The plugin surface is intentionally small:

- one remote HTTPS MCP connection
- three user-invoked commands: `/orgx-login`, `/orgx-status`, and
  `/orgx-operator-chronicle`
- one static setup skill for connection troubleshooting

The installed plugin has no automatic lifecycle hooks, background process,
local sidecar, shell command, embedded credential, or dynamic skill/agent sync.
It does not inspect project files or Claude session data. OrgX receives data only
when the user requests an OrgX MCP operation, subject to the authenticated
account's permissions.

## Install from the public marketplace

```bash
claude plugin marketplace add https://github.com/useorgx/orgx-claude-code-plugin.git --scope user
claude plugin install orgx-claude-code-plugin@orgx --scope user
```

The official `claude-plugins-official` listing is a separate distribution state.
Until Anthropic confirms publication, the HTTPS marketplace above is the public
self-serve installation path.

The OrgX wizard is another installation path and requires its own release
receipt. A compatible wizard build must copy root `.mcp.json` and tolerate the
placeholder-only `agents/`, `hooks/`, `lib/`, and `scripts/` directories. Do not
treat an older wizard's successful exit as proof that the OAuth connector was
installed; verify the cached plugin contains `.mcp.json` and that `/mcp` lists
`orgx`.

## Connect OrgX

1. Open `/mcp` in Claude Code.
2. Select `orgx`.
3. Choose **Authenticate** and complete the OrgX consent flow in the browser.
4. Return to `/mcp` and confirm that `orgx` is connected.

No API key or bearer token belongs in the plugin manifest, chat, or a checked-in
file. Installation alone is not proof that OAuth succeeded.

The plugin connects to:

```text
https://mcp.useorgx.com/mcp?profile=claude-directory
```

That closed-world profile exposes exactly seven OrgX tools:

- `orgx_search`
- `orgx_inspect`
- `orgx_recommend`
- `get_agent_status`
- `get_initiative_pulse`
- `get_morning_brief`
- `get_operator_chronicle`

The profile does not expose business-data deletion or state-transition tools.
Standard OrgX MCP usage may be recorded by the hosted service for operation and
metering. The installed plugin adds no local telemetry or background reporting.

## User-invoked workflows

- `/orgx-login` explains the native OAuth connection flow.
- `/orgx-status` calls `get_initiative_pulse` for a requested initiative.
- `/orgx-operator-chronicle` calls `get_operator_chronicle` for the last 30
  days.

The commands do not run automatically and do not call unrelated software.

## Data and support

- Privacy: https://useorgx.com/privacy
- Terms: https://useorgx.com/terms
- Support: https://useorgx.com/support
- Security contact: reviewers@useorgx.com
- License: MIT

## Development and validation

Requirements: Node.js 18+ and a current Claude Code CLI.

```bash
npm ci
npm run check
claude plugin validate . --strict
npm pack --dry-run --json
```

Run the local plugin in an isolated Claude session:

```bash
claude --plugin-dir . -p "Reply with exactly: plugin-smoke-ok"
```

Release and directory-review evidence is tracked in:

- `docs/release-checklist.md`
- `docs/anthropic-plugin-directory-submission.md`

Source readiness, submission, review, approval, directory publication, and an
Anthropic Verified badge are distinct states.
