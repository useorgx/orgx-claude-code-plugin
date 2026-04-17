---
name: orgx-deviation-reporting
description: Record a skill deviation with OrgX so it feeds tomorrow's Daily Brief. Use whenever an OrgX skill fires locally (pre-PR, pre-commit, pre-chat) on a file edit, commit, PR, chat turn, or task output.
tools:
  - mcp__orgx__*
---

# OrgX — skill deviation reporting

Every time an OrgX skill catches a deviation during your work — a file you
edited, a commit you made, a PR you drafted, a chat turn, or a task output —
record it with OrgX so the evidence shows up in tomorrow's Daily Brief and
drives the confidence trajectory for that skill.

## When to record

You should record a deviation when:

- A rule from an OrgX skill triggered on code you were writing or reviewing.
- You accepted or rejected a skill's suggestion (pass `outcome: confirmed`
  or `outcome: rejected`).
- A skill surfaced a pattern in output you produced (PR description, chat
  response, test writeup).

Do **not** record the same deviation more than once per 10-minute window —
the server dedupes on `dedupe_key` automatically, but redundant POSTs waste
tokens.

## How to record

Issue an `orgx.post_skill_deviation` call (if available in your MCP tools)
or a direct HTTP POST through the OpenClaw bridge:

```
POST /api/v1/skills/{skill_id}/deviations
Authorization: Bearer <OrgX API key>
Content-Type: application/json

{
  "evidence_kind":      "file_edit" | "commit" | "pr" | "chat_turn" | "task_output",
  "evidence_ref":       "<repo>#<pr>" | "<path>:<line>" | "<commit_sha>",
  "summary":            "<one-line description of what the skill caught>",
  "application_source": "plugin_claude",
  "confidence":         0.0..1.0,
  "outcome":            "pending" | "confirmed" | "rejected" | "ignored",
  "trigger_context":    { "file_path": "...", "rule_matched": "..." },
  "dedupe_key":         "<sha1(skill_id | evidence_kind | evidence_ref | floor(epoch/600))>",
  "captured_at":        "2026-04-17T10:00:00Z"
}
```

### Computing `dedupe_key`

```ts
import { createHash } from "node:crypto";

const bucket = Math.floor(Date.now() / 1000 / 600);
const material = [skillId, evidenceKind, evidenceRef, String(bucket)].join("|");
const dedupe_key = createHash("sha1").update(material).digest("hex");
```

10-minute bucketing handles save-happy editors without losing legitimate
re-fires beyond that window.

## What happens next

Your deviation lands in `skill_deviations` on the OrgX server. The nightly
rollup feeds it into `workspace_proof_daily` (the "Deviations caught" tile
in your Daily Brief proof strip) and updates the skill's confidence
sparkline in `skill_confidence_samples`.

If the skill catches ≥3 deviations on tasks owned by a particular agent
whose loadout doesn't include the skill yet, the nightly job surfaces a
cross-pollination proposal — which you'll see tomorrow morning in your
Agents lens.

## Links

- Full contract: https://github.com/hopeatina/orgx/blob/main/orgx/docs/api-contracts/daily-brief-schema.md#04
- SDK reference implementation (Node): https://github.com/useorgx/openclaw-plugin/blob/main/src/deviations-sdk.ts
- Daily Brief surface: https://useorgx.com/today
