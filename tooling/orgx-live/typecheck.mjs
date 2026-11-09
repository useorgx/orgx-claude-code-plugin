#!/usr/bin/env node
// Type-checks the orgx-live mod against the Claude Code plugin API.
//
// The API's declarations are written by Claude Code itself, per build, into
// the mod's .claude-plugin/types/ whenever it loads the mod from a folder you
// own (`claude --plugin-dir plugins/orgx-live`). That folder is gitignored:
// the declarations belong to the CLI build, not to this repository.
//
// Without that folder, set CLAUDE_CODE_TYPES to a claude-code.d.ts written by
// the same CLI build (the plugin-authoring skill's types/claude-code.d.ts) and
// this script lays it where the engine would before running tsc.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const laid = resolve(root, "plugins", "orgx-live", ".claude-plugin", "types", "claude-code", "index.d.ts");

if (!existsSync(laid)) {
  const source = process.env.CLAUDE_CODE_TYPES;
  if (!source || !existsSync(source)) {
    console.error(
      "orgx-live typecheck: no Claude Code plugin API declarations found.\n" +
        "Load the mod once with `claude --plugin-dir plugins/orgx-live`, or set\n" +
        "CLAUDE_CODE_TYPES to the plugin-authoring skill's types/claude-code.d.ts."
    );
    process.exit(1);
  }
  mkdirSync(dirname(laid), { recursive: true });
  copyFileSync(source, laid);
}

const tsc = resolve(root, "node_modules", "typescript", "bin", "tsc");
const result = spawnSync(process.execPath, [tsc, "-p", resolve(here, "tsconfig.json")], {
  stdio: "inherit",
});
if (result.status === 0) console.log("orgx-live typecheck: ok");
process.exit(result.status ?? 1);
