import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  defaultInstallationId,
  normalizeRunnerInstanceId,
  resolveRunnerActivationBinding,
  resolveRunnerInstanceId,
} from '../lib/peer/runnerInstanceIdentity.mjs';

const cleanup = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('runner instance identity', () => {
  it('uses a valid installer-provided identity verbatim', async () => {
    assert.equal(
      await resolveRunnerInstanceId({ configuredId: ' candidate.attempt-01 ' }),
      'candidate.attempt-01',
    );
    await assert.rejects(
      resolveRunnerInstanceId({ configuredId: 'contains spaces' }),
      /runner_instance_id_invalid/,
    );
  });

  it('persists one private identity for a workspace and installation', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'claude-runner-id-'));
    cleanup.push(stateDirectory);
    let generationCalls = 0;
    const input = {
      stateDirectory,
      workspaceId: 'workspace-01',
      installationId: 'installation-01',
      randomUUIDImpl: () => {
        generationCalls += 1;
        return '11111111-2222-4333-8444-555555555555';
      },
    };

    const first = await resolveRunnerInstanceId(input);
    const second = await resolveRunnerInstanceId({
      ...input,
      randomUUIDImpl: () => {
        throw new Error('must not regenerate a persisted identity');
      },
    });

    assert.equal(first, 'claude-11111111-2222-4333-8444-555555555555');
    assert.equal(second, first);
    assert.equal(generationCalls, 1);
    const entries = await readdir(stateDirectory);
    assert.equal(entries.length, 1);
    assert.equal(
      (await readFile(join(stateDirectory, entries[0]), 'utf8')).trim(),
      first,
    );
    assert.equal((await stat(join(stateDirectory, entries[0]))).mode & 0o777, 0o600);
  });

  it('requires a complete candidate or canonical activation binding', () => {
    assert.deepEqual(resolveRunnerActivationBinding(), {
      activationAttemptId: null,
      runnerRole: null,
    });
    assert.deepEqual(
      resolveRunnerActivationBinding({
        activationAttemptId: ' activation-attempt-01 ',
        runnerRole: 'canonical',
      }),
      {
        activationAttemptId: 'activation-attempt-01',
        runnerRole: 'canonical',
      },
    );
    assert.throws(
      () =>
        resolveRunnerActivationBinding({
          activationAttemptId: 'activation-attempt-01',
        }),
      /runner_activation_binding_incomplete/,
    );
    assert.throws(
      () =>
        resolveRunnerActivationBinding({
          activationAttemptId: 'activation-attempt-01',
          runnerRole: 'primary',
        }),
      /runner_role_invalid/,
    );
  });

  it('normalizes the shared activation-safe identifier contract', () => {
    assert.equal(
      normalizeRunnerInstanceId('canonical.attempt:01'),
      'canonical.attempt:01',
    );
    assert.equal(normalizeRunnerInstanceId(' bad value '), null);
    assert.equal(
      defaultInstallationId({ platform: 'test', user: 'hope' }),
      'orgx-claude-code-plugin:test:hope',
    );
  });
});
