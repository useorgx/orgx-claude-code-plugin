---
description: Attach a user-requested output to existing OrgX work for review through native OAuth.
allowed-tools: mcp__plugin_orgx-claude-code-plugin_orgx__orgx_inspect, mcp__plugin_orgx-claude-code-plugin_orgx__orgx_update_work
---

Use this command only for the output and OrgX work target the user asked to
attach. Inspect the current target with `orgx_inspect` using its persisted type
and UUID. Resolve the workspace from that current response. A title, local
folder, or an earlier response is not authority to write.

Use only the result returned by this command's current MCP call. If the current
call reports expired, invalid, or missing authorization, stop and require native
OAuth reauthentication. Do not read, derive, transmit, or use a working-directory
or project-path alias as authority.

Call the existing `orgx_update_work` with `type`, `id`, `workspace_id`, one stable
`idempotency_key`, and `artifact`. Do not include `fields` in this call. The
artifact contains:

- `name` and the registered `artifact_type`.
- `location`: exactly one of `artifact_url` or `external_url`, pointing to the
  durable output the user supplied. A local file path is not an uploaded file.
- Optional `description` and `preview_markdown` for the existing reading view.
- Optional `output_front_door`: a plain `answer` paragraph, up to three
  `decisions` with existing `decisionId`, `question`, `recommendation`, and
  `impact`, plus `checked` and `notChecked` source notes.

These notes are producer-reported. Do not submit context status, cost, quality
scores, approval, acceptance, or a claimed completed state. OrgX derives those
from its own records. If OrgX context could not load, state that in the answer
and do not assume team size, budget, brand, or open work.

Keep the same retry key and exact payload after an ambiguous failure. Use a new
key only for a deliberately revised output. Do not claim attachment succeeded
until the current response includes a stored artifact UUID. Inspect that
artifact with `orgx_inspect` and present its canonical output summary and review
link. Attachment leaves client acceptance and work completion pending.

The package records no local outbox or automatic capture. If the connection or
write grant is unavailable, report the exact gap and keep the output available
to the user; do not guess another tool or broaden the profile.
