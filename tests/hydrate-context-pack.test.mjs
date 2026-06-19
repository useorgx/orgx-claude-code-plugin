import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveConfig,
  buildPackRequest,
} from "../hooks/scripts/hydrate-context-pack.mjs";

test("resolveConfig requires both an api key and an active initiative", () => {
  assert.equal(resolveConfig({}, null), null);
  assert.equal(resolveConfig({ ORGX_API_KEY: "k" }, null), null);
  assert.deepEqual(resolveConfig({ ORGX_API_KEY: "k", ORGX_INITIATIVE_ID: "i1" }, null), {
    apiKey: "k",
    baseUrl: "https://useorgx.com",
    initiativeId: "i1",
  });
});

test("resolveConfig falls back to .claude/orgx.local.json", () => {
  assert.deepEqual(
    resolveConfig({}, { api_key: "k2", initiative_id: "i2", base_url: "https://x.test" }),
    { apiKey: "k2", baseUrl: "https://x.test", initiativeId: "i2" }
  );
});

test("buildPackRequest targets the endpoint with bearer auth and the initiative", () => {
  const r = buildPackRequest({ apiKey: "k", baseUrl: "https://useorgx.com/", initiativeId: "i1" });
  assert.equal(r.url, "https://useorgx.com/api/client/context-pack");
  assert.equal(r.method, "POST");
  assert.equal(r.headers.authorization, "Bearer k");
  assert.deepEqual(JSON.parse(r.body), { initiative_id: "i1" });
});
