import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  extractOpenclawAgentMap,
  defaultOrgxAgentsDir,
  readAgentPackSyncState,
  syncOrgxAgentProfilesFromServer,
  toAgentEntries,
} from "../lib/agent-profile-sync.mjs";

function makeResponse({ status = 200, body = {}, headers = {} }) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
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

test("extractOpenclawAgentMap reads openclaw_agents manifest field", () => {
  const result = extractOpenclawAgentMap({
    openclaw_agents: {
      engineering: "# Engineering Agent",
      design: { markdown: "# Design Agent" },
    },
  });
  assert.equal(result.engineering, "# Engineering Agent\n");
  assert.equal(result.design, "# Design Agent\n");
});

test("toAgentEntries falls back to skill domains and writes frontmatter", () => {
  const entries = toAgentEntries({
    openclaw_skills: {
      engineering: "# Engineering Skill",
      orchestration: "# Orchestration Skill",
    },
  });
  const names = entries.map((entry) => entry.baseName);
  assert.ok(names.includes("orgx-engineering"));
  assert.ok(names.includes("orgx-orchestrator"));
  const engineering = entries.find((entry) => entry.baseName === "orgx-engineering");
  assert.ok(engineering.content.startsWith("---\nname: orgx-engineering\n"));
});

test("syncOrgxAgentProfilesFromServer writes agent profiles and state", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "orgx-agent-sync-"));
  const result = await syncOrgxAgentProfilesFromServer({
    apiKey: "oxk_test",
    baseUrl: "https://www.useorgx.com",
    projectDir,
    fetchImpl: async () =>
      makeResponse({
        status: 200,
        headers: { etag: "\"agent-etag-v1\"" },
        body: {
          ok: true,
          data: {
            name: "orgx-agent-suite",
            version: "1.0.0",
            checksum: "abc123",
            updated_at: "2026-02-27T00:00:00.000Z",
            manifest: {
              openclaw_skills: {
                engineering: "# Eng Skill",
                product: "# Product Skill",
              },
            },
          },
        },
      }),
  });

  const agentsDir = defaultOrgxAgentsDir(projectDir);
  assert.equal(result.notModified, false);
  assert.ok(existsSync(join(agentsDir, "orgx-engineering.md")));
  assert.ok(existsSync(join(agentsDir, "orgx-product.md")));

  const state = readAgentPackSyncState({ projectDir });
  assert.equal(state.pack.version, "1.0.0");
  assert.equal(state.etag, "\"agent-etag-v1\"");
  assert.ok(Array.isArray(state.agents));
  assert.ok(state.agents.length >= 2);
});

test("syncOrgxAgentProfilesFromServer sends If-None-Match and handles 304", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "orgx-agent-sync-304-"));
  const claudeDir = join(projectDir, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const statePath = join(claudeDir, "orgx-agent-pack-state.json");
  writeFileSync(
    statePath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: "2026-02-27T00:00:00.000Z",
        lastCheckedAt: "2026-02-27T00:00:00.000Z",
        lastError: null,
        etag: "\"agent-etag-prev\"",
        pack: null,
        agents: [],
      },
      null,
      2
    ),
    "utf8"
  );

  let receivedIfNoneMatch = null;
  const result = await syncOrgxAgentProfilesFromServer({
    apiKey: "oxk_test",
    baseUrl: "https://www.useorgx.com",
    projectDir,
    fetchImpl: async (_url, init) => {
      receivedIfNoneMatch = init?.headers?.["If-None-Match"] ?? null;
      return makeResponse({
        status: 304,
        headers: { etag: "\"agent-etag-prev\"" },
      });
    },
  });

  assert.equal(receivedIfNoneMatch, "\"agent-etag-prev\"");
  assert.equal(result.notModified, true);

  const persisted = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(persisted.etag, "\"agent-etag-prev\"");
  assert.equal(persisted.lastError, null);
});
