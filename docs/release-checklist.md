# Release Checklist

## Pre-release

- `npm ci`
- `npm run check`
- `npm run manifest:check`
- `npm run release:dry-run`
- `claude plugin validate . --strict`
- inspect `npm pack --dry-run --json` and confirm no local credentials, config,
  screenshots, or unrelated files are present
- smoke load:
  - `claude --plugin-dir . -p "Reply with exactly: plugin-smoke-ok"`
- smoke MCP call:
  - `claude --plugin-dir . --permission-mode bypassPermissions -p "Use the orgx_status_json MCP tool and return one-line summary."`

## Packaging

- verify `.claude-plugin/plugin.json` version bump
- verify `package.json`, `package-lock.json`, `.claude-plugin/marketplace.json`,
  and `plugin.manifest.json` use the same version
- run `npm run manifest:refresh` after changing public manifest identity, then
  review and commit the generated fingerprint
- confirm `plugin.manifest.json` has no `signature` field; public builds are
  intentionally unsigned and must not claim a signing step
- update `README.md` and migration notes if behavior changed
- ensure hooks/commands/agents/skills paths are present
- create and push release tag:
  - `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
  - `git push origin vX.Y.Z`

## Marketplace Readiness

- keep the plugin source relative to the HTTPS-cloned marketplace root
- test a clean install without using the user's Claude configuration:

  ```bash
  plugin_smoke_root="$(mktemp -d)"
  CLAUDE_CONFIG_DIR="$plugin_smoke_root/config" \
    CLAUDE_CODE_PLUGIN_CACHE_DIR="$plugin_smoke_root/plugins" \
    GIT_SSH_COMMAND=/usr/bin/false \
    claude plugin marketplace add https://github.com/useorgx/orgx-claude-code-plugin.git --scope user
  CLAUDE_CONFIG_DIR="$plugin_smoke_root/config" \
    CLAUDE_CODE_PLUGIN_CACHE_DIR="$plugin_smoke_root/plugins" \
    GIT_SSH_COMMAND=/usr/bin/false \
    claude plugin install orgx-claude-code-plugin@orgx --scope user
  CLAUDE_CONFIG_DIR="$plugin_smoke_root/config" \
    CLAUDE_CODE_PLUGIN_CACHE_DIR="$plugin_smoke_root/plugins" \
    claude plugin list --json
  ```

- inspect the installed source and confirm version, HTTPS provenance, and
  expected plugin components
- authenticate the bundled `orgx` MCP server through `/mcp`; do not embed an
  API key in plugin metadata

## Anthropic Plugin Directory

- complete `docs/anthropic-plugin-directory-submission.md`
- merge the reviewed source to the public default branch before submission
- submit through exactly one official Anthropic portal
- retain submission, approval, and publication receipts as separate evidence
- prove publication with a fresh install from
  `orgx-claude-code-plugin@claude-plugins-official`

## Post-release

- monitor OrgX activity ingestion from `source_client=claude-code`
- verify initiative/task attribution in live dashboard
