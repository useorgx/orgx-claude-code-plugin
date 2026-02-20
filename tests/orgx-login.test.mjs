import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseArgs, writeLocalConfig, readLocalConfig } from "../scripts/orgx-login.mjs";

test("orgx-login parseArgs parses key/value and boolean flags", () => {
  const parsed = parseArgs([
    "--initiative_id=init-1",
    "--project_dir=/tmp/x",
    "--open_browser=false",
  ]);
  assert.equal(parsed.initiative_id, "init-1");
  assert.equal(parsed.project_dir, "/tmp/x");
  assert.equal(parsed.open_browser, "false");
});

test("orgx-login writes local config without API key", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "orgx-login-"));
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  const config = {
    enabled: true,
    baseUrl: "https://www.useorgx.com",
    mcpUrl: "https://mcp.useorgx.com/mcp",
    initiativeId: "init-1",
    userId: "user-1",
    workspaceName: "workspace",
    keyPrefix: "oxk_",
    keychainService: "orgx-claude-code-plugin",
    keychainAccount: "user-1",
    source: "browser_pairing",
    updatedAt: new Date().toISOString(),
  };
  const path = writeLocalConfig(projectDir, config);
  const raw = readFileSync(path, "utf8");
  assert.ok(raw.includes("\"keychainService\""));
  assert.ok(!raw.includes("oxk_real_secret"));
});

test("orgx-login reads existing local config", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "orgx-login-read-"));
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeLocalConfig(projectDir, {
    enabled: true,
    baseUrl: "https://www.useorgx.com",
    initiativeId: "init-2",
    keychainService: "orgx-claude-code-plugin",
    keychainAccount: "acct",
    updatedAt: new Date().toISOString(),
  });
  const loaded = readLocalConfig(projectDir);
  assert.equal(loaded.initiativeId, "init-2");
  assert.equal(loaded.keychainAccount, "acct");
});
