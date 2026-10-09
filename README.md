# OrgX for Claude Code

OrgX is a public Claude Code plugin that connects Claude to a focused,
non-destructive, closed-world OrgX status profile through Claude Code's native
OAuth flow.

The plugin surface is intentionally small:

- one remote HTTPS MCP connection
- three user-invoked commands:
  `/orgx-claude-code-plugin:orgx-login`,
  `/orgx-claude-code-plugin:orgx-status`, and
  `/orgx-claude-code-plugin:orgx-operator-chronicle`
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

Anthropic directory publication is a separate distribution state. Anthropic's
documentation describes both a general, community-driven plugin directory and
the `claude-plugins-official` Claude Code marketplace. Treat the provider
submission receipt and resulting catalog entry as authoritative for the actual
publication destination, then verify a fresh install from the marketplace named
there. Until Anthropic confirms publication, the HTTPS marketplace above is the
public self-serve installation path.

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
https://mcp.useorgx.com/mcp?profile=read-only
```

That closed-world profile exposes exactly seven OrgX tools:

- `orgx_search`
- `orgx_inspect`
- `orgx_get_next_actions`
- `orgx_get_agent_status`
- `orgx_get_initiative_progress`
- `orgx_get_operation_status`
- `orgx_get_operator_brief`

The profile does not expose business-data deletion or state-transition tools.
Standard OrgX MCP usage may be recorded by the hosted service for operation and
metering. The installed plugin adds no local telemetry or background reporting.

The `read-only` selector uses seven current named informational operations.
The public command names remain the same, and their bundled MCP names and
inputs now match this catalog. The release manifest binds that profile into
its fingerprint. The broader directory and runtime profiles are separate.

After updating an older installation, refresh its MCP connection and verify the
seven authenticated tools above. If the profile is unavailable, stop the OrgX
command and report the connection mismatch. Do not select a broader profile or
guess a replacement tool. Profile changes require server deployment before a
client release; local source updates are not evidence of publication.

## User-invoked workflows

- `/orgx-claude-code-plugin:orgx-login` explains the native OAuth connection
  flow.
- `/orgx-claude-code-plugin:orgx-status` calls `orgx_get_initiative_progress` for a
  requested initiative.
- `/orgx-claude-code-plugin:orgx-operator-chronicle` calls
  `orgx_get_operator_brief` for the last 30 days.

The source files keep their short names under `commands/`; Claude Code adds the
plugin namespace to installed slash-command invocations.

The commands do not run automatically and do not call unrelated software.

## Session security boundary

The public plugin is stateless. Each status command uses only its current MCP
response and never treats an earlier command result as continuing authority. An
expired, invalid, or missing authorization response fails closed and returns the
user to Claude Code's native OAuth flow.

The plugin does not read or transmit the current working directory, repository
path, or path aliases, so no CWD alias can inherit organizational authority. It
creates no local state file or plugin-owned lease. Consequently there is no
local lease TTL to refresh and no customer-repository state path to protect.
Native OAuth and the hosted MCP service own authorization expiry.

`plugin.manifest.json` records this boundary as a machine-checked contract. If a
future directory-policy-approved runtime introduces local state, the contract
requires project-relative storage to remain forbidden and private files to use
mode `0600`; that future runtime would require a separate implementation and
review before the manifest could change.

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
