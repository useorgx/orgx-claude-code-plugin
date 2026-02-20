---
description: Resume the most recent OrgX autopilot dispatch state file.
allowed-tools: Bash,Read
argument-hint: [initiative_id]
---

Resume with retry for blocked tasks:

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/run-claude-dispatch-job.mjs --initiative_id="${1:-$ORGX_INITIATIVE_ID}" --resume=true --retry_blocked=true --plugin_dir="${CLAUDE_PLUGIN_ROOT}"`

Return:
- resumed job id
- number of pending tasks at start
- final completed/blocked counts
