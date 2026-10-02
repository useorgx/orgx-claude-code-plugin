// Pure helpers for the orgx-live mod: the per-turn tally, the counts-only
// activity payload, the pending-decisions parser and the status line text.
// Nothing here calls `$`; register.tsx owns every side effect.

import type { McpToolResult } from 'claude-code'

import type { OrgxLivePendingDecision } from '../types'

/** What one turn's tool calls add up to. Held in memory, never sent whole. */
export type TurnTally = {
  calls: number
  failed: number
  /** Tool name (or `mcp` / `other`) to call count. */
  tools: Record<string, number>
  /**
   * Files the turn changed, by the path the tool was given. Kept only to
   * count distinct files; the paths themselves never leave this module.
   */
  changed: Set<string>
  /** Calls made inside subagents the turn started. */
  subagentCalls: number
}

/** What a turn summary carries: counts and the turn's outcome, no content. */
export type TurnSummary = {
  turn: number
  calls: number
  failed: number
  tools: Record<string, number>
  filesChanged: number
  subagentCalls: number
  durationMs: number
  outcome: 'answer' | 'aborted' | 'error' | 'refusal'
}

export const SUMMARY_SCHEMA = 'orgx-live.turn-summary.v1'

/** Built-in tools that change a file, and the argument naming it. */
const FILE_CHANGING_TOOLS: Record<string, 'file_path' | 'notebook_path'> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
}

const BUILTIN_NAME = /^[A-Z][A-Za-z0-9]{0,39}$/u
const MAX_TOOL_KEYS = 16

export function newTally(): TurnTally {
  return { calls: 0, failed: 0, tools: {}, changed: new Set(), subagentCalls: 0 }
}

/**
 * The name a summary counts a tool under. Built-in tools keep their name;
 * every MCP tool is counted as `mcp`, so server names a person configured
 * (which can name their accounts) never leave the machine.
 */
export function toolKey(tool: string): string {
  if (tool.startsWith('mcp__')) return 'mcp'
  return BUILTIN_NAME.test(tool) ? tool : 'other'
}

/**
 * Adds one finished tool call to the tally. `args` is the call's input, read
 * only for the path of a file-changing tool; `failed` whether it errored or
 * was denied.
 */
export function tallyCall(
  tally: TurnTally,
  tool: string,
  args: Record<string, unknown>,
  failed: boolean,
  inSubagent: boolean,
): void {
  tally.calls += 1
  if (inSubagent) tally.subagentCalls += 1
  if (failed) tally.failed += 1

  let key = toolKey(tool)
  if (!(key in tally.tools) && Object.keys(tally.tools).length >= MAX_TOOL_KEYS) key = 'other'
  tally.tools[key] = (tally.tools[key] ?? 0) + 1

  const pathArg = FILE_CHANGING_TOOLS[tool]
  const path = pathArg === undefined ? undefined : args[pathArg]
  if (!failed && typeof path === 'string' && path.length > 0) tally.changed.add(path)
}

export function summarize(
  tally: TurnTally,
  turn: number,
  durationMs: number,
  outcome: TurnSummary['outcome'],
): TurnSummary {
  return {
    turn,
    calls: tally.calls,
    failed: tally.failed,
    tools: { ...tally.tools },
    filesChanged: tally.changed.size,
    subagentCalls: tally.subagentCalls,
    durationMs: Math.max(0, Math.round(durationMs)),
    outcome,
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

/** The one-line, human-readable activity message: counts only. */
export function summaryMessage(summary: TurnSummary): string {
  const tools = Object.entries(summary.tools)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, count]) => `${name} ${count}`)
    .join(', ')
  const parts = [
    `${plural(summary.calls, 'tool call')}${tools ? ` (${tools})` : ''}`,
    `${plural(summary.filesChanged, 'file')} changed`,
  ]
  if (summary.failed > 0) parts.push(`${summary.failed} failed`)
  if (summary.outcome !== 'answer') parts.push(summary.outcome)
  parts.push(formatDuration(summary.durationMs))
  return `Claude Code turn ${summary.turn}: ${parts.join(', ')}`
}

/**
 * The `orgx_emit_activity` arguments for one turn. Every field is a count,
 * a fixed label, or an id the mod minted or was configured with.
 */
export function activityArgs(
  summary: TurnSummary,
  context: { initiativeId: string; correlationId: string },
): Record<string, unknown> {
  return {
    initiative_id: context.initiativeId,
    correlation_id: context.correlationId,
    source_client: 'claude-code',
    phase: 'execution',
    level: summary.failed > 0 || summary.outcome === 'error' ? 'warn' : 'info',
    message: summaryMessage(summary),
    metadata: {
      schema: SUMMARY_SCHEMA,
      capture: 'summary',
      turn: summary.turn,
      tool_calls: summary.calls,
      tools: summary.tools,
      failed_tool_calls: summary.failed,
      files_changed: summary.filesChanged,
      subagent_tool_calls: summary.subagentCalls,
      duration_ms: summary.durationMs,
      outcome: summary.outcome,
    },
    runtime: {
      source_runtime: 'anthropic',
      source_system: 'claude-code',
      adapter: 'orgx-live-mod',
    },
  }
}

