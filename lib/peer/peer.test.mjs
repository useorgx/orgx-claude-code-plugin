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

import { ClaudeCodeDriver } from './ClaudeCodeDriver.mjs';

let workdir;
let originalPath;

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
    ERROR_TRACE: [
      JSON.stringify({ kind: 'error', message: 'session interrupted', recoverable: true }),
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

describe('ClaudeCodeDriver', () => {
  it('detect reports installed + authenticated when --version works', async () => {
    process.env.CLAUDE_FIXTURE = 'VERSION_ONLY';
    const d = new ClaudeCodeDriver();
    const s = await d.detect();
    assert.equal(s.installed, true);
    assert.equal(s.authenticated, true);
    assert.match(s.version, /claude 1\.2\.3/);
  });

  it('dispatch yields task.started → task.step → task.completed on a success trace', async () => {
    process.env.CLAUDE_FIXTURE = 'SUCCESS_TRACE';
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
});
