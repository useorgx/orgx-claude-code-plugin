---
description: Pull OrgX skill pack and materialize local SKILL.md files for Claude agents.
allowed-tools: Bash,Read,Write
argument-hint: [skill_pack_name]
---

Sync skill docs from OrgX:

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/orgx-sync-skills.mjs --project_dir="${CLAUDE_PROJECT_DIR:-$PWD}" --skill_pack_name="${1:-orgx-agent-suite}"`

Then summarize:
- skill count synced
- skills directory path
- whether pack was unchanged (ETag 304)
