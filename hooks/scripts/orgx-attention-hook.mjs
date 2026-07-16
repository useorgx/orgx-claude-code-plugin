#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import {
  answersForClaude,
  attentionBundleKey,
  readAttentionBundleForDecision,
  writeAttentionBundle,
} from '../../lib/peer/attentionState.mjs';

function string(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionRecords(question) {
  if (!Array.isArray(question?.options)) return [];
  return question.options
    .map((option, index) => {
      const label =
        typeof option === 'string' ? option : string(option?.label);
      if (!label) return null;
      return {
        id:
          typeof option === 'object' && string(option?.value)
            ? string(option.value)
            : `option-${index + 1}`,
        label,
        ...(typeof option === 'object' && string(option?.description)
          ? { description: string(option.description) }
          : {}),
      };
    })
    .filter(Boolean);
}

function hookOutput(permissionDecision, extra = {}) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      ...extra,
    },
  };
}

async function postAttention(baseUrl, apiKey, body, request) {
  const response = await request(
    `${baseUrl.replace(/\/$/, '')}/api/client/live/attention`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.decision_id !== 'string') {
    throw new Error(
      `OrgX attention request failed (${response.status}): ${
        payload.error ?? 'missing decision id'
      }`
    );
  }
  return payload;
}

export async function handleAttentionHook(
  input,
  env = process.env,
  deps = {}
) {
  if (
    env.ORGX_REMOTE_ATTENTION !== '1' ||
    input?.hook_event_name !== 'PreToolUse' ||
    input?.tool_name !== 'AskUserQuestion'
  ) {
    return null;
  }

  const apiKey = string(env.ORGX_API_KEY);
  const initiativeId = string(env.ORGX_INITIATIVE_ID);
  const runId = string(env.ORGX_RUN_ID);
  const sessionId = string(input.session_id);
  const toolCallId = string(input.tool_use_id);
  const questions = Array.isArray(input.tool_input?.questions)
    ? input.tool_input.questions
    : [];
  if (!apiKey || !initiativeId || !sessionId || !toolCallId || !questions.length) {
    throw new Error(
      'Remote attention requires ORGX_API_KEY, ORGX_INITIATIVE_ID, session_id, tool_use_id, and at least one question.'
    );
  }

  const existingDecisionId = string(env.ORGX_ATTENTION_DECISION_ID);
  if (existingDecisionId) {
    const existing = await readAttentionBundleForDecision(
      existingDecisionId,
      env
    );
    if (
      existing?.state === 'answer_received' &&
      Object.keys(answersForClaude(existing)).length === questions.length
    ) {
      return hookOutput('allow', {
        permissionDecisionReason: 'OrgX returned the requested human answer.',
        updatedInput: {
          ...input.tool_input,
          answers: answersForClaude(existing),
        },
      });
    }
  }

  const request = deps.fetch ?? globalThis.fetch;
  const baseUrl = string(env.ORGX_BASE_URL) ?? 'https://useorgx.com';
  const bundleKey = attentionBundleKey(sessionId, toolCallId);
  const created = [];
  for (const [index, question] of questions.entries()) {
    const prompt = string(question?.question);
    if (!prompt) continue;
    const options = optionRecords(question);
    const responseMode = question?.multiSelect
      ? 'multi_select'
      : options.length
      ? 'single_select'
      : 'free_text';
    const response = await postAttention(
      baseUrl,
      apiKey,
      {
        initiative_id: initiativeId,
        ...(runId ? { run_id: runId } : {}),
        ...(string(env.ORGX_WORKSTREAM_ID)
          ? { workstream_id: string(env.ORGX_WORKSTREAM_ID) }
          : {}),
        idempotency_key: `claude:${bundleKey}:${index}`,
        question: prompt,
        context: [
          string(question?.header),
          string(question?.description),
          questions.length > 1
            ? `Question ${index + 1} of ${questions.length}. The session resumes after all answers arrive.`
            : null,
        ]
          .filter(Boolean)
          .join('\n\n'),
        ...(options.length ? { options } : {}),
        blocking: true,
        attention_kind: 'question',
        response_mode: responseMode,
        source_client: 'claude-code',
        source_tool: 'AskUserQuestion',
        source_session_id: sessionId,
        source_event_id: `${toolCallId}:${index}`,
        impact_if_delayed:
          'This Claude session is paused at a preserved tool call until the answer is returned.',
        recommended_action: 'Answer here to resume the same Claude session.',
        continuation: {
          strategy: 'resume_session',
          session_handle: sessionId,
          tool_call_id: toolCallId,
          capability_version: 'claude-hooks-v1',
        },
        metadata: {
          claude: {
            bundle_key: bundleKey,
            question_index: index,
            question_count: questions.length,
          },
        },
      },
      request
    );
    created.push({
      decision_id: response.decision_id,
      prompt,
      index,
    });
  }

  if (!created.length) throw new Error('No valid Claude questions to forward.');
  await writeAttentionBundle(
    {
      bundle_key: bundleKey,
      session_id: sessionId,
      tool_call_id: toolCallId,
      initiative_id: initiativeId,
      workspace_id: string(env.ORGX_WORKSPACE_ID),
      workstream_id: string(env.ORGX_WORKSTREAM_ID),
      run_id: runId,
      cwd: string(input.cwd),
      decision_ids: created.map((item) => item.decision_id),
      questions: created,
      tool_input: input.tool_input,
    },
    env
  );

  return hookOutput('defer', {
    permissionDecisionReason:
      created.length === 1
        ? 'Question forwarded to OrgX. The same session will resume after the answer arrives.'
        : `${created.length} questions forwarded to OrgX. The same session will resume after every answer arrives.`,
  });
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk.toString('utf8');
  return input.trim() ? JSON.parse(input) : {};
}

async function main() {
  try {
    const output = await handleAttentionHook(await readStdin());
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    // Fail open to Claude's native interaction instead of trapping a session
    // behind an OrgX/network/configuration problem.
    process.stderr.write(
      `[orgx-attention] ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
