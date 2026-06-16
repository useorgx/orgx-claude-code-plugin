import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveGraph,
  buildExecutionGraphEvent,
  parseJsonl,
  main,
} from "../hooks/scripts/emit-execution-graph.mjs";

const transcript = [
  { type: "user", message: { content: [{ type: "text", text: "go" }] } },
  {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "running" },
        { type: "tool_use", id: "tu_1", name: "Bash", input: {} },
      ],
    },
  },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: false }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", id: "tu_2", name: "Edit", input: {} }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_2", is_error: true }] } },
];

const transcriptJsonl = transcript.map((e) => JSON.stringify(e)).join("\n");

test("parseJsonl tolerates blank and garbage lines", () => {
  const parsed = parseJsonl(`${transcriptJsonl}\n\nnot json\n`);
  assert.equal(parsed.length, transcript.length);
});

test("deriveGraph: root + one step per tool call, no edges", () => {
  const { nodes, edges } = deriveGraph(transcript);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].id, "session");
  assert.equal(nodes[1].title, "Bash");
  assert.equal(nodes[2].title, "Edit");
  // No depends_on edges — temporal order is not a verified dependency.
  assert.deepEqual(edges, []);
});

test("deriveGraph: a failed tool_result marks the step failed", () => {
  const { nodes } = deriveGraph(transcript);
  assert.equal(nodes[1].status, "completed");
  assert.equal(nodes[2].status, "failed");
});

test("buildExecutionGraphEvent: null without an initiative id", () => {
  assert.equal(
    buildExecutionGraphEvent({ entries: transcript, env: {}, sessionId: "s" }),
    null
  );
});

test("buildExecutionGraphEvent: schema-shaped, run identity via correlation_id", () => {
  const event = buildExecutionGraphEvent({
    entries: transcript,
    env: { ORGX_INITIATIVE_ID: "9e52303c-430a-4472-a5ae-ec3ab169e4f3" },
    sessionId: "sess-abc",
  });
  assert.equal(event.source_client, "claude-code");
  assert.equal(event.run_id, undefined);
  assert.equal(event.correlation_id, "sess-abc");
  assert.deepEqual(event.trust_events, []);
});

test("main: no-op unless ORGX_EMIT_EXECUTION_GRAPH is set (safety floor)", async () => {
  let called = false;
  const clientFactory = () => ({ emitExecutionGraph: async () => { called = true; } });
  const res = await main({ env: { ORGX_INITIATIVE_ID: "x", ORGX_API_KEY: "k" }, stdin: "{}", clientFactory });
  assert.equal(res.skipped, "not_enabled");
  assert.equal(called, false);
});

test("main: skips without an api key", async () => {
  const res = await main({
    env: { ORGX_EMIT_EXECUTION_GRAPH: "1", ORGX_INITIATIVE_ID: "x" },
    stdin: "{}",
    clientFactory: () => ({ emitExecutionGraph: async () => {} }),
  });
  assert.equal(res.skipped, "missing_api_key");
});

test("main: enabled + configured emits the derived graph via the client helper", async () => {
  let posted = null;
  const clientFactory = (cfg) => {
    assert.equal(cfg.apiKey, "k");
    assert.equal(cfg.userId, "u");
    return {
      async emitExecutionGraph(payload) {
        posted = payload;
        return { execution_graph_fingerprint: "xgf_test" };
      },
    };
  };
  const res = await main({
    env: {
      ORGX_EMIT_EXECUTION_GRAPH: "1",
      ORGX_API_KEY: "k",
      ORGX_USER_ID: "u",
      ORGX_INITIATIVE_ID: "9e52303c-430a-4472-a5ae-ec3ab169e4f3",
    },
    stdin: JSON.stringify({ session_id: "s1", transcript_path: "/does/not/exist.jsonl" }),
    clientFactory,
  });
  assert.equal(res.emitted, true);
  assert.ok(posted);
  assert.equal(posted.initiative_id, "9e52303c-430a-4472-a5ae-ec3ab169e4f3");
  // Missing transcript file -> still emits an honest single-node session graph.
  assert.equal(posted.nodes.length, 1);
  assert.equal(posted.nodes[0].id, "session");
});

test("main: a throwing client never propagates (host session must not fail)", async () => {
  const clientFactory = () => ({
    async emitExecutionGraph() {
      throw new Error("network boom");
    },
  });
  const res = await main({
    env: {
      ORGX_EMIT_EXECUTION_GRAPH: "1",
      ORGX_API_KEY: "k",
      ORGX_INITIATIVE_ID: "x",
    },
    stdin: "{}",
    clientFactory,
  });
  assert.equal(res.skipped, "emit_failed");
});
