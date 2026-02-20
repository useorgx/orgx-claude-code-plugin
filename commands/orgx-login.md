---
description: Pair this project with OrgX via browser login and store API key in macOS keychain.
allowed-tools: Bash,Read,Write
argument-hint: [initiative_id]
---

Run the login helper:

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/orgx-login.mjs --project_dir="${CLAUDE_PROJECT_DIR:-$PWD}" --initiative_id="${1:-$ORGX_INITIATIVE_ID}"`

Then summarize:
- whether pairing succeeded
- which initiative id is configured
- whether skill-pack sync succeeded
- next command to start autopilot dispatch
