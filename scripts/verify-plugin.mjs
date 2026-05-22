#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`verify-plugin: ${message}`);
  process.exit(1);
}

const root = process.cwd();
const manifestPath = resolve(root, ".claude-plugin", "plugin.json");
const marketplacePath = resolve(root, ".claude-plugin", "marketplace.json");
const hooksPath = resolve(root, "hooks", "hooks.json");
const hookScriptPath = resolve(root, "hooks", "scripts", "post-reporting-event.mjs");

for (const path of [manifestPath, marketplacePath, hooksPath, hookScriptPath]) {
  if (!existsSync(path)) fail(`missing file: ${path}`);
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

console.log("verify-plugin: ok");
console.log(`manifest: ${manifest.name}@${manifest.version}`);
console.log(`marketplace: ${marketplace.name}/${marketplacePlugin.name}`);
console.log(`mcp server: ${orgxServer.url}`);
