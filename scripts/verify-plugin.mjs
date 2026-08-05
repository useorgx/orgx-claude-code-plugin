#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expectedManifestFingerprint } from "./refresh-plugin-manifest.mjs";

function fail(message) {
  console.error(`verify-plugin: ${message}`);
  process.exit(1);
}

const root = process.cwd();
const packagePath = resolve(root, "package.json");
const packageLockPath = resolve(root, "package-lock.json");
const manifestPath = resolve(root, ".claude-plugin", "plugin.json");
const mcpConfigPath = resolve(root, ".mcp.json");
const marketplacePath = resolve(root, ".claude-plugin", "marketplace.json");
const releaseManifestPath = resolve(root, "plugin.manifest.json");
const hooksPath = resolve(root, "hooks", "hooks.json");
const hookScriptPath = resolve(root, "hooks", "scripts", "post-reporting-event.mjs");
const hookReconcilerPath = resolve(root, "hooks", "scripts", "orgx-work-graph-reconcile.mjs");
const hookReconcileWrapperPath = resolve(root, "hooks", "scripts", "orgx-reconcile-hook.mjs");
const operatorChronicleCommandPath = resolve(root, "commands", "orgx-operator-chronicle.md");
const directorySubmissionPath = resolve(
  root,
  "docs",
  "anthropic-plugin-directory-submission.md"
);

for (const path of [
  packagePath,
  packageLockPath,
  manifestPath,
  mcpConfigPath,
  marketplacePath,
  releaseManifestPath,
  hooksPath,
  hookScriptPath,
  hookReconcilerPath,
  hookReconcileWrapperPath,
  operatorChronicleCommandPath,
  directorySubmissionPath,
]) {
  if (!existsSync(path)) fail(`missing file: ${path}`);
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(packagePath, "utf8"));
} catch (error) {
  fail(`invalid JSON in ${packagePath}: ${String(error)}`);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`invalid JSON in ${manifestPath}: ${String(error)}`);
}

for (const key of ["name", "version", "description"]) {
  if (typeof manifest[key] !== "string" || manifest[key].trim().length === 0) {
    fail(`manifest missing string field: ${key}`);
  }
}
if (pkg.version !== manifest.version) {
  fail("package.json version must match .claude-plugin/plugin.json version");
}
if (manifest.displayName !== "OrgX") fail("manifest displayName must be OrgX");
if (manifest.homepage !== "https://useorgx.com") {
  fail("manifest homepage must point to the public OrgX site");
}
if (manifest.repository !== "https://github.com/useorgx/orgx-claude-code-plugin") {
  fail("manifest repository must point to the public plugin repository");
}
if (manifest.license !== "MIT") fail("manifest license must be MIT");
if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("mcp")) {
  fail("manifest keywords must include mcp");
}
if (!pkg.description.includes("operator chronicle reporting")) {
  fail("package description must mention operator chronicle reporting");
}
if (
  pkg.dependencies?.["@useorgx/orgx-gateway-sdk"] !==
  "https://codeload.github.com/useorgx/orgx-gateway-sdk/tar.gz/c3dfd41ad01d44660457961f3ddee080e1596faa"
) {
  fail("gateway SDK must stay commit-pinned as an HTTPS tarball");
}
const packageLockText = readFileSync(packageLockPath, "utf8");
if (
  packageLockText.includes("git+ssh://") ||
  packageLockText.includes("git@github.com") ||
  packageLockText.includes('"resolved": "git+')
) {
  fail("package lock must not require git or GitHub SSH credentials");
}
if (!manifest.description.includes("operator chronicle reporting")) {
  fail("manifest description must mention operator chronicle reporting");
}

if (Object.hasOwn(manifest, "mcpServers")) {
  fail("use the standard root .mcp.json instead of duplicating MCP config inline");
}

let mcpConfig;
try {
  mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
} catch (error) {
  fail(`invalid JSON in ${mcpConfigPath}: ${String(error)}`);
}
if (!mcpConfig.mcpServers?.orgx || typeof mcpConfig.mcpServers.orgx !== "object") {
  fail(".mcp.json missing mcpServers.orgx");
}

