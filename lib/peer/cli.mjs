#!/usr/bin/env node
/**
 * CLI entrypoint: `orgx-claude-code-peer` — starts the plugin's peer
 * sidecar so OrgX server can dispatch tasks to the user's local Claude
 * Code session.
 */

import { startPeer } from './peer.mjs';
import { captureFatalPeerException } from './sentry.mjs';

async function main() {
  const apiKey = process.env.ORGX_API_KEY ?? process.env.ORGX_GATEWAY_KEY;
  const workspaceId = process.env.ORGX_WORKSPACE_ID;
  const baseUrl = process.env.ORGX_BASE_URL ?? 'https://useorgx.com';
  if (!apiKey || !workspaceId) {
    console.error('Missing ORGX_API_KEY and/or ORGX_WORKSPACE_ID. Export both and retry.');
    process.exit(2);
  }

  const installationId = process.env.ORGX_INSTALLATION_ID;
  const peer = await startPeer({
    apiKey,
    workspaceId,
    baseUrl,
    installationId,
  });
  console.log(
    '[orgx-claude-code-plugin] peer running — ctrl-c to stop. Dispatches arrive when OrgX sends them.'
  );

  const shutdown = async () => {
    await peer.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err) => {
  await captureFatalPeerException(err);
  console.error('[orgx-claude-code-plugin] fatal', err);
  process.exit(1);
});
