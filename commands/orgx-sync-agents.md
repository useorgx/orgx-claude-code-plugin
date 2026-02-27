---
description: Pull OrgX agent pack and materialize Claude agent profiles in this plugin.
allowed-tools: Bash,Read,Write
argument-hint: [skill_pack_name]
---

Sync agent profiles from OrgX:

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/orgx-sync-agents.mjs --project_dir="${CLAUDE_PROJECT_DIR:-$PWD}" --plugin_dir="${CLAUDE_PLUGIN_ROOT}" --skill_pack_name="${1:-orgx-agent-suite}"`

Then summarize:
- agent count synced
- agents directory path
- whether pack was unchanged (ETag 304)
