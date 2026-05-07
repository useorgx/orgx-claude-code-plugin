import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseArgs,
  pickString,
  normalizeSourceClient,
  sanitizeArgs,
  buildWorkGraphHookRecord,
  buildRuntimePayload,
  buildActivityPayload,
  buildCompletionChangesetPayload,
  main,
} from "../hooks/scripts/post-reporting-event.mjs";

async function createOutboxPath(prefix = "orgx-claude-hook-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return join(dir, "events.jsonl");
}

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

test("sanitizeArgs redacts token-like hook arguments", () => {
  const sanitized = sanitizeArgs({
    event: "stop",
    hook_token: "secret-token",
    runtime_hook_token: "secret-token",
    api_key: "oxk_secret",
  });
  assert.equal(sanitized.event, "stop");
  assert.equal(sanitized.hook_token, "[redacted]");
  assert.equal(sanitized.runtime_hook_token, "[redacted]");
  assert.equal(sanitized.api_key, "[redacted]");
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
    argv: ["--event=session_start", `--outbox=${await createOutboxPath()}`],
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
      `--outbox=${await createOutboxPath()}`,
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
    argv: [
      "--event=post_tool_use",
      "--message=hello",
      `--outbox=${await createOutboxPath()}`,
    ],
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

test("buildWorkGraphHookRecord emits redacted reconciliation metadata", () => {
  const record = buildWorkGraphHookRecord({
    args: { task_id: "task-1", run_id: "run-1" },
    payload: {
      session_id: "sess-1",
      transcript_path: "/tmp/transcript.jsonl",
      prompt: "do the work",
      secret: "do-not-copy",
    },
    sourceClient: "claude-code",
    event: "Stop",
    cwd: "/repo",
    timestamp: "2026-05-07T00:00:00.000Z",
  });

  assert.equal(record.source, "orgx_claude_code_plugin_runtime_hook");
  assert.equal(record.source_client, "claude-code");
  assert.equal(record.session_id, "sess-1");
  assert.equal(record.summary.prompt_chars, 11);
  assert.equal(record.summary.task_id, "task-1");
  assert.equal(JSON.stringify(record).includes("do the work"), false);
  assert.equal(JSON.stringify(record).includes("do-not-copy"), false);
});

test("main spools Work Graph event even when live API is unavailable", async () => {
  const outbox = await createOutboxPath();

  const result = await main({
    argv: ["--event=stop", `--outbox=${outbox}`],
    env: {},
    stdinText: JSON.stringify({ session_id: "sess-1", prompt: "hello" }),
    fetchImpl: async () => {
      throw new Error("should not call fetch");
    },
    now: () => Date.parse("2026-05-07T00:00:00.000Z"),
    cwd: "/repo",
  });

  assert.equal(result.ok, true);
  assert.equal(result.work_graph_spooled, true);
  assert.equal(result.skipped, "missing_api_key");

  const lines = (await readFile(outbox, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.source, "orgx_claude_code_plugin_runtime_hook");
  assert.equal(event.event, "stop");
  assert.equal(event.summary.prompt_chars, 5);
});
