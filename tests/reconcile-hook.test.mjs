import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildReconcileArgv,
  main,
  shouldPost,
} from "../hooks/scripts/orgx-reconcile-hook.mjs";

const NOW = "2026-05-07T12:00:00.000Z";

function hookRecord(overrides = {}) {
  return {
    schema_version: "2026-05-07",
    source: "orgx_claude_code_plugin_runtime_hook",
    source_client: "claude-code",
    event: "Stop",
    session_id: "session-1",
    cwd: "/Users/example/Code/orgx",
    timestamp: NOW,
    summary: {
      tool_name: "mcp__orgx__orgx_emit_activity",
      prompt_chars: 42,
      payload_keys: ["tool_name", "cwd"],
    },
    ...overrides,
  };
}

test("Claude reconcile hook replays authenticated outbox records by default", () => {
  const built = buildReconcileArgv(["--event=stop"], {
    ORGX_WIZARD_HOOK_OUTBOX: "/tmp/events.jsonl",
    ORGX_API_KEY: "oxk_test",
  });

  assert.equal(built.postRequested, true);
  assert.equal(built.postEnabled, true);
  assert.equal(built.argv.includes("--post=true"), true);
  assert.equal(built.argv.some((arg) => arg === "--outbox=/tmp/events.jsonl"), true);
  assert.equal(
    built.argv.some((arg) => arg.includes("latest-work-graph-report.json")),
    true
  );
});

test("Claude reconcile hook posting requires an API key and supports explicit disable", () => {
  assert.equal(shouldPost({}, {}), false);
  assert.equal(shouldPost({}, { ORGX_API_KEY: "oxk_test" }), true);
  assert.equal(shouldPost({}, { ORGX_CLAUDE_HOOK_RECONCILE_POST: "true" }), true);
  assert.equal(shouldPost({}, { ORGX_HOOK_RECONCILE_POST: "1" }), true);
  assert.equal(shouldPost({}, { ORGX_WIZARD_HOOK_RECONCILE_POST: "yes" }), true);

  const missingKey = buildReconcileArgv(["--event=stop"], {
    ORGX_CLAUDE_HOOK_RECONCILE_POST: "true",
  });
  assert.equal(missingKey.postRequested, true);
  assert.equal(missingKey.postEnabled, false);
  assert.equal(missingKey.skippedPost, "missing_api_key");
  assert.equal(missingKey.argv.includes("--post=true"), false);

  const enabled = buildReconcileArgv(["--event=stop"], {
    ORGX_CLAUDE_HOOK_RECONCILE_POST: "true",
    ORGX_API_KEY: "oxk_test",
  });
  assert.equal(enabled.postRequested, true);
  assert.equal(enabled.postEnabled, true);
  assert.equal(enabled.argv.includes("--post=true"), true);

  const disabled = buildReconcileArgv(["--event=stop", "--post=false"], {
    ORGX_API_KEY: "oxk_test",
  });
  assert.equal(disabled.postRequested, false);
  assert.equal(disabled.postEnabled, false);
  assert.equal(disabled.argv.includes("--post=true"), false);
});

test("Claude authenticated Stop replay stays private", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orgx-claude-private-replay-"));
  const outbox = join(dir, "events.jsonl");
  const output = join(dir, "report.json");
  writeFileSync(outbox, `${JSON.stringify(hookRecord())}\n`, "utf8");
  const calls = [];

  const result = await main({
    argv: ["--event=stop", `--outbox=${outbox}`, `--output=${output}`],
    env: { ORGX_API_KEY: "oxk_test", ORGX_BASE_URL: "https://example.test" },
    now: () => new Date(NOW),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ ok: true, replayed: false }),
      };
    },
  });

  assert.equal(result.posted_enabled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.test/api/client/work-graph/reports");
  assert.equal(JSON.parse(calls[0].options.body).public_share, false);
});

test("Claude reconcile hook writes summary-only report for Stop", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orgx-claude-stop-hook-"));
  const outbox = join(dir, "events.jsonl");
  const output = join(dir, "report.json");
  writeFileSync(outbox, `${JSON.stringify(hookRecord())}\n`, "utf8");

  const result = await main({
    argv: ["--event=stop", `--outbox=${outbox}`, `--output=${output}`],
    env: {},
    now: () => new Date(NOW),
    fetchImpl: async () => {
      throw new Error("should not call fetch without post opt-in");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.event, "stop");
  assert.equal(result.posted_requested, false);
  assert.equal(result.reconcile.records_read, 1);

  const written = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(written.report.raw_transcripts_sent, false);
  assert.equal(written.report.investigation.raw_transcripts_excluded, true);
  assert.match(written.work_graph_fingerprint, /^wgf_[0-9a-f]{24}$/);
  assert.equal(
    written.hydration_key,
    `orgx:work-graph:${written.work_graph_fingerprint}`
  );
});

test("Claude reconcile hook skips non-Stop events", async () => {
  const result = await main({
    argv: ["--event=post_tool_use"],
    env: {},
    reconcile: async () => {
      throw new Error("should not reconcile non-stop events");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, "non_stop_event");
});
