import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { expectedManifestFingerprint } from "../tooling/refresh-plugin-manifest.mjs";

import {
  EXPECTED_SESSION_SECURITY,
  assertSessionSecurityContract,
} from "../tooling/session-security-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return result.stdout;
}

function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

test("directory verifier accepts the policy-safe public surface", () => {
  const output = run(process.execPath, ["tooling/verify-plugin.mjs"]);
  assert.match(output, /verify-plugin: ok/u);
  assert.match(output, /loaded commands: 3/u);
  assert.match(output, /loaded skills: 1/u);
});

test("npm artifact contains no executable or automatic capability paths", () => {
  const output = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"]);
  const report = JSON.parse(output);
  const files = report[0].files.map((entry) => entry.path).sort();

  for (const expected of [
    ".claude-plugin/marketplace.json",
    ".claude-plugin/plugin.json",
    ".mcp.json",
    "commands/orgx-login.md",
    "commands/orgx-operator-chronicle.md",
    "commands/orgx-status.md",
    "skills/orgx-setup/SKILL.md",
  ]) {
    assert.ok(files.includes(expected), `packed artifact missing ${expected}`);
  }

  for (const path of files) {
    assert.doesNotMatch(path, /^(?:agents|hooks|lib|scripts|tests|tooling)\//u);
    assert.doesNotMatch(path, /\.(?:js|mjs|cjs)$/u);
  }
});

test("GitHub tree remains compatible with the wizard's directory fetch", () => {
  for (const directory of ["agents", "hooks", "lib", "scripts"]) {
    const path = resolve(root, directory);
    assert.equal(existsSync(path), true, `${directory} must exist for wizard sync`);
    assert.deepEqual(walk(path).map((file) => relative(path, file)), [".gitkeep"]);
  }
  assert.equal(existsSync(resolve(root, ".mcp.json")), true);
});

test("loaded instructions contain no automatic, dynamic, or session-data path", () => {
  const loadedRoots = [".claude-plugin", "commands", "skills"].map((path) =>
    resolve(root, path)
  );
  const patterns = [
    /!`/u,
    /SessionStart|PreToolUse|PostToolUse|SubagentStop/u,
    /sync[-_ ]skills|sync[-_ ]agents/iu,
    /tool[_ ]input|transcript[_ ]path|conversation[_ ]id/iu,
    /Claude'?s memory|chat history|conversation summaries|user files/iu,
    /process\.stdin/iu,
  ];

  for (const path of loadedRoots.flatMap(walk)) {
    const text = readFileSync(path, "utf8");
    for (const pattern of patterns) {
      assert.doesNotMatch(text, pattern, relative(root, path));
    }
  }
});

test("loaded command and skill roots contain no hidden state or lease file", () => {
  assert.deepEqual(
    walk(resolve(root, "commands")).map((path) => relative(resolve(root, "commands"), path)),
    ["orgx-login.md", "orgx-operator-chronicle.md", "orgx-status.md"]
  );
  assert.deepEqual(
    walk(resolve(root, "skills")).map((path) => relative(resolve(root, "skills"), path)),
    ["orgx-setup/SKILL.md"]
  );
});

test("commands use Claude plugin-scoped bundled MCP tool names", () => {
  const pluginManifest = JSON.parse(
    readFileSync(resolve(root, ".claude-plugin", "plugin.json"), "utf8")
  );
  const mcpConfig = JSON.parse(readFileSync(resolve(root, ".mcp.json"), "utf8"));
  const serverKeys = Object.keys(mcpConfig.mcpServers ?? {});
  assert.deepEqual(serverKeys, ["orgx"]);

  const toolPrefix = `mcp__plugin_${pluginManifest.name}_${serverKeys[0]}__`;
  for (const [commandFile, toolName] of [
    ["orgx-status.md", "orgx_get_initiative_progress"],
    ["orgx-operator-chronicle.md", "orgx_get_operator_brief"],
  ]) {
    const text = readFileSync(resolve(root, "commands", commandFile), "utf8");
    assert.match(
      text,
      new RegExp(`^allowed-tools: ${toolPrefix}${toolName}$`, "mu"),
      commandFile
    );
  }
});

test("public catalog contains exactly seven focused profile tools", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "plugin.manifest.json"), "utf8"));
  assert.deepEqual([...manifest.mcp_tools].sort(), [
    "orgx_get_agent_status", "orgx_get_initiative_progress", "orgx_get_next_actions",
    "orgx_get_operation_status", "orgx_get_operator_brief", "orgx_inspect", "orgx_search",
  ]);
  assert.equal(manifest.mcp_tools.includes("orgx_bootstrap"), false);
});

test("Claude commands bind the current seven-tool informational profile", () => {
  const mcp = JSON.parse(readFileSync(resolve(root, ".mcp.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(resolve(root, "plugin.manifest.json"), "utf8"));
  assert.equal(new URL(mcp.mcpServers.orgx.url).searchParams.get("profile"), "read-only");
  assert.deepEqual(manifest.mcp_contract, { family: "operation-v1", profile: "read-only" });
  const widened = structuredClone(manifest);
  widened.mcp_contract.profile = "claude-directory";
  assert.notEqual(expectedManifestFingerprint(widened), expectedManifestFingerprint(manifest));
});

test("stateless session security contract rejects stale authority and ambient path scope", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "plugin.manifest.json"), "utf8"));
  const statusCommand = readFileSync(resolve(root, "commands", "orgx-status.md"), "utf8");
  const chronicleCommand = readFileSync(
    resolve(root, "commands", "orgx-operator-chronicle.md"),
    "utf8"
  );

  assert.doesNotThrow(() =>
    assertSessionSecurityContract({
      manifestSecurity: manifest.session_security,
      statusCommand,
      chronicleCommand,
    })
  );
  assert.deepEqual(manifest.session_security, EXPECTED_SESSION_SECURITY);
});

test("session security contract rejects a missing fresh-response guard", () => {
  assert.throws(
    () =>
      assertSessionSecurityContract({
        manifestSecurity: EXPECTED_SESSION_SECURITY,
        statusCommand: "Call the status tool once.",
        chronicleCommand: readFileSync(
          resolve(root, "commands", "orgx-operator-chronicle.md"),
          "utf8"
        ),
      }),
    /orgx-status\.md is missing session security contract/u
  );
});

test("session security contract rejects CWD alias authority", () => {
  const unsafe = structuredClone(EXPECTED_SESSION_SECURITY);
  unsafe.cwd = { access: "project", aliases: "normalize" };
  assert.throws(
    () =>
      assertSessionSecurityContract({
        manifestSecurity: unsafe,
        statusCommand: readFileSync(resolve(root, "commands", "orgx-status.md"), "utf8"),
        chronicleCommand: readFileSync(
          resolve(root, "commands", "orgx-operator-chronicle.md"),
          "utf8"
        ),
      }),
    /session_security must equal/u
  );
});

test("session security contract rejects project-local state or a weaker file mode", () => {
  for (const localState of [
    {
      storage: "project_file",
      project_paths: "allowed",
      private_file_mode_if_introduced: "0600",
    },
    {
      storage: "none",
      project_paths: "forbidden",
      private_file_mode_if_introduced: "0644",
    },
  ]) {
    const unsafe = structuredClone(EXPECTED_SESSION_SECURITY);
    unsafe.local_state = localState;
    assert.throws(
      () =>
        assertSessionSecurityContract({
          manifestSecurity: unsafe,
          statusCommand: readFileSync(resolve(root, "commands", "orgx-status.md"), "utf8"),
          chronicleCommand: readFileSync(
            resolve(root, "commands", "orgx-operator-chronicle.md"),
            "utf8"
          ),
        }),
      /session_security must equal/u
    );
  }
});

test("session security contract rejects plugin-owned TTL or stale-expiry reuse", () => {
  const unsafe = structuredClone(EXPECTED_SESSION_SECURITY);
  unsafe.lease = {
    owner: "plugin",
    local_ttl: "300s",
    expired: "reuse_until_refresh",
  };
  assert.throws(
    () =>
      assertSessionSecurityContract({
        manifestSecurity: unsafe,
        statusCommand: readFileSync(resolve(root, "commands", "orgx-status.md"), "utf8"),
        chronicleCommand: readFileSync(
          resolve(root, "commands", "orgx-operator-chronicle.md"),
          "utf8"
        ),
      }),
    /session_security must equal/u
  );
});

test("public copy uses the audited non-destructive profile boundary", () => {
  const expectedDescription =
    "Connect Claude Code to a focused, non-destructive, closed-world OrgX status profile through native OAuth.";
  const pluginManifest = JSON.parse(
    readFileSync(resolve(root, ".claude-plugin", "plugin.json"), "utf8")
  );
  const marketplace = JSON.parse(
    readFileSync(resolve(root, ".claude-plugin", "marketplace.json"), "utf8")
  );
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(pluginManifest.description, expectedDescription);
  assert.equal(marketplace.description, expectedDescription);
  assert.equal(marketplace.metadata.description, expectedDescription);
  assert.equal(marketplace.plugins[0].description, expectedDescription);
  assert.equal(pkg.description, expectedDescription);

  const publicCopy = [
    "README.md",
    "plugin.manifest.json",
    "commands/orgx-status.md",
    "commands/orgx-operator-chronicle.md",
    "skills/orgx-setup/SKILL.md",
    "docs/anthropic-plugin-directory-submission.md",
    "docs/release-checklist.md",
  ].map((path) => readFileSync(resolve(root, path), "utf8"));
  const overbroadAccessClaim = /seven[^\n]*read tools|directory-safe read/iu;
  for (const text of publicCopy) {
    assert.doesNotMatch(text, overbroadAccessClaim);
  }
  assert.match(publicCopy[0], /Standard OrgX MCP usage may be recorded/u);
});

test("submission runbook uses Anthropic's current plugin portals", () => {
  const path = resolve(root, "docs", "anthropic-plugin-directory-submission.md");
  const text = readFileSync(path, "utf8");
  assert.match(
    text,
    /https:\/\/claude\.ai\/admin-settings\/directory\/submissions\/plugins\/new/u
  );
  assert.match(text, /https:\/\/platform\.claude\.com\/plugins\/submit/u);
  assert.doesNotMatch(text, /claude\.ai\/settings\/plugins\/submit/u);
});
