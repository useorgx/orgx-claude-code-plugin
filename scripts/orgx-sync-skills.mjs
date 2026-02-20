#!/usr/bin/env node

import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  readApiKeyFromKeychain,
  readLocalConfig,
} from "../hooks/scripts/load-orgx-env.mjs";
import {
  defaultOrgxSkillsDir,
  syncOrgxSkillsFromServer,
} from "../lib/skill-pack-sync.mjs";

const DEFAULT_BASE_URL = "https://www.useorgx.com";

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
  const bestEffort = parseBoolean(args.best_effort, false);
  const quiet = parseBoolean(args.quiet, false);
  const baseUrl = pickString(args.base_url, env.ORGX_BASE_URL, DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );
  const packName = pickString(args.skill_pack_name, env.ORGX_SKILL_PACK_NAME, "orgx-agent-suite");
  const skillsDir = resolve(
    pickString(args.skills_dir, env.ORGX_SKILLS_DIR, defaultOrgxSkillsDir(projectDir))
  );
  const stateFile = resolve(
    pickString(args.state_file, join(projectDir, ".claude", "orgx-skill-pack-state.json"))
  );

  let config = readLocalConfig(projectDir);
  let userId = pickString(args.user_id, env.ORGX_USER_ID, config?.userId);
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
      console.log("[orgx-sync-skills] skipped: missing API key");
    }
    return result;
  }

  try {
    const result = await syncOrgxSkillsFromServer({
      apiKey,
      userId,
      baseUrl,
      packName,
      projectDir,
      skillsDir,
      stateFile,
    });
    if (!quiet) {
      if (result.notModified) {
        console.log(`[orgx-sync-skills] up-to-date (${packName})`);
      } else {
        console.log(
          `[orgx-sync-skills] synced ${String(result.skillCount ?? 0)} skills -> ${skillsDir}`
        );
      }
    }
    return {
      ok: true,
      notModified: Boolean(result.notModified),
      skillsDir,
      stateFile,
      skillCount: result.skillCount ?? result.state?.skills?.length ?? 0,
    };
  } catch (error) {
    if (bestEffort) {
      if (!quiet) {
        console.warn(
          `[orgx-sync-skills] warning: ${error instanceof Error ? error.message : String(error)}`
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
        `[orgx-sync-skills] ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    });
}
