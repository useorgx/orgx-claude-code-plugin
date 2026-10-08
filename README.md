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

- `/orgx-claude-code-plugin:orgx-login` explains the native OAuth connection
  flow.
- `/orgx-claude-code-plugin:orgx-status` calls `get_initiative_pulse` for a
  requested initiative.
- `/orgx-claude-code-plugin:orgx-operator-chronicle` calls
  `get_operator_chronicle` for the last 30 days.

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

## OrgX Live (optional mod)

`orgx-live` is a second, separate plugin in the same marketplace, under
`plugins/orgx-live/`. It is a Claude Code mod (a plugin of function hooks), so
it adds hooks and sends activity to OrgX when you turn capture on. It is not
part of the OrgX plugin above, its npm package, or its directory submission,
and installing it changes nothing about that plugin.

```bash
claude plugin marketplace add https://github.com/useorgx/orgx-claude-code-plugin.git --scope user
claude plugin install orgx-live@orgx --scope user
```

It needs a Claude Code build that loads mods. It ships its own MCP connection,
`https://mcp.useorgx.com/mcp?profile=claude-plugin`, listed in `/mcp` under the
`orgx-live` plugin; authenticate it there once. That profile also gives Claude
the OrgX tools it lists (activity, receipts, decisions, bootstrap).

What it does:

- Status line: `OrgX · N need you`, from `orgx_decide` with
  `action: "list_pending"`, checked at session start and every five minutes.
  Nothing shows when nothing needs you. One quiet note replaces it if OrgX
  cannot be reached or asks you to sign in.
- `/orgx-needs-you` opens a pane listing those decisions (question, urgency,
  age, OrgX's recommendation when there is one) with **Open in OrgX** for each,
  plus the last few captured turns. You decide in OrgX: the mod never
  approves, rejects or settles a decision.
- Capture, off by default. With `capture: summary`, each turn that used tools
  sends one `orgx_emit_activity` a couple of seconds after the turn ends. Tool
  calls are never delayed, and an OrgX failure is counted, never raised.

A captured turn sends counts only:

```json
{
  "initiative_id": "2f1c9a7e-4b7d-4c1e-9a55-0d3e8b6f1a20",
  "correlation_id": "claude-code:a8ca17f0-9de1-4d88-bf39-14087192859b",
  "source_client": "claude-code",
  "phase": "execution",
  "level": "warn",
  "message": "Claude Code turn 1: 7 tool calls (Bash 2, Edit 2, Read 1, Write 1, mcp 1), 2 files changed, 1 failed, 48s",
  "metadata": {
    "schema": "orgx-live.turn-summary.v1",
    "capture": "summary",
    "turn": 1,
    "tool_calls": 7,
    "tools": { "Read": 1, "Edit": 2, "Write": 1, "Bash": 2, "mcp": 1 },
    "failed_tool_calls": 1,
    "files_changed": 2,
    "subagent_tool_calls": 0,
    "duration_ms": 48200,
    "outcome": "answer"
  },
  "runtime": { "source_runtime": "anthropic", "source_system": "claude-code", "adapter": "orgx-live-mod" }
}
```

It never sends file paths or contents, prompts, answers, commands or their
output, environment values, or MCP server names (every MCP tool counts as
`mcp`). The correlation id is random per session. Summaries go to the
initiative in the mod's `initiative` setting, else the one `orgx_bootstrap`
bound in the session; with neither, the turn is skipped and the pane says why.

To turn capture off, open `/config`, find `orgx-live`, and set `capture` to
`off`; the mod reloads without its tool and turn hooks. To remove the mod
entirely, run `claude plugin uninstall orgx-live@orgx`.

Developing it needs the `claude` CLI: `npm run mod:validate`, `npm run
mod:test` and `npm run mod:typecheck` (see `tooling/orgx-live/typecheck.mjs`
for where the API declarations come from).

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
