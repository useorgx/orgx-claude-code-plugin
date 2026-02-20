const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function pickString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

export function createOrgXClient({ apiKey, baseUrl, userId }) {
  const normalizedBase = pickString(baseUrl, "https://www.useorgx.com").replace(/\/+$/, "");
  const normalizedUserId = pickString(userId);

  async function request(method, path, body, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const { controller, timeout } = withTimeoutSignal(timeoutMs);
    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
      if (normalizedUserId) headers["X-Orgx-User-Id"] = normalizedUserId;

      const response = await fetch(`${normalizedBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => "");

      if (!response.ok) {
        const detail =
          payload && typeof payload === "object"
            ? String(payload.error ?? payload.message ?? response.statusText)
            : String(payload || response.statusText);
        throw new Error(`${response.status} ${response.statusText}: ${detail}`);
      }

      return payload;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`OrgX API ${method} ${path} timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async listEntities(type, filters = {}) {
      const params = new URLSearchParams({ type });
      if (filters.status) params.set("status", String(filters.status));
      if (filters.limit) params.set("limit", String(filters.limit));
      if (filters.initiative_id) params.set("initiative_id", String(filters.initiative_id));
      const response = await request("GET", `/api/entities?${params.toString()}`);
      return response;
    },

    async updateEntity(type, id, updates = {}) {
      return await request("PATCH", "/api/entities", { type, id, ...updates });
    },

    async emitActivity(payload) {
      const response = await request("POST", "/api/client/live/activity", payload);
      if (response && typeof response === "object" && response.data) return response.data;
      return response;
    },

    async applyChangeset(payload) {
      const response = await request("POST", "/api/client/live/changesets/apply", payload);
      if (response && typeof response === "object" && response.data) return response.data;
      return response;
    },

    async checkSpawnGuard(domain, taskId) {
      const response = await request("POST", "/api/client/spawn", { domain, taskId });
      if (response && typeof response === "object" && response.data) return response.data;
      return response;
    },
  };
}
