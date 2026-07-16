/**
 * ClaudeCodeDriver — drives the local `claude` CLI for OrgX peer dispatch.
 *
 * The Claude Code CLI supports non-interactive one-shot mode via `-p` with a
 * prompt argument, streaming JSON events on stdout when `--output-format
 * stream-json` is set. The driver:
 *
 *   1. detect()   — runs `claude --version` to confirm installation and
 *                    `claude auth status --json` to prove local account
 *                    state. Version output is never treated as auth proof.
 *   2. dispatch() — spawns `claude -p <prompt> --output-format stream-json
 *                    --plugin-dir <plugin_dir>` in the task's repo_path,
 *                    reads the NDJSON stream on stdout, yields PeerToServer
 *                    messages as events land. Rule-based deviation checks
 *                    run against each file-edit event.
 *   3. cancel()   — kills the spawned process (SIGTERM then SIGKILL after 3s).
 *   4. probe()    — repeats the auth-aware detection contract.
 *
 * This driver is a *peer implementation detail*. The plugin peer runtime
 * (see lib/peer/peer.mjs) wires it into @useorgx/orgx-gateway-sdk's PeerClient.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { recordAttentionResolution } from './attentionState.mjs';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANCEL_GRACE_MS = 3_000;

export class ClaudeCodeDriver {
  id = 'claude_code';

  constructor(opts = {}) {
    this.opts = opts;
    this.running = new Map(); // run_id → ChildProcess
  }

  async detect() {
    let version;
    try {
      const out = await runOnce('claude', ['--version'], { timeoutMs: 5_000 });
      version = out.stdout.trim() || undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/ENOENT|not found/i.test(message)) {
        return {
          installed: false,
          authenticated: false,
          subscription_active: false,
          auth_status: 'not_installed',
          error: message,
        };
      }
      return {
        installed: true,
        authenticated: false,
        subscription_active: false,
        auth_status: 'probe_failed',
        error: message,
      };
    }

    try {
      const auth = await runOnce('claude', ['auth', 'status', '--json'], {
        timeoutMs: 5_000,
      });
      const status = JSON.parse(auth.stdout);
      const authenticated = status?.loggedIn === true;
      return {
        installed: true,
        authenticated,
        version,
        subscription_active: authenticated,
        subscription_type:
          typeof status?.subscriptionType === 'string'
            ? status.subscriptionType
            : null,
        auth_method:
          typeof status?.authMethod === 'string' ? status.authMethod : null,
        auth_status: authenticated ? 'authenticated' : 'sign_in_required',
      };
    } catch (err) {
      return {
        installed: true,
        authenticated: false,
        version,
        subscription_active: false,
        subscription_type: null,
        auth_method: null,
        auth_status: 'sign_in_required',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async probe() {
    const detected = await this.detect();
    const ready = detected.installed === true && detected.authenticated === true;
    return {
      subscription_active: ready,
      session_alive: detected.installed === true,
      dispatch_ready: ready,
      auth_status: detected.auth_status,
      auth_method: detected.auth_method ?? null,
      subscription_type: detected.subscription_type ?? null,
      queue_depth: this.running.size,
    };
  }

  async *dispatch(task, context) {
    const prompt = renderPrompt(task);
    const cwd = task.repo_path || process.cwd();
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--plugin-dir',
      this.opts.pluginDir ?? PLUGIN_ROOT,
    ];

    const startedAt = new Date().toISOString();
    const child = (this.opts.spawn ?? spawn)('claude', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.executionEnvironment(task, context.run_id),
    });
    this.running.set(context.run_id, child);

    yield { kind: 'task.started', run_id: context.run_id, started_at: startedAt };

    const rules = (await (this.opts.skillRules?.() ?? Promise.resolve([]))).filter(Boolean);
    const seen = new Set();
    let firstResponseAt = null;
    let tokensTotal = 0;
    let sessionHandle = null;

    try {
      for await (const line of readNdjson(child.stdout)) {
        const event = safeParse(line);
        if (!event || typeof event !== 'object') continue;
        if (typeof event.session_id === 'string' && event.session_id.trim()) {
          sessionHandle = event.session_id.trim();
        }

        if (
          !firstResponseAt &&
          (event.kind === 'tool_call' ||
            event.kind === 'chat' ||
            event.kind === 'file_edit' ||
            (event.type === 'assistant' && event.message?.role === 'assistant'))
        ) {
          firstResponseAt = new Date().toISOString();
        }

        if (event.kind === 'tokens_used') {
          tokensTotal += Number(event.delta ?? 0);
          continue;
        }

        if (event.kind === 'file_edit' || event.kind === 'tool_call') {
          const summary =
            event.kind === 'file_edit'
              ? `edit ${event.path} — ${event.summary ?? 'change'}`
              : `call ${event.tool ?? 'tool'} — ${event.summary ?? ''}`;
          yield {
            kind: 'task.step',
            run_id: context.run_id,
            step: {
              kind: event.kind,
              summary,
              evidence_ref: event.diff_ref ?? event.ref ?? null,
            },
          };

          for (const rule of rules) {
            if (rule.match?.on !== event.kind) continue;
            const text =
              event.kind === 'file_edit'
                ? `${event.path ?? ''} ${event.summary ?? ''}`
                : `${event.tool ?? ''} ${event.summary ?? ''}`;
            try {
              if (!new RegExp(rule.match.pattern).test(text)) continue;
            } catch {
              continue;
            }
            const dedupe = `${rule.skill_id}:${rule.dedupe_fingerprint}:${context.run_id}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            yield {
              kind: 'task.deviation',
              run_id: context.run_id,
              skill_id: rule.skill_id,
              evidence_kind: rule.evidence_kind,
              evidence_ref: event.diff_ref ?? event.ref ?? event.path ?? event.tool ?? '',
              dedupe_key: dedupe,
              severity: 'warn',
            };
          }
        }

        if (event.kind === 'assistant_completed') {
          tokensTotal = tokensTotal || Number(event.tokens_used ?? 0);
          yield {
            kind: 'task.completed',
            run_id: context.run_id,
            outcome_kind: 'shipped',
            started_at: startedAt,
            first_response_at: firstResponseAt ?? startedAt,
            completed_at: new Date().toISOString(),
            tokens_used: tokensTotal,
            provider: 'anthropic',
            source_sub_type: 'subscription',
            source_driver: 'claude_code',
            cost_estimate_cents: 0,
          };
          return;
        }

        // Native Claude Code stream-json terminal contract. The real CLI
        // emits `type=result`, not the early-alpha `assistant_completed`
        // fixture shape retained above for backwards compatibility.
        if (event.type === 'result') {
          tokensTotal = tokensTotal || tokensFromUsage(event.usage);
          if (event.subtype === 'tool_deferred') {
            yield {
              kind: 'task.suspended',
              run_id: context.run_id,
              reason: 'attention',
              ...(sessionHandle ? { session_handle: sessionHandle } : {}),
              detail:
                'Claude preserved a deferred tool call while OrgX waits for the human answer.',
            };
            return;
          }
          if (event.subtype === 'success' && event.is_error !== true) {
            yield {
              kind: 'task.completed',
              run_id: context.run_id,
              outcome_kind: 'shipped',
              started_at: startedAt,
              first_response_at: firstResponseAt ?? startedAt,
              completed_at: new Date().toISOString(),
              tokens_used: tokensTotal,
              provider: 'anthropic',
              source_sub_type: 'subscription',
              source_driver: 'claude_code',
              cost_estimate_cents: 0,
            };
          } else {
            yield {
              kind: 'task.failed',
              run_id: context.run_id,
              reason:
                typeof event.result === 'string' && event.result.trim()
                  ? event.result.slice(0, 300)
                  : `claude result ${event.subtype ?? 'failed'}`,
              recoverable: event.subtype === 'error_during_execution',
            };
          }
          return;
        }

        if (event.kind === 'error') {
          yield {
            kind: 'task.failed',
            run_id: context.run_id,
            reason: event.message ?? 'claude errored',
            recoverable: event.recoverable === true,
          };
          return;
        }
      }

      // stdout closed without explicit completed → check exit code.
      const exitCode = await waitExit(child);
      if (exitCode === 0) {
        yield {
          kind: 'task.completed',
          run_id: context.run_id,
          outcome_kind: 'shipped',
          started_at: startedAt,
          first_response_at: firstResponseAt ?? startedAt,
          completed_at: new Date().toISOString(),
          tokens_used: tokensTotal,
          provider: 'anthropic',
          source_sub_type: 'subscription',
          source_driver: 'claude_code',
          cost_estimate_cents: 0,
        };
      } else {
        yield {
          kind: 'task.failed',
          run_id: context.run_id,
          reason: `claude exited ${exitCode}`,
          recoverable: exitCode === null,
        };
      }
    } finally {
      this.running.delete(context.run_id);
    }
  }

  async cancel(runId) {
    const child = this.running.get(runId);
    if (!child) return;
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, CANCEL_GRACE_MS).unref?.();
    this.running.delete(runId);
  }

  async *resolveAttention(message) {
    const answer =
      message.resolution.answer ??
      message.resolution.option_ids ??
      message.resolution.option_id ??
      message.resolution.note ??
      '';
    const bundle = await recordAttentionResolution(
      message.decision_id,
      {
        answer,
        status: message.resolution.status,
        option_id: message.resolution.option_id ?? null,
        option_ids: message.resolution.option_ids ?? [],
        note: message.resolution.note ?? null,
      },
      this.opts.env ?? process.env
    );
    if (!bundle) {
      throw new Error(
        'The local Claude attention checkpoint is missing; the durable answer remains available in OrgX.'
      );
    }

    const answeredCount = Object.keys(bundle.answers ?? {}).length;
    const expectedCount = bundle.decision_ids?.length ?? 1;
    if (bundle.state !== 'answer_received') {
      yield {
        state: 'answer_received',
        session_handle: bundle.session_id,
        detail: `${answeredCount} of ${expectedCount} related answers received.`,
      };
      return;
    }

    const sessionHandle = message.session_handle ?? bundle.session_id;
    if (!sessionHandle) {
      throw new Error('Claude continuation is missing its session handle.');
    }

    yield {
      state: 'resuming',
      session_handle: sessionHandle,
      detail: 'Restoring the preserved Claude tool call.',
    };

    const args = [
      '--resume',
      sessionHandle,
      '-p',
      'Continue from the deferred tool. The requested human answer is now available through the OrgX hook.',
      '--output-format',
      'stream-json',
      '--verbose',
      '--plugin-dir',
      this.opts.pluginDir ?? PLUGIN_ROOT,
    ];
    const child = (this.opts.spawn ?? spawn)('claude', args, {
      cwd: bundle.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...this.executionEnvironment(
          {
            workspace_id: bundle.workspace_id,
            initiative_id: bundle.initiative_id,
            workstream_id: bundle.workstream_id,
          },
          message.run_id
        ),
        ORGX_ATTENTION_DECISION_ID: message.decision_id,
      },
    });
    this.running.set(message.run_id, child);

    let accepted = false;
    const startedAt = new Date().toISOString();
    let firstResponseAt = null;
    let tokensTotal = 0;
    try {
      for await (const line of readNdjson(child.stdout)) {
        const event = safeParse(line);
        if (!event || typeof event !== 'object') continue;
        if (!accepted) {
          accepted = true;
          firstResponseAt = new Date().toISOString();
          yield {
            state: 'resumed',
            session_handle: sessionHandle,
            detail:
              'Claude accepted the answer and advanced the preserved session.',
          };
        }
        if (event.kind === 'tokens_used') {
          tokensTotal += Number(event.delta ?? 0);
        }
        if (event.type === 'result') {
          tokensTotal = tokensTotal || tokensFromUsage(event.usage);
          if (event.subtype === 'success' && event.is_error !== true) {
            yield {
              kind: 'task.completed',
              run_id: message.run_id,
              outcome_kind: 'shipped',
              started_at: startedAt,
              first_response_at: firstResponseAt ?? startedAt,
              completed_at: new Date().toISOString(),
              tokens_used: tokensTotal,
              provider: 'anthropic',
              source_sub_type: 'subscription',
              source_driver: 'claude_code',
              cost_estimate_cents: 0,
            };
          } else {
            yield {
              kind: 'task.failed',
              run_id: message.run_id,
              reason:
                typeof event.result === 'string' && event.result.trim()
                  ? event.result.slice(0, 500)
                  : `Claude resume ended with ${event.subtype ?? 'an error'}`,
              recoverable: event.subtype === 'error_during_execution',
            };
          }
          return;
        }
      }
      const exitCode = await waitExit(child);
      yield {
        kind: 'task.failed',
        run_id: message.run_id,
        reason: accepted
          ? `Claude resume exited ${exitCode} without a terminal result.`
          : 'Claude exited without evidence that the preserved session advanced.',
        recoverable: exitCode === 0 || exitCode === null,
      };
    } finally {
      this.running.delete(message.run_id);
    }
  }

  executionEnvironment(task = {}, runId) {
    const source = this.opts.env ?? process.env;
    return {
      ...source,
      ORGX_REMOTE_ATTENTION: '1',
      ORGX_RUN_ID: runId,
      ...(this.opts.apiKey || source.ORGX_API_KEY
        ? { ORGX_API_KEY: this.opts.apiKey ?? source.ORGX_API_KEY }
        : {}),
      ...(this.opts.baseUrl || source.ORGX_BASE_URL
        ? { ORGX_BASE_URL: this.opts.baseUrl ?? source.ORGX_BASE_URL }
        : {}),
      ...(task.workspace_id || this.opts.workspaceId
        ? { ORGX_WORKSPACE_ID: task.workspace_id ?? this.opts.workspaceId }
        : {}),
      ...(task.initiative_id
        ? { ORGX_INITIATIVE_ID: task.initiative_id }
        : {}),
      ...(task.workstream_id
        ? { ORGX_WORKSTREAM_ID: task.workstream_id }
        : {}),
    };
  }
}

// ───────── Helpers ─────────────────────────────────────────────────────────

function runOnce(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      rejectFn(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(t);
      rejectFn(err);
    });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolveFn({ stdout, stderr });
      else rejectFn(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

async function* readNdjson(stream) {
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function tokensFromUsage(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  return [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens,
  ].reduce((sum, value) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? sum + parsed : sum;
  }, 0);
}

function waitExit(child) {
  return new Promise((resolveFn) => {
    if (child.exitCode !== null) resolveFn(child.exitCode);
    else child.once('close', (code) => resolveFn(code));
  });
}

function renderPrompt(task) {
  const parts = [task.title];
  if (task.description) parts.push('\n\n', task.description);
  if (task.skill_ids?.length) {
    parts.push('\n\nSkills to honor:\n');
    for (const id of task.skill_ids) parts.push(`  - ${id}\n`);
  }
  return parts.join('');
}
