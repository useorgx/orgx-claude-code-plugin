---
description: Attach a user-requested output to existing OrgX work for review through native OAuth.
allowed-tools: mcp__plugin_orgx-claude-code-plugin_orgx__orgx_inspect, mcp__plugin_orgx-claude-code-plugin_orgx__orgx_update_work, Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/attachment-outbox.mjs" *)
---

For an explicit `list`, `retry`, `clear` or `recover` request, follow the queue
management instructions below. Local list, clear and recover do not call MCP.

Use this command only for the output and OrgX work target the user asked to
attach. Inspect the current target with `orgx_inspect` using its persisted type
and UUID. Resolve the workspace from that current response. A title, local
folder, or an earlier response is not authority to write.

Use only the result returned by this command's current MCP call. If the current
call reports expired, invalid, or missing authorization, stop and require native
OAuth reauthentication. Do not read, derive, transmit, or use a working-directory
or project-path alias as authority.

Prepare the existing `orgx_update_work` request with `type`, `id`, `workspace_id`, one stable
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

Before the first write, persist ONLY this explicit user-selected request by
running `node "${CLAUDE_PLUGIN_ROOT}/scripts/attachment-outbox.mjs" enqueue`.
Send JSON on stdin: `{"session_id":"${CLAUDE_SESSION_ID}","request":{...}}`.
Use a single-quoted heredoc with a delimiter absent from the JSON; never
interpolate request data into shell arguments, command substitutions or a
project file. The helper generates `idempotency_key` when omitted. If the session
placeholder is not substituted or local persistence fails, report the gap and
do not write. Never queue tokens, credentials, local paths, or discovered files.
No file is uploaded by this helper; locations must be durable HTTPS URLs.

Call `orgx_update_work` with exactly the returned `request`. Retain its entry
`id` and `request_digest`. Keep the same retry key and exact payload after an ambiguous failure. Use a new
key only for a deliberately revised output. Do not claim attachment succeeded
until the current response includes a stored artifact UUID. Inspect that
artifact with `orgx_inspect` and present its canonical output summary and review
link. Attachment leaves client acceptance and work completion pending.

Record the current result using the same helper's `result` operation with JSON
`{"entry_id":"...","request_digest":"...","session_id":"${CLAUDE_SESSION_ID}","outcome":"..."}`:
use `stored` only for an actual current stored artifact UUID and add
`artifact_id`; use `uncertain` for timeout, transport, 5xx or ambiguous results;
use `auth` for missing/expired authentication, `denied` for missing write grant,
foreign scope or permission denial, and `invalid` for validation/idempotency
conflicts. These last three pause retries and require the named setup fix.
Do not save raw responses/errors. If local acknowledgment fails after success,
retain the same key; a retry must reconcile the original request.

The Stop hook retries at most one pending request in this session, using fresh
target/workspace inspection and the existing native OAuth tool. It never adds
requests, scans files, grants access or publishes a revised output. Paused,
expired (seven days), or retry-limited (three attempts) entries never retry
automatically. A Stop already continuing from a hook cannot start another retry.

For explicit queue management requested by the user, the same command accepts
`list`, `retry <entry-id>`, `clear <entry-id>`, or `recover`. Use the helper `list` with `{}`
to show bounded summaries. For `retry`, first re-inspect the exact target and
workspace and resolve the recorded auth/permission/validation gap; then run
`resume` with entry_id, request_digest and current session_id, and submit that
unchanged request once. Resume never creates a new key or revises a payload.
For `clear`, run `clear` with entry_id and request_digest only after the user
explicitly names that entry for removal. Clearing local data does not cancel or
delete an attachment already stored remotely. Never resume or clear from Stop.
If a killed helper left a lock or staged write, an explicit user `recover`
request runs the helper `recover` with `{}`. Recovery refuses a live lock owner,
releases only a dead owner's lock, and restores complete staged requests as
paused with the same payload/key. An explicit retry is still required. It may
discard incomplete local staging; it does not send, cancel or delete remotely.
Never force a live lock, recover from Stop, or remove unknown files.
If the connection or write grant is unavailable, report the exact gap; do not
guess another tool, bypass permissions, or broaden the profile.
