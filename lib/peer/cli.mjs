#!/usr/bin/env node
/**
 * CLI entrypoint: `orgx-claude-code-peer` — starts the plugin's peer
 * sidecar so OrgX server can dispatch tasks to the user's local Claude
 * Code session.
 */

import { startPeer } from './peer.mjs';
import { pathToFileURL } from 'node:url';

import {
  defaultInstallationId,
  resolveRunnerActivationBinding,
  resolveRunnerInstanceId,
} from './runnerInstanceIdentity.mjs';
import { captureFatalPeerException } from './sentry.mjs';

export async function main(opts = {}) {
  const env = opts.env ?? process.env;
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const apiKey = env.ORGX_API_KEY ?? env.ORGX_GATEWAY_KEY;
  const workspaceId = env.ORGX_WORKSPACE_ID;
  const baseUrl = env.ORGX_BASE_URL ?? 'https://useorgx.com';
  if (!apiKey || !workspaceId) {
    error('Missing ORGX_API_KEY and/or ORGX_WORKSPACE_ID. Export both and retry.');
    return 2;
  }

  const installationId =
    env.ORGX_INSTALLATION_ID ?? defaultInstallationId();
  const resolveIdentity =
    opts.resolveRunnerInstanceIdImpl ?? resolveRunnerInstanceId;
  let runnerInstanceId;
  let activationBinding;
  try {
    runnerInstanceId = await resolveIdentity({
      configuredId: env.ORGX_RUNNER_INSTANCE_ID,
      workspaceId,
      installationId,
    });
    activationBinding = resolveRunnerActivationBinding({
      activationAttemptId: env.ORGX_ACTIVATION_ATTEMPT_ID,
      runnerRole: env.ORGX_RUNNER_ROLE,
    });
  } catch (identityError) {
    error(
      `[orgx-claude-code-plugin] ${
        identityError instanceof Error
          ? identityError.message
          : 'runner_instance_id_unavailable'
      }`,
    );
    return 2;
  }

  const start = opts.startPeerImpl ?? startPeer;
  const peer = await start({
    apiKey,
    workspaceId,
    baseUrl,
    installationId,
    runnerInstanceId,
    ...(activationBinding.activationAttemptId
      ? {
          activationAttemptId: activationBinding.activationAttemptId,
          runnerRole: activationBinding.runnerRole,
        }
      : {}),
  });
  log('[orgx-claude-code-plugin] peer running — ctrl-c to stop.');

  const shutdown = async () => {
    await peer.stop();
    process.exit(0);
  };
  if (opts.registerSignalHandlers !== false) {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(async (err) => {
      await captureFatalPeerException(err);
      console.error('[orgx-claude-code-plugin] fatal', err);
      process.exitCode = 1;
    });
}
