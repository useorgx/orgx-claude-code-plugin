#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { expectedManifestFingerprint } from "./refresh-plugin-manifest.mjs";

function fail(message) {
  console.error(`verify-plugin: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`invalid JSON in ${path}: ${String(error)}`);
  }
}

function listFiles(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && [".git", "artifacts", "node_modules"].includes(entry.name)) {
      return [];
    }
    const child = join(path, entry.name);
    return entry.isDirectory() ? listFiles(child) : [child];
  });
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function assertSameMembers(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    fail(`${label} must be ${JSON.stringify(expectedSorted)}, received ${JSON.stringify(actualSorted)}`);
  }
}

const root = process.cwd();
const paths = {
  package: resolve(root, "package.json"),
  lock: resolve(root, "package-lock.json"),
  manifest: resolve(root, ".claude-plugin", "plugin.json"),
  marketplace: resolve(root, ".claude-plugin", "marketplace.json"),
  mcp: resolve(root, ".mcp.json"),
  releaseManifest: resolve(root, "plugin.manifest.json"),
  submission: resolve(root, "docs", "anthropic-plugin-directory-submission.md"),
};

for (const path of Object.values(paths)) {
  if (!existsSync(path)) fail(`missing required file: ${path}`);
}

const pkg = readJson(paths.package);
const lock = readJson(paths.lock);
const manifest = readJson(paths.manifest);
const marketplace = readJson(paths.marketplace);
const mcp = readJson(paths.mcp);
const releaseManifest = readJson(paths.releaseManifest);

for (const key of ["name", "version", "description"]) {
  assertString(manifest[key], `plugin manifest ${key}`);
}
if (manifest.name !== "orgx-claude-code-plugin") fail("unexpected plugin name");
if (manifest.displayName !== "OrgX") fail("plugin displayName must be OrgX");
if (manifest.homepage !== "https://useorgx.com") fail("unexpected homepage");
if (manifest.repository !== "https://github.com/useorgx/orgx-claude-code-plugin") {
  fail("unexpected repository URL");
}
if (manifest.license !== "MIT") fail("plugin license must be MIT");

const versions = [
  pkg.version,
  lock.version,
  lock.packages?.[""]?.version,
  manifest.version,
  marketplace.version,
  marketplace.metadata?.version,
  marketplace.plugins?.[0]?.version,
  releaseManifest.version,
];
if (new Set(versions).size !== 1) {
  fail(`release versions differ: ${JSON.stringify(versions)}`);
}

if (Object.hasOwn(manifest, "mcpServers")) {
  fail("MCP configuration must be defined only in root .mcp.json");
}
const orgxServer = mcp.mcpServers?.orgx;
if (!orgxServer || orgxServer.type !== "http") fail("missing HTTP orgx MCP server");
const expectedMcpUrl = "https://mcp.useorgx.com/mcp?profile=claude-directory";
if (orgxServer.url !== expectedMcpUrl) {
  fail(`orgx MCP URL must be ${expectedMcpUrl}`);
}
assertSameMembers(Object.keys(orgxServer), ["type", "url"], "orgx MCP fields");

const marketplacePlugin = marketplace.plugins?.find(
  (plugin) => plugin.name === manifest.name
);
if (!marketplacePlugin) fail("marketplace is missing the OrgX plugin");
if (marketplacePlugin.source !== "./") {
  fail("marketplace plugin source must reuse the HTTPS-cloned repository root");
}
if (marketplacePlugin.repository !== manifest.repository) {
  fail("marketplace repository must match the plugin manifest");
}

const expectedPublishedPaths = [
  ".claude-plugin/",
  ".mcp.json",
  "commands/",
  "skills/",
  "plugin.manifest.json",
  "README.md",
];
assertSameMembers(pkg.files ?? [], expectedPublishedPaths, "package files allowlist");
if (pkg.bin || pkg.exports || pkg.dependencies) {
  fail("public plugin must not publish executables, runtime exports, or runtime dependencies");
}

for (const placeholderDirectory of ["agents", "hooks", "lib", "scripts"]) {
  const directoryPath = resolve(root, placeholderDirectory);
  if (!existsSync(directoryPath)) {
    fail(`wizard compatibility directory is missing: ${placeholderDirectory}`);
  }
  assertSameMembers(
    listFiles(directoryPath).map((path) => relative(directoryPath, path)),
    [".gitkeep"],
    `${placeholderDirectory} placeholder contents`
  );
}
for (const forbiddenCommand of [
  "orgx-autopilot-start.md",
  "orgx-autopilot-resume.md",
  "orgx-sync-skills.md",
  "orgx-sync-agents.md",
  "orgx-sync.md",
]) {
  if (existsSync(resolve(root, "commands", forbiddenCommand))) {
    fail(`prohibited command is present: ${forbiddenCommand}`);
  }
}

const loadedCapabilityRoots = [
  resolve(root, ".claude-plugin"),
  resolve(root, "commands"),
  resolve(root, "skills"),
];
const loadedFiles = loadedCapabilityRoots
  .flatMap(listFiles)
  .filter((path) => [".json", ".md"].includes(extname(path)));

const prohibitedCapabilityPatterns = [
  ["shell execution", /!`/u],
  ["automatic lifecycle event", /SessionStart|PreToolUse|PostToolUse|SubagentStop/u],
  ["dynamic skill sync", /sync[-_ ]skills|skill[-_ ]pack|materialize[^\n]*SKILL/iu],
  ["dynamic agent sync", /sync[-_ ]agents|agent[-_ ]pack/iu],
  ["session payload field", /tool[_ ]input|transcript[_ ]path|conversation[_ ]id/iu],
  ["prohibited context source", /Claude'?s memory|chat history|conversation summaries|user files/iu],
  ["local stdin reader", /process\.stdin/iu],
  ["local runtime invocation", /node\s+\$\{CLAUDE_PLUGIN_ROOT\}/u],
];
for (const path of loadedFiles) {
  const text = readFileSync(path, "utf8");
  for (const [label, pattern] of prohibitedCapabilityPatterns) {
    if (pattern.test(text)) {
      fail(`${label} found in loaded capability ${relative(root, path)}`);
    }
  }
}

const commandFiles = listFiles(resolve(root, "commands")).filter(
  (path) => extname(path) === ".md"
);
assertSameMembers(
  commandFiles.map((path) => relative(resolve(root, "commands"), path)),
  ["orgx-login.md", "orgx-operator-chronicle.md", "orgx-status.md"],
  "loaded commands"
);
const skillFiles = listFiles(resolve(root, "skills")).filter(
  (path) => extname(path) === ".md"
);
assertSameMembers(
  skillFiles.map((path) => relative(resolve(root, "skills"), path)),
  ["orgx-setup/SKILL.md"],
  "loaded skills"
);

if (Object.hasOwn(releaseManifest, "signature")) {
  fail("unsigned public builds must not claim a signature");
}
assertSameMembers(
  releaseManifest.capabilities ?? [],
  ["commands:user-invoked", "mcp:remote-oauth", "skills:static"],
  "release capabilities"
);
const expectedFingerprint = expectedManifestFingerprint(releaseManifest);
if (releaseManifest.manifest_fingerprint !== expectedFingerprint) {
  fail(`release manifest fingerprint mismatch; expected ${expectedFingerprint}`);
}

const submission = readFileSync(paths.submission, "utf8");
for (const expectedUrl of [
  "https://claude.ai/admin-settings/directory/submissions/plugins/new",
  "https://platform.claude.com/plugins/submit",
  "https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy",
]) {
  if (!submission.includes(expectedUrl)) fail(`submission runbook missing ${expectedUrl}`);
}
if (submission.includes("https://claude.ai/settings/plugins/submit")) {
  fail("submission runbook contains a stale plugin portal path");
}

for (const path of listFiles(root)) {
  const relativePath = relative(root, path);
  if (/\.(pem|key|p12|pfx|env)$/u.test(path)) {
    fail(`credential-like file must not be present: ${relativePath}`);
  }
}

console.log("verify-plugin: ok");
console.log(`manifest: ${manifest.name}@${manifest.version}`);
console.log(`loaded commands: ${commandFiles.length}`);
console.log(`loaded skills: ${skillFiles.length}`);
console.log(`mcp server: ${orgxServer.url}`);
console.log(`release manifest: ${releaseManifest.manifest_fingerprint} (unsigned)`);
