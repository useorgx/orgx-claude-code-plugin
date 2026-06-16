#!/usr/bin/env node
/**
 * OrgX Claude Code plugin hook: emit the execution graph at session Stop.
 *
 * The WEG keystone's client side. PR #15 added the `emitExecutionGraph` client
 * method but nothing CALLED it — so a real Claude Code session emitted no
 * execution graph automatically. This hook closes that seam: on Stop it derives
 * a REAL graph from the session transcript (one step node per actual tool call;
 * a tool_result is_error marks that step failed) and posts it via the existing
 * client helper. The backend derives false-completion / hallucinated-receipt /
 * dependency-violation signals from the graph itself.
 *
 * Conventions mirror post-reporting-event.mjs (same env + auth + base URL).
 *
 * OPT-IN: no-ops unless ORGX_EMIT_EXECUTION_GRAPH is truthy. Never throws — a
 * reporting hook must not fail a real session.
 *
 * Env:
 *   ORGX_EMIT_EXECUTION_GRAPH=1   (master opt-in switch)
 *   ORGX_API_KEY                  (bearer; same key the other hooks use)
 *   ORGX_USER_ID                  (X-Orgx-User-Id)
 *   ORGX_INITIATIVE_ID            (which initiative the run belongs to)
 *   ORGX_BASE_URL                 (default https://www.useorgx.com)
 *   ORGX_SOURCE_CLIENT            (default claude-code)
 *   ORGX_RUN_ID / ORGX_CORRELATION_ID
 *   ORGX_EMIT_MAX_NODES (default 40), ORGX_EMIT_DEBUG
 */

import process from "node:process";
import { readFileSync } from "node:fs";

import { createOrgXClient } from "../../lib/orgx-client.mjs";

const SCHEMA_VERSION = "1.0.0";
const VALID_SOURCE_CLIENTS = new Set([
  "openclaw",
  "codex",
  "claude-code",
  "chatgpt",
  "cursor",
  "web-ui",
  "api",
]);

const isTruthy = (v) =>
  typeof v === "string" && ["1", "true", "yes", "on"].includes(v.toLowerCase());

export function pickString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

const clampStr = (s, max) => (typeof s === "string" ? s.slice(0, max) : undefined);

export function parseJsonl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const out = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      /* skip non-JSON lines */
    }
  }
  return out;
}

function contentBlocks(entry) {
  const msg = entry && (entry.message ?? entry);
  const content = msg && msg.content;
  return Array.isArray(content) ? content : [];
}

/**
 * Derive a real execution graph from a parsed transcript. One root `task` node
 * for the session plus one `step` node per tool call that actually ran; a
 * tool_result flagged is_error marks that step `failed`. Emits NO depends_on
 * edges — temporal ordering of tool calls is not a verified dependency, and
 * asserting one would make the backend derive a false dependency_violation per
 * edge. Order is positional.
 */
export function deriveGraph(entries, opts = {}) {
  const maxNodes = Math.max(1, opts.maxNodes ?? 40);

  const errorByToolUseId = new Map();
  for (const entry of entries) {
    for (const block of contentBlocks(entry)) {
      if (block && block.type === "tool_result" && block.tool_use_id) {
        errorByToolUseId.set(block.tool_use_id, Boolean(block.is_error));
      }
    }
  }

  const steps = [];
  for (const entry of entries) {
    for (const block of contentBlocks(entry)) {
      if (block && block.type === "tool_use") {
        steps.push({
          toolUseId: block.id,
          name: typeof block.name === "string" ? block.name : "tool",
        });
      }
    }
  }

  const nodes = [
    {
      id: "session",
      type: "task",
      title: clampStr(opts.summary, 500) || "Claude Code session",
      status: "completed",
      requires_evidence: false,
    },
  ];

  for (const [i, step] of steps.slice(-(maxNodes - 1)).entries()) {
    const failed = errorByToolUseId.get(step.toolUseId) === true;
    nodes.push({
      id: `step-${i + 1}`,
      type: "step",
      title: clampStr(step.name, 500),
      status: failed ? "failed" : "completed",
      requires_evidence: false,
    });
  }

  return { nodes, edges: [] };
}

