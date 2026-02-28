import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { extractOpenclawSkillMap } from "./skill-pack-sync.mjs";

const DEFAULT_BASE_URL = "https://www.useorgx.com";
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_PACK_NAME = "orgx-agent-suite";
const DEFAULT_STATE_FILENAME = "orgx-agent-pack-state.json";
const DEFAULT_AGENTS_DIRNAME = "agents";
const STATE_VERSION = 1;

const DOMAIN_ALIASES = {
  orchestrator: "orchestration",
  ops: "operations",
};

const DOMAIN_TO_AGENT_BASENAME = {
  engineering: "orgx-engineering",
  product: "orgx-product",
  marketing: "orgx-marketing",
  sales: "orgx-sales",
  operations: "orgx-operations",
  design: "orgx-design",
  orchestration: "orgx-orchestrator",
};

const DOMAIN_TO_SKILL = {
  engineering: "orgx-engineering-agent",
  product: "orgx-product-agent",
  marketing: "orgx-marketing-agent",
  sales: "orgx-sales-agent",
  operations: "orgx-operations-agent",
  design: "orgx-design-agent",
  orchestration: "orgx-orchestrator-agent",
};

function nowIso() {
  return new Date().toISOString();
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeDomain(rawDomain) {
  const raw = pickString(rawDomain)?.toLowerCase();
  if (!raw) return null;
  const normalized = raw.replace(/[\s_]+/g, "-");
  return DOMAIN_ALIASES[normalized] ?? normalized;
}

function safeSegment(input) {
  const normalized = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "orgx-agent";
}

function titleCase(value) {
  return String(value ?? "")
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function markdownFromValue(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? `${trimmed}\n` : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const candidate = pickString(
    record.markdown,
    record.content,
    record.agent_md,
    record.agent,
    record.text
  );
  return candidate ? `${candidate.trim()}\n` : null;
}

function readJson(pathname) {
  if (!existsSync(pathname)) return null;
  try {
    return asRecord(JSON.parse(readFileSync(pathname, "utf8")));
  } catch {
    return null;
  }
}

function writeJson(pathname, payload) {
  mkdirSync(dirname(resolve(pathname)), { recursive: true });
  writeFileSync(pathname, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function resolveDefaults({ projectDir, agentsDir, stateFile }) {
  const resolvedProjectDir = resolve(projectDir ?? process.cwd());
  const resolvedAgentsDir = resolve(
    agentsDir ?? join(resolvedProjectDir, DEFAULT_AGENTS_DIRNAME)
  );
  const resolvedStateFile = resolve(
    stateFile ?? join(resolvedProjectDir, ".claude", DEFAULT_STATE_FILENAME)
  );
  return {
    projectDir: resolvedProjectDir,
    agentsDir: resolvedAgentsDir,
    stateFile: resolvedStateFile,
  };
}

function domainToAgentBaseName(domain) {
  return DOMAIN_TO_AGENT_BASENAME[domain] ?? `orgx-${safeSegment(domain)}`;
}

function domainToSkillName(domain) {
  return DOMAIN_TO_SKILL[domain] ?? `orgx-${safeSegment(domain)}-agent`;
}

function ensureAgentFrontmatter({ domain, baseName, skillName, content }) {
  const trimmed = pickString(content) ?? "";
  if (trimmed.startsWith("---\n")) return `${trimmed}\n`;

  const domainTitle = titleCase(domain);
  const description = `OrgX ${domainTitle} subagent profile for Claude Code.`;
  const body = trimmed || [
    `You are the OrgX ${domainTitle} subagent for Claude Code.`,
    "",
    "Rules:",
    "- Treat OrgX initiative state as source of truth.",
    "- Keep updates short, specific, and evidence-based.",
    "- Register artifacts and request decisions when blocked.",
    "",
    `Primary skill guidance: $${skillName}`,
  ].join("\n");

  return [
    "---",
    `name: ${baseName}`,
    `description: ${description}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}

export function extractOpenclawAgentMap(manifestInput) {
  const manifest = asRecord(manifestInput) ?? {};
  const candidates = [
    asRecord(manifest.openclaw_agents),
    asRecord(manifest.openclawAgents),
    asRecord(asRecord(manifest.openclaw)?.agents),
  ].filter(Boolean);

  const out = {};
  for (const candidate of candidates) {
    for (const [rawKey, rawValue] of Object.entries(candidate)) {
      const domain = normalizeDomain(rawKey);
      const markdown = markdownFromValue(rawValue);
      if (!domain || !markdown) continue;
      out[domain] = markdown;
    }
  }
  return out;
}

export function toAgentEntries(manifestInput) {
  const agentMap = extractOpenclawAgentMap(manifestInput);
  const skillMap = extractOpenclawSkillMap(manifestInput);
  const domains = new Set([
    ...Object.keys(skillMap),
    ...Object.keys(agentMap),
  ]);

  return [...domains].map((domain) => {
    const baseName = domainToAgentBaseName(domain);
    const skillName = domainToSkillName(domain);
    const skillPath = `.claude/orgx-skills/${skillName}/SKILL.md`;

    const generatedDefaultBody = [
      `You are the OrgX ${titleCase(domain)} subagent for Claude Code.`,
      "",
      "Rules:",
      "- Treat OrgX initiative state as source of truth.",
      "- Keep updates short, specific, and evidence-based.",
      "- Register artifacts and request decisions when blocked.",
      "",
      `Primary skill guidance: $${skillName}`,
      `Skill path: ${skillPath}`,
    ].join("\n");

    const body = pickString(agentMap[domain], generatedDefaultBody);
    const content = ensureAgentFrontmatter({
      domain,
      baseName,
      skillName,
      content: body,
    });

    return {
      domain,
      baseName,
      fileName: `${baseName}.md`,
      skillName,
      content,
    };
  });
}

function pruneStaleAgentFiles(agentsDir, validAgentFiles) {
  if (!existsSync(agentsDir)) return;
  const valid = new Set(validAgentFiles.map((entry) => entry.toLowerCase()));
  const entries = readdirSync(agentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    if (!entry.name.toLowerCase().startsWith("orgx-")) continue;
    if (valid.has(entry.name.toLowerCase())) continue;
    rmSync(join(agentsDir, entry.name), { force: true });
  }
}

export function writeSyncedAgents({ agentsDir, entries }) {
  mkdirSync(agentsDir, { recursive: true });
  const files = [];

  for (const entry of entries) {
    const path = join(agentsDir, entry.fileName);
    writeFileSync(path, entry.content, { encoding: "utf8", mode: 0o600 });
    files.push(path);
  }

  pruneStaleAgentFiles(
    agentsDir,
    entries.map((entry) => entry.fileName)
  );
  return files;
}

function buildState({ pack, etag, entries, error = null }) {
  return {
    version: STATE_VERSION,
    updatedAt: nowIso(),
    lastCheckedAt: nowIso(),
    lastError: error,
    etag: pickString(etag) ?? null,
    pack: pack
      ? {
          name: pickString(pack.name) ?? null,
          version: pickString(pack.version) ?? null,
          checksum: pickString(pack.checksum) ?? null,
          updated_at: pickString(pack.updated_at) ?? null,
        }
      : null,
    agents: entries.map((entry) => ({
      domain: entry.domain,
      name: entry.baseName,
      path: entry.fileName,
      skill: entry.skillName,
    })),
  };
}

export function readAgentPackSyncState(input = {}) {
  const { stateFile } = resolveDefaults(input);
  const parsed = readJson(stateFile);
  if (!parsed || parsed.version !== STATE_VERSION) return null;
  return parsed;
}

export async function syncOrgxAgentProfilesFromServer({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  userId,
  packName = DEFAULT_PACK_NAME,
  ifNoneMatch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  projectDir,
  agentsDir,
  stateFile,
  fetchImpl = fetch,
}) {
  const key = pickString(apiKey);
  if (!key) {
    throw new Error("ORGX_API_KEY is required for agent sync");
  }

  const resolved = resolveDefaults({ projectDir, agentsDir, stateFile });
  const previous = readAgentPackSyncState(resolved);
  const etagToSend =
    ifNoneMatch === undefined ? pickString(previous?.etag) : pickString(ifNoneMatch);
  const normalizedBaseUrl = pickString(baseUrl, DEFAULT_BASE_URL).replace(/\/+$/, "");
  const name = pickString(packName, DEFAULT_PACK_NAME);
  const url = `${normalizedBaseUrl}/api/client/skill-pack?name=${encodeURIComponent(name)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
    if (pickString(userId)) {
      headers["X-Orgx-User-Id"] = userId;
    }
    if (etagToSend) {
      headers["If-None-Match"] = etagToSend;
    }

    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    const etag = pickString(response.headers.get("etag"), previous?.etag) ?? null;
    if (response.status === 304) {
      const state = {
        ...(previous ?? buildState({ pack: null, etag, entries: [] })),
        updatedAt: nowIso(),
        lastCheckedAt: nowIso(),
        lastError: null,
        etag,
      };
      writeJson(resolved.stateFile, state);
      return {
        ok: true,
        notModified: true,
        etag,
        state,
        agentsDir: resolved.agentsDir,
        stateFile: resolved.stateFile,
      };
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        asRecord(payload) && pickString(payload.error, payload.message)
          ? pickString(payload.error, payload.message)
          : `${response.status} ${response.statusText}`;
      throw new Error(detail);
    }

    const wrapped = asRecord(payload);
    const pack = asRecord(wrapped?.ok === true ? wrapped.data : payload);
    if (!pack) {
      throw new Error("Agent sync response missing data");
    }

    const entries = toAgentEntries(pack.manifest);
    const files = writeSyncedAgents({
      agentsDir: resolved.agentsDir,
      entries,
    });
    const state = buildState({
      pack,
      etag,
      entries,
    });
    writeJson(resolved.stateFile, state);

    return {
      ok: true,
      notModified: false,
      etag,
      state,
      agentsDir: resolved.agentsDir,
      stateFile: resolved.stateFile,
      agentCount: entries.length,
      files,
    };
  } catch (error) {
    const nextState = {
      ...(previous ?? buildState({ pack: null, etag: null, entries: [] })),
      updatedAt: nowIso(),
      lastCheckedAt: nowIso(),
      lastError: String(error?.message ?? error),
    };
    writeJson(resolved.stateFile, nextState);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function defaultOrgxAgentsDir(projectDir = process.cwd()) {
  const resolvedProjectDir = resolve(projectDir);
  return join(resolvedProjectDir, DEFAULT_AGENTS_DIRNAME);
}
