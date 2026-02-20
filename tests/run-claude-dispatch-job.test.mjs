import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { findMostRecentStateFile } from "../scripts/run-claude-dispatch-job.mjs";

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
