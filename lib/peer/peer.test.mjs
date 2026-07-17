/**
 * ClaudeCodeDriver tests. We swap PATH to prepend a temp directory
 * containing a fake `claude` shim, so spawn('claude', …) hits our
 * shim. The shim emits a scripted NDJSON stream on stdout based on
 * the $CLAUDE_FIXTURE env var.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

import { ClaudeCodeDriver } from './ClaudeCodeDriver.mjs';
import { writeAttentionBundle } from './attentionState.mjs';
import { startPeer, summarizeTransportError } from './peer.mjs';

const NOW = '2026-07-15T12:00:00.000Z';

let workdir;
let originalPath;

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'ccp-peer-test-'));
  const fixtures = {
    SUCCESS_TRACE: [
      JSON.stringify({ kind: 'tool_call', tool: 'read_file', summary: 'tests/billing.py' }),
      JSON.stringify({
        kind: 'file_edit',
        path: 'tests/billing.py',
        summary: 'replaced class-based with @pytest.mark.parametrize',
      }),
      JSON.stringify({ kind: 'tokens_used', delta: 3400 }),
      JSON.stringify({ kind: 'assistant_completed', tokens_used: 3400 }),
    ].join('\n'),
    NATIVE_SUCCESS_TRACE: [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'ORGX_NOOP_OK' }],
        },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'ORGX_NOOP_OK',
        usage: {
          input_tokens: 2,
          output_tokens: 14,
          cache_creation_input_tokens: 120,
          cache_read_input_tokens: 30,
        },
      }),
    ].join('\n'),
    ERROR_TRACE: [
      JSON.stringify({ kind: 'error', message: 'session interrupted', recoverable: true }),
    ].join('\n'),
    DEFERRED_TRACE: [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'claude-session-1',
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'tool_deferred',
        is_error: false,
        session_id: 'claude-session-1',
      }),
    ].join('\n'),
    VERSION_ONLY: '',
  };

  const shim = `#!/usr/bin/env node
const fixture = process.env.CLAUDE_FIXTURE;
const traces = ${JSON.stringify(fixtures)};
if (process.argv.includes('--version')) {
  process.stdout.write('claude 1.2.3\\n');
  process.exit(0);
}
if (
  process.argv[2] === 'auth' &&
  process.argv[3] === 'status' &&
  process.argv.includes('--json')
) {
  process.stdout.write(JSON.stringify({
    loggedIn: process.env.CLAUDE_AUTH !== 'signed-out',
    subscriptionType: process.env.CLAUDE_AUTH === 'signed-out' ? null : 'max',
    authMethod: process.env.CLAUDE_AUTH === 'signed-out' ? null : 'claude.ai',
  }) + '\\n');
  process.exit(0);
}
const trace = traces[fixture] || '';
if (!trace) { process.exit(0); }
process.stdout.write(trace + '\\n');
process.exit(0);
`;

  const shimPath = join(workdir, 'claude');
  await writeFile(shimPath, shim);
  await chmod(shimPath, 0o755);

  originalPath = process.env.PATH;
  process.env.PATH = `${workdir}:${originalPath}`;
});

after(async () => {
  process.env.PATH = originalPath;
  await rm(workdir, { recursive: true, force: true });
});

async function collect(generator) {
  const out = [];
  for await (const msg of generator) out.push(msg);
  return out;
}

it('summarizes transport failures without retaining authorization internals', () => {
  const summary = summarizeTransportError({
    name: 'ErrorEvent',
    message: 'Unexpected server response: 401 Bearer oxk_test_secret',
    target: {
      request: {
        header: 'Sec-WebSocket-Protocol: orgx.v1,bearer.oxk_test_secret',
      },
    },
  });

  assert.deepEqual(summary, {
    name: 'ErrorEvent',
    message: 'Unexpected server response: 401 Bearer [redacted]',
  });
  assert.doesNotMatch(JSON.stringify(summary), /test_secret/);
});

describe('ClaudeCodeDriver', () => {
  it('detect reports installed + authenticated from the auth status contract', async () => {
    process.env.CLAUDE_FIXTURE = 'VERSION_ONLY';
    process.env.CLAUDE_AUTH = 'max';
    const d = new ClaudeCodeDriver();
    const s = await d.detect();
    assert.equal(s.installed, true);
    assert.equal(s.authenticated, true);
    assert.equal(s.subscription_active, true);
    assert.equal(s.subscription_type, 'max');
    assert.equal(s.auth_method, 'claude.ai');
    assert.equal(s.auth_status, 'authenticated');
    assert.match(s.version, /claude 1\.2\.3/);
  });

  it('does not infer authentication from a working version command', async () => {
    process.env.CLAUDE_AUTH = 'signed-out';
    const d = new ClaudeCodeDriver();
    const detected = await d.detect();
    const probe = await d.probe();

    assert.equal(detected.installed, true);
    assert.equal(detected.authenticated, false);
    assert.equal(detected.subscription_active, false);
    assert.equal(detected.auth_status, 'sign_in_required');
    assert.equal(probe.session_alive, true);
    assert.equal(probe.dispatch_ready, false);
  });

  it('dispatch yields task.started → task.step → task.completed on a success trace', async () => {
    process.env.CLAUDE_FIXTURE = 'SUCCESS_TRACE';
    process.env.CLAUDE_AUTH = 'max';
    const d = new ClaudeCodeDriver({ skillRules: async () => [] });
    const msgs = await collect(
      d.dispatch(
        { title: 'refactor tests', driver: 'claude_code' },
        { run_id: 'r1', idempotency_key: 'k1' }
      )
    );
    const kinds = msgs.map((m) => m.kind);
    assert.ok(kinds.includes('task.started'), 'expected task.started');
    assert.equal(kinds.filter((k) => k === 'task.step').length, 2);
    assert.equal(kinds[kinds.length - 1], 'task.completed');
    const completed = msgs.at(-1);
    assert.equal(completed.provider, 'anthropic');
    assert.equal(completed.source_sub_type, 'subscription');
    assert.equal(completed.source_driver, 'claude_code');
    assert.equal(completed.tokens_used, 3400);
  });

  it('dispatch emits task.deviation when a skill rule matches a file_edit', async () => {
    process.env.CLAUDE_FIXTURE = 'SUCCESS_TRACE';
    const d = new ClaudeCodeDriver({
      skillRules: async () => [
        {
          skill_id: 'parametrize-tests',
          match: { pattern: 'parametrize', on: 'file_edit' },
          dedupe_fingerprint: 'parametrize-tests-v1',
          evidence_kind: 'test_style_shift',
        },
      ],
    });
    const msgs = await collect(
      d.dispatch(
        { title: 'refactor tests', driver: 'claude_code' },
        { run_id: 'r1', idempotency_key: 'k1' }
      )
    );
    const deviations = msgs.filter((m) => m.kind === 'task.deviation');
    assert.equal(deviations.length, 1);
    assert.equal(deviations[0].skill_id, 'parametrize-tests');
    assert.equal(deviations[0].evidence_kind, 'test_style_shift');
  });

  it('parses the native Claude stream-json result into a terminal receipt', async () => {
    process.env.CLAUDE_FIXTURE = 'NATIVE_SUCCESS_TRACE';
    const d = new ClaudeCodeDriver({ skillRules: async () => [] });
    const msgs = await collect(
      d.dispatch(
        { title: 'no-op', driver: 'claude_code' },
        { run_id: 'native-1', idempotency_key: 'native-k1' }
      )
    );
    const completed = msgs.at(-1);
    assert.equal(completed.kind, 'task.completed');
    assert.equal(completed.tokens_used, 166);
    assert.equal(completed.source_driver, 'claude_code');
  });

  it('dispatch emits task.failed on an error event', async () => {
    process.env.CLAUDE_FIXTURE = 'ERROR_TRACE';
    const d = new ClaudeCodeDriver({ skillRules: async () => [] });
    const msgs = await collect(
      d.dispatch(
        { title: 'anything', driver: 'claude_code' },
        { run_id: 'r1', idempotency_key: 'k1' }
      )
    );
    const failed = msgs.find((m) => m.kind === 'task.failed');
    assert.ok(failed, 'expected task.failed');
    assert.equal(failed.recoverable, true);
  });

  it('dispatch preserves a deferred AskUserQuestion without manufacturing a failure', async () => {
    process.env.CLAUDE_FIXTURE = 'DEFERRED_TRACE';
    const d = new ClaudeCodeDriver({ skillRules: async () => [] });
    const msgs = await collect(
      d.dispatch(
        {
          title: 'choose direction',
          driver: 'claude_code',
          initiative_id: 'initiative-1',
        },
        { run_id: 'deferred-1', idempotency_key: 'deferred-k1' }
      )
    );
    assert.equal(msgs.at(-1).kind, 'task.suspended');
    assert.equal(msgs.at(-1).reason, 'attention');
    assert.equal(msgs.at(-1).session_handle, 'claude-session-1');
    assert.equal(msgs.some((message) => message.kind === 'task.failed'), false);
  });

  it('restores the exact Claude session and emits continuation plus terminal proof', async () => {
    const stateDir = join(workdir, 'attention-state');
    const env = { ...process.env, ORGX_ATTENTION_STATE_DIR: stateDir };
    await writeAttentionBundle(
      {
        session_id: 'claude-session-1',
        initiative_id: 'initiative-1',
        decision_ids: ['decision-1'],
        questions: [
          {
            decision_id: 'decision-1',
            prompt: 'Which direction?',
            index: 0,
          },
        ],
      },
      env
    );
    process.env.CLAUDE_FIXTURE = 'NATIVE_SUCCESS_TRACE';
    env.CLAUDE_FIXTURE = 'NATIVE_SUCCESS_TRACE';
    const d = new ClaudeCodeDriver({ env, skillRules: async () => [] });
    const messages = await collect(
      d.resolveAttention({
        kind: 'attention.resolve',
        protocol_version: 3,
        decision_id: 'decision-1',
        run_id: 'deferred-1',
        driver: 'claude_code',
        session_handle: 'claude-session-1',
        idempotency_key: 'attention:decision-1:resolve',
        resolution: {
          status: 'approved',
          answer: 'Use the signal frame.',
        },
      })
    );
    assert.deepEqual(
      messages.map((message) => message.state ?? message.kind),
      ['resuming', 'resumed', 'task.completed']
    );
    assert.equal(messages.at(-1).source_driver, 'claude_code');
  });
});

it('peer opens the gateway socket, advertises Claude, heartbeats, and returns a receipt', async (t) => {
  const heartbeats = [];
  const messages = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/api/v1/gateway/heartbeat') {
      let body = '';
      for await (const chunk of request) body += chunk;
      heartbeats.push(JSON.parse(body));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    sockets.handleUpgrade(request, socket, head, (peer) => {
      sockets.emit('connection', peer, request);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => sockets.close(() => server.close(resolve))));
  const port = server.address().port;

  const terminal = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('peer receipt timed out')), 5_000);
    sockets.once('connection', (socket, request) => {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      assert.equal(url.searchParams.get('plugin_id'), 'orgx-claude-code-plugin');
      assert.equal(url.searchParams.get('drivers'), 'claude_code');
      assert.equal(url.searchParams.get('installation_id'), 'claude-e2e-install');
      assert.equal(url.searchParams.get('runner_instance_id'), 'claude-e2e-runner');
      assert.equal(url.searchParams.get('activation_attempt_id'), null);
      assert.equal(url.searchParams.get('runner_role'), null);
      assert.match(request.headers['sec-websocket-protocol'] ?? '', /orgx\.v3/);
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        messages.push(message);
        if (message.kind === 'task.completed') {
          clearTimeout(timeout);
          resolve(message);
        }
      });
      socket.send(JSON.stringify({
        kind: 'task.dispatch',
        run_id: 'claude-peer-e2e',
        idempotency_key: 'claude-peer-e2e-key',
        timeout_seconds: 30,
        task: { title: 'no-op', driver: 'claude_code' },
      }));
    });
  });
  const fakeDriver = {
    id: 'claude_code',
    running: new Map(),
    detect: async () => ({
      installed: true,
      authenticated: true,
      subscription_active: true,
      subscription_type: 'max',
      auth_method: 'claude.ai',
      auth_status: 'authenticated',
      version: 'claude-e2e',
    }),
    probe: async () => ({ subscription_active: true, session_alive: true, dispatch_ready: true }),
    cancel: async () => undefined,
    async *dispatch(_task, context) {
      const now = new Date().toISOString();
      yield { kind: 'task.started', run_id: context.run_id, started_at: now };
      yield {
        kind: 'task.completed',
        run_id: context.run_id,
        outcome_kind: 'shipped',
        started_at: now,
        completed_at: now,
        tokens_used: 1,
        provider: 'anthropic',
        source_sub_type: 'subscription',
        source_driver: 'claude_code',
        cost_estimate_cents: 0,
      };
    },
  };
  const peer = await startPeer({
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: 'oxk_test_only',
    workspaceId: 'workspace-e2e',
    installationId: 'claude-e2e-install',
    runnerInstanceId: 'claude-e2e-runner',
    activationAttemptId: 'activation-e2e-attempt',
    runnerRole: 'candidate',
    driver: fakeDriver,
    skipHeartbeat: true,
    mcpEndpoint: 'https://mcp.useorgx.com/mcp',
    continuityOutbox: {
      state: 'ready',
      pending: 0,
      dead_letters: 0,
      last_replay_at: NOW,
    },
  });
  const receipt = await terminal;
  await waitFor(() => heartbeats.at(-1)?.metadata?.dispatch_ready === true);
  await peer.stop();

  assert.equal(receipt.source_driver, 'claude_code');
  assert.deepEqual(messages.map((message) => message.kind), ['task.started', 'task.completed']);
  assert.equal(heartbeats.at(-1)?.metadata?.transport_online, true);
  assert.equal(heartbeats.at(-1)?.metadata?.dispatch_ready, true);
  assert.equal(heartbeats.at(-1)?.runner_instance_id, 'claude-e2e-runner');
  assert.equal(
    heartbeats.at(-1)?.activation_attempt_id,
    'activation-e2e-attempt',
  );
  assert.equal(heartbeats.at(-1)?.runner_role, 'candidate');
  assert.deepEqual(heartbeats.at(-1)?.metadata?.continuity_health, {
    schema_version: 'plugin-health.v1',
    endpoint: 'https://mcp.useorgx.com/mcp',
    auth_state: 'authenticated',
    release: { installed: '0.1.9', source: '0.1.9', deployed: '0.1.9' },
    hooks: {
      reported: 4,
      expected: 4,
      terminal_passive: true,
      events: ['SessionStart', 'PostToolUse', 'SubagentStop', 'Stop'],
    },
    outbox: {
      state: 'ready',
      pending: 0,
      dead_letters: 0,
      last_replay_at: NOW,
    },
    capabilities: {
      profile: 'claude-code',
      profile_tools: 33,
      manifest_tools: 33,
      inspectable_entities: 20,
      visible_entities: 20,
    },
    last_receipt_at: NOW,
  });
  assert.equal(heartbeats.at(-1)?.protocol_version, 3);
});

it('rejects invalid or incomplete activation identity before opening transport', async () => {
  await assert.rejects(
    startPeer({
      apiKey: 'oxk_test_only',
      workspaceId: 'workspace-invalid',
      runnerInstanceId: 'contains spaces',
      skipHeartbeat: true,
    }),
    /runner_instance_id_invalid/,
  );
  await assert.rejects(
    startPeer({
      apiKey: 'oxk_test_only',
      workspaceId: 'workspace-partial',
      runnerInstanceId: 'candidate.activation-partial',
      activationAttemptId: 'activation-partial',
      skipHeartbeat: true,
    }),
    /runner_activation_binding_incomplete/,
  );
});
