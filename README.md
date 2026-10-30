# OrgX for Claude Code

OrgX connects Claude Code to current work and reviewable outputs through Claude
Code's native OAuth flow. Status reads and explicit user-requested updates use
the authenticated account's grants.

The plugin surface is intentionally small:

- one remote HTTPS MCP connection
- four user-invoked commands:
  `/orgx-claude-code-plugin:orgx-login`,
  `/orgx-claude-code-plugin:orgx-status`,
  `/orgx-claude-code-plugin:orgx-operator-chronicle`, and
  `/orgx-claude-code-plugin:orgx-attach-output`
- one static setup skill for connection troubleshooting
- one `Stop` hook and a dependency-free attachment outbox helper

Version 0.1.17 can retain an attachment request that the user explicitly queues.
At the end of a response, the `Stop` hook can ask the current Claude session to
retry that request through the existing OrgX MCP connection. The helper reads
only the hook's session identifier and loop flag; it does not read project files,
session text, or transcripts. OrgX receives only the requested operation's
inputs, subject to the authenticated account's permissions. The hook makes no
HTTP requests and reads no OAuth credentials.

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
receipt. A compatible build must copy root `.mcp.json`, the `Stop` hook
configuration and `scripts/attachment-outbox.mjs`, and remove older runtime
files. Verify those installed files and confirm that `/mcp` lists `orgx`;
an older wizard's successful exit does not establish compatibility.

## Connect OrgX

1. Open `/mcp` in Claude Code.
2. Select `orgx`.
3. Choose **Authenticate** and complete the OrgX consent flow in the browser.
4. Return to `/mcp` and confirm that `orgx` is connected.

No API key or bearer token belongs in the plugin manifest, chat, or a checked-in
file. Installation alone is not proof that OAuth succeeded.

The plugin connects to:

```text
https://mcp.useorgx.com/mcp?profile=claude-code
```

That closed-world profile exposes exactly eight OrgX tools:

- `orgx_search`
- `orgx_inspect`
- `orgx_get_next_actions`
- `orgx_get_agent_status`
- `orgx_get_initiative_progress`
- `orgx_get_operation_status`
- `orgx_get_operator_brief`
- `orgx_update_work`

The update operation accepts either a bounded content patch or one output
attachment. It requires a stable retry key and the account's write grant.
Attachment enters review; it does not approve or complete the work. The profile
does not expose business-data deletion or workflow state-transition tools.
Standard OrgX MCP usage may be recorded by the hosted service for operation and
metering. The installed plugin adds no local telemetry or background reporting.

The `claude-code` selector uses the seven named informational operations plus
the existing `orgx_update_work` operation. The release manifest binds this exact
profile into its fingerprint. Existing `read-only` clients retain their seven
informational operations. Broader directory and runtime profiles are separate.

After updating an older installation, refresh its MCP connection and verify the
eight authenticated tools above. A read-only OAuth grant can hide the write
operation; the native consent flow must grant write access before attachment.
If the profile is unavailable, stop the OrgX
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
- `/orgx-claude-code-plugin:orgx-attach-output` inspects the requested target,
  attaches one durable output through `orgx_update_work`, then inspects the
  stored artifact. It presents the canonical answer, linked decisions, source
  notes, context, files and receipt when OrgX has recorded them. The user can
  explicitly queue an attachment with its selected HTTPS output URL, list queued
  requests, retry a selected request, clear a local request, or run `recover`
  after an interrupted local queue write.

The source files keep their short names under `commands/`; Claude Code adds the
plugin namespace to installed slash-command invocations.

The commands are user-invoked. The `Stop` hook handles only explicitly queued
attachment requests from its own session.

## Session security boundary

Every attachment attempt uses current `orgx_inspect` results to check the target
and workspace, then calls the existing `orgx_update_work` through Claude Code's
native OAuth connection. Stored request data and an earlier MCP response grant
no continuing authority. Expired or missing authorization requires native OAuth
reauthentication; a denied or invalid request stays paused.

The plugin does not read or transmit the current working directory, repository
path, or path aliases. Queued requests live in the user's home directory at
`~/.config/useorgx/claude-code/attachment-outbox`, with directory mode `0700` and
file mode `0600`. It retains only the selected attachment request and its retry
state, with at most 20 entries of 64 KiB each. It does not discover files, upload
local paths, or retain tokens, session text or transcripts. Native OAuth and the
hosted MCP service own authorization expiry.

An ambiguous attempt retains its exact payload and stable retry key. The hook
emits bounded instructions for the current Claude session; it cannot attach an
output itself or publish a newly discovered output. Automatic retries stop after
three attempts, and requests older than seven days pause. Authentication,
permission and validation failures also pause. Only an explicit retry command
resumes a paused request. Another session cannot automatically retry it. Clear
removes the local request only; it does not delete an OrgX artifact.

Use the attachment command's explicit `recover` action if a crash interrupted a
local queue write. It refuses recovery while the recorded owner process is
alive. For a dead owner, it can release the stale lock and restore a valid
uncommitted request as paused with reason `recovered`, preserving its exact
payload and retry key. An explicit retry is still required. Recovery discards
incomplete staging data and rejects unknown files; it makes no MCP call. Do not
force a live lock or delete unrelated files.

Claude Code does not run `Stop` when the user interrupts a response or when an
API error ends the turn. Those paths leave an attachment pending; the hook does
not establish delivery.

Attachment succeeds only when the current MCP response identifies the stored
artifact. Review, client acceptance and work completion remain separate. The
outbox does not replace Wizard's runtime capture.

`plugin.manifest.json` records this boundary as a machine-checked contract.
Version 0.1.17 requires a new directory review. Local protocol tests establish
the hook and queue behavior; they do not prove native OAuth, a live attachment,
directory publication or a signed package. Deploy the matching app attachment
route and MCP `claude-code` profile before distributing this version.

## Data and support

- Privacy: https://useorgx.com/privacy
- Terms: https://useorgx.com/terms
- Support: https://useorgx.com/support
- Security contact: reviewers@useorgx.com
- License: MIT

## Development and validation

Requirements: Node.js 18+ and a current Claude Code CLI supporting exec-form
command hooks. Plugin validation was exercised with Claude Code 2.1.309.

```bash
npm ci
npm run check
claude plugin validate . --strict
npm pack --dry-run --json
```

Record the actual CLI validation result for the release. Claude Code 2.1.309's
strict validator currently reports pre-existing plugin-name and missing-icon
warnings for this package; strict validation has not passed. Normal validation
and a live OAuth attachment need their own recorded results.

Run the local plugin in an isolated Claude session:

```bash
claude --plugin-dir . -p "Reply with exactly: plugin-smoke-ok"
```

Release and directory-review evidence is tracked in:

- `docs/release-checklist.md`
- `docs/anthropic-plugin-directory-submission.md`

Source readiness, submission, review, approval, directory publication, and an
Anthropic Verified badge are distinct states.

## About OrgX

[OrgX](https://useorgx.com) is proof for AI-delivered work — the operating record your agents and tools share. Agents in ChatGPT, Claude, Cursor, and Codex work from one record of decisions, approvals, and work receipts.

- [OrgX FAQ](https://useorgx.com/faq): what it is, who it's for, and what it costs
- [Agent work receipts](https://useorgx.com/agent-work-receipts): how finished agent work is checked and signed off
- [Pricing](https://useorgx.com/pricing)
- Hosted MCP server: [useorgx/orgx-mcp](https://github.com/useorgx/orgx-mcp)
