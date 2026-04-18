# OrgX Peer Sidecar for Claude Code

The plugin under `@useorgx/claude-code-plugin` has always been a **Claude Code CLI plugin** (hooks + skills + commands + agents) you load with `claude --plugin-dir .`.

This folder adds a second shape: a **peer sidecar** that connects to OrgX server over WebSocket and dispatches to your local `claude` CLI on demand. That sidecar implements [Gateway Protocol v1](https://github.com/useorgx/orgx-gateway-sdk/blob/main/PROTOCOL.md) via the shared `@useorgx/orgx-gateway-sdk` package.

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

- `ClaudeCodeDriver.mjs` — Driver implementing Gateway Protocol v1. Spawns `claude`, reads NDJSON stdout, emits task.step / task.deviation / task.completed / task.failed.
- `peer.mjs` — `startPeer()` wires Driver into PeerClient + manages heartbeat.
- `cli.mjs` — shell entrypoint so `node lib/peer/cli.mjs` just works.
- `peer.test.mjs` — Node `node --test` unit coverage for the Driver (spawns a fake `claude` via a test fixture).

## Status

Alpha — lands alongside the other Sovereign Execution plugin peers (orgx-codex-plugin, orgx-opencode-plugin). See initiative [`993cabeb`](https://useorgx.com/live/993cabeb-8162-4f35-9b4d-3832df9d5f83).
