#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`verify-plugin: ${message}`);
  process.exit(1);
}

const root = process.cwd();
const manifestPath = resolve(root, ".claude-plugin", "plugin.json");
const packagePath = resolve(root, "package.json");
const hooksPath = resolve(root, "hooks", "hooks.json");
const hookScriptPath = resolve(root, "hooks", "scripts", "post-reporting-event.mjs");
const hookReconcilerPath = resolve(root, "hooks", "scripts", "orgx-work-graph-reconcile.mjs");
const readmePath = resolve(root, "README.md");

for (const path of [manifestPath, packagePath, hooksPath, hookScriptPath, hookReconcilerPath, readmePath]) {
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
if (pkg.peerDependencies?.["@useorgx/agent-memory-projections"] !== ">=0.1.0") {
  fail("package.json must declare @useorgx/agent-memory-projections as an optional peer contract");
}
if (pkg.peerDependenciesMeta?.["@useorgx/agent-memory-projections"]?.optional !== true) {
  fail("@useorgx/agent-memory-projections peer dependency must be optional until the shared package is published");
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
if (!String(orgxServer.note ?? "").includes("orgx_memory_context")) {
  fail("mcpServers.orgx.note must mention orgx_memory_context");
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

const readme = readFileSync(readmePath, "utf8");
for (const expected of [
  "orgx_memory_context",
  "client: \"claude_code\"",
  "source_refs",
  "projection_targets",
  "proof that the active Claude Code session can call the tool",
  "raw transcripts",
  "one-time codes",
]) {
  if (!readme.includes(expected)) {
    fail(`README must document memory projection contract: ${expected}`);
  }
}

console.log("verify-plugin: ok");
console.log(`manifest: ${manifest.name}@${manifest.version}`);
console.log(`mcp server: ${orgxServer.url}`);
