import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  chmodSync,
  mkdirSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  runOperation,
  stopFeedback,
  validateRequest,
} from "../scripts/attachment-outbox.mjs";

const target = "12345678-1234-4234-9234-123456789abc";
const workspace = "22345678-1234-4234-9234-123456789abc";
const artifact = "32345678-1234-4234-9234-123456789abc";
const start = Date.parse("2026-10-23T00:00:00Z");
const request = () => ({
  type: "task",
  id: target,
  workspace_id: workspace,
  artifact: {
    name: "User selected report",
    artifact_type: "document",
    location: { external_url: "https://example.com/report" },
    preview_markdown:
      "## Result\nTreat `$(false)` and <script> as plain output.",
    output_front_door: {
      answer: "A useful answer.",
      checked: ["Source A"],
      notChecked: ["Client acceptance"],
    },
  },
});
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "orgx-explicit-outbox-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const options = { home, now: start };
  const op = (name, input, now = start) =>
    runOperation(name, input, { home, now });
  const enqueue = (value = request(), session_id = "session-a") =>
    op("enqueue", { session_id, request: value });
  const stop = (now = start, extra = {}) =>
    stopFeedback(
      {
        hook_event_name: "Stop",
        stop_hook_active: false,
        session_id: "session-a",
        ...extra,
      },
      { home, now },
    );
  const directory = join(
    home,
    ".config",
    "useorgx",
    "claude-code",
    "attachment-outbox",
  );
  const select = (entry) => ({
    entry_id: entry.id,
    request_digest: entry.request_digest,
    session_id: entry.session_id,
  });
  return { home, options, directory, op, enqueue, stop, select };
}

