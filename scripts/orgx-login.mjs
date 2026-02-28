#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  defaultOrgxSkillsDir,
  syncOrgxSkillsFromServer,
} from "../lib/skill-pack-sync.mjs";
import {
  defaultOrgxAgentsDir,
  syncOrgxAgentProfilesFromServer,
} from "../lib/agent-profile-sync.mjs";

const DEFAULT_BASE_URL = "https://www.useorgx.com";
const DEFAULT_MCP_URL = "https://mcp.useorgx.com/mcp";
const DEFAULT_PAIR_TIMEOUT_MS = 8 * 60 * 1000;
const KEYCHAIN_SERVICE = "orgx-claude-code-plugin";
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

function parseBoolean(value, fallback = false) {
  const normalized = pickString(value)?.toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "n"].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function maskKey(value) {
  const raw = pickString(value);
  if (!raw) return "(none)";
  if (raw.length <= 8) return `${raw.slice(0, 2)}...`;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

async function fetchOrgxJson({ method, baseUrl, path, payload, apiKey, timeoutMs = 30_000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "Content-Type": "application/json" };
    if (pickString(apiKey)) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const parsed = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    if (!response.ok) {
      const detail =
        parsed && typeof parsed === "object"
          ? String(parsed.error ?? parsed.message ?? response.statusText)
          : String(parsed || response.statusText);
      return { ok: false, status: response.status, error: detail, data: null };
    }

    if (parsed && typeof parsed === "object" && parsed.ok === true && parsed.data) {
      return { ok: true, status: response.status, data: parsed.data };
    }
    return { ok: true, status: response.status, data: parsed };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, status: 504, error: `request timed out after ${timeoutMs}ms`, data: null };
    }
    return { ok: false, status: 0, error: String(error?.message ?? error), data: null };
  } finally {
    clearTimeout(timeout);
  }
}

function openBrowser(url) {
  if (!pickString(url)) return false;
  const platform = process.platform;
  const candidates =
    platform === "darwin"
      ? [["open", [url]]]
      : platform === "win32"
        ? [["cmd", ["/c", "start", "", url]]]
        : [["xdg-open", [url]]];

  for (const [cmd, args] of candidates) {
    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return true;
    } catch {
      // try next launcher
    }
  }
  return false;
}

export function readLocalConfig(projectDir) {
  const configPath = join(projectDir, ".claude", LOCAL_CONFIG_FILENAME);
  if (!existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocalConfig(projectDir, config) {
  const claudeDir = join(projectDir, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const configPath = join(claudeDir, LOCAL_CONFIG_FILENAME);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return configPath;
}

function storeApiKeyInKeychain({ key, account, service = KEYCHAIN_SERVICE }) {
  if (process.platform !== "darwin") {
    throw new Error("macOS keychain storage is only available on darwin");
  }
  const result = spawnSync(
    "security",
    ["add-generic-password", "-U", "-s", service, "-a", account, "-w", key],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "security add-generic-password failed");
  }
}

async function verifyApiKey({ apiKey, baseUrl }) {
  const response = await fetchOrgxJson({
    method: "POST",
    baseUrl,
    path: "/api/client/sync",
    payload: {},
    apiKey,
    timeoutMs: 40_000,
  });
  if (!response.ok) {
    throw new Error(`API key validation failed: ${response.error}`);
  }
}

async function startPairing({ baseUrl, pluginVersion, deviceName }) {
  const payload = {
    installationId: `claude-plugin-${Date.now()}`,
    pluginVersion,
    openclawVersion: "claude-code",
    platform: process.platform,
    deviceName,
  };
  const response = await fetchOrgxJson({
    method: "POST",
    baseUrl,
    path: "/api/plugin/openclaw/pairings",
    payload,
    timeoutMs: 30_000,
  });
  if (!response.ok) {
    throw new Error(`Pairing start failed: ${response.error}`);
  }
  const data = response.data ?? {};
  const pairingId = pickString(data.pairingId);
  const pollToken = pickString(data.pollToken);
  const connectUrl = pickString(data.connectUrl);
  const pollIntervalMs = parseInteger(data.pollIntervalMs, 1500);
  if (!pairingId || !pollToken || !connectUrl) {
    throw new Error("Pairing start response missing required fields");
  }
  return { pairingId, pollToken, connectUrl, pollIntervalMs };
}

async function pollPairingReady({ baseUrl, pairingId, pollToken, timeoutMs, pollIntervalMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetchOrgxJson({
      method: "GET",
      baseUrl,
      path: `/api/plugin/openclaw/pairings/${encodeURIComponent(pairingId)}?pollToken=${encodeURIComponent(
        pollToken
      )}`,
      timeoutMs: Math.max(10_000, pollIntervalMs * 2),
    });
    if (!response.ok) {
      throw new Error(`Pairing poll failed: ${response.error}`);
    }

    const data = response.data ?? {};
    const status = pickString(data.status, "pending");
    if (status === "pending" || status === "authorized") {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, pollIntervalMs));
      continue;
    }
    if (status === "ready") return data;
    if (status === "cancelled") throw new Error("Pairing cancelled in browser.");
    if (status === "expired") throw new Error("Pairing expired before completion.");
    if (status === "consumed") throw new Error("Pairing already consumed.");
    throw new Error(pickString(data.errorMessage, `Pairing failed with status=${status}`));
  }
  throw new Error(`Pairing timed out after ${Math.round(timeoutMs / 1000)}s`);
}

