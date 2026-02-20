---
description: Push an execution update into OrgX with explicit phase and evidence.
allowed-tools: mcp__orgx__*
argument-hint: [phase] [message]
---

Collect arguments:
- `phase`: defaults to `execution`
- `message`: concise update of what changed

Then call `orgx_emit_activity` and include:
- `source_client: "claude-code"`
- `phase`
- `message`
- any known `initiative_id`, `workstream_id`, `task_id`, `run_id`, `correlation_id`

If an artifact was produced, also call `orgx_register_artifact`.
