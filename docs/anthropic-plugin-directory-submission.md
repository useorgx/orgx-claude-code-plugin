# Anthropic Plugin Directory Submission

## Current state

**Prepared, not submitted.** Version 0.1.17 adds a `Stop` hook and private local
outbox for explicitly queued attachment requests. This runtime change requires
a new directory review and matching hosted app/MCP deployment. It does not
inherit review or publication evidence from the earlier stateless package.
A source commit, portal submission, automated
screening result, directory publication, and Anthropic Verified status require
separate evidence.

## Copy-ready listing

- Name: `OrgX`
- Plugin ID: `orgx-claude-code-plugin`
- Version: `0.1.17`
- Category: `productivity`
- Repository: `https://github.com/useorgx/orgx-claude-code-plugin`
- Homepage: `https://useorgx.com`
- Privacy: `https://useorgx.com/privacy`
- Terms: `https://useorgx.com/terms`
- Support: `https://useorgx.com/support`
- Maintainer: `reviewers@useorgx.com`
- License: `MIT`
- Short description: `Connect Claude Code to OrgX status, bounded work updates, and reviewable outputs through native OAuth.`

The plugin contains a remote HTTPS MCP configuration, four user-invoked
commands, one static setup skill, one `Stop` hook and the dependency-free
`scripts/attachment-outbox.mjs` helper. The user explicitly selects the existing
OrgX target and durable HTTPS output to queue. The helper stores the request
and retry state under `~/.config/useorgx/claude-code/attachment-outbox` with
directory mode `0700` and file mode `0600`. Storage is bounded to 20 entries of
64 KiB each.

The hook consumes only the current session identifier and stop-loop flag. It
emits bounded instructions for that Claude session to inspect the target and
retry the exact request through the existing native OAuth MCP connection. The
helper reads no tokens, sends no direct HTTP requests, and does not discover
project files or read session text, summaries or transcripts. Stored selectors
and request data do not grant authority; each attempt requires current MCP
responses and the account's grants. Another session cannot automatically retry
the request.

Three failed attempts or seven days of age pause the request. Authentication,
permission and validation failures also pause. An explicit user command lists,
retries or clears requests; clearing removes only local state. The MCP server
receives only the inputs needed for the requested OrgX operation.

The explicit `recover` action repairs local state after a crash. A lock contains
only a PID and nonce, is prepared and fsynced, and is published with an atomic
hard link. Recovery refuses a live owner and can release a dead owner's lock.
It restores valid uncommitted staging as paused with reason `recovered`, keeping
the exact request and retry key; explicit retry is still required. Incomplete
staging is discarded and unknown files are rejected. Recovery makes no MCP
call, and users must not force a live lock or delete unrelated files.

The `Stop` hook does not run for a user interrupt or an API-error termination.
Requests remain pending in those cases; the hook provides no delivery proof.
The fixed eight-operation profile permits content edits and reviewable output
attachment only when requested and authorized. It exposes no deletion or
workflow transition operation. Standard
OrgX MCP usage may be recorded by the hosted service for operation and metering;
the plugin itself adds no local telemetry or background reporting.

The repository's self-hosted marketplace also lists `orgx-live`, an optional
mod under `plugins/orgx-live/` that adds function hooks and its own MCP
connection. It is a separate plugin with its own install command. It is not
part of this submission, the `orgx-claude-code-plugin` manifest, or the npm
artifact, and none of the checks below cover it.

## Policy mapping

Review the changed runtime against the Anthropic Software Directory Policy
dated April 15, 2026. The following maps the intended boundary; it does not
establish provider approval:

- Sections 1D and 1F: only explicitly queued attachment request data is retained;
  the hook's session identifier selects that request. No session-text or file
  extraction path is present.
- Sections 2A and 2B: every loaded command and skill is narrow and matches its
  actual behavior.
- Section 2D: user-invoked workflows name only the bundled OrgX connector.
- Section 2F: all behavioral guidance is static in this repository; the plugin
  does not download instructions for Claude to execute.
- Section 3A: the public privacy policy explains remote service data handling.
- Sections 3B and 3C: public support, source, setup, and troubleshooting paths
  are provided.

Official policy and submission documentation:

- `https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy`
- `https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms`
- `https://claude.com/docs/plugins/submit`
- `https://code.claude.com/docs/en/plugins`

## Reviewer path

1. Clone the public repository over HTTPS.
2. Run `npm ci` and `npm run check`.
3. Run `claude plugin validate . --strict`.
4. Inspect `npm pack --dry-run --json`. Confirm the exact `Stop` hook and
   `scripts/attachment-outbox.mjs` are packaged. Confirm there is no subagent,
   sidecar, telemetry client, dispatch runtime or sync runtime.
5. Install from the self-hosted public marketplace:

   ```bash
   claude plugin marketplace add https://github.com/useorgx/orgx-claude-code-plugin.git --scope user
   claude plugin install orgx-claude-code-plugin@orgx --scope user
   ```