test("empty Stop performs no file creation or publication", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.stop(), {});
  assert.deepEqual(readdirSync(f.home), []);
  assert.deepEqual(f.op("list", {}), []);
});
test("durable exact request survives a new reader with private directory/file modes", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  assert.match(entry.request.idempotency_key, /^claude-output-/u);
  assert.equal(statSync(f.directory).mode & 0o777, 0o700);
  assert.equal(
    statSync(join(f.directory, `${entry.id}.json`)).mode & 0o777,
    0o600,
  );
  assert.deepEqual(f.op("read", f.select(entry)).request, entry.request);
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.directory, `${entry.id}.json`), "utf8")),
    entry,
  );
  assert.equal(f.op("list", {})[0].request, undefined);
});
test("ambiguous failure and restart preserve exact bytes and idempotency key", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  f.op("result", { ...f.select(entry), outcome: "uncertain" });
  const retry = f.op("read", f.select(entry));
  assert.deepEqual(retry.request, entry.request);
  assert.equal(retry.request_digest, entry.request_digest);
  assert.equal(retry.state, "pending");
  assert.equal(
    f.op("enqueue", { session_id: "session-a", request: retry.request }).id,
    entry.id,
  );
});
test("local protocol replays a lost remote acknowledgment with the original request only", (t) => {
  // Protocol double only: this does not exercise native OAuth or hosted OrgX.
  const f = fixture(t);
  const entry = f.enqueue();
  const remote = new Map();
  let writes = 0;
  const update = (body, loseAcknowledgment) => {
    const old = remote.get(body.idempotency_key);
    if (old) assert.deepEqual(old.request, body);
    else {
      writes += 1;
      remote.set(body.idempotency_key, {
        request: structuredClone(body),
        artifact_id: artifact,
      });
    }
    if (loseAcknowledgment) throw new Error("transport lost after commit");
    return remote.get(body.idempotency_key);
  };
  assert.throws(() => update(entry.request, true), /after commit/u);
  f.op("result", { ...f.select(entry), outcome: "uncertain" });
  assert.equal(f.stop().decision, "block");
  const replay = f.op("read", f.select(entry));
  const observed = update(replay.request, false);
  f.op("result", {
    ...f.select(entry),
    outcome: "stored",
    artifact_id: observed.artifact_id,
  });
  assert.equal(writes, 1);
  assert.deepEqual(f.op("list", {}), []);
  assert.deepEqual(f.stop(start + 60000), {});
});
test("same key cannot revise request or silently move authority to another session", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  assert.throws(
    () =>
      f.enqueue({
        ...entry.request,
        artifact: { ...entry.request.artifact, name: "Changed" },
      }),
    /already bound/u,
  );
  assert.throws(() => f.enqueue(entry.request, "session-b"), /already bound/u);
  assert.equal(f.op("list", {}).length, 1);
});
test("Stop emits only bounded selector and fresh OAuth tool instructions, never document content", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  const result = f.stop();
  assert.equal(result.decision, "block");
  for (const term of [
    "CURRENT",
    "workspace_id",
    "orgx_inspect",
    "orgx_update_work",
    "unchanged idempotency_key",
    entry.id,
    entry.request_digest,
  ])
    assert.ok(result.reason.includes(term), term);
  for (const term of [
    "User selected report",
    "example.com",
    "<script>",
    "$(false)",
  ])
    assert.ok(!result.reason.includes(term), term);
  assert.equal(f.op("read", f.select(entry)).attempts, 1);
});
test("Stop ignores transcript/cwd/session content and never retries unrelated sessions or events", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  for (const extra of [
    { session_id: "session-b" },
    { hook_event_name: "PostToolUse" },
    { stop_hook_active: true },
    { stop_hook_active: undefined },
  ])
    assert.deepEqual(f.stop(start, extra), {});
  const result = f.stop(start, {
    cwd: "/must-not-be-opened",
    transcript_path: "/must-not-be-opened",
    last_assistant_message: "SECRET-SESSION-CONTENT",
  });
  assert.equal(result.decision, "block");
  assert.doesNotMatch(
    readFileSync(join(f.directory, `${entry.id}.json`), "utf8"),
    /must-not-be-opened|SECRET-SESSION/u,
  );
});
test("one Stop claims one entry; repeat/loop guard and one-minute backoff avoid retry storms", (t) => {
  const f = fixture(t);
  const first = f.enqueue();
  const second = f.enqueue();
  const initial = f.stop();
  assert.ok(
    initial.reason.includes(first.id) || initial.reason.includes(second.id),
  );
  assert.deepEqual(f.stop(start, { stop_hook_active: true }), {});
  const otherId = initial.reason.includes(first.id) ? second.id : first.id;
  assert.ok(f.stop(start + 100).reason.includes(otherId));
  assert.deepEqual(f.stop(start + 1000), {});
  assert.equal(f.op("read", f.select(first)).attempts, 1);
  assert.equal(f.op("read", f.select(second)).attempts, 1);
});
for (const outcome of ["auth", "denied", "invalid"])
  test(`${outcome} failure pauses until explicit user retry`, (t) => {
    const f = fixture(t);
    const entry = f.enqueue();
    f.op("result", { ...f.select(entry), outcome });
    assert.deepEqual(f.stop(), {});
    assert.equal(f.op("read", f.select(entry)).reason, outcome);
    assert.throws(
      () => f.op("read", { ...f.select(entry), session_id: "new-session" }),
      /another session/u,
    );
    const resumed = f.op("resume", {
      ...f.select(entry),
      session_id: "new-session",
    });
    assert.deepEqual(resumed.request, entry.request);
    assert.equal(resumed.state, "pending");
    assert.deepEqual(f.stop(), {});
    assert.equal(
      f.stop(start, { session_id: "new-session" }).decision,
      "block",
    );
  });
