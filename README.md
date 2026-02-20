# OrgX Claude Code Plugin

Claude Code plugin package for OrgX:
- OrgX MCP server wiring (`mcp.useorgx.com`)
- Runtime hooks that post activity/progress back to OrgX
- Browser pairing login (`/orgx-login`) with macOS keychain storage
- Session env hydration from keychain (`hooks/scripts/load-orgx-env.mjs`)
- Skill-pack sync from OrgX to local `SKILL.md` files (`/orgx-sync-skills`)
- Full dispatch/autopilot orchestration (`scripts/run-claude-dispatch-job.mjs`)
- Project commands, agent profile, and skill guidance
- CI and architecture ADR for migration planning

## Repo

- Path: `/Users/hopeatina/Code/orgx-claude-code-plugin`
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
commands/*.md                # Slash commands
agents/*.md                  # Subagent profiles
skills/**/SKILL.md           # Reusable guidance
```

## Environment Variables

- `ORGX_API_KEY` (required for live activity/changesets)
- `ORGX_MCP_URL` (optional, default: `https://mcp.useorgx.com/mcp`)
- `ORGX_BASE_URL` (optional, default: `https://www.useorgx.com`)
- `ORGX_INITIATIVE_ID` (recommended for activity attribution)
- `ORGX_USER_ID` (optional header for API attribution)
- `ORGX_CLAUDE_PLUGIN_DIR` (optional plugin root override for dispatch)
- `ORGX_SKILLS_DIR` (optional skills root override; default `.claude/orgx-skills`)
- `ORGX_SKILL_PACK_NAME` (optional; default `orgx-agent-suite`)
- `ORGX_RUNTIME_HOOK_URL` and `ORGX_HOOK_TOKEN` (optional local runtime relay)

## Login + Autopilot

1. Run `/orgx-login` (or `node scripts/orgx-login.mjs`) to start browser pairing.
2. Complete browser auth; key is stored in macOS keychain.
3. SessionStart hook loads key into `CLAUDE_ENV_FILE`.
4. Run `/orgx-sync-skills` to pull OrgX skill pack locally.
5. Run `/orgx-autopilot-start` to dispatch initiative tasks.
6. Run `/orgx-autopilot-resume` to resume from the latest state file.

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

## Hook Behavior

`hooks/scripts/post-reporting-event.mjs` posts:
- activity events -> `/api/client/live/activity`
- optional completion changeset -> `/api/client/live/changesets/apply`
- optional local runtime relay -> `ORGX_RUNTIME_HOOK_URL`

The script is best-effort and exits cleanly on failures to avoid interrupting Claude sessions.

## Next Steps

- Add marketplace metadata and publishing pipeline.
- Add E2E harness for real Claude CLI sessions and OrgX assertion checks.
- Extract reusable shared core from OpenClaw plugin into a standalone package.

Docs:
- `docs/adr-0001-openclaw-to-claude-plugin.md`
- `docs/release-checklist.md`