6. Invoke `/orgx-claude-code-plugin:orgx-login` (or open `/mcp` directly),
   select `orgx`, and complete native OAuth.
7. Confirm the matching app attachment route and MCP profile are deployed, then confirm the endpoint is
   `https://mcp.useorgx.com/mcp?profile=claude-code` and the server is
   connected. With a write grant, confirm it advertises exactly these eight profile tools:

   - `orgx_search`
   - `orgx_inspect`
   - `orgx_get_next_actions`
   - `orgx_get_agent_status`
   - `orgx_get_initiative_progress`
   - `orgx_get_operation_status`
   - `orgx_update_work`
   - `orgx_get_operator_brief`

8. Use the provider's secure reviewer-credential field for the populated test
   account. Never put reviewer credentials in this repository, a PR, an issue,
   or a screenshot.

## Working examples

1. Invoke `/orgx-claude-code-plugin:orgx-status`, select the seeded initiative
   if prompted, and verify that the response identifies progress and blockers
   from `orgx_get_initiative_progress`.
2. Invoke `/orgx-claude-code-plugin:orgx-operator-chronicle` and verify that the
   response separates decisions, artifacts, goals, initiatives, data gaps, and
   the first action.
3. Ask Claude to use `orgx_search` to find a seeded project term, then use
   `orgx_inspect` only on a returned OrgX entity.
4. Invoke `/orgx-claude-code-plugin:orgx-attach-output` with a seeded target and
   durable output URL. Verify the returned stored artifact, retry the same
   payload/key without duplication, and confirm acceptance remains pending.
5. Explicitly queue a seeded attachment, then let the originating session reach
   `Stop`. Confirm the hook asks Claude to inspect the current target and use
   `orgx_update_work` through native OAuth. Confirm another session does not
   automatically retry it and that ordinary stops with no queued request do
   nothing.
6. Exercise permission, authentication and validation failures, the three-attempt
   limit and seven-day expiry. Confirm each pauses without losing the exact
   request/key. Explicitly list, retry and clear a local entry; clearing must
   leave the stored OrgX artifact intact.
7. Exercise a crash during local queue staging, then explicitly run `recover`.
   Confirm a live owner is refused and a dead owner's valid request returns
   paused with the same payload/key. Confirm incomplete staging is discarded,
   unknown files are rejected, and no MCP call occurs until an explicit retry.

Claude Code 2.1.309's strict validator currently reports pre-existing
plugin-name and missing-icon warnings for this package. Strict validation has
not passed. Record normal validation separately when run, and retain the actual
provider review result rather than treating these local checks as approval.

Local protocol tests cover the helper's bounded inputs, queue and retry rules.
They do not establish a successful native OAuth connection or live MCP write.
Retain separate evidence for those checks and for package signing or directory
publication; the source package makes no cryptographic signing claim.

## Pre-submission evidence

- [ ] PR merged to the public default branch
- [ ] `npm ci`
- [ ] `npm run check`
- [ ] `npm run manifest:check`
- [ ] `claude plugin validate . --strict`
- [ ] package-content inspection passed
- [ ] session isolation, private file modes, size limits and retry/expiry tests passed
- [ ] explicit local recovery tested for live/dead locks and valid/incomplete staging
- [ ] clean local marketplace install passed
- [ ] clean remote HTTPS marketplace install passed with SSH disabled
- [ ] released OrgX wizard copied `.mcp.json` and pruned legacy runtime files
- [ ] native OAuth completed with the reviewer account
- [ ] all eight advertised MCP tools exercised with seeded data
- [ ] originating-session Stop retry exercised through native OAuth with a stored artifact readback
- [ ] privacy, terms, support, repository, and MCP URLs respond publicly

## Official submission portals

Anthropic currently documents two in-app forms. Submit through exactly one to
avoid duplicate review records:

- Claude.ai: `https://claude.ai/admin-settings/directory/submissions/plugins/new`
  — requires a Team or Enterprise organization plus directory-management
  access; organization Owners have access by default.
- Console: `https://platform.claude.com/plugins/submit`
  — requires Developer, Admin, or Owner on a Console organization.

The public repository is required. After publication, Anthropic says updates
to the repository are mirrored and screened automatically; a source merge is
not itself evidence of a published directory update.

Anthropic's documentation currently uses both general, community-driven plugin
directory language and `claude-plugins-official` marketplace language. The
provider receipt and resulting catalog entry are authoritative for the actual
publication destination. Verify the listing there and, when the receipt names a
Claude Code marketplace, perform a fresh install from that exact marketplace.

## Receipt ledger

| State | Required evidence |
| --- | --- |
| Source prepared | PR URL and reviewed commit SHA |
| Submitted | Provider receipt or submission ID with timestamp |
| Review pending | Provider status page or email receipt |
| Approved | Provider approval notice |
| Published | Receipt and catalog entry; marketplace install when applicable |
| Anthropic Verified | Badge visible in the provider directory |
