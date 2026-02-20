#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

function run(cmd, args, { cwd = process.cwd(), capture = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    const detail =
      capture && (result.stderr || result.stdout)
        ? `\n${String(result.stderr || result.stdout).trim()}`
        : "";
    throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${result.status}${detail}`);
  }

  return result;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function gitCommand() {
  return process.platform === "win32" ? "git.exe" : "git";
}

function printHeading(label) {
  process.stdout.write(`\n[release:dry-run] ${label}\n`);
}

function main() {
  const cwd = process.cwd();
  const npmCmd = npmCommand();

  try {
    printHeading("preflight");
    const status = run(gitCommand(), ["status", "--porcelain"], { cwd, capture: true });
    const dirty = status.stdout.trim().length > 0;
    if (dirty) {
      process.stdout.write(
        "[release:dry-run] warning: working tree has uncommitted changes. Continuing.\n"
      );
    } else {
      process.stdout.write("[release:dry-run] git working tree is clean.\n");
    }

    printHeading("running checks");
    run(npmCmd, ["run", "check"], { cwd });

    printHeading("packing artifact");
    mkdirSync(resolve(cwd, "artifacts"), { recursive: true });
    run(npmCmd, ["run", "pack"], { cwd });

    printHeading("complete");
    process.stdout.write(
      "[release:dry-run] success. Next steps: commit changes, create tag (vX.Y.Z), push tag.\n"
    );
  } catch (error) {
    process.stderr.write(
      `[release:dry-run] ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}

main();
