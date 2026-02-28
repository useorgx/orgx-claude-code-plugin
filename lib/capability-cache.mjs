import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const DEFAULT_CACHE_FILENAME = "orgx-capability-cache.json";
const CACHE_VERSION = 1;
const MAX_CACHE_ENTRIES = 200;
const PROMOTION_MIN_USES = 3;
const PROMOTION_MIN_AVG_SCORE = 80;

function nowIso() {
  return new Date().toISOString();
}

function resolveCachePath(projectDir) {
  return resolve(join(projectDir ?? process.cwd(), ".claude", DEFAULT_CACHE_FILENAME));
}

function emptyCache() {
  return {
    version: CACHE_VERSION,
    updatedAt: nowIso(),
    policies: {},
  };
}

export function readCapabilityCache({ projectDir } = {}) {
  const pathname = resolveCachePath(projectDir);
  if (!existsSync(pathname)) return emptyCache();
  try {
    const parsed = JSON.parse(readFileSync(pathname, "utf8"));
    if (!parsed || typeof parsed !== "object" || parsed.version !== CACHE_VERSION) {
      return emptyCache();
    }
    return parsed;
  } catch {
    return emptyCache();
  }
}

export function writeCapabilityCache(cache, { projectDir } = {}) {
  const pathname = resolveCachePath(projectDir);
  mkdirSync(dirname(pathname), { recursive: true });
  const payload = { ...cache, updatedAt: nowIso() };
  writeFileSync(pathname, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return payload;
}

export function getCachedPolicy(cacheKey, cache) {
  if (!cache?.policies || !cacheKey) return null;
  return cache.policies[cacheKey] ?? null;
}

export function setCachedPolicy(cacheKey, policy, cache) {
  if (!cacheKey || !policy) return cache;
  const existing = cache.policies[cacheKey];
  cache.policies[cacheKey] = {
    ...policy,
    scores: existing?.scores ?? [],
    avgScore: existing?.avgScore ?? 0,
    useCount: (existing?.useCount ?? 0) + 1,
    promotedAt: existing?.promotedAt ?? null,
    lastUsedAt: nowIso(),
  };
  cache.updatedAt = nowIso();
  return cache;
}

export function recordPolicyScore(cacheKey, score, cache) {
  const entry = cache.policies?.[cacheKey];
  if (!entry) return { cache, promoted: false };

  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return { cache, promoted: false };

  entry.scores = [...(entry.scores ?? []), numericScore];
  const sum = entry.scores.reduce((a, b) => a + b, 0);
  entry.avgScore = entry.scores.length > 0 ? sum / entry.scores.length : 0;
  entry.lastUsedAt = nowIso();
  cache.updatedAt = nowIso();

  const promoted =
    !entry.promotedAt &&
    entry.scores.length >= PROMOTION_MIN_USES &&
    entry.avgScore >= PROMOTION_MIN_AVG_SCORE;

  if (promoted) {
    entry.promotedAt = nowIso();
  }

  return { cache, promoted };
}

export function getPromotedPolicies(cache) {
  if (!cache?.policies) return [];
  return Object.entries(cache.policies)
    .filter(([, entry]) => entry.promotedAt != null)
    .map(([key, entry]) => ({ cacheKey: key, ...entry }));
}

export function pruneCache(cache) {
  if (!cache?.policies) return cache;
  const entries = Object.entries(cache.policies);
  if (entries.length <= MAX_CACHE_ENTRIES) return cache;

  const sorted = entries.sort((a, b) => (a[1].avgScore ?? 0) - (b[1].avgScore ?? 0));
  const toRemove = sorted.length - MAX_CACHE_ENTRIES;
  const removeKeys = new Set(sorted.slice(0, toRemove).map(([key]) => key));

  cache.policies = Object.fromEntries(
    entries.filter(([key]) => !removeKeys.has(key))
  );
  cache.updatedAt = nowIso();
  return cache;
}
