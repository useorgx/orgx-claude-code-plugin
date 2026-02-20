import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseArgs,
  buildEnvLines,
  readLocalConfig,
  persistSessionEnv,
} from "../hooks/scripts/load-orgx-env.mjs";

test("load-orgx-env parseArgs parses key/value flags", () => {
  const parsed = parseArgs(["--project_dir=/tmp/project", "--dry_run"]);
  assert.equal(parsed.project_dir, "/tmp/project");
  assert.equal(parsed.dry_run, "true");
});

test("buildEnvLines emits exports for configured values", () => {
  const lines = buildEnvLines({
    apiKey: "oxk_test",
    baseUrl: "https://www.useorgx.com",
    initiativeId: "init-1",
    userId: "user-1",
    mcpUrl: "https://mcp.useorgx.com/mcp",
  });
  assert.equal(lines.length, 5);
  assert.ok(lines[0].startsWith("export ORGX_API_KEY="));
});

test("readLocalConfig reads project .claude/orgx.local.json", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "orgx-load-env-"));
  const claudeDir = join(projectDir, ".claude");
  const configPath = join(claudeDir, "orgx.local.json");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({ enabled: true, initiativeId: "init-1" }, null, 2)
  );
  const loaded = readLocalConfig(projectDir);
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.initiativeId, "init-1");
});

test("persistSessionEnv writes export lines", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "orgx-load-env-file-"));
  const envPath = join(projectDir, "session.env");
  persistSessionEnv(envPath, ["export A=1", "export B=2"]);
  const text = readFileSync(envPath, "utf8");
  assert.ok(text.includes("export A=1"));
  assert.ok(text.includes("export B=2"));
});
