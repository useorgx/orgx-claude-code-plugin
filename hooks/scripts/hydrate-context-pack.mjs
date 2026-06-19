#!/usr/bin/env node
/**
 * SessionStart: hydrate the OrgX AgentContextPack (M adapter — Claude Code).
 *
 * Fetches the compiled pack for the active initiative from the app endpoint
 * (POST /api/client/context-pack) and writes it to .claude/orgx-context-pack.json
 * so the agent starts already briefed — before its first token. Best-effort:
 * never fails the session. Pairs with the MCP backbone (orgx_inspect also
 * returns the pack), so even without this hook the agent hydrates on first call.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const LOCAL_CONFIG_FILENAME = "orgx.local.json";
const PACK_FILENAME = "orgx-context-pack.json";

export function pickString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
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

/** Pure: resolve creds + active initiative from env, falling back to local config. */
export function resolveConfig(env = {}, localConfig = null) {
  const apiKey = pickString(env.ORGX_API_KEY, localConfig?.apiKey, localConfig?.api_key);
  const baseUrl =
    pickString(env.ORGX_BASE_URL, localConfig?.baseUrl, localConfig?.base_url) ||
    "https://useorgx.com";
  const initiativeId = pickString(
    env.ORGX_INITIATIVE_ID,
    localConfig?.initiativeId,
    localConfig?.initiative_id
  );
  if (!apiKey || !initiativeId) return null;
  return { apiKey, baseUrl, initiativeId };
}

/** Pure: the HTTP request that fetches the pack. */
export function buildPackRequest(config) {
  return {
    url: `${config.baseUrl.replace(/\/$/, "")}/api/client/context-pack`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ initiative_id: config.initiativeId }),
  };
}

async function main() {
  try {
    const projectDir = pickString(process.env.CLAUDE_PROJECT_DIR) ?? process.cwd();
    const config = resolveConfig(process.env, readLocalConfig(projectDir));
    if (!config) return; // nothing to hydrate from

    const req = buildPackRequest(config);
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    if (!res.ok) return;
    const payload = await res.json().catch(() => null);
    const data = payload?.data ?? null;
    if (!data) return;

    const dir = join(projectDir, ".claude");
    mkdirSync(dir, { recursive: true });
    const out = join(dir, PACK_FILENAME);
    // 0600 — the pack carries decisions/CRM context; owner-only at rest.
    writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString(), data }, null, 2), {
      mode: 0o600,
    });
    try {
      chmodSync(out, 0o600);
    } catch {
      /* best-effort perms */
    }
  } catch {
    /* never fail the session on context hydration */
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(() => process.exit(0));
}
