# Release Checklist

## Source and identity

- use version `0.1.17` for the explicit attachment outbox runtime change
- confirm the branch and exact release diff
- confirm `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`, and `plugin.manifest.json` use the same
  version
- run `npm run manifest:refresh` after changing manifest identity, then inspect
  the generated fingerprint
- confirm the public build has no `signature` field and makes no signing claim

## Policy-safe installed surface

- `.mcp.json` contains only the native-OAuth HTTPS endpoint
  `https://mcp.useorgx.com/mcp?profile=claude-code`
- `plugin.manifest.json` lists exactly eight focused profile tools and does not list
  `orgx_bootstrap`
- the release manifest fingerprint binds the eight existing operations and
  `mcp_contract` to `claude-code`
- deploy the matching server profile before releasing this client change; confirm
  authenticated discovery with write grants exposes exactly eight operations
- prove a Read grant hides updates and an authorized output attachment enters
  review without completing or approving work; retry its exact key/payload
- `commands/` contains only user-invoked OrgX status/setup/output workflows
- installed commands resolve under Claude Code's plugin namespace:
  `/orgx-claude-code-plugin:orgx-login`,
  `/orgx-claude-code-plugin:orgx-status`,
  `/orgx-claude-code-plugin:orgx-operator-chronicle`, and
  `/orgx-claude-code-plugin:orgx-attach-output`
- `skills/` contains only static, human-readable setup guidance
- the only lifecycle hook is `Stop`, invoking the dependency-free
  `scripts/attachment-outbox.mjs` helper with a bounded timeout
- no subagent profile is present
- packaged executable code is limited to that outbox helper; no sidecar,
  dispatch, attention, telemetry, transcript, skill-sync or agent-sync runtime
  is packaged
- no MCP header, token, API key, password, cookie, or OAuth code is embedded
- standard hosted OrgX MCP usage may be recorded, but the installed plugin adds
  no local telemetry or background reporting
- `plugin.manifest.json` matches the revised session-security contract:
  current-response-only authority, no CWD access or aliases, remote expiry
  enforcement, and explicit session-bound attachment request storage under
  `~/.config/useorgx/claude-code/attachment-outbox`
- the outbox directory is `0700`, files are `0600`, and project-relative state,
  tokens and cached authorization are forbidden
- both status commands reject expired authorization and prohibit reuse of an
  earlier command result as current authority

## Attachment outbox checks

- enqueue only the user's explicitly selected target and durable HTTPS output;
  never discover files, scrape session text, or upload a local path
- preserve the exact request and stable retry key after an ambiguous response
- accept at most 20 entries, each at most 64 KiB
- the hook consumes only `session_id` and `stop_hook_active`; ignore CWD,
  transcript paths and assistant text
- stop-hook reentry permits the session to stop, with no recursive retry loop
- an unrelated session cannot automatically drain another session's requests
- each attempt requires a current target/workspace inspection and the existing
  native OAuth `orgx_update_work` call; the helper uses no direct HTTP or tokens
- three failed attempts pause a request; age beyond seven days also pauses it
- authentication, permission and validation failures pause; only an explicit
  user retry command resumes a paused request
- list and clear require an explicit command; clear changes only local state
- test explicit `recover` as local repair only: refuse a live owner, release a
  dead owner's lock, and restore valid uncommitted staging as paused with reason
  `recovered` while preserving the exact payload and retry key
- recovery discards incomplete staging and rejects unknown files; it makes no
  MCP call and never requires forcing a live lock or deleting unrelated files
- a recovered request remains paused until an explicit retry command
- verify lock records contain only a PID and nonce, are prepared and fsynced
  before atomic hard-link publication, and contain no credentials
- user interrupts and API errors do not invoke `Stop`; leave pending requests
  pending and make no delivery claim for those paths
- report success only after the current MCP call returns a stored artifact UUID;
  artifact review, client acceptance and work completion remain pending
- record static protocol tests separately from actual native OAuth and live
  attachment evidence; a passing local suite proves neither live boundary

## Deterministic gates

```bash
npm ci
npm run check
npm run manifest:check
claude plugin validate . --strict
npm pack --dry-run --json
```

Record normal and strict CLI validation separately. With Claude Code 2.1.309,
the strict validator reports pre-existing plugin-name and missing-icon warnings;
do not record strict validation as passed. Retain the actual normal-validation
result when run.

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
exactly the eight operations in `plugin.manifest.json` with the requested
grants, and exercise each operation with seeded reviewer data. Keep deletion,
approval and completion outside this profile.

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

`hooks/` and `scripts/` now carry the bounded attachment outbox runtime;
`agents/` and `lib/` retain compatibility placeholders. A wizard refresh must
copy the exact new runtime while removing legacy installed files. Validate the
released wizard in an isolated home directory:

```bash
wizard_smoke_root="$(mktemp -d)"
ORGX_WIZARD_CONFIG_HOME="$wizard_smoke_root/wizard" \
  CLAUDE_CONFIG_DIR="$wizard_smoke_root/claude" \
  CLAUDE_CODE_PLUGIN_CACHE_DIR="$wizard_smoke_root/cache" \
  npx -y @useorgx/wizard@latest plugins add claude
```

Then inspect the managed Claude plugin cache and prove:

- `.mcp.json` exists and contains the `claude-code` endpoint
- only `.gitkeep` exists in `agents/` and `lib/`
- the only configured lifecycle event is `Stop`
- the hook points to the installed `scripts/attachment-outbox.mjs`
- the four commands and one setup skill exist
- no legacy installed file survives the sync

As of the 0.1.12 source preparation, wizard `0.1.52` still omitted `.mcp.json`
from its Claude sync specification. Release a corrected wizard and run this
smoke before claiming wizard compatibility.

## Directory release

- complete `docs/anthropic-plugin-directory-submission.md`
- request a new review for 0.1.17's hook and private local outbox; do not inherit
  approval or publication evidence from the earlier stateless package
- merge reviewed source before submission
- submit through one official portal only
- retain submission, review, approval, publication, and verification receipts
  separately
- treat the provider receipt and resulting catalog entry as authoritative for
  the publication destination; Anthropic documentation uses both general
  plugin-directory and `claude-plugins-official` marketplace language
- when Anthropic names a Claude Code marketplace, prove publication with a
  fresh install of `orgx-claude-code-plugin` from that exact marketplace
