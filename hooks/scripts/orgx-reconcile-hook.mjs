#!/usr/bin/env node

import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  main as reconcileMain,
  parseArgs,
  pickString,
} from "./orgx-work-graph-reconcile.mjs";

const DEFAULT_OUTBOX = join(
  homedir(),
  ".config",
  "useorgx",
  "wizard",
  "hooks",
  "events.jsonl"
);
const DEFAULT_OUTPUT = join(
  homedir(),
  ".config",
  "useorgx",
  "wizard",
  "hooks",
  "reports",
  "latest-work-graph-report.json"
);

export function envFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function shouldPost(args = {}, env = {}) {
  return envFlag(
    pickString(
      args.post,
      args["post-report"],
      env.ORGX_CLAUDE_HOOK_RECONCILE_POST,
      env.ORGX_HOOK_RECONCILE_POST,
      env.ORGX_WIZARD_HOOK_RECONCILE_POST
    )
  );
}

function withoutPostFlags(argv) {
  const filtered = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--post" || item === "--post=true" || item === "--post=false") continue;
    if (item === "--post-report" || item === "--post-report=true" || item === "--post-report=false") {
      continue;
    }
    if (item === "--api-key" || item === "--api_key") {
      index += 1;
      continue;
    }
    if (item.startsWith("--post=") || item.startsWith("--post-report=")) continue;
    if (item.startsWith("--api-key=") || item.startsWith("--api_key=")) continue;
    filtered.push(item);
  }
  return filtered;
}

export function buildReconcileArgv(argv = [], env = {}) {
  const args = parseArgs(argv);
  const next = withoutPostFlags(argv);

  if (!pickString(args.outbox)) {
    next.push(`--outbox=${pickString(env.ORGX_WIZARD_HOOK_OUTBOX, DEFAULT_OUTBOX)}`);
  }
  if (!pickString(args.output)) {
    next.push(`--output=${DEFAULT_OUTPUT}`);
  }

  const postRequested = shouldPost(args, env);
  const apiKey = pickString(args.api_key, args["api-key"], env.ORGX_API_KEY);
  if (postRequested && apiKey) {
    next.push("--post=true");
  }

  return {
    argv: next,
    postRequested,
    postEnabled: postRequested && Boolean(apiKey),
    skippedPost: postRequested && !apiKey ? "missing_api_key" : undefined,
  };
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  now,
  reconcile = reconcileMain,
} = {}) {
  const args = parseArgs(argv);
  const event = pickString(args.event, env.ORGX_HOOK_EVENT, "stop");
  if (String(event).trim().toLowerCase() !== "stop") {
    return {
      ok: true,
      skipped: "non_stop_event",
      event,
    };
  }

  try {
    const built = buildReconcileArgv(argv, env);
    const result = await reconcile({
      argv: built.argv,
      env,
      fetchImpl,
      ...(now ? { now } : {}),
    });
    return {
      ok: true,
      event,
      posted_requested: built.postRequested,
      posted_enabled: built.postEnabled,
      skipped_post: built.skippedPost,
      reconcile: result,
    };
  } catch (error) {
    return {
      ok: false,
      event,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((result) => {
    process.stderr.write(`[orgx-reconcile-hook] ${JSON.stringify({
      ok: result.ok,
      event: result.event,
      records_read: result.reconcile?.records_read,
      work_graph_fingerprint: result.reconcile?.work_graph_fingerprint,
      posted_enabled: result.posted_enabled,
      skipped: result.skipped,
      skipped_post: result.skipped_post,
      error: result.error,
    })}\n`);
    process.exit(0);
  });
}
