import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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
