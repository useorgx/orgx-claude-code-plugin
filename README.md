# OrgX Claude Code Plugin

Claude Code plugin package for OrgX:
- OrgX MCP server wiring (`mcp.useorgx.com`)
- Operator chronicle reporting for yesterday, week, 30-day decisions, artifacts,
  PR velocity, goals, initiatives, data gaps, and top priorities
- Runtime hooks that post activity/progress back to OrgX and spool compact Work
  Graph events for reconciliation
- Browser pairing login (`/orgx-login`) with macOS keychain storage
- Session env hydration from keychain (`hooks/scripts/load-orgx-env.mjs`)
- Skill-pack sync from OrgX to local `SKILL.md` files (`/orgx-sync-skills`)
- Agent-pack sync from OrgX to Claude subagent profiles (`/orgx-sync-agents`)
- Full dispatch/autopilot orchestration (`scripts/run-claude-dispatch-job.mjs`)
- Project commands, agent profile, and skill guidance
- CI and architecture ADR for migration planning

## Repo

- Repository: `https://github.com/useorgx/orgx-claude-code-plugin`
- License: MIT
- Initiative: `9b543d86-ea3e-47b8-8109-7160547f2745`
- Live view: `https://useorgx.com/live/9b543d86-ea3e-47b8-8109-7160547f2745`

## Requirements

- Node.js 18+
- Claude Code with plugin support
- OrgX API key (`oxk_...`)

## Structure

```text
.claude-plugin/plugin.json   # Claude plugin manifest
hooks/hooks.json             # Claude hook declarations
hooks/scripts/post-reporting-event.mjs
hooks/scripts/orgx-work-graph-reconcile.mjs
commands/*.md                # Slash commands
agents/*.md                  # Subagent profiles
skills/**/SKILL.md           # Reusable guidance
```

## Environment Variables

- `ORGX_API_KEY` (required for live activity/changesets)
- `ORGX_MCP_URL` (optional, default: `https://mcp.useorgx.com/mcp?profile=commander`)
- `ORGX_BASE_URL` (optional, default: `https://www.useorgx.com`)
- `ORGX_INITIATIVE_ID` (recommended for activity attribution)
- `ORGX_USER_ID` (optional header for API attribution)
- `ORGX_CLAUDE_PLUGIN_DIR` (optional plugin root override for dispatch)
- `ORGX_SKILLS_DIR` (optional skills root override; default `.claude/orgx-skills`)
- `ORGX_SKILL_PACK_NAME` (optional; default `orgx-agent-suite`)
- `ORGX_RUNTIME_HOOK_URL` and `ORGX_HOOK_TOKEN` (optional local runtime relay)
- `ORGX_WIZARD_HOOK_OUTBOX` (optional local JSONL outbox; default
  `~/.config/useorgx/wizard/hooks/events.jsonl`)

## Login + Autopilot

1. Run `/orgx-login` (or `node scripts/orgx-login.mjs`) to start browser pairing.
2. Complete browser auth; key is stored in macOS keychain.
3. SessionStart hook loads key into `CLAUDE_ENV_FILE`.
4. Run `/orgx-sync-skills` to pull OrgX skill pack locally.
5. Run `/orgx-sync-agents` to refresh OrgX Claude agent profiles.
6. Run `/orgx-autopilot-start` to dispatch initiative tasks.
7. Run `/orgx-autopilot-resume` to resume from the latest state file.

## Local Development

1. Install deps:

```bash
npm install
```

2. Validate:

```bash
npm run check
```

3. Run Claude with local plugin directory:

```bash
npm run dev:claude
```

Or directly:

```bash
claude --plugin-dir /Users/hopeatina/Code/orgx-claude-code-plugin
```

4. Smoke test plugin loading:

```bash
claude --plugin-dir . -p "Reply with exactly: plugin-smoke-ok"
```

5. Smoke test MCP tool invocation:

```bash
claude --plugin-dir . --permission-mode bypassPermissions -p "Use the orgx_status_json MCP tool and return one-line summary."
```

## Claude Code Marketplace

This repo also hosts the self-serve OrgX Claude Code marketplace catalog at
`.claude-plugin/marketplace.json`.

Add the marketplace:

```text
/plugin marketplace add useorgx/orgx-claude-code-plugin
```

Install the plugin:

```text
/plugin install orgx-claude-code-plugin@orgx
```

Run `/orgx-login` after installation to pair a workspace and store the OrgX API
key in the local keychain. The hosted MCP endpoint defaults to
`https://mcp.useorgx.com/mcp?profile=commander`.

## Hook Behavior

`hooks/scripts/post-reporting-event.mjs` posts:
- activity events -> `/api/client/live/activity`
- optional completion changeset -> `/api/client/live/changesets/apply`
- optional local runtime relay -> `ORGX_RUNTIME_HOOK_URL`
- compact, redacted Work Graph hook events -> local wizard outbox

The `Stop` hook then runs `hooks/scripts/orgx-reconcile-hook.mjs`, which turns
the local outbox into a summary-only Work Graph report at
`~/.config/useorgx/wizard/hooks/reports/latest-work-graph-report.json`.

The script is best-effort and exits cleanly on failures to avoid interrupting Claude sessions.
It never writes raw transcripts or full hook payloads; the reconciler should keep
raw client history local and promote only redacted summaries, evidence refs,
Work Graph fingerprints, and approved OrgX activity.

For live reporting, use MCP before hooks: `get_operator_chronicle` is the
preferred tool when Claude Code exposes it. If Claude Code has a stale MCP tool
list, use `orgx_recommend` with `mode: "morning_brief"` and present
`reportingNarrative.briefMarkdown`.

Dry-run reconciliation does not require OrgX credentials:

```bash
orgx-claude-code-reconcile-hooks \
  --outbox ~/.config/useorgx/wizard/hooks/events.jsonl \
  --output /tmp/orgx-work-graph-report.json
```

Automatic Stop reconciliation writes locally by default. Publishing is explicit
and requires both an API key and an opt-in flag such as
`ORGX_CLAUDE_HOOK_RECONCILE_POST=true`:

```bash
ORGX_CLAUDE_HOOK_RECONCILE_POST=true ORGX_API_KEY=oxk_... \
  orgx-claude-code-reconcile-hooks --post
```

## Next Steps

- Submit to the Claude plugin directory after explicit submitter authorization.
- Add E2E harness for real Claude CLI sessions and OrgX assertion checks.
- Extract reusable shared core from OpenClaw plugin into a standalone package.

Docs:
- `docs/adr-0001-openclaw-to-claude-plugin.md`
- `docs/release-checklist.md`
