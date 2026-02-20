#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`verify-plugin: ${message}`);
  process.exit(1);
}

const root = process.cwd();
const manifestPath = resolve(root, ".claude-plugin", "plugin.json");
const hooksPath = resolve(root, "hooks", "hooks.json");
const hookScriptPath = resolve(root, "hooks", "scripts", "post-reporting-event.mjs");

for (const path of [manifestPath, hooksPath, hookScriptPath]) {
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

console.log("verify-plugin: ok");
console.log(`manifest: ${manifest.name}@${manifest.version}`);
console.log(`mcp server: ${orgxServer.url}`);
