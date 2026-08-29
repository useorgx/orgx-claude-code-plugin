import { isDeepStrictEqual } from "node:util";

export const EXPECTED_SESSION_SECURITY = Object.freeze({
  schema_version: "orgx-claude-session-security/v1",
  enforcement_model: "stateless_remote_call",
  authority: Object.freeze({
    source: "current_mcp_response",
    cache: "forbidden",
    stale_response: "reject",
  }),
  cwd: Object.freeze({
    access: "none",
    aliases: "not_applicable",
  }),
  local_state: Object.freeze({
    storage: "none",
    project_paths: "forbidden",
    private_file_mode_if_introduced: "0600",
  }),
  lease: Object.freeze({
    owner: "hosted_mcp_and_native_oauth",
    local_ttl: "none",
    expired: "reject_and_reauthenticate",
  }),
});

export const CURRENT_RESPONSE_ONLY =
  "Use only the result returned by this command's current MCP call.";
export const EXPIRED_AUTHORITY_REJECTION =
  "If the current call reports expired, invalid, or missing authorization, stop and require native OAuth reauthentication.";
export const NO_CWD_AUTHORITY =
  "Do not read, derive, transmit, or use a working-directory or project-path alias as authority.";

function normalizeWhitespace(value) {
  return value.replace(/\s+/gu, " ").trim();
}

export function assertSessionSecurityContract({
  manifestSecurity,
  statusCommand,
  chronicleCommand,
}) {
  if (!isDeepStrictEqual(manifestSecurity, EXPECTED_SESSION_SECURITY)) {
    throw new Error(
      `session_security must equal ${JSON.stringify(EXPECTED_SESSION_SECURITY)}`
    );
  }

  for (const [label, command] of [
    ["orgx-status.md", statusCommand],
    ["orgx-operator-chronicle.md", chronicleCommand],
  ]) {
    const normalizedCommand = normalizeWhitespace(command);
    for (const required of [
      CURRENT_RESPONSE_ONLY,
      EXPIRED_AUTHORITY_REJECTION,
      NO_CWD_AUTHORITY,
    ]) {
      if (!normalizedCommand.includes(normalizeWhitespace(required))) {
        throw new Error(`${label} is missing session security contract: ${required}`);
      }
    }
  }
}
