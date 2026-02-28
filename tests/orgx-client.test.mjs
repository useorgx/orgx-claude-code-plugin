import test from "node:test";
import assert from "node:assert/strict";

import { createOrgXClient } from "../lib/orgx-client.mjs";

function mockFetch(expectedCalls = []) {
  let callIndex = 0;
  const calls = [];

  async function fetchImpl(url, options) {
    calls.push({ url, options });
    const expected = expectedCalls[callIndex++];
    const status = expected?.status ?? 200;
    const body = expected?.body ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: {
        get(name) {
          if (name === "content-type") return "application/json";
          return null;
        },
      },
      async json() {
        return body;
      },
    };
  }

  return { fetchImpl, calls };
}

// Patch global fetch for client usage
function createTestClient(fetchImpl) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const client = createOrgXClient({
    apiKey: "oxk_test",
    baseUrl: "https://test.useorgx.com",
    userId: "user-1",
  });
  // Restore after creation — client captures fetch at call time, not creation time
  // so we keep it patched for the test duration
  return { client, restore: () => { globalThis.fetch = originalFetch; } };
}

test("getRelevantLearnings posts to /api/client/learnings/relevant", async () => {
  const { fetchImpl, calls } = mockFetch([
    { status: 200, body: { data: { learnings: ["learning-1"] } } },
  ]);
  const { client, restore } = createTestClient(fetchImpl);
  try {
    const result = await client.getRelevantLearnings({
      initiative_id: "init-1",
      domain: "engineering",
      task_type: "feature",
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/api/client/learnings/relevant"));
    assert.equal(calls[0].options.method, "POST");

    const sentBody = JSON.parse(calls[0].options.body);
    assert.equal(sentBody.initiative_id, "init-1");
    assert.equal(sentBody.domain, "engineering");
    assert.equal(sentBody.task_type, "feature");

    assert.deepEqual(result, { learnings: ["learning-1"] });
  } finally {
    restore();
  }
});

test("classifyTaskModel posts to /api/client/classify-model", async () => {
  const { fetchImpl, calls } = mockFetch([
    { status: 200, body: { data: { model_tier: "standard", reason: "general task" } } },
  ]);
  const { client, restore } = createTestClient(fetchImpl);
  try {
    const result = await client.classifyTaskModel({
      task_id: "task-1",
      domain: "engineering",
      task_type: "bugfix",
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/api/client/classify-model"));
    assert.equal(calls[0].options.method, "POST");

    const sentBody = JSON.parse(calls[0].options.body);
    assert.equal(sentBody.task_id, "task-1");
    assert.equal(sentBody.domain, "engineering");

    assert.equal(result.model_tier, "standard");
  } finally {
    restore();
  }
});

test("getRelevantLearnings returns raw response when no data wrapper", async () => {
  const { fetchImpl } = mockFetch([
    { status: 200, body: { learnings: [] } },
  ]);
  const { client, restore } = createTestClient(fetchImpl);
  try {
    const result = await client.getRelevantLearnings({ initiative_id: "init-1" });
    assert.deepEqual(result, { learnings: [] });
  } finally {
    restore();
  }
});
