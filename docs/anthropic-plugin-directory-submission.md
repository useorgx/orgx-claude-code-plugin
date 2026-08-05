# Anthropic Plugin Directory Submission

## Current state

**Prepared, not submitted.** A source commit, portal submission, automated
screening result, directory publication, and Anthropic Verified status require
separate evidence.

## Copy-ready listing

- Name: `OrgX`
- Plugin ID: `orgx-claude-code-plugin`
- Version: `0.1.12`
- Category: `productivity`
- Repository: `https://github.com/useorgx/orgx-claude-code-plugin`
- Homepage: `https://useorgx.com`
- Privacy: `https://useorgx.com/privacy`
- Terms: `https://useorgx.com/terms`
- Support: `https://useorgx.com/support`
- Maintainer: `reviewers@useorgx.com`
- License: `MIT`
- Short description: `Read OrgX initiative status, search organizational context, and review operator briefings from Claude Code through native OAuth.`

The plugin contains a remote HTTPS MCP configuration, three user-invoked
commands, and one static setup skill. It loads no automatic hooks or local
executables. It does not fetch skill or agent instructions from OrgX. It does
not read Claude memory, session history, summaries, or user files. The MCP
server receives only the inputs needed for an OrgX action the user requests.

## Policy mapping

The package was narrowed for the Anthropic Software Directory Policy dated
April 15, 2026:

- Sections 1D and 1F: no automatic context collection and no session/file
  extraction paths.
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

## Reviewer path

1. Clone the public repository over HTTPS.
2. Run `npm ci` and `npm run check`.
3. Run `claude plugin validate . --strict`.
4. Inspect `npm pack --dry-run --json`; the artifact must contain no hooks,
   agents, sidecar, telemetry client, dispatch runtime, or sync runtime.
5. Install from the self-hosted public marketplace:

   ```bash
   claude plugin marketplace add https://github.com/useorgx/orgx-claude-code-plugin.git --scope user
   claude plugin install orgx-claude-code-plugin@orgx --scope user
   ```

6. Open `/mcp`, select `orgx`, and complete native OAuth.
7. Confirm the endpoint is
   `https://mcp.useorgx.com/mcp?profile=claude-directory` and the server is
   connected. Confirm it advertises exactly these seven read tools:

   - `orgx_search`
   - `orgx_inspect`
   - `orgx_recommend`
   - `get_agent_status`
   - `get_initiative_pulse`
   - `get_morning_brief`
   - `get_operator_chronicle`

8. Use the provider's secure reviewer-credential field for the populated test
   account. Never put reviewer credentials in this repository, a PR, an issue,
   or a screenshot.

## Working examples

1. Invoke `/orgx-status`, select the seeded initiative if prompted, and verify
   that the response identifies progress and blockers from
   `get_initiative_pulse`.
2. Invoke `/orgx-operator-chronicle` and verify that the response separates
   decisions, artifacts, goals, initiatives, data gaps, and the first action.
3. Ask Claude to use `orgx_search` to find a seeded project term, then use
   `orgx_inspect` only on a returned OrgX entity.

## Pre-submission evidence

- [ ] PR merged to the public default branch
- [ ] `npm ci`
- [ ] `npm run check`
- [ ] `npm run manifest:check`
- [ ] `claude plugin validate . --strict`
- [ ] package-content inspection passed
- [ ] clean local marketplace install passed
- [ ] clean remote HTTPS marketplace install passed with SSH disabled
- [ ] released OrgX wizard copied `.mcp.json` and pruned legacy runtime files
- [ ] native OAuth completed with the reviewer account
- [ ] all seven advertised MCP tools exercised with seeded data
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

## Receipt ledger

| State | Required evidence |
| --- | --- |
| Source prepared | PR URL and reviewed commit SHA |
| Submitted | Provider receipt or submission ID with timestamp |
| Review pending | Provider status page or email receipt |
| Approved | Provider approval notice |
| Published | Fresh install from `claude-plugins-official` |
| Anthropic Verified | Badge visible in the provider directory |