// ---------------------------------------------------------------------------
// Reading OrgX results
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value.trim())
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** A tool result's structured payload, or its first text block parsed as JSON. */
export function payloadOf(result: McpToolResult): Record<string, unknown> | null {
  const structured = record(result.structuredContent)
  if (structured) return structured
  for (const block of result.content) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    try {
      const parsed = record(JSON.parse(block.text))
      if (parsed) return parsed
    } catch {
      // Not JSON: a plain summary line.
    }
  }
  return null
}

/** Clips on a code-point boundary, collapsing whitespace, marking the cut. */
export function clip(value: string, max: number): string {
  const chars = Array.from(value.replace(/\s+/gu, ' ').trim())
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

const ORGX_APP = 'https://useorgx.com'

/** An https URL safe for a Link, or null. */
function linkable(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    const href = url.href
    return /^[\x21-\x7e]{1,2048}$/u.test(href) ? href : null
  } catch {
    return null
  }
}

function urgencyOf(value: unknown): OrgxLivePendingDecision['urgency'] {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return slug === 'critical' || slug === 'high' || slug === 'low' ? slug : 'medium'
}

/** One pending decision as OrgX returned it, normalized for the pane. */
export function toPendingDecision(input: unknown): OrgxLivePendingDecision | null {
  const row = record(input)
  if (!row) return null
  const id = text(row.id)
  if (!id || !isUuid(id)) return null
  const packet = record(row.review_packet) ?? {}
  const context = record(row.context) ?? {}
  const recommendation = record(packet.recommendation) ?? record(row.recommendation)
  const initiativeId = text(context.initiative_id) ?? text(row.initiative_id)
  const fallbackUrl =
    initiativeId && isUuid(initiativeId)
      ? `${ORGX_APP}/initiatives/${initiativeId}?focus=decisions&decision=${id}`
      : `${ORGX_APP}/decisions/${id}`
  const question =
    text(packet.question) ?? text(row.question) ?? text(row.summary) ?? text(row.title) ?? 'Decision'
  const action = text(recommendation?.action) ?? text(row.recommended_action)
  return {
    id,
    question: clip(question, 240),
    urgency: urgencyOf(row.urgency),
    createdAt: text(row.created_at),
    recommendation: action ? clip(action, 160) : null,
    reviewUrl: linkable(row.review_url) ?? linkable(row.url) ?? fallbackUrl,
  }
}

const URGENCY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const

/**
 * The pending decisions in an `orgx_decide` `list_pending` result, most
 * urgent and then oldest first; null when the result is not a list of them.
 */
export function parsePending(
  result: McpToolResult,
): { count: number; decisions: OrgxLivePendingDecision[] } | null {
  if (result.isError) return null
  const payload = payloadOf(result)
  if (!payload) return null
  const data = record(payload.data) ?? payload
  const list = Array.isArray(data.decisions) ? data.decisions : null
  if (!list) return null
  const decisions = list
    .map(toPendingDecision)
    .filter((one): one is OrgxLivePendingDecision => one !== null)
    .sort(
      (a, b) =>
        URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
        (Date.parse(a.createdAt ?? '') || Infinity) - (Date.parse(b.createdAt ?? '') || Infinity),
    )
  const total = typeof data.total === 'number' && data.total >= list.length ? data.total : list.length
  return { count: total, decisions }
}

/** The initiative an `orgx_bootstrap` result says this session is bound to. */
export function boundInitiative(result: McpToolResult): string | null {
  if (result.isError) return null
  const payload = payloadOf(result)
  const initiative = record(payload?.initiative)
  const id = text(initiative?.id) ?? text(payload?.initiative_id)
  return id && isUuid(id) ? id : null
}

// ---------------------------------------------------------------------------
// What the person sees
// ---------------------------------------------------------------------------

/**
 * The status line: the count when something needs the person, one quiet
 * note when OrgX cannot be reached, and nothing at all when all is well.
 */
export function statusText(input: {
  count: number | null
  reach: 'unknown' | 'ok' | 'auth' | 'unreachable'
  captureBlocked: boolean
}): string | undefined {
  const parts: string[] = []
  if (input.count !== null && input.count > 0) parts.push(`${input.count} need${input.count === 1 ? 's' : ''} you`)
  if (input.reach === 'auth') parts.push('sign in via /mcp')
  else if (input.reach === 'unreachable') parts.push('unreachable')
  else if (input.captureBlocked) parts.push('capture needs an initiative')
  return parts.length === 0 ? undefined : `OrgX · ${parts.join(' · ')}`
}

/** How long ago, compactly: `now`, `5m`, `3h`, `2d`. */
export function ago(from: number | string | null, now: number): string {
  const at = typeof from === 'string' ? Date.parse(from) : from
  if (at === null || !Number.isFinite(at)) return ''
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}
