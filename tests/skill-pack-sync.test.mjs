import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  extractOpenclawSkillMap,
  readSkillPackSyncState,
  syncOrgxSkillsFromServer,
  toSkillEntries,
} from "../lib/skill-pack-sync.mjs";

function makeResponse({ status = 200, body = {}, headers = {} }) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 304 ? "Not Modified" : "OK",
    headers: {
      get(name) {
        return normalizedHeaders[String(name).toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
  };
}

test("extractOpenclawSkillMap reads openclaw_skills manifest field", () => {
  const result = extractOpenclawSkillMap({
    openclaw_skills: {
      engineering: "# Engineering",
      product: { markdown: "# Product" },
    },
  });
  assert.equal(result.engineering, "# Engineering\n");
  assert.equal(result.product, "# Product\n");
});

test("toSkillEntries maps domains to orgx skill names", () => {
  const entries = toSkillEntries({
    openclaw_skills: {
      engineering: "# Engineering",
      operations: "# Operations",
    },
  });
  const names = entries.map((entry) => entry.skillName);
  assert.ok(names.includes("orgx-engineering-agent"));
  assert.ok(names.includes("orgx-operations-agent"));
});

test("syncOrgxSkillsFromServer writes skills and state file", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "orgx-skill-sync-"));
  const calls = [];

  const result = await syncOrgxSkillsFromServer({
    apiKey: "oxk_test",
    baseUrl: "https://www.useorgx.com",
    projectDir,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return makeResponse({
        status: 200,
        headers: { etag: "\"etag-v1\"" },
        body: {
          ok: true,
          data: {
            name: "orgx-agent-suite",
            version: "1.2.3",
            checksum: "abc123",
            updated_at: "2026-02-16T00:00:00.000Z",
            manifest: {
              openclaw_skills: {
                engineering: "# Eng",
                design: "# Design",
              },
            },
          },
        },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.notModified, false);
  assert.ok(existsSync(join(projectDir, ".claude", "orgx-skills", "orgx-engineering-agent", "SKILL.md")));
  assert.ok(existsSync(join(projectDir, ".claude", "orgx-skills", "orgx-design-agent", "SKILL.md")));

  const state = readSkillPackSyncState({ projectDir });
  assert.equal(state.pack.version, "1.2.3");
  assert.equal(state.etag, "\"etag-v1\"");
});

test("syncOrgxSkillsFromServer sends If-None-Match and handles 304", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "orgx-skill-sync-304-"));
  const statePath = join(projectDir, ".claude", "orgx-skill-pack-state.json");
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeFileSync(
    statePath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: "2026-02-16T00:00:00.000Z",
        lastCheckedAt: "2026-02-16T00:00:00.000Z",
        lastError: null,
        etag: "\"etag-prev\"",
        pack: null,
        skills: [],
      },
      null,
      2
    ),
    "utf8"
  );

  let receivedIfNoneMatch = null;
  const result = await syncOrgxSkillsFromServer({
    apiKey: "oxk_test",
    baseUrl: "https://www.useorgx.com",
    projectDir,
    fetchImpl: async (_url, init) => {
      receivedIfNoneMatch = init?.headers?.["If-None-Match"] ?? null;
      return makeResponse({
        status: 304,
        headers: { etag: "\"etag-prev\"" },
      });
    },
  });

  assert.equal(receivedIfNoneMatch, "\"etag-prev\"");
  assert.equal(result.notModified, true);

  const persisted = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(persisted.etag, "\"etag-prev\"");
  assert.equal(persisted.lastError, null);
});
