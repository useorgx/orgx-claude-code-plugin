#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function fingerprintPayload(manifest) {
  return {
    plugin_name: manifest.plugin_name,
    version: manifest.version,
    capabilities: [...(manifest.capabilities ?? [])].sort(),
    mcp_tools: [...(manifest.mcp_tools ?? [])].sort(),
    driver_ids: [...(manifest.driver_ids ?? [])].sort(),
    session_security: manifest.session_security,
  };
}

export function expectedManifestFingerprint(manifest) {
  const canonical = JSON.stringify(fingerprintPayload(manifest));
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `sha256:${digest}`;
}

export function readManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function checkManifest(manifest) {
  const expected = expectedManifestFingerprint(manifest);
  return {
    ok: manifest.manifest_fingerprint === expected,
    actual: manifest.manifest_fingerprint,
    expected,
  };
}

function main(argv = process.argv.slice(2)) {
  const manifestPath = resolve(process.cwd(), "plugin.manifest.json");
  const manifest = readManifest(manifestPath);
  const expected = expectedManifestFingerprint(manifest);

  if (argv.includes("--write")) {
    manifest.manifest_fingerprint = expected;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`plugin manifest fingerprint updated: ${expected}`);
    return;
  }

  if (argv.includes("--check")) {
    if (manifest.manifest_fingerprint !== expected) {
      console.error(
        `plugin manifest fingerprint mismatch: expected ${expected}, received ${String(
          manifest.manifest_fingerprint
        )}`
      );
      process.exitCode = 1;
      return;
    }
    console.log(`plugin manifest fingerprint verified: ${expected}`);
    return;
  }

  console.log(expected);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
