import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../scripts/orgx-sync-agents.mjs";

test("orgx-sync-agents skips when API key is missing", async () => {
  const result = await main({
    argv: ["--quiet=true"],
    env: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, "missing_api_key");
});