const orgxServer = mcpConfig.mcpServers.orgx;
if (orgxServer.type !== "http") fail("mcpServers.orgx.type must be 'http'");
if (typeof orgxServer.url !== "string" || orgxServer.url.trim().length === 0) {
  fail("mcpServers.orgx.url must be a non-empty string");
}
if (
  orgxServer.url !==
  "${ORGX_MCP_URL:-https://mcp.useorgx.com/mcp?profile=commander}"
) {
  fail("mcpServers.orgx.url must default to the commander MCP profile");
}
if (Object.hasOwn(orgxServer, "headers") || Object.hasOwn(orgxServer, "headersHelper")) {
  fail("mcpServers.orgx must use the server's native OAuth flow, not embedded headers");
}

let releaseManifest;
try {
  releaseManifest = JSON.parse(readFileSync(releaseManifestPath, "utf8"));
} catch (error) {
  fail(`invalid JSON in ${releaseManifestPath}: ${String(error)}`);
}
if (releaseManifest.plugin_name !== pkg.name) {
  fail("plugin.manifest.json plugin_name must match package.json name");
}
if (releaseManifest.version !== pkg.version) {
  fail("plugin.manifest.json version must match package.json version");
}
if (Object.hasOwn(releaseManifest, "signature")) {
  fail("unsigned public builds must not claim a signature field");
}
const expectedFingerprint = expectedManifestFingerprint(releaseManifest);
if (releaseManifest.manifest_fingerprint !== expectedFingerprint) {
  fail(
    `plugin.manifest.json fingerprint mismatch: expected ${expectedFingerprint}, received ${String(
      releaseManifest.manifest_fingerprint
    )}`
  );
}

let marketplace;
try {
  marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
} catch (error) {
  fail(`invalid JSON in ${marketplacePath}: ${String(error)}`);
}

if (marketplace.name !== "orgx") fail("marketplace name must be orgx");
if (typeof marketplace.description !== "string" || marketplace.description.trim().length === 0) {
  fail("marketplace missing description");
}
if (!marketplace.owner || marketplace.owner.name !== "OrgX Team") {
  fail("marketplace owner must identify OrgX Team");
}
if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
  fail("marketplace must list at least one plugin");
}

const marketplacePlugin = marketplace.plugins.find((plugin) => plugin.name === manifest.name);
if (!marketplacePlugin) fail(`marketplace must list ${manifest.name}`);
if (marketplacePlugin.version !== manifest.version) {
  fail(`marketplace plugin version ${marketplacePlugin.version} must match manifest ${manifest.version}`);
}
if (!marketplacePlugin.description.includes("operator chronicle reporting")) {
  fail("marketplace plugin description must mention operator chronicle reporting");
}
if (marketplacePlugin.license !== "MIT") fail("marketplace plugin license must be MIT");
if (marketplacePlugin.repository !== "https://github.com/useorgx/orgx-claude-code-plugin") {
  fail("marketplace plugin repository must point to the public OrgX Claude Code plugin repo");
}
if (marketplacePlugin.source !== "./") {
  fail("marketplace plugin source must reuse the HTTPS-cloned marketplace root");
}

let hooks;
try {
  hooks = JSON.parse(readFileSync(hooksPath, "utf8"));
} catch (error) {
  fail(`invalid JSON in ${hooksPath}: ${String(error)}`);
}

if (!hooks.hooks || typeof hooks.hooks !== "object") fail("hooks/hooks.json missing hooks object");
for (const eventName of ["SessionStart", "PostToolUse", "SubagentStop", "Stop"]) {
  if (!Array.isArray(hooks.hooks[eventName])) fail(`hooks.${eventName} must be an array`);
}
const stopHookCommands = hooks.hooks.Stop.flatMap((entry) =>
  Array.isArray(entry.hooks)
    ? entry.hooks.map((hook) => (typeof hook.command === "string" ? hook.command : ""))
    : []
);
if (!stopHookCommands.some((command) => command.includes("post-reporting-event.mjs"))) {
  fail("Stop hook must record a compact runtime event");
}
if (
  stopHookCommands.some(
    (command) =>
      command.includes("--apply_completion") ||
      command.includes("--phase=completed")
  )
) {
  fail("Stop hooks are passive and must never complete scoped work");
}
if (
  !stopHookCommands.some(
    (command) =>
      command.includes("orgx-reconcile-hook.mjs") &&
      command.includes("--event=stop") &&
      command.includes("--source_client=claude-code")
  )
) {
  fail("Stop hook must run local Work Graph reconciliation for claude-code");
}

