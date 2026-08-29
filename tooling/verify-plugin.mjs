#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { expectedManifestFingerprint } from "./refresh-plugin-manifest.mjs";
import { assertSessionSecurityContract } from "./session-security-contract.mjs";

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

const expectedDescription =
  "Connect Claude Code to a focused, non-destructive, closed-world OrgX status profile through native OAuth.";
for (const [label, description] of [
  ["plugin manifest", manifest.description],
  ["marketplace", marketplace.description],
  ["marketplace metadata", marketplace.metadata?.description],
  ["marketplace plugin", marketplace.plugins?.[0]?.description],
  ["package", pkg.description],
]) {
  if (description !== expectedDescription) {
    fail(`${label} description must be ${expectedDescription}`);
  }
}

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
assertSameMembers(Object.keys(mcp.mcpServers ?? {}), ["orgx"], "MCP server keys");
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

const commandFiles = listFiles(resolve(root, "commands"));
assertSameMembers(
  commandFiles.map((path) => relative(resolve(root, "commands"), path)),
  ["orgx-login.md", "orgx-operator-chronicle.md", "orgx-status.md"],
  "loaded commands"
);

const serverKey = Object.keys(mcp.mcpServers)[0];
const scopedToolPrefix = `mcp__plugin_${manifest.name}_${serverKey}__`;
const commandToolContracts = new Map([
  ["orgx-status.md", "get_initiative_pulse"],
  ["orgx-operator-chronicle.md", "get_operator_chronicle"],
]);
for (const [commandFile, toolName] of commandToolContracts) {
  const commandText = readFileSync(resolve(root, "commands", commandFile), "utf8");
  const allowedTools = commandText.match(/^allowed-tools:\s*(\S+)\s*$/mu)?.[1];
  const expectedTool = `${scopedToolPrefix}${toolName}`;
  if (allowedTools !== expectedTool) {
    fail(`${commandFile} allowed-tools must be ${expectedTool}, received ${String(allowedTools)}`);
  }
}

const skillFiles = listFiles(resolve(root, "skills"));
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
const expectedDirectoryTools = [
  "get_agent_status",
  "get_initiative_pulse",
  "get_morning_brief",
  "get_operator_chronicle",
  "orgx_inspect",
  "orgx_recommend",
  "orgx_search",
];
assertSameMembers(
  releaseManifest.mcp_tools ?? [],
  expectedDirectoryTools,
  "directory MCP tool catalog"
);
if (releaseManifest.mcp_tools.includes("orgx_bootstrap")) {
  fail("directory MCP tool catalog must not include stateful orgx_bootstrap");
}
for (const toolName of commandToolContracts.values()) {
  if (!releaseManifest.mcp_tools.includes(toolName)) {
    fail(`command tool is missing from directory MCP tool catalog: ${toolName}`);
  }
}

try {
  assertSessionSecurityContract({
    manifestSecurity: releaseManifest.session_security,
    statusCommand: readFileSync(resolve(root, "commands", "orgx-status.md"), "utf8"),
    chronicleCommand: readFileSync(
      resolve(root, "commands", "orgx-operator-chronicle.md"),
      "utf8"
    ),
  });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const readme = readFileSync(resolve(root, "README.md"), "utf8");
if (!readme.includes("closed-world profile exposes exactly seven OrgX tools")) {
  fail("README must describe the exact seven-tool directory profile");
}
for (const toolName of expectedDirectoryTools) {
  if (!readme.includes(`- \`${toolName}\``)) {
    fail(`README is missing directory tool ${toolName}`);
  }
}
if (readme.includes("- `orgx_bootstrap`")) {
  fail("README must not advertise stateful orgx_bootstrap");
}
if (!readme.includes("Standard OrgX MCP usage may be recorded")) {
  fail("README must disclose standard hosted OrgX MCP usage recording");
}

const publicCopyPaths = [
  paths.package,
  paths.manifest,
  paths.marketplace,
  paths.releaseManifest,
  resolve(root, "README.md"),
  resolve(root, "commands", "orgx-status.md"),
  resolve(root, "commands", "orgx-operator-chronicle.md"),
  resolve(root, "skills", "orgx-setup", "SKILL.md"),
  paths.submission,
  resolve(root, "docs", "release-checklist.md"),
];
const overbroadAccessClaim = /read(?:-| )only|seven[^\n]*read tools|directory-safe read/iu;
for (const path of publicCopyPaths) {
  if (overbroadAccessClaim.test(readFileSync(path, "utf8"))) {
    fail(`overbroad access claim found in ${relative(root, path)}`);
  }
}
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