async function ackPairing({ baseUrl, pairingId, pollToken }) {
  await fetchOrgxJson({
    method: "POST",
    baseUrl,
    path: `/api/plugin/openclaw/pairings/${encodeURIComponent(pairingId)}/ack`,
    payload: { pollToken },
    timeoutMs: 15_000,
  });
}

export async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const args = parseArgs(argv);
  const baseUrl = pickString(args.base_url, env.ORGX_BASE_URL, DEFAULT_BASE_URL).replace(/\/+$/, "");
  const projectDir = resolve(
    pickString(args.project_dir, env.CLAUDE_PROJECT_DIR, process.cwd())
  );
  const pluginVersion = pickString(args.plugin_version, "0.1.0");
  const initiativeId = pickString(args.initiative_id, env.ORGX_INITIATIVE_ID);
  const deviceName = pickString(args.device_name, `${process.platform}-claude`);
  const pairTimeoutMs = Math.max(30_000, parseInteger(args.timeout_sec, 0) * 1000 || DEFAULT_PAIR_TIMEOUT_MS);
  const openBrowserEnabled = parseBoolean(args.open_browser, true);
  const syncSkills = parseBoolean(args.sync_skills, true);
  const syncAgents = parseBoolean(args.sync_agents, true);
  const skillPackName = pickString(args.skill_pack_name, env.ORGX_SKILL_PACK_NAME, "orgx-agent-suite");
  const skillsDir = resolve(
    pickString(args.skills_dir, env.ORGX_SKILLS_DIR, defaultOrgxSkillsDir(projectDir))
  );
  const pluginDir = resolve(
    pickString(args.plugin_dir, env.CLAUDE_PLUGIN_ROOT, projectDir)
  );
  const agentsDir = resolve(
    pickString(args.agents_dir, env.ORGX_AGENTS_DIR, defaultOrgxAgentsDir(pluginDir))
  );

  let apiKey = pickString(args.api_key, env.ORGX_API_KEY);
  let pairingContext = null;
  let workspaceName = null;
  let keyPrefix = null;
  let userId = pickString(args.user_id, env.ORGX_USER_ID);

  if (!apiKey) {
    const started = await startPairing({
      baseUrl,
      pluginVersion,
      deviceName,
    });
    pairingContext = started;

    if (openBrowserEnabled) {
      const opened = openBrowser(started.connectUrl);
      if (!opened) {
        console.warn(`[orgx-login] Could not auto-open browser. Open this URL manually: ${started.connectUrl}`);
      }
    }
    console.log(`[orgx-login] Complete login in browser: ${started.connectUrl}`);

    const ready = await pollPairingReady({
      baseUrl,
      pairingId: started.pairingId,
      pollToken: started.pollToken,
      timeoutMs: pairTimeoutMs,
      pollIntervalMs: Math.max(1_000, started.pollIntervalMs),
    });
    apiKey = pickString(ready.key);
    if (!apiKey) throw new Error("Pairing completed without API key payload.");
    workspaceName = pickString(ready.workspaceName);
    keyPrefix = pickString(ready.keyPrefix);
    userId = pickString(ready.supabaseUserId, ready.userId, userId);
    await ackPairing({
      baseUrl,
      pairingId: started.pairingId,
      pollToken: started.pollToken,
    });
  }

  await verifyApiKey({ apiKey, baseUrl });

  const account =
    pickString(args.keychain_account, userId, keyPrefix, `orgx-${Math.random().toString(16).slice(2, 10)}`) ??
    "orgx-default";
  storeApiKeyInKeychain({
    key: apiKey,
    account,
    service: KEYCHAIN_SERVICE,
  });

  const config = {
    enabled: true,
    baseUrl,
    mcpUrl: pickString(args.mcp_url, env.ORGX_MCP_URL, DEFAULT_MCP_URL),
    initiativeId: initiativeId ?? null,
    userId: userId ?? null,
    workspaceName,
    keyPrefix,
    keychainService: KEYCHAIN_SERVICE,
    keychainAccount: account,
    source: pairingContext ? "browser_pairing" : "manual_key",
    updatedAt: new Date().toISOString(),
  };
  const configPath = writeLocalConfig(projectDir, config);

  let skillSync = { attempted: false, notModified: false, skillCount: 0, error: null };
  if (syncSkills) {
    skillSync.attempted = true;
    try {
      const result = await syncOrgxSkillsFromServer({
        apiKey,
        baseUrl,
        userId,
        packName: skillPackName,
        projectDir,
        skillsDir,
      });
      skillSync.notModified = Boolean(result.notModified);
      skillSync.skillCount = result.skillCount ?? result.state?.skills?.length ?? 0;
    } catch (error) {
      skillSync.error = String(error?.message ?? error);
    }
  }

  let agentSync = { attempted: false, notModified: false, agentCount: 0, error: null };
  if (syncAgents) {
    agentSync.attempted = true;
    try {
      const result = await syncOrgxAgentProfilesFromServer({
        apiKey,
        baseUrl,
        userId,
        packName: skillPackName,
        projectDir,
        agentsDir,
      });
      agentSync.notModified = Boolean(result.notModified);
      agentSync.agentCount = result.agentCount ?? result.state?.agents?.length ?? 0;
    } catch (error) {
      agentSync.error = String(error?.message ?? error);
    }
  }

  console.log(`[orgx-login] Login saved. key=${maskKey(apiKey)} account=${account}`);
  console.log(`[orgx-login] Config: ${configPath}`);
  if (skillSync.attempted) {
    if (skillSync.error) {
      console.warn(`[orgx-login] Skill sync warning: ${skillSync.error}`);
    } else if (skillSync.notModified) {
      console.log("[orgx-login] Skill pack already up-to-date.");
    } else {
      console.log(`[orgx-login] Synced ${skillSync.skillCount} skills to ${skillsDir}`);
    }
  }
  if (agentSync.attempted) {
    if (agentSync.error) {
      console.warn(`[orgx-login] Agent sync warning: ${agentSync.error}`);
    } else if (agentSync.notModified) {
      console.log("[orgx-login] Agent pack already up-to-date.");
    } else {
      console.log(`[orgx-login] Synced ${agentSync.agentCount} agents to ${agentsDir}`);
    }
  }
  console.log(
    "[orgx-login] Next session will hydrate ORGX_API_KEY from keychain via SessionStart hook."
  );

  return {
    ok: true,
    configPath,
    baseUrl,
    initiativeId: config.initiativeId,
    keychainAccount: account,
    source: config.source,
    skillSync,
    agentSync,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[orgx-login] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
