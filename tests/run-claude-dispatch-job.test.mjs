import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createReporter,
  findMostRecentStateFile,
  normalizeSourceClient,
} from "../scripts/run-claude-dispatch-job.mjs";

test("findMostRecentStateFile returns null when logs root has no state files", () => {
  const root = mkdtempSync(join(tmpdir(), "orgx-dispatch-empty-"));
  assert.equal(findMostRecentStateFile(root), null);
});

test("findMostRecentStateFile returns newest job-state.json by mtime", () => {
  const root = mkdtempSync(join(tmpdir(), "orgx-dispatch-latest-"));
  const olderDir = join(root, "claude-job-older");
  const newerDir = join(root, "claude-job-newer");
  mkdirSync(olderDir, { recursive: true });
  mkdirSync(newerDir, { recursive: true });

  const olderState = join(olderDir, "job-state.json");
  const newerState = join(newerDir, "job-state.json");
  writeFileSync(olderState, "{\"jobId\":\"older\"}\n", "utf8");
  writeFileSync(newerState, "{\"jobId\":\"newer\"}\n", "utf8");

  const olderEpoch = new Date("2026-02-16T00:00:00.000Z");
  const newerEpoch = new Date("2026-02-16T01:00:00.000Z");
  utimesSync(olderState, olderEpoch, olderEpoch);
  utimesSync(newerState, newerEpoch, newerEpoch);

  assert.equal(findMostRecentStateFile(root), newerState);
});

test("normalizeSourceClient falls back for invalid identifiers", () => {
  assert.equal(normalizeSourceClient("claude-code"), "claude-code");
  assert.equal(normalizeSourceClient("ORGX.Dispatch"), "orgx.dispatch");
  assert.equal(normalizeSourceClient("5"), "claude-code");
  assert.equal(normalizeSourceClient("bad source"), "claude-code");
});

test("createReporter keeps source_client after run_id is established", async () => {
  const activityPayloads = [];
  const client = {
    async emitActivity(payload) {
      activityPayloads.push(payload);
      if (activityPayloads.length === 1) {
        return { ok: true, run_id: "run-123" };
      }
      return { ok: true };
    },
    async applyChangeset() {
      return { ok: true };
    },
    async updateEntity() {
      return { ok: true };
    },
  };

  const reporter = createReporter({
    client,
    initiativeId: "init-1",
    sourceClient: "claude-code",
    correlationId: "corr-1",
    planPath: null,
    planHash: "abc123",
    jobId: "job-1",
    dryRun: false,
  });

  await reporter.emit({ message: "first" });
  await reporter.emit({ message: "second" });

  assert.equal(activityPayloads.length, 2);
  assert.equal(activityPayloads[0].source_client, "claude-code");
  assert.equal(activityPayloads[0].correlation_id, "corr-1");
  assert.equal(activityPayloads[1].source_client, "claude-code");
  assert.equal(activityPayloads[1].run_id, "run-123");
});
