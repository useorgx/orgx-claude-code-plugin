#!/usr/bin/env node

import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  readApiKeyFromKeychain,
  readLocalConfig,
} from "../hooks/scripts/load-orgx-env.mjs";
import {
  defaultOrgxAgentsDir,
  syncOrgxAgentProfilesFromServer,
} from "../lib/agent-profile-sync.mjs";

const DEFAULT_BASE_URL = "https://www.useorgx.com";
const DEFAULT_PACK_NAME = "orgx-agent-suite";

function pickString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function parseBoolean(value, fallback = false) {
  const normalized = pickString(value)?.toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseArgs(argv) {
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

export async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const args = parseArgs(argv);
  const projectDir = resolve(
    pickString(args.project_dir, env.CLAUDE_PROJECT_DIR, process.cwd())
  );
  const pluginDir = resolve(
    pickString(args.plugin_dir, env.CLAUDE_PLUGIN_ROOT, process.cwd())
  );
  const agentsDir = resolve(
    pickString(args.agents_dir, env.ORGX_AGENTS_DIR, defaultOrgxAgentsDir(pluginDir))
  );
  const stateFile = resolve(
    pickString(args.state_file, join(projectDir, ".claude", "orgx-agent-pack-state.json"))
  );
  const bestEffort = parseBoolean(args.best_effort, false);
  const quiet = parseBoolean(args.quiet, false);
  const baseUrl = pickString(args.base_url, env.ORGX_BASE_URL, DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );
  const packName = pickString(args.skill_pack_name, env.ORGX_SKILL_PACK_NAME, DEFAULT_PACK_NAME);

  const config = readLocalConfig(projectDir);
  const userId = pickString(args.user_id, env.ORGX_USER_ID, config?.userId);
  let apiKey = pickString(args.api_key, env.ORGX_API_KEY);
  if (!apiKey && config) {
    apiKey = readApiKeyFromKeychain({
      service: config.keychainService,
      account: config.keychainAccount,
    });
  }

  if (!apiKey) {
    const result = { ok: true, skipped: "missing_api_key", projectDir };
    if (!quiet) {
      console.log("[orgx-sync-agents] skipped: missing API key");
    }
    return result;
  }

  try {
    const result = await syncOrgxAgentProfilesFromServer({
      apiKey,
      userId,
      baseUrl,
      packName,
      projectDir,
      agentsDir,
      stateFile,
    });

    if (!quiet) {
      if (result.notModified) {
        console.log(`[orgx-sync-agents] up-to-date (${packName})`);
      } else {
        console.log(
          `[orgx-sync-agents] synced ${String(result.agentCount ?? 0)} agents -> ${agentsDir}`
        );
      }
    }

    return {
      ok: true,
      notModified: Boolean(result.notModified),
      agentsDir,
      stateFile,
      agentCount: result.agentCount ?? result.state?.agents?.length ?? 0,
    };
  } catch (error) {
    if (bestEffort) {
      if (!quiet) {
        console.warn(
          `[orgx-sync-agents] warning: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return {
        ok: true,
        skipped: "sync_failed_best_effort",
      };
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(
        `[orgx-sync-agents] ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    });
}
