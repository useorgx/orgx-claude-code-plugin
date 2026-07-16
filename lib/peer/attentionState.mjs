import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function attentionStateDirectory(env = process.env) {
  return resolve(
    env.ORGX_ATTENTION_STATE_DIR ||
      join(homedir(), '.config', 'useorgx', 'attention')
  );
}

export function attentionBundleKey(sessionId, toolCallId) {
  return createHash('sha256')
    .update(`${sessionId}:${toolCallId}`)
    .digest('hex')
    .slice(0, 32);
}

function decisionPath(directory, decisionId) {
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(String(decisionId))) {
    throw new Error('Invalid attention decision id');
  }
  return join(directory, `${decisionId}.json`);
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, path);
}

export async function writeAttentionBundle(bundle, env = process.env) {
  const directory = attentionStateDirectory(env);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const normalized = {
    protocol: 'orgx.attention.v1',
    state: 'waiting',
    answers: {},
    created_at: new Date().toISOString(),
    ...bundle,
  };
  for (const decisionId of normalized.decision_ids ?? []) {
    await writeJsonAtomic(decisionPath(directory, decisionId), normalized);
  }
  return normalized;
}

export async function readAttentionBundleForDecision(
  decisionId,
  env = process.env
) {
  const path = decisionPath(attentionStateDirectory(env), decisionId);
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function recordAttentionResolution(
  decisionId,
  resolution,
  env = process.env
) {
  const current = await readAttentionBundleForDecision(decisionId, env);
  if (!current) return null;

  const decisionIds = Array.isArray(current.decision_ids)
    ? current.decision_ids
    : [decisionId];
  const mergedAnswers = { ...(current.answers ?? {}) };
  for (const relatedId of decisionIds) {
    const related = await readAttentionBundleForDecision(relatedId, env);
    Object.assign(mergedAnswers, related?.answers ?? {});
  }
  mergedAnswers[decisionId] = resolution;

  const complete = decisionIds.every((id) =>
    Object.prototype.hasOwnProperty.call(mergedAnswers, id)
  );
  const next = {
    ...current,
    answers: mergedAnswers,
    state: complete ? 'answer_received' : 'waiting',
    updated_at: new Date().toISOString(),
  };
  const directory = attentionStateDirectory(env);
  for (const relatedId of decisionIds) {
    await writeJsonAtomic(decisionPath(directory, relatedId), next);
  }
  return next;
}

export function answersForClaude(bundle) {
  const answers = {};
  for (const question of bundle.questions ?? []) {
    const resolution = bundle.answers?.[question.decision_id];
    if (resolution === undefined) continue;
    const value =
      resolution && typeof resolution === 'object' && 'answer' in resolution
        ? resolution.answer
        : resolution;
    answers[question.prompt] = Array.isArray(value)
      ? value.join(', ')
      : value == null
      ? ''
      : String(value);
  }
  return answers;
}