const hookScript = readFileSync(hookScriptPath, "utf8");
if (!hookScript.includes("orgx_claude_code_plugin_runtime_hook")) {
  fail("hook script must emit orgx_claude_code_plugin_runtime_hook records");
}
if (!hookScript.includes("ORGX_WIZARD_HOOK_OUTBOX")) {
  fail("hook script must support ORGX_WIZARD_HOOK_OUTBOX");
}
if (hookScript.includes("appendFileSync(outbox, stdinText")) {
  fail("hook script must not persist raw hook stdin");
}
if (
  !pkg.bin ||
  pkg.bin["orgx-claude-code-reconcile-hooks"] !==
    "hooks/scripts/orgx-work-graph-reconcile.mjs"
) {
  fail("package bin must expose orgx-claude-code-reconcile-hooks");
}
if (!Array.isArray(pkg.files)) {
  fail("package.json must define a publish files allowlist");
}
for (const expectedPath of [
  ".claude-plugin/",
  ".mcp.json",
  "hooks/",
  "lib/",
  "scripts/",
  "skills/",
]) {
  if (!pkg.files.includes(expectedPath)) {
    fail(`package files allowlist missing ${expectedPath}`);
  }
}
for (const forbiddenPath of [".agents/", ".agent/", ".codex/"]) {
  if (pkg.files.includes(forbiddenPath)) {
    fail(`package files allowlist must not include local mirror ${forbiddenPath}`);
  }
}

const reconciler = readFileSync(hookReconcilerPath, "utf8");
for (const expected of [
  "work_graph_fingerprint",
  "signup_hydration",
  "raw_transcripts_sent: false",
  "raw_transcripts_excluded: true",
]) {
  if (!reconciler.includes(expected)) {
    fail(`hook reconciler must include ${expected}`);
  }
}

const reconcileWrapper = readFileSync(hookReconcileWrapperPath, "utf8");
for (const expected of [
  "latest-work-graph-report.json",
  "ORGX_CLAUDE_HOOK_RECONCILE_POST",
  "ORGX_HOOK_RECONCILE_POST",
  "ORGX_WIZARD_HOOK_RECONCILE_POST",
  "process.exit(0)",
]) {
  if (!reconcileWrapper.includes(expected)) {
    fail(`hook reconcile wrapper must include ${expected}`);
  }
}
if (reconcileWrapper.includes("process.exit(1)")) {
  fail("hook reconcile wrapper must not block Claude sessions with process.exit(1)");
}

for (const file of [
  "README.md",
  "commands/orgx-operator-chronicle.md",
  "commands/orgx-status.md",
  "skills/orgx-runtime-reporting/SKILL.md",
]) {
  const text = readFileSync(resolve(root, file), "utf8");
  if (!text.includes("get_operator_chronicle")) {
    fail(`${file} must route reporting through get_operator_chronicle`);
  }
  if (!text.includes("orgx_recommend") || !text.includes('mode: "morning_brief"')) {
    fail(`${file} must document the orgx_recommend morning_brief stale-client fallback`);
  }
}

const readme = readFileSync(resolve(root, "README.md"), "utf8");
if (
  !readme.includes(
    "claude plugin marketplace add https://github.com/useorgx/orgx-claude-code-plugin.git"
  )
) {
  fail("README must document the HTTPS marketplace install path");
}
if (readme.includes("claude plugin marketplace add useorgx/orgx-claude-code-plugin")) {
  fail("README must not direct users through the SSH-sensitive GitHub shorthand");
}
if (!readme.includes("native OAuth")) {
  fail("README must explain native OAuth for the MCP connection");
}

const directorySubmission = readFileSync(directorySubmissionPath, "utf8");
if (!directorySubmission.includes("Prepared, not submitted")) {
  fail("directory submission runbook must preserve the not-submitted status boundary");
}
if (!directorySubmission.includes("https://platform.claude.com/plugins/submit")) {
  fail("directory submission runbook must include the official Console portal");
}
if (!directorySubmission.includes("https://claude.ai/settings/plugins/submit")) {
  fail("directory submission runbook must include the official Claude.ai portal");
}
if (directorySubmission.includes("/admin-settings/directory/submissions/plugins/new")) {
  fail("directory submission runbook must not include the retired Claude.ai portal path");
}

console.log("verify-plugin: ok");
console.log(`manifest: ${manifest.name}@${manifest.version}`);
console.log(`marketplace: ${marketplace.name}/${marketplacePlugin.name}`);
console.log(`mcp server: ${orgxServer.url}`);
console.log(`release manifest: ${releaseManifest.manifest_fingerprint} (unsigned)`);
