import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { main } from '../lib/peer/cli.mjs';

describe('orgx-claude-code-peer CLI', () => {
  it('propagates the installer activation identity into the peer', async () => {
    let received;
    const code = await main({
      env: {
        ORGX_API_KEY: 'oxk_test_only',
        ORGX_WORKSPACE_ID: 'workspace-candidate',
        ORGX_INSTALLATION_ID: 'installation-candidate',
        ORGX_RUNNER_INSTANCE_ID: 'candidate.activation-01',
        ORGX_ACTIVATION_ATTEMPT_ID: 'activation-01',
        ORGX_RUNNER_ROLE: 'candidate',
      },
      log: () => undefined,
      startPeerImpl: async (opts) => {
        received = opts;
        return { stop: async () => undefined };
      },
      registerSignalHandlers: false,
    });

    assert.equal(code, 0);
    assert.equal(received.installationId, 'installation-candidate');
    assert.equal(received.runnerInstanceId, 'candidate.activation-01');
    assert.equal(received.activationAttemptId, 'activation-01');
    assert.equal(received.runnerRole, 'candidate');
  });

  it('rejects a partial activation binding before starting the peer', async () => {
    const errors = [];
    let started = false;
    const code = await main({
      env: {
        ORGX_API_KEY: 'oxk_test_only',
        ORGX_WORKSPACE_ID: 'workspace-candidate',
        ORGX_RUNNER_INSTANCE_ID: 'candidate.activation-02',
        ORGX_ACTIVATION_ATTEMPT_ID: 'activation-02',
      },
      error: (line) => errors.push(line),
      startPeerImpl: async () => {
        started = true;
        return { stop: async () => undefined };
      },
      registerSignalHandlers: false,
    });

    assert.equal(code, 2);
    assert.equal(started, false);
    assert.match(errors[0], /runner_activation_binding_incomplete/);
  });

  it('uses the durable identity resolver for an interactive launch', async () => {
    let identityInput;
    let received;
    const code = await main({
      env: {
        ORGX_GATEWAY_KEY: 'oxk_test_only',
        ORGX_WORKSPACE_ID: 'workspace-interactive',
        ORGX_INSTALLATION_ID: 'installation-interactive',
      },
      log: () => undefined,
      resolveRunnerInstanceIdImpl: async (input) => {
        identityInput = input;
        return 'persisted-claude-runner';
      },
      startPeerImpl: async (opts) => {
        received = opts;
        return { stop: async () => undefined };
      },
      registerSignalHandlers: false,
    });

    assert.equal(code, 0);
    assert.equal(identityInput.configuredId, undefined);
    assert.equal(identityInput.workspaceId, 'workspace-interactive');
    assert.equal(identityInput.installationId, 'installation-interactive');
    assert.equal(received.runnerInstanceId, 'persisted-claude-runner');
  });
});
