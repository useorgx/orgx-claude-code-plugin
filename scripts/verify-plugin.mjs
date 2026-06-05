#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`verify-plugin: ${message}`);
  process.exit(1);
}

const root = process.cwd();
const packagePath = resolve(root, "package.json");
const manifestPath = resolve(root, ".claude-plugin", "plugin.json");
const marketplacePath = resolve(root, ".claude-plugin", "marketplace.json");
const hooksPath = resolve(root, "hooks", "hooks.json");
const hookScriptPath = resolve(root, "hooks", "scripts", "post-reporting-event.mjs");
const hookReconcilerPath = resolve(root, "hooks", "scripts", "orgx-work-graph-reconcile.mjs");
const hookReconcileWrapperPath = resolve(root, "hooks", "scripts", "orgx-reconcile-hook.mjs");
const operatorChronicleCommandPath = resolve(root, "commands", "orgx-operator-chronicle.md");

for (const path of [
  packagePath,
  manifestPath,
  marketplacePath,
  hooksPath,
  hookScriptPath,
  hookReconcilerPath,
  hookReconcileWrapperPath,
  operatorChronicleCommandPath,
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
if (!pkg.description.includes("operator chronicle reporting")) {
  fail("package description must mention operator chronicle reporting");
}
if (!manifest.description.includes("operator chronicle reporting")) {
  fail("manifest description must mention operator chronicle reporting");
}

if (!manifest.mcpServers || typeof manifest.mcpServers !== "object") {
  fail("manifest missing mcpServers");
}

if (!manifest.mcpServers.orgx || typeof manifest.mcpServers.orgx !== "object") {
  fail("manifest missing mcpServers.orgx");
}

const orgxServer = manifest.mcpServers.orgx;
if (orgxServer.type !== "http") fail("mcpServers.orgx.type must be 'http'");
if (typeof orgxServer.url !== "string" || orgxServer.url.trim().length === 0) {
  fail("mcpServers.orgx.url must be a non-empty string");
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
if (marketplacePlugin.source?.source !== "github" || marketplacePlugin.source?.repo !== "useorgx/orgx-claude-code-plugin") {
  fail("marketplace plugin source must use the public GitHub repository");
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

console.log("verify-plugin: ok");
console.log(`manifest: ${manifest.name}@${manifest.version}`);
console.log(`marketplace: ${marketplace.name}/${marketplacePlugin.name}`);
console.log(`mcp server: ${orgxServer.url}`);
