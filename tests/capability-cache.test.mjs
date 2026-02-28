import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  readCapabilityCache,
  writeCapabilityCache,
  getCachedPolicy,
  setCachedPolicy,
  recordPolicyScore,
  getPromotedPolicies,
  pruneCache,
} from "../lib/capability-cache.mjs";

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "orgx-cap-cache-"));
}

test("readCapabilityCache returns empty cache for missing file", () => {
  const dir = makeTmpDir();
  const cache = readCapabilityCache({ projectDir: dir });
  assert.equal(cache.version, 1);
  assert.deepEqual(cache.policies, {});
  assert.ok(cache.updatedAt);
});

test("writeCapabilityCache + readCapabilityCache round-trip", () => {
  const dir = makeTmpDir();
  const cache = readCapabilityCache({ projectDir: dir });
  cache.policies["abc123"] = {
    domain: "engineering",
    taskType: "feature",
    scores: [85],
    avgScore: 85,
    useCount: 1,
    promotedAt: null,
    lastUsedAt: new Date().toISOString(),
  };

  writeCapabilityCache(cache, { projectDir: dir });

  const reloaded = readCapabilityCache({ projectDir: dir });
  assert.equal(reloaded.version, 1);
  assert.ok(reloaded.policies["abc123"]);
  assert.equal(reloaded.policies["abc123"].domain, "engineering");
  assert.equal(reloaded.policies["abc123"].avgScore, 85);
});

test("writeCapabilityCache writes with restrictive permissions", () => {
  const dir = makeTmpDir();
  const cache = readCapabilityCache({ projectDir: dir });
  writeCapabilityCache(cache, { projectDir: dir });

  const filePath = join(dir, ".claude", "orgx-capability-cache.json");
  const content = readFileSync(filePath, "utf8");
  assert.ok(content.includes('"version": 1'));
});

test("setCachedPolicy / getCachedPolicy round-trip", () => {
  const cache = { version: 1, updatedAt: "", policies: {} };
  const policy = {
    domain: "engineering",
    taskType: "bugfix",
    heuristics: ["Fix root cause"],
    cacheKey: "key-1",
  };

  setCachedPolicy("key-1", policy, cache);
  const retrieved = getCachedPolicy("key-1", cache);

  assert.ok(retrieved);
  assert.equal(retrieved.domain, "engineering");
  assert.equal(retrieved.taskType, "bugfix");
  assert.equal(retrieved.useCount, 1);
  assert.deepEqual(retrieved.scores, []);
  assert.equal(retrieved.promotedAt, null);
});

test("setCachedPolicy increments useCount on repeated calls", () => {
  const cache = { version: 1, updatedAt: "", policies: {} };
  const policy = { domain: "engineering", taskType: "feature", cacheKey: "key-2" };

  setCachedPolicy("key-2", policy, cache);
  setCachedPolicy("key-2", policy, cache);
  setCachedPolicy("key-2", policy, cache);

  const retrieved = getCachedPolicy("key-2", cache);
  assert.equal(retrieved.useCount, 3);
});

test("getCachedPolicy returns null for missing key", () => {
  const cache = { version: 1, updatedAt: "", policies: {} };
  assert.equal(getCachedPolicy("nonexistent", cache), null);
});

test("recordPolicyScore accumulates scores and computes average", () => {
  const cache = { version: 1, updatedAt: "", policies: {} };
  setCachedPolicy("key-3", { domain: "engineering", taskType: "feature" }, cache);

  recordPolicyScore("key-3", 80, cache);
  recordPolicyScore("key-3", 90, cache);

  const entry = getCachedPolicy("key-3", cache);
  assert.deepEqual(entry.scores, [80, 90]);
  assert.equal(entry.avgScore, 85);
});

test("recordPolicyScore triggers promotion at threshold", () => {
  const cache = { version: 1, updatedAt: "", policies: {} };
  setCachedPolicy("key-4", { domain: "engineering", taskType: "feature" }, cache);

  const r1 = recordPolicyScore("key-4", 85, cache);
  assert.equal(r1.promoted, false); // only 1 score

  const r2 = recordPolicyScore("key-4", 90, cache);
  assert.equal(r2.promoted, false); // only 2 scores

  const r3 = recordPolicyScore("key-4", 80, cache);
  assert.equal(r3.promoted, true); // 3 scores, avg=85 >= 80

  const entry = getCachedPolicy("key-4", cache);
  assert.ok(entry.promotedAt);
});

test("recordPolicyScore does not promote below threshold", () => {
  const cache = { version: 1, updatedAt: "", policies: {} };
  setCachedPolicy("key-5", { domain: "engineering", taskType: "feature" }, cache);

  recordPolicyScore("key-5", 50, cache);
  recordPolicyScore("key-5", 60, cache);
  const r3 = recordPolicyScore("key-5", 70, cache);

  assert.equal(r3.promoted, false); // avg=60, below 80
  const entry = getCachedPolicy("key-5", cache);
  assert.equal(entry.promotedAt, null);
});

test("recordPolicyScore ignores non-numeric scores", () => {
  const cache = { version: 1, updatedAt: "", policies: {} };
  setCachedPolicy("key-6", { domain: "engineering", taskType: "feature" }, cache);

  const r = recordPolicyScore("key-6", "not-a-number", cache);
  assert.equal(r.promoted, false);
  assert.deepEqual(getCachedPolicy("key-6", cache).scores, []);
});

test("getPromotedPolicies filters correctly", () => {
  const cache = { version: 1, updatedAt: "", policies: {} };
  setCachedPolicy("promoted-1", { domain: "engineering", taskType: "feature" }, cache);
  setCachedPolicy("not-promoted", { domain: "engineering", taskType: "bugfix" }, cache);

  // Promote first one
  recordPolicyScore("promoted-1", 90, cache);
  recordPolicyScore("promoted-1", 85, cache);
  recordPolicyScore("promoted-1", 80, cache);

  const promoted = getPromotedPolicies(cache);
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].cacheKey, "promoted-1");
});

test("pruneCache evicts lowest avgScore entries beyond 200", () => {
  const cache = { version: 1, updatedAt: "", policies: {} };

  // Add 205 entries
  for (let i = 0; i < 205; i++) {
    cache.policies[`key-${i}`] = {
      domain: "engineering",
      taskType: "feature",
      scores: [i],
      avgScore: i,
      useCount: 1,
      promotedAt: null,
      lastUsedAt: new Date().toISOString(),
    };
  }

  assert.equal(Object.keys(cache.policies).length, 205);

  pruneCache(cache);

  assert.equal(Object.keys(cache.policies).length, 200);

  // Lowest 5 entries (avgScore 0-4) should be removed
  for (let i = 0; i < 5; i++) {
    assert.equal(cache.policies[`key-${i}`], undefined, `key-${i} should be pruned`);
  }
  // Entry with avgScore=5 should remain
  assert.ok(cache.policies["key-5"]);
});

test("pruneCache is a no-op when under limit", () => {
  const cache = { version: 1, updatedAt: "", policies: {} };
  cache.policies["only-one"] = { avgScore: 50 };

  pruneCache(cache);

  assert.equal(Object.keys(cache.policies).length, 1);
});
