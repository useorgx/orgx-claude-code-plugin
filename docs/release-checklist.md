# Release Checklist

## Pre-release

- `npm ci`
- `npm run check`
- `npm run release:dry-run`
- `claude plugin validate .`
- smoke load:
  - `claude --plugin-dir . -p "Reply with exactly: plugin-smoke-ok"`
- smoke MCP call:
  - `claude --plugin-dir . --permission-mode bypassPermissions -p "Use the orgx_status_json MCP tool and return one-line summary."`

## Packaging

- verify `.claude-plugin/plugin.json` version bump
- update `README.md` and migration notes if behavior changed
- ensure hooks/commands/agents/skills paths are present
- create and push release tag:
  - `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
  - `git push origin vX.Y.Z`

## Marketplace Readiness

- add marketplace manifest metadata
- publish version and test install from marketplace source
- run post-install smoke tests in a clean environment

## Post-release

- monitor OrgX activity ingestion from `source_client=claude-code`
- verify initiative/task attribution in live dashboard
