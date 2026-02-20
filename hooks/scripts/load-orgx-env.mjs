#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const LOCAL_CONFIG_FILENAME = "orgx.local.json";

export function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, ...rest] = arg.slice(2).split("=");
    const key = rawKey.trim();
    if (!key) continue;
    args[key] = rest.length > 0 ? rest.join("=") : "true";
  }
  return args;
}

export function pickString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

export function readLocalConfig(projectDir) {
  const path = join(projectDir, ".claude", LOCAL_CONFIG_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function readApiKeyFromKeychain({ service, account }) {
  if (process.platform !== "darwin") return null;
  const svc = pickString(service);
  const acct = pickString(account);
  if (!svc || !acct) return null;

  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", svc, "-a", acct, "-w"],
    { encoding: "utf8" }
  );
  if (result.status !== 0) return null;
  const key = pickString(result.stdout);
  return key ?? null;
}

export function buildEnvLines(input) {
  const lines = [];
  if (pickString(input.apiKey)) lines.push(`export ORGX_API_KEY=${shellQuote(input.apiKey)}`);
  if (pickString(input.baseUrl)) lines.push(`export ORGX_BASE_URL=${shellQuote(input.baseUrl)}`);
  if (pickString(input.initiativeId)) {
    lines.push(`export ORGX_INITIATIVE_ID=${shellQuote(input.initiativeId)}`);
  }
  if (pickString(input.userId)) lines.push(`export ORGX_USER_ID=${shellQuote(input.userId)}`);
  if (pickString(input.mcpUrl)) lines.push(`export ORGX_MCP_URL=${shellQuote(input.mcpUrl)}`);
  return lines;
}

export function persistSessionEnv(envFile, lines) {
  const dir = dirname(resolve(envFile));
  mkdirSync(dir, { recursive: true });
  const payload = `${lines.join("\n")}\n`;
  writeFileSync(envFile, payload, { encoding: "utf8", mode: 0o600 });
}

export async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const args = parseArgs(argv);
  const projectDir = resolve(
    pickString(args.project_dir, env.CLAUDE_PROJECT_DIR, process.cwd())
  );
  const config = readLocalConfig(projectDir);
  if (!config || config.enabled === false) return { ok: true, skipped: "not_configured" };

  const apiKey =
    pickString(env.ORGX_API_KEY) ??
    readApiKeyFromKeychain({
      service: config.keychainService,
      account: config.keychainAccount,
    });
  if (!apiKey) return { ok: true, skipped: "missing_api_key" };

  const lines = buildEnvLines({
    apiKey,
    baseUrl: config.baseUrl,
    initiativeId: config.initiativeId,
    userId: config.userId,
    mcpUrl: config.mcpUrl,
  });
  const envFile = pickString(env.CLAUDE_ENV_FILE, args.env_file);
  if (!envFile) {
    return { ok: true, hydrated: false, skipped: "missing_claude_env_file", lines };
  }

  persistSessionEnv(envFile, lines);
  return { ok: true, hydrated: true, lineCount: lines.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch(() => process.exit(0));
}
