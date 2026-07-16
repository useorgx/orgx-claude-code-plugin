import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleAttentionHook } from '../hooks/scripts/orgx-attention-hook.mjs';
import {
  readAttentionBundleForDecision,
  recordAttentionResolution,
} from '../lib/peer/attentionState.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

async function environment() {
  const stateDir = await mkdtemp(join(tmpdir(), 'orgx-attention-hook-'));
  temporaryDirectories.push(stateDir);
  return {
    ORGX_REMOTE_ATTENTION: '1',
    ORGX_API_KEY: 'oxk_test',
    ORGX_BASE_URL: 'https://useorgx.test',
    ORGX_INITIATIVE_ID: 'aa6d16dc-d450-417f-8a17-fd89bd597195',
    ORGX_RUN_ID: '4d601b64-2b7f-495c-a13a-fef3b1de1180',
    ORGX_ATTENTION_STATE_DIR: stateDir,
  };
}

function input() {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    session_id: 'claude-session-1',
    tool_use_id: 'tool-use-1',
    cwd: '/tmp/project',
    tool_input: {
      questions: [
        {
          question: 'Which visual direction should continue?',
          header: 'Direction',
          options: [
            { label: 'Signal frame', description: 'Restrained and precise.' },
            { label: 'Editorial grid', description: 'Denser and expressive.' },
          ],
          multiSelect: false,
        },
        {
          question: 'What must remain unchanged?',
          header: 'Constraint',
          options: [],
          multiSelect: false,
        },
      ],
    },
  };
}

describe('Claude AskUserQuestion attention hook', () => {
  it('does nothing outside an OrgX remote dispatch', async () => {
    assert.equal(await handleAttentionHook(input(), {}), null);
  });

  it('persists every question and defers the preserved tool call', async () => {
    const env = await environment();
    const requests = [];
    const output = await handleAttentionHook(input(), env, {
      async fetch(url, init) {
        requests.push({ url, body: JSON.parse(init.body) });
        return new Response(
          JSON.stringify({ decision_id: `decision-${requests.length}` }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      },
    });

    assert.equal(
      output.hookSpecificOutput.permissionDecision,
      'defer'
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[0].body.response_mode, 'single_select');
    assert.equal(requests[1].body.response_mode, 'free_text');
    assert.deepEqual(requests[0].body.continuation, {
      strategy: 'resume_session',
      session_handle: 'claude-session-1',
      tool_call_id: 'tool-use-1',
      capability_version: 'claude-hooks-v1',
    });
    const bundle = await readAttentionBundleForDecision('decision-1', env);
    assert.deepEqual(bundle.decision_ids, ['decision-1', 'decision-2']);
    assert.equal(bundle.cwd, '/tmp/project');
  });

  it('waits for the whole question set, then injects structured answers', async () => {
    const env = await environment();
    let requestCount = 0;
    await handleAttentionHook(input(), env, {
      async fetch() {
        requestCount += 1;
        return new Response(
          JSON.stringify({ decision_id: `decision-${requestCount}` }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      },
    });
    const partial = await recordAttentionResolution(
      'decision-1',
      { answer: 'Signal frame' },
      env
    );
    assert.equal(partial.state, 'waiting');
    await recordAttentionResolution(
      'decision-2',
      { answer: 'Keep the logo geometry.' },
      env
    );

    const resumed = await handleAttentionHook(input(), {
      ...env,
      ORGX_ATTENTION_DECISION_ID: 'decision-2',
    });
    assert.equal(
      resumed.hookSpecificOutput.permissionDecision,
      'allow'
    );
    assert.deepEqual(resumed.hookSpecificOutput.updatedInput.answers, {
      'Which visual direction should continue?': 'Signal frame',
      'What must remain unchanged?': 'Keep the logo geometry.',
    });
  });
});
