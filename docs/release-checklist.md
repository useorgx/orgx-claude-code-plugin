# Release Checklist

## Source and identity

- confirm the branch and exact release diff
- confirm `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`, and `plugin.manifest.json` use the same
  version
- run `npm run manifest:refresh` after changing manifest identity, then inspect
  the generated fingerprint
- confirm the public build has no `signature` field and makes no signing claim

## Policy-safe installed surface

- `.mcp.json` contains only the native-OAuth HTTPS endpoint
  `https://mcp.useorgx.com/mcp?profile=claude-directory`
- `plugin.manifest.json` lists exactly seven read tools and does not list
  `orgx_bootstrap`
- `commands/` contains only user-invoked, OrgX-specific read/setup workflows
- `skills/` contains only static, human-readable setup guidance
- no automatic hook configuration is present
- no subagent profile is present
- no local executable, sidecar, dispatch, attention, telemetry, transcript,
  skill-sync, or agent-sync runtime is packaged
- no MCP header, token, API key, password, cookie, or OAuth code is embedded

## Deterministic gates

```bash
npm ci
npm run check
npm run manifest:check
claude plugin validate . --strict
npm pack --dry-run --json
```

Inspect the package list and confirm it matches the `package.json` allowlist.
Then run a local load smoke:

```bash
claude --plugin-dir . -p "Reply with exactly: plugin-smoke-ok"
```

## Clean marketplace install

Use an isolated Claude configuration and disable SSH fallback:

```bash
plugin_smoke_root="$(mktemp -d)"
CLAUDE_CONFIG_DIR="$plugin_smoke_root/config" \
  CLAUDE_CODE_PLUGIN_CACHE_DIR="$plugin_smoke_root/plugins" \
  GIT_SSH_COMMAND=/usr/bin/false \
  claude plugin marketplace add \
  https://github.com/useorgx/orgx-claude-code-plugin.git --scope user
CLAUDE_CONFIG_DIR="$plugin_smoke_root/config" \
  CLAUDE_CODE_PLUGIN_CACHE_DIR="$plugin_smoke_root/plugins" \
  GIT_SSH_COMMAND=/usr/bin/false \
  claude plugin install orgx-claude-code-plugin@orgx --scope user
CLAUDE_CONFIG_DIR="$plugin_smoke_root/config" \
  CLAUDE_CODE_PLUGIN_CACHE_DIR="$plugin_smoke_root/plugins" \
  claude plugin list --json
```

Installation is not authentication. Open `/mcp` and verify native OAuth and the
connected state separately. After authentication, verify the server advertises
exactly the seven tools in `plugin.manifest.json` and exercise each one with
seeded reviewer data.

## OrgX wizard compatibility

The wizard's Claude sync specification must include all of these source paths:

```text
.claude-plugin
.mcp.json
agents
commands
hooks
lib
scripts
skills
```

The last four runtime-capable directories are placeholder-only in this public
plugin so a wizard refresh removes legacy installed files without getting a
GitHub 404. Validate the released wizard in an isolated home directory:

```bash
wizard_smoke_root="$(mktemp -d)"
ORGX_WIZARD_CONFIG_HOME="$wizard_smoke_root/wizard" \
  CLAUDE_CONFIG_DIR="$wizard_smoke_root/claude" \
  CLAUDE_CODE_PLUGIN_CACHE_DIR="$wizard_smoke_root/cache" \
  npx -y @useorgx/wizard@latest plugins add claude
```

Then inspect the managed Claude plugin cache and prove:

- `.mcp.json` exists and contains the `claude-directory` endpoint
- only `.gitkeep` exists in `agents/`, `hooks/`, `lib/`, and `scripts/`
- the three commands and one setup skill exist
- no legacy installed file survives the sync

As of the 0.1.12 source preparation, wizard `0.1.52` still omitted `.mcp.json`
from its Claude sync specification. Release a corrected wizard and run this
smoke before claiming wizard compatibility.

## Directory release

- complete `docs/anthropic-plugin-directory-submission.md`
- merge reviewed source before submission
- submit through one official portal only
- retain submission, review, approval, publication, and verification receipts
  separately
- prove publication with a fresh install from
  `orgx-claude-code-plugin@claude-plugins-official`
