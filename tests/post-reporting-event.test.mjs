import test from "node:test";
import assert from "node:assert/strict";

import {
  parseArgs,
  pickString,
  normalizeSourceClient,
  buildRuntimePayload,
  buildActivityPayload,
  buildCompletionChangesetPayload,
  main,
} from "../hooks/scripts/post-reporting-event.mjs";

test("parseArgs parses key/value and boolean flags", () => {
  const parsed = parseArgs(["--event=stop", "--apply_completion", "--phase=completed"]);
  assert.equal(parsed.event, "stop");
  assert.equal(parsed.apply_completion, "true");
  assert.equal(parsed.phase, "completed");
});

test("pickString returns first non-empty string", () => {
  assert.equal(pickString("", "   ", "value", "next"), "value");
  assert.equal(pickString("", " "), undefined);
});

test("normalizeSourceClient falls back for invalid values", () => {
  assert.equal(normalizeSourceClient("claude-code"), "claude-code");
  assert.equal(normalizeSourceClient("ORGX.CLI"), "orgx.cli");
  assert.equal(normalizeSourceClient("5"), "claude-code");
  assert.equal(normalizeSourceClient("bad source"), "claude-code");
});

test("payload builders shape expected OrgX fields", () => {
  const runtime = buildRuntimePayload({
    initiativeId: "init-1",
    runId: "run-1",
    correlationId: "corr-1",
    sourceClient: "claude-code",
    event: "session_start",
    phase: "intent",
    message: "start",
    workstreamId: "ws-1",
    taskId: "task-1",
    agentId: "agent-1",
    agentName: "Agent",
    progressPct: 10,
    args: { event: "session_start" },
  });
  assert.equal(runtime.initiative_id, "init-1");
  assert.equal(runtime.source_client, "claude-code");

  const activity = buildActivityPayload({
    initiativeId: "init-1",
    runId: "run-1",
    correlationId: "corr-1",
    sourceClient: "claude-code",
    event: "blocked",
    phase: "blocked",
    message: "blocked",
    args: { event: "blocked" },
  });
  assert.equal(activity.level, "warn");

  const changeset = buildCompletionChangesetPayload({
    initiativeId: "init-1",
    runId: "run-1",
    correlationId: "corr-1",
    sourceClient: "claude-code",
    event: "stop",
    taskId: "task-1",
  });
  assert.equal(changeset.operations[0].status, "done");
});

test("main skips when api key is missing", async () => {
  const result = await main({
    argv: ["--event=session_start"],
    env: { ORGX_INITIATIVE_ID: "init-1" },
    fetchImpl: async () => {
      throw new Error("should not call fetch");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, "missing_api_key");
});

test("main posts activity and completion changeset", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return { ok: true };
      },
      async text() {
        return "";
      },
    };
  };

  const result = await main({
    argv: [
      "--event=stop",
      "--phase=completed",
      "--message=done",
      "--task_id=task-1",
      "--apply_completion=true",
    ],
    env: {
      ORGX_API_KEY: "oxk_test",
      ORGX_INITIATIVE_ID: "init-1",
      ORGX_BASE_URL: "https://www.useorgx.com",
    },
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.activity_posted, true);
  assert.equal(result.changeset_posted, true);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://www.useorgx.com/api/client/live/activity");
  assert.equal(calls[1].url, "https://www.useorgx.com/api/client/live/changesets/apply");
  assert.equal(calls[0].init.headers.Authorization, "Bearer oxk_test");
});

test("main normalizes invalid ORGX_SOURCE_CLIENT env value", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return { ok: true };
      },
      async text() {
        return "";
      },
    };
  };

  const result = await main({
    argv: ["--event=post_tool_use", "--message=hello"],
    env: {
      ORGX_API_KEY: "oxk_test",
      ORGX_INITIATIVE_ID: "init-1",
      ORGX_SOURCE_CLIENT: "5",
      ORGX_BASE_URL: "https://www.useorgx.com",
    },
    fetchImpl,
  });

  assert.equal(result.ok, true);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.source_client, "claude-code");
});
