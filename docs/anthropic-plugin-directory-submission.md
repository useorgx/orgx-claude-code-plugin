# Anthropic Plugin Directory Submission

## Status

**Prepared, not submitted.** Source readiness, a portal submission, automated
review, publication in `claude-plugins-official`, and Anthropic Verified status
are separate states. Record each provider receipt independently.

## Copy-ready listing facts

- Name: `OrgX`
- Plugin ID: `orgx-claude-code-plugin`
- Version prepared for review: `0.1.12`
- Public repository: `https://github.com/useorgx/orgx-claude-code-plugin`
- Homepage: `https://useorgx.com`
- Privacy: `https://useorgx.com/privacy`
- Terms: `https://useorgx.com/terms`
- Support: `https://useorgx.com/support`
- License: `MIT`
- Maintainer contact: `reviewers@useorgx.com`
- Category: `productivity`
- Short description: `Connect Claude Code to OrgX MCP tools, operator reporting, runtime telemetry, skill sync, and Work Graph orchestration.`

The plugin bundles OrgX skills, commands, agents, passive runtime hooks, and a
remote HTTPS MCP connection. The MCP connection authenticates through Claude
Code's native OAuth flow. The manifest contains no bearer token or API key.
Optional runtime reporting and autopilot features use `/orgx-login`, which
stores a machine API key in macOS keychain and writes only non-secret metadata
to the project.

## Reviewer path

1. Clone the public repository over HTTPS.
2. Run `npm ci` and `npm run check`.
3. Run `claude plugin validate . --strict`.
4. Add the self-hosted marketplace over HTTPS:

   ```bash
   claude plugin marketplace add https://github.com/useorgx/orgx-claude-code-plugin.git --scope user
   claude plugin install orgx-claude-code-plugin@orgx --scope user
   ```

5. Open `/mcp`, select `orgx`, and complete native OAuth.
6. Confirm OrgX MCP tools are connected. Installation alone is not an
   authentication receipt.
7. Run `/orgx-login` only if reviewing optional runtime reporting, skill/agent
   sync, or autopilot dispatch. Never place reviewer credentials in this repo,
   an issue, a PR, or a screenshot; deliver them through the provider's secure
   submission field if requested.

## Required evidence before submission

- [ ] `npm ci`
- [ ] `npm run check`
- [ ] `npm pack --dry-run --json` inspected for the allowlisted package surface
- [ ] `claude plugin validate . --strict`
- [ ] clean local marketplace install succeeds
- [ ] clean remote HTTPS marketplace install succeeds with SSH disabled
- [ ] `/mcp` presents native OAuth for the hosted OrgX server
- [ ] public privacy, terms, support, and repository URLs respond successfully
- [ ] source commit is merged to the public default branch

## Submission portals and authority

Anthropic documents two official submission forms:

- Console: `https://platform.claude.com/plugins/submit` — Developer, Admin, or
  Owner on a Console organization.
- Claude.ai: `https://claude.ai/admin-settings/directory/submissions/plugins/new`
  — Team or Enterprise organization with directory management access.

Use one form, not duplicate submissions. The repository must be public. Review
time varies with queue volume. After publication, Anthropic says updates pushed
to the GitHub repository are mirrored and screened automatically; a source
merge is still not proof that the directory has published the update.

Official references:

- `https://claude.com/docs/plugins/submit`
- `https://code.claude.com/docs/en/plugins-reference`
- `https://code.claude.com/docs/en/plugin-marketplaces`

## Receipt ledger

Keep this section factual. Do not fill a later state from inference.

| State | Evidence |
| --- | --- |
| Source prepared | PR URL and merge SHA |
| Submitted | Provider submission ID, timestamp, and screenshot or confirmation URL |
| Review pending | Provider status page or email receipt |
| Approved | Provider approval notice |
| Published | Installable `orgx-claude-code-plugin@claude-plugins-official` result |
| Anthropic Verified | Badge visible in the provider directory |