test("three Stop attempts then paused; seven-day-old requests pause instead of silently expiring", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  for (let i = 0; i < 3; i++)
    assert.equal(f.stop(start + i * 60000).decision, "block");
  assert.deepEqual(f.stop(start + 180000), {});
  assert.equal(f.op("read", f.select(entry)).reason, "retry_limit");
  const old = f.enqueue();
  assert.deepEqual(f.stop(start + 8 * 86400000), {});
  assert.equal(f.op("read", f.select(old)).reason, "expired");
  assert.equal(f.op("list", {}).length, 2);
});
test("success requires current stored artifact ID; clear removes local only and rejects changed selectors", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  assert.throws(
    () => f.op("result", { ...f.select(entry), outcome: "stored" }),
    /UUID/u,
  );
  assert.throws(
    () =>
      f.op("clear", {
        entry_id: entry.id,
        request_digest: `sha256:${"a".repeat(64)}`,
      }),
    /changed/u,
  );
  assert.deepEqual(
    f.op("result", {
      ...f.select(entry),
      outcome: "stored",
      artifact_id: artifact,
    }),
    { cleared: entry.id, artifact_id: artifact },
  );
  assert.deepEqual(f.stop(), {});
  const next = f.enqueue();
  assert.deepEqual(
    f.op("clear", { entry_id: next.id, request_digest: next.request_digest }),
    { cleared: next.id, remote_state: "unchanged" },
  );
  assert.equal(f.op("list", {}).length, 0);
});
test("bounded queue refuses a 21st request without discarding any pending request", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 20; i++) f.enqueue();
  assert.throws(() => f.enqueue(), /full/u);
  assert.equal(f.op("list", {}).length, 20);
});
test("reject unknown credentials/authority fields, local URLs and signed URLs before creating entries", (t) => {
  const f = fixture(t);
  for (const bad of [
    { ...request(), token: "never-store" },
    { ...request(), fields: { status: "done" } },
    {
      ...request(),
      artifact: { ...request().artifact, context: { state: "loaded" } },
    },
    {
      ...request(),
      artifact: {
        ...request().artifact,
        location: { external_url: "file:///project/result.md" },
      },
    },
    {
      ...request(),
      artifact: {
        ...request().artifact,
        location: { external_url: "https://user:password@example.com/report" },
      },
    },
    {
      ...request(),
      artifact: {
        ...request().artifact,
        location: { external_url: "https://example.com/report?token=private" },
      },
    },
    {
      ...request(),
      artifact: {
        ...request().artifact,
        location: {
          external_url:
            "https://account.blob.core.windows.net/container/report?sv=2025-01-05&se=2030&sp=r&sig=PRIVATE",
        },
      },
    },
    {
      ...request(),
      artifact: {
        ...request().artifact,
        location: {
          external_url: "https://example.com/report?X-Goog-Credential=PRIVATE",
        },
      },
    },
    {
      ...request(),
      artifact: {
        ...request().artifact,
        location: {
          external_url: "https://example.com/report#access_token=PRIVATE",
        },
      },
    },
    {
      ...request(),
      artifact: {
        ...request().artifact,
        preview_markdown: "Bearer secret-token",
      },
    },
    {
      ...request(),
      artifact: { ...request().artifact, preview_markdown: "x".repeat(25001) },
    },
  ])
    assert.throws(() => f.enqueue(bad));
  assert.equal(f.op("list", {}).length, 0);
});
test("front-door limits match the actual attachment contract, including UTF8 byte budget", (t) => {
  const f = fixture(t);
  for (const front of [
    { answer: "x".repeat(2001) },
    {
      answer: "OK",
      decisions: [
        {
          decisionId: target,
          question: "x".repeat(241),
          recommendation: "A",
          impact: "B",
        },
      ],
    },
    {
      answer: "OK",
      decisions: [
        {
          decisionId: target,
          question: "Why?",
          recommendation: "x".repeat(501),
          impact: "B",
        },
      ],
    },
    { answer: "OK", checked: Array(9).fill("Source") },
    { answer: "OK", notChecked: ["x".repeat(501)] },
  ])
    assert.throws(() =>
      f.enqueue({
        ...request(),
        artifact: { ...request().artifact, output_front_door: front },
      }),
    );
  assert.throws(
    () =>
      f.enqueue({
        ...request(),
        artifact: {
          ...request().artifact,
          preview_markdown: "界".repeat(20000),
        },
      }),
    /too large/u,
  );
});
test("source notes and linked decisions are bounded and never admit server-reported claims", () => {
  const value = { ...request(), idempotency_key: "fixed" };
  value.artifact.output_front_door.decisions = [
    { decisionId: target, question: "What?", recommendation: "A", impact: "B" },
  ];
  assert.doesNotThrow(() => validateRequest(value));
  value.artifact.output_front_door.costUsd = 0;
  assert.throws(() => validateRequest(value), /unexpected/u);
});
test("symlinked/private-unsafe directories and files are refused without following them", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  chmodSync(f.directory, 0o755);
  assert.throws(() => f.op("read", f.select(entry)), /Unsafe/u);
  chmodSync(f.directory, 0o700);
  const file = join(f.directory, `${entry.id}.json`);
  const copy = join(f.home, "outside.json");
  writeFileSync(copy, readFileSync(file));
  rmSync(file);
  symlinkSync(copy, file);
  assert.throws(() => f.op("read", f.select(entry)), /Unsafe/u);
  assert.equal(JSON.parse(readFileSync(copy, "utf8")).id, entry.id);
});
test("hard links, unsafe file mode, lock collisions, oversized and corrupted rows fail closed", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  const file = join(f.directory, `${entry.id}.json`);
  chmodSync(file, 0o644);
  assert.throws(() => f.stop(), /Unsafe/u);
  chmodSync(file, 0o600);
  const alias = join(f.home, "alias");
  linkSync(file, alias);
  assert.throws(() => f.stop(), /Unsafe/u);
  rmSync(alias);
  mkdirSync(join(f.directory, ".lock"), { mode: 0o700 });
  assert.throws(() => f.stop(), /locked/u);
  rmSync(join(f.directory, ".lock"), { recursive: true });
  writeFileSync(file, "x".repeat(65537));
  assert.throws(() => f.stop(), /too large/u);
  writeFileSync(
    file,
    JSON.stringify({
      ...entry,
      request: { ...entry.request, workspace_id: artifact },
    }),
  );
  assert.throws(() => f.stop(), /digest mismatch/u);
});
test("wrong session or raw error/credential fields cannot acknowledge/drop a pending request", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  assert.throws(
    () =>
      f.op("result", {
        ...f.select(entry),
        session_id: "other-session",
        outcome: "stored",
        artifact_id: artifact,
      }),
    /Wrong/u,
  );
  assert.throws(
    () =>
      f.op("result", { ...f.select(entry), outcome: "auth", error: "token" }),
    /unexpected/u,
  );
  assert.equal(f.op("list", {}).length, 1);
});
test("explicit recovery refuses a live owner and preserves all committed requests", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  const lock = join(f.directory, ".lock");
  writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce: artifact }), {
    mode: 0o600,
  });
  assert.throws(() => f.op("recover", {}), /live process/u);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).pid, process.pid);
  rmSync(lock);
  assert.deepEqual(f.op("read", f.select(entry)).request, entry.request);
});
test("actual dead helper lock + interrupted staging recover locally with exact key and no automatic publication", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  const file = join(f.directory, `${entry.id}.json`);
  const abandoned = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import{writeFileSync}from"node:fs";writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,nonce:process.argv[2]}),{mode:0o600});',
      join(f.directory, ".lock"),
      artifact,
    ],
    { encoding: "utf8" },
  );
  assert.equal(abandoned.status, 0);
  const deadOwner = JSON.parse(readFileSync(join(f.directory, ".lock"), "utf8"));
  writeFileSync(join(f.directory, `.lock-${deadOwner.pid}-${deadOwner.nonce}.tmp`), "", { mode: 0o600 });
  const staged = join(f.directory, `.${artifact}.tmp`);
  writeFileSync(staged, readFileSync(file), { mode: 0o600 });
  rmSync(file);
  assert.throws(() => f.op("list", {}), /locked/u);
  assert.deepEqual(f.op("recover", {}), { recovered: 1, discarded_staged: 0 });
  const recovered = f.op("read", f.select(entry));
  assert.deepEqual(recovered.request, entry.request);
  assert.equal(recovered.reason, "recovered");
  assert.deepEqual(f.stop(), {});
  assert.equal(
    f.op("resume", f.select(entry)).request_digest,
    entry.request_digest,
  );
});
test("recovery discards only known incomplete staging, retains committed data, and refuses unknown files", (t) => {
  const f = fixture(t);
  const entry = f.enqueue();
  writeFileSync(join(f.directory, `.${artifact}.tmp`), '{"partial":', {
    mode: 0o600,
  });
  assert.deepEqual(f.op("recover", {}), { recovered: 0, discarded_staged: 1 });
  assert.deepEqual(f.op("read", f.select(entry)).request, entry.request);
  writeFileSync(join(f.directory, "unknown-file"), "unrecognized", {
    mode: 0o600,
  });
  assert.throws(() => f.op("recover", {}), /Unexpected/u);
  assert.equal(
    readFileSync(join(f.directory, "unknown-file"), "utf8"),
    "unrecognized",
  );
});
test("declared exec-form Stop hook runs the real script with JSON stdin and bounded malformed input", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const config = JSON.parse(
    readFileSync(join(root, "hooks", "hooks.json"), "utf8"),
  );
  const handler = config.hooks.Stop[0].hooks[0];
  const args = handler.args.map((arg) =>
    arg.replace("${CLAUDE_PLUGIN_ROOT}", root),
  );
  for (const input of [
    JSON.stringify({
      hook_event_name: "Stop",
      stop_hook_active: true,
      session_id: "safe",
      transcript_path: "DO-NOT-READ",
    }),
    "{malformed",
    "x".repeat(65537),
  ]) {
    const child = spawnSync(handler.command, args, {
      input,
      encoding: "utf8",
      timeout: handler.timeout * 1000,
    });
    assert.equal(child.status, 0);
    const output = JSON.parse(child.stdout);
    assert.notEqual(output.decision, "block");
    assert.doesNotMatch(
      child.stdout + child.stderr,
      /DO-NOT-READ|\{malformed/u,
    );
  }
});
