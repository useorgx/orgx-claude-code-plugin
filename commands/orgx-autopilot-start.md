---
description: Start OrgX autopilot dispatch for this initiative using Claude workers.
allowed-tools: Bash,Read
argument-hint: [initiative_id] [concurrency]
---

Run dispatcher in this project:

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/run-claude-dispatch-job.mjs --initiative_id="${1:-$ORGX_INITIATIVE_ID}" --concurrency="${2:-2}" --plugin_dir="${CLAUDE_PLUGIN_ROOT}"`

After execution:
- report completed/blocked counts
- include state file path
- list top blockers if any
