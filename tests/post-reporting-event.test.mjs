import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseArgs,
  pickString,
  normalizeSourceClient,
  buildHookOutboxRecord,
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

test("configured Claude hooks cover session, tool, subagent, and stop lifecycle", () => {
  const hooks = JSON.parse(readFileSync(new URL("../hooks/hooks.json", import.meta.url), "utf8"));
  const configured = Object.keys(hooks.hooks).sort();
  assert.deepEqual(configured, ["PostToolUse", "SessionStart", "Stop", "SubagentStop"]);

  for (const hookName of configured) {
    const commands = hooks.hooks[hookName].flatMap((entry) => entry.hooks ?? []);
    assert.ok(
      commands.some(
        (hook) =>
          hook.type === "command" &&
          hook.command.includes("hooks/scripts/post-reporting-event.mjs")
      ),
      `${hookName} should invoke post-reporting-event.mjs`
    );
  }
});

test("main posts deterministic activity/runtime/completion payloads for entity signals", async () => {
  const cases = [
    {
      name: "progress",
      argv: [
        "--event=post_tool_use",
        "--phase=execution",
        "--message=Progress update",
        "--progress_pct=35",
        "--tool_name=mcp__orgx__orgx_report_progress",
      ],
      runtime: true,
    },
    {
      name: "decision",
      argv: [
        "--event=decision_requested",
        "--phase=blocked",
        "--message=Decision needed",
        "--tool_name=mcp__orgx__orgx_request_decision",
      ],
    },
    {
      name: "blocker",
      argv: [
        "--event=blocked",
        "--phase=blocked",
        "--message=Blocked on approval",
        "--tool_name=mcp__orgx__orgx_create_blocker",
      ],
    },
    {
      name: "artifact",
      argv: [
        "--event=artifact_registered",
        "--phase=execution",
        "--message=Artifact registered",
        "--tool_name=mcp__orgx__orgx_register_artifact",
      ],
    },
    {
      name: "completion",
      argv: [
        "--event=stop",
        "--phase=completed",
        "--message=Completed",
        "--task_id=task-1",
        "--apply_completion=true",
        "--tool_name=mcp__orgx__orgx_apply_changeset",
      ],
      changeset: true,
    },
  ];

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
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

  for (const scenario of cases) {
    const result = await main({
      argv: scenario.argv,
      env: {
        ORGX_API_KEY: "oxk_test",
        ORGX_INITIATIVE_ID: "init-1",
        ORGX_BASE_URL: "https://www.useorgx.com",
        ORGX_RUNTIME_HOOK_URL: scenario.runtime ? "https://hooks.useorgx.test/runtime" : "",
        ORGX_HOOK_TOKEN: scenario.runtime ? "hook-token" : "",
      },
      fetchImpl,
      readStdinImpl: async () => JSON.stringify({ session_id: `session-${scenario.name}` }),
      now: () => new Date("2026-05-07T12:00:00.000Z"),
    });
    assert.equal(result.ok, true);
  }

  const runtimeCalls = calls.filter((call) => call.url === "https://hooks.useorgx.test/runtime");
  const activityCalls = calls.filter((call) => call.url === "https://www.useorgx.com/api/client/live/activity");
  const changesetCalls = calls.filter((call) => call.url === "https://www.useorgx.com/api/client/live/changesets/apply");

  assert.equal(runtimeCalls.length, 1);
  assert.equal(runtimeCalls[0].body.progress_pct, 35);
  assert.equal(activityCalls.length, 5);
  assert.equal(changesetCalls.length, 1);
  assert.equal(changesetCalls[0].body.operations[0].op, "task.update");
  assert.equal(changesetCalls[0].body.operations[0].status, "done");
  assert.ok(
    activityCalls.some(
      (call) =>
        call.body.phase === "blocked" &&
        call.body.level === "warn" &&
        call.body.metadata.raw_args.tool_name === "mcp__orgx__orgx_create_blocker"
    )
  );
  assert.deepEqual(
    activityCalls.map((call) => call.body.metadata.raw_args.tool_name).sort(),
    cases.map((scenario) => scenario.argv.find((arg) => arg.startsWith("--tool_name=")).split("=")[1]).sort()
  );
});

test("buildHookOutboxRecord captures redacted runtime evidence", () => {
  const record = buildHookOutboxRecord({
    sourceClient: "claude-code",
    event: "post_tool_use",
    args: { tool_name: "mcp__orgx__orgx_emit_activity" },
    env: { CLAUDE_PROJECT_DIR: "/repo" },
    payload: { thread_id: "thread-1", prompt: "ship this" },
    now: () => new Date("2026-05-07T12:00:00.000Z"),
  });

  assert.equal(record.source, "orgx_claude_code_plugin_runtime_hook");
  assert.equal(record.session_id, "thread-1");
  assert.equal(record.cwd, "/repo");
  assert.equal(record.summary.tool_name, "mcp__orgx__orgx_emit_activity");
  assert.equal(record.summary.prompt_chars, 9);
});

test("main skips when api key is missing", async () => {
  const result = await main({
    argv: ["--event=session_start"],
    env: {
      ORGX_INITIATIVE_ID: "init-1",
      ORGX_WIZARD_HOOK_OUTBOX: join(mkdtempSync(join(tmpdir(), "orgx-claude-hook-")), "events.jsonl"),
    },
    readStdinImpl: async () => JSON.stringify({ session_id: "session-1" }),
    fetchImpl: async () => {
      throw new Error("should not call fetch");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, "missing_api_key");
  assert.equal(result.hook_outbox_written, true);
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
    readStdinImpl: async () => "",
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
    readStdinImpl: async () => "",
  });

  assert.equal(result.ok, true);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.source_client, "claude-code");
});
