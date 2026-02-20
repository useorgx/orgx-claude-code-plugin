import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const DEFAULT_BASE_URL = "https://www.useorgx.com";
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_SKILL_PACK_NAME = "orgx-agent-suite";
const DEFAULT_SKILLS_DIRNAME = "orgx-skills";
const DEFAULT_STATE_FILENAME = "orgx-skill-pack-state.json";
const STATE_VERSION = 1;

const DOMAIN_TO_SKILL = {
  engineering: "orgx-engineering-agent",
  product: "orgx-product-agent",
  marketing: "orgx-marketing-agent",
  sales: "orgx-sales-agent",
  operations: "orgx-operations-agent",
  design: "orgx-design-agent",
  orchestration: "orgx-orchestrator-agent",
};

const DOMAIN_ALIASES = {
  orchestrator: "orchestration",
  ops: "operations",
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
  return normalized || "skill";
}

function readJson(pathname) {
  if (!existsSync(pathname)) return null;
  try {
    const parsed = JSON.parse(readFileSync(pathname, "utf8"));
    return asRecord(parsed);
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

function markdownFromValue(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? `${trimmed}\n` : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const candidate = pickString(record.markdown, record.content, record.skill_md, record.text);
  return candidate ? `${candidate.trim()}\n` : null;
}

function skillNameFromDomain(domain) {
  const normalized = normalizeDomain(domain) ?? safeSegment(domain);
  return DOMAIN_TO_SKILL[normalized] ?? `orgx-${safeSegment(normalized)}-agent`;
}

export function extractOpenclawSkillMap(manifestInput) {
  const manifest = asRecord(manifestInput) ?? {};
  const candidates = [
    asRecord(manifest.openclaw_skills),
    asRecord(manifest.openclawSkills),
    asRecord(asRecord(manifest.openclaw)?.skills),
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

export function toSkillEntries(manifestInput) {
  const skillMap = extractOpenclawSkillMap(manifestInput);
  return Object.entries(skillMap).map(([domain, content]) => ({
    domain,
    skillName: skillNameFromDomain(domain),
    content,
  }));
}

function resolveDefaults({ projectDir, skillsDir, stateFile }) {
  const resolvedProjectDir = resolve(projectDir ?? process.cwd());
  const resolvedSkillsDir = resolve(
    skillsDir ?? join(resolvedProjectDir, ".claude", DEFAULT_SKILLS_DIRNAME)
  );
  const resolvedStateFile = resolve(
    stateFile ?? join(resolvedProjectDir, ".claude", DEFAULT_STATE_FILENAME)
  );
  return {
    projectDir: resolvedProjectDir,
    skillsDir: resolvedSkillsDir,
    stateFile: resolvedStateFile,
  };
}

export function readSkillPackSyncState(input = {}) {
  const { stateFile } = resolveDefaults(input);
  const parsed = readJson(stateFile);
  if (!parsed || parsed.version !== STATE_VERSION) return null;
  return parsed;
}

function pruneStaleSkillDirs(skillsDir, validDirectories) {
  if (!existsSync(skillsDir)) return;
  const entries = readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (validDirectories.has(entry.name)) continue;
    rmSync(join(skillsDir, entry.name), { recursive: true, force: true });
  }
}

export function writeSyncedSkills({ skillsDir, entries }) {
  mkdirSync(skillsDir, { recursive: true });
  const validDirectories = new Set();
  const files = [];

  for (const entry of entries) {
    const dirName = safeSegment(entry.skillName);
    const skillDir = join(skillsDir, dirName);
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, "SKILL.md");
    writeFileSync(skillPath, entry.content, { encoding: "utf8", mode: 0o600 });
    validDirectories.add(dirName);
    files.push(skillPath);
  }

  pruneStaleSkillDirs(skillsDir, validDirectories);
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
    skills: entries.map((entry) => ({
      domain: entry.domain,
      skill: entry.skillName,
      path: join(safeSegment(entry.skillName), "SKILL.md"),
    })),
  };
}

export async function syncOrgxSkillsFromServer({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  userId,
  packName = DEFAULT_SKILL_PACK_NAME,
  ifNoneMatch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  projectDir,
  skillsDir,
  stateFile,
  fetchImpl = fetch,
}) {
  const key = pickString(apiKey);
  if (!key) {
    throw new Error("ORGX_API_KEY is required for skill sync");
  }

  const resolved = resolveDefaults({ projectDir, skillsDir, stateFile });
  const previous = readSkillPackSyncState(resolved);
  const etagToSend =
    ifNoneMatch === undefined ? pickString(previous?.etag) : pickString(ifNoneMatch);
  const normalizedBaseUrl = pickString(baseUrl, DEFAULT_BASE_URL).replace(/\/+$/, "");
  const name = pickString(packName, DEFAULT_SKILL_PACK_NAME);
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
        skillsDir: resolved.skillsDir,
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
      throw new Error("Skill pack response missing data");
    }

    const entries = toSkillEntries(pack.manifest);
    const files = writeSyncedSkills({
      skillsDir: resolved.skillsDir,
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
      skillsDir: resolved.skillsDir,
      stateFile: resolved.stateFile,
      skillCount: entries.length,
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

export function defaultOrgxSkillsDir(projectDir = process.cwd()) {
  const resolvedProjectDir = resolve(projectDir);
  return join(resolvedProjectDir, ".claude", DEFAULT_SKILLS_DIRNAME);
}

export function describeSkillPaths(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(skillsDir, entry.name, "SKILL.md"));
}
