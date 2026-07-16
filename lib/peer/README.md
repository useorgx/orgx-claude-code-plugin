# OrgX Peer Sidecar for Claude Code

The plugin under `@useorgx/claude-code-plugin` has always been a **Claude Code CLI plugin** (hooks + skills + commands + agents) you load with `claude --plugin-dir .`.

This folder adds a second shape: a **peer sidecar** that connects to OrgX server over WebSocket and dispatches to your local `claude` CLI on demand. The sidecar uses the shared `@useorgx/orgx-gateway-sdk` package, pinned to a release that supports Gateway protocols v1, v2, and v3.

The production peer negotiates v3 for resumable human attention while retaining
the v1 task terminal. A successful Claude process is not, by itself, a
canonical `ProofPacket`; proof finalization will move to v2 only when the driver
can return the envelope-bound proof, receipt, artifact, cost, and outcome
references required by `ExecutionResult`.

## Mental model

- The CLI plugin is **loaded by you** when you run Claude Code interactively.
- The peer sidecar is **loaded by the machine** (e.g. autostart on login) and listens for OrgX dispatches. When a task arrives, it runs `claude -p <prompt> --plugin-dir <this-plugin>` under the hood — which re-uses the same skills + hooks your interactive sessions use.

Both shapes share a codebase and the same skill catalog.

## Run it

```bash
# from the plugin root
ORGX_API_KEY=oxk_your_token_here \
ORGX_WORKSPACE_ID=<workspace-uuid> \
node lib/peer/cli.mjs
```

Or programmatically:

```js
import { startPeer } from '@useorgx/claude-code-plugin/peer';

const peer = await startPeer({
  apiKey: process.env.ORGX_API_KEY,
  workspaceId: process.env.ORGX_WORKSPACE_ID,
});

// later
await peer.stop();
```

## Required oxk_ scopes

- `gateway:drive`  — accept task.dispatch / emit task.step + task.completed
- `plugin:heartbeat` — post `POST /api/v1/licenses/heartbeat` weekly

## Protocol

- On boot: calls `GET /api/v1/plan-skills` to pull skill rules the peer checks against file-edit / tool-call events. Matches emit `task.deviation` to the server.
- `claude` is invoked with `--output-format stream-json` so stdout is NDJSON events that the Driver translates into wire-protocol messages.
- Token usage is accumulated from `tokens_used` events emitted by Claude Code when present; `cost_estimate_cents` is set to 0 because subscription-backed dispatches don't carry a price — the server fills `saved_estimate_cents` later via the receipt aggregator.

## AskUserQuestion continuation

For sidecar-dispatched work, the `PreToolUse:AskUserQuestion` hook posts each
question to the initiative's OrgX Attention queue and returns Claude's native
`defer` decision. Claude preserves the session and tool call instead of turning
the interruption into a failed run.

When every related answer arrives, Gateway v3 sends `attention.resolve` to the
owning peer. The driver stores the answer in the local 0600 checkpoint, resumes
the same Claude session with `--resume`, and the hook allows the preserved tool
with structured `updatedInput.answers`. OrgX receives separate
`answer_received`, `resuming`, and `resumed` receipts, followed by the continued
task's normal terminal receipt.

The hook fails open to Claude's native interaction if OrgX, auth, or lineage is
unavailable; it never traps the session behind a network-only state. Native
`PermissionRequest` does not expose the same durable defer/resume contract, so
this release does not claim remote permission parity. Explicit human choices
must use `AskUserQuestion`; local permission policy remains authoritative.

## Peer lifecycle

```
startPeer()
  ├─ load plugin.manifest.json (unsigned in dev → 'degraded' in permissive mode)
  ├─ new PeerClient({ baseUrl: wss://useorgx.com, apiKey, workspaceId,
  │                    pluginId: '@useorgx/claude-code-plugin',
  │                    drivers: [new ClaudeCodeDriver(…)] })
  ├─ client.connect()         // WebSocket + protocol handshake
  ├─ postHeartbeat()          // initial license heartbeat
  └─ setInterval(heartbeat, 7d) // keep status active
```

`client.disconnect()` on stop clears the heartbeat timer.

## Files

- `ClaudeCodeDriver.mjs` — Driver implementing v1 task execution plus v3 resumable attention. Spawns `claude`, reads NDJSON stdout, and preserves deferred sessions.
- `attentionState.mjs` — private local checkpoint store for decision/session/tool-call bindings and structured answers.
- `peer.mjs` — `startPeer()` wires Driver into PeerClient + manages heartbeat.
- `cli.mjs` — shell entrypoint so `node lib/peer/cli.mjs` just works.
- `peer.test.mjs` — Node `node --test` unit coverage for the Driver (spawns a fake `claude` via a test fixture).

## Status

Alpha — lands alongside the other Sovereign Execution plugin peers (orgx-codex-plugin, orgx-opencode-plugin). See initiative [`993cabeb`](https://useorgx.com/live/993cabeb-8162-4f35-9b4d-3832df9d5f83).