/** Build the runtime execution-graph event payload. Pure. */
export function buildExecutionGraphEvent({ entries, env, sessionId }) {
  const initiativeId = pickString(env.ORGX_INITIATIVE_ID);
  if (!initiativeId) return null;

  let sourceClient = pickString(env.ORGX_SOURCE_CLIENT) || "claude-code";
  if (!VALID_SOURCE_CLIENTS.has(sourceClient)) sourceClient = "claude-code";

  const maxNodes = Number.parseInt(env.ORGX_EMIT_MAX_NODES ?? "", 10);
  const { nodes, edges } = deriveGraph(entries, {
    maxNodes: Number.isFinite(maxNodes) ? maxNodes : 40,
    summary: env.ORGX_EMIT_SUMMARY,
  });

  const event = {
    schema_version: SCHEMA_VERSION,
    initiative_id: initiativeId,
    source_client: sourceClient,
    summary: clampStr(
      pickString(env.ORGX_EMIT_SUMMARY) ||
        `${sourceClient} session: ${nodes.length - 1} step(s)`,
      2000
    ),
    nodes,
    edges,
    trust_events: [],
    metadata: { emitter: "orgx-claude-code-plugin", via: "stop-hook" },
  };

  const runId = pickString(env.ORGX_RUN_ID);
  if (runId) {
    event.run_id = runId;
  } else {
    event.correlation_id = clampStr(
      pickString(sessionId, env.ORGX_CORRELATION_ID) ||
        `${sourceClient}-${initiativeId}`,
      120
    );
  }

  return event;
}

async function readStdin() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    return "";
  }
}

function debug(env, ...args) {
  if (isTruthy(env.ORGX_EMIT_DEBUG)) {
    process.stderr.write(`[orgx-emit-graph] ${args.join(" ")}\n`);
  }
}

export async function main({
  env = process.env,
  stdin,
  clientFactory = createOrgXClient,
} = {}) {
  // OPT-IN gate — the safety floor.
  if (!isTruthy(env.ORGX_EMIT_EXECUTION_GRAPH)) {
    return { skipped: "not_enabled" };
  }

  const apiKey = pickString(env.ORGX_API_KEY);
  if (!apiKey) return { skipped: "missing_api_key" };
  if (!pickString(env.ORGX_INITIATIVE_ID)) return { skipped: "missing_initiative_id" };

  const raw = stdin ?? (await readStdin());
  let hook = {};
  try {
    hook = raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    hook = {};
  }

  const transcriptPath = pickString(env.ORGX_TRANSCRIPT_PATH, hook.transcript_path);
  const sessionId = pickString(hook.session_id, env.CLAUDE_SESSION_ID, env.ORGX_SESSION_ID);

  let entries = [];
  if (transcriptPath) {
    try {
      entries = parseJsonl(readFileSync(transcriptPath, "utf8"));
    } catch {
      entries = [];
    }
  }

  const event = buildExecutionGraphEvent({ entries, env, sessionId });
  if (!event) return { skipped: "no_event" };

  const client = clientFactory({
    apiKey,
    baseUrl: pickString(env.ORGX_BASE_URL, "https://www.useorgx.com"),
    userId: pickString(env.ORGX_USER_ID),
  });

  try {
    const data = await client.emitExecutionGraph(event);
    debug(env, "emitted", JSON.stringify(data).slice(0, 200));
    return { emitted: true, nodes: event.nodes.length };
  } catch (error) {
    debug(env, "emit failed:", error && error.message ? error.message : String(error));
    return { skipped: "emit_failed" };
  }
}

// Robust against macOS /tmp -> /private/tmp symlink differences: match on the
// script basename rather than a full-href compare.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  process.argv[1].endsWith("emit-execution-graph.mjs");
if (invokedDirectly) {
  main().catch(() => {
    /* never fail the host session */
  });
}
