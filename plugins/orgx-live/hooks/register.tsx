// orgx-live: an optional OrgX mod for Claude Code.
//
// - Status line: "OrgX · N need you" from orgx_decide action=list_pending,
//   read at session start and every few minutes; nothing when nothing does.
// - /orgx-needs-you: a pane listing those decisions (question, urgency, age,
//   OrgX's recommendation, a link to decide in OrgX) and the last summaries.
// - Capture (userConfig `capture`, off by default): with `summary`, one
//   counts-only orgx_emit_activity per turn that used tools, sent after the
//   turn ends. With `off` no tool or turn hook is registered at all.
//
// The mod never approves, rejects or otherwise settles a decision: its only
// orgx_decide call is the list_pending read, and the pane links to OrgX.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult, Register } from 'claude-code'

import type { OrgxLiveActivityRow, OrgxLiveCapture, OrgxLivePending, OrgxLiveReach } from '../types'
import {
  activityArgs,
  ago,
  boundInitiative,
  isUuid,
  newTally,
  parsePending,
  statusText,
  summarize,
  summaryMessage,
  tallyCall,
} from './summary'
import type { TurnSummary } from './summary'

type Engine = EngineInterface

const PANE = 'orgx-needs-you'
const COMMAND = 'orgx-needs-you'
/** The server key in this plugin's own .mcp.json. */
const SERVER_KEY = 'orgx'
/** How often the status line re-reads pending decisions. */
const REFRESH_MS = 5 * 60_000
/** A pane opened sooner than this after the last read shows that read. */
const PANE_STALE_MS = 60_000
/** How long after a turn ends its summary is sent (turns ending together queue). */
const FLUSH_DELAY_MS = 2_000
const MAX_QUEUE = 20
const ACTIVITY_KEPT = 8
const ACTIVITY_SHOWN = 5
const DECISIONS_SHOWN = 8
const AUTH_HINT = /auth|sign[ -]?in|unauthori[sz]ed|forbidden|401|403/iu
const BOOTSTRAP_TOOL = /^mcp__.*orgx.*__orgx_bootstrap$/iu

const INITIAL_PENDING: OrgxLivePending = { count: null, decisions: [], checkedAt: null }
const INITIAL_REACH: OrgxLiveReach = { status: 'unknown', note: null }
const INITIAL_CAPTURE: OrgxLiveCapture = {
  turns: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  skipReason: null,
  correlationId: null,
  initiativeId: null,
  initiativeSource: null,
  bootstrapAsked: false,
}

const pending = atom({ plugin: 'orgx-live', key: 'pending' } as const, INITIAL_PENDING)
const reach = atom({ plugin: 'orgx-live', key: 'reach' } as const, INITIAL_REACH)
const activity = atom({ plugin: 'orgx-live', key: 'activity' } as const, [] as OrgxLiveActivityRow[])
const capture = atom({ plugin: 'orgx-live', key: 'capture' } as const, INITIAL_CAPTURE)

// Module working state. What the pane and status line draw lives in $.state;
// these are transient, and a reload runs the module (and register) afresh.
let isCapturing = false
let configuredInitiative: string | null = null
let server: string | null = null
let lastStatus: string | undefined | null = null
let refreshing = false
let tally = newTally()
let turnSeq = 0
const queue: TurnSummary[] = []
let flushScheduled = false
let flushing = false

// -------------------------------------------------------------------------
// OrgX calls: connect once, swallow every failure, record reachability.
// -------------------------------------------------------------------------

async function setReach($: Engine, status: OrgxLiveReach['status'], note: string | null): Promise<void> {
  const now = await read($, reach)
  if (now.status !== status || now.note !== note) await update($, reach, () => ({ status, note }))
}

async function connect($: Engine): Promise<string | null> {
  if (server) return server
  const result = await $.mcp.connect(SERVER_KEY)
  if (result.isConnected) {
    server = result.server
    return server
  }
  await setReach($, result.reason === 'auth' ? 'auth' : 'unreachable', result.message)
  return null
}

/** One OrgX tool call. Never throws; null when OrgX could not be reached. */
async function callOrgx($: Engine, tool: string, args: Record<string, unknown>): Promise<McpToolResult | null> {
  try {
    const name = await connect($)
    if (!name) return null
    const result = await $.mcp.call(name, tool, args)
    const said = result.isError
      ? result.content.map(block => (typeof block.text === 'string' ? block.text : '')).join(' ')
      : ''
    if (AUTH_HINT.test(said)) await setReach($, 'auth', 'OrgX asked to sign in again.')
    else await setReach($, 'ok', null)
    return result
  } catch {
    server = null
    await setReach($, 'unreachable', 'OrgX did not answer').catch(() => undefined)
    return null
  }
}

async function applyStatus($: Engine): Promise<void> {
  const [p, r, c, rows] = await Promise.all([read($, pending), read($, reach), read($, capture), read($, activity)])
  const latest = rows[rows.length - 1]
  const text = statusText({
    count: p.count,
    reach: r.status,
    captureBlocked: isCapturing && latest?.status === 'skipped' && c.skipReason !== null,
  })
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text)
}

// -------------------------------------------------------------------------
// Pending decisions: the status line and the pane.
// -------------------------------------------------------------------------

async function refreshPending($: Engine): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    const checkedAt = await $.clock.now()
    // The one orgx_decide action this mod sends: a read.
    const result = await callOrgx($, 'orgx_decide', { action: 'list_pending' })
    const parsed = result ? parsePending(result) : null
    await update($, pending, previous =>
      parsed ? { count: parsed.count, decisions: parsed.decisions, checkedAt } : { ...previous, checkedAt },
    )
    await applyStatus($)
  } catch {
    // A failed refresh leaves the last good read in place.
  } finally {
    refreshing = false
  }
}

// -------------------------------------------------------------------------
// Capture: counts-only turn summaries, sent after the turn.
// -------------------------------------------------------------------------

async function addRow($: Engine, row: OrgxLiveActivityRow): Promise<void> {
  await update($, activity, rows => [...rows.filter(one => one.turn !== row.turn), row].slice(-ACTIVITY_KEPT))
}

async function resolveInitiative($: Engine): Promise<string | null> {
  if (configuredInitiative) return configuredInitiative
  const current = await read($, capture)
  if (current.initiativeId) return current.initiativeId
  if (current.bootstrapAsked) return null
  await update($, capture, c => ({ ...c, bootstrapAsked: true }))
  // No workspace_id or initiative_id: this reads the session's existing
  // binding and binds nothing new on the OrgX side.
  const result = await callOrgx($, 'orgx_bootstrap', { client_name: 'claude-code' })
  const bound = result ? boundInitiative(result) : null
  if (bound) await update($, capture, c => ({ ...c, initiativeId: bound, initiativeSource: 'bootstrap' as const }))
  return bound
}

async function sendSummary($: Engine, summary: TurnSummary): Promise<void> {
  const at = await $.clock.now()
  const message = summaryMessage(summary)
  const initiativeId = await resolveInitiative($)
  const { correlationId } = await read($, capture)
  if (!initiativeId || !correlationId) {
    const reason = initiativeId ? 'session not started' : 'no OrgX initiative bound'
    await update($, capture, c => ({ ...c, skipped: c.skipped + 1, skipReason: reason }))
    await addRow($, { turn: summary.turn, at, message, status: 'skipped' })
    return
  }
  const result = await callOrgx($, 'orgx_emit_activity', activityArgs(summary, { initiativeId, correlationId }))
  const isSent = result !== null && !result.isError
  await update($, capture, c => (isSent ? { ...c, sent: c.sent + 1, skipReason: null } : { ...c, failed: c.failed + 1 }))
  await addRow($, { turn: summary.turn, at, message, status: isSent ? 'sent' : 'failed' })
}

async function flush($: Engine): Promise<void> {
  flushScheduled = false
  if (flushing) return
  flushing = true
  try {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        await sendSummary($, next)
      } catch {
        await update($, capture, c => ({ ...c, failed: c.failed + 1 })).catch(() => undefined)
      }
    }
    await applyStatus($)
  } catch {
    // Swallowed: capture never surfaces an exception.
  } finally {
    flushing = false
  }
}

function enqueue($: Engine, summary: TurnSummary): void {
  if (queue.length >= MAX_QUEUE) {
    queue.shift()
    void update($, capture, c => ({ ...c, skipped: c.skipped + 1, skipReason: 'queue full' })).catch(() => undefined)
  }
  queue.push(summary)
  void update($, capture, c => ({ ...c, turns: Math.max(c.turns, summary.turn) })).catch(() => undefined)
  if (flushScheduled) return
  flushScheduled = true
  $.clock.after(FLUSH_DELAY_MS, () => void flush($))
}

export const register: Register = (on, options) => {
  isCapturing = options.capture === 'summary'
  configuredInitiative =
    typeof options.initiative === 'string' && isUuid(options.initiative) ? options.initiative.trim() : null

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'OrgX: decisions waiting on you and recent captured turns',
      })
      const current = await read($, capture)
      turnSeq = current.turns
      await update($, capture, c => ({
        ...c,
        // The setting wins; one cleared since the last load stops applying.
        ...(configuredInitiative
          ? { initiativeId: configuredInitiative, initiativeSource: 'config' as const }
          : c.initiativeSource === 'config'
            ? { initiativeId: null, initiativeSource: null }
            : {}),
        correlationId: c.correlationId ?? `claude-code:${crypto.randomUUID()}`,
      }))
      if (e.isInteractive) {
        void refreshPending($)
        $.clock.every(REFRESH_MS, () => void refreshPending($))
      }
    } catch {
      // Startup never fails the session.
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'OrgX · needs you' })
    const { checkedAt } = await read($, pending)
    const now = await $.clock.now()
    if (checkedAt === null || now - checkedAt >= PANE_STALE_MS) void refreshPending($)
    return {
      text: opened.isPlaced
        ? 'Opened the OrgX needs-you pane.'
        : 'The OrgX needs-you pane opens once the terminal is wider.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const [p, r, rows, c] = await Promise.all([read($, pending), read($, reach), read($, activity), read($, capture)])
    const now = await $.clock.now()
    const shown = p.decisions.slice(0, DECISIONS_SHOWN)
    const more = (p.count ?? 0) - shown.length

    const headline =
      p.count === null
        ? p.checkedAt === null
          ? 'Checking OrgX…'
          : 'OrgX has not answered yet.'
        : p.count === 0
          ? 'Nothing needs you in OrgX.'
          : `${p.count} decision${p.count === 1 ? '' : 's'} need${p.count === 1 ? 's' : ''} you`
    const reachNote =
      r.status === 'auth'
        ? 'Sign in to orgx (orgx-live) in /mcp.'
        : r.status === 'unreachable'
          ? `OrgX unreachable${r.note ? `: ${r.note}.` : '.'}`
          : null

    return (
      <Box flexDirection="column">
        <Box key="head" flexDirection="column">
          <Text bold>{headline}</Text>
          {p.checkedAt !== null && <Text dimColor>{`checked ${ago(p.checkedAt, now)} ago`}</Text>}
          {reachNote && <Text color="yellow">{reachNote}</Text>}
        </Box>
        {shown.map(decision => (
          <Box key={`decision-${decision.id}`} flexDirection="column" marginTop={1}>
            <Text bold={decision.urgency === 'critical' || decision.urgency === 'high'}>
              {`${decision.urgency}${decision.createdAt ? ` · ${ago(decision.createdAt, now)}` : ''} · ${decision.question}`}
            </Text>
            {decision.recommendation && <Text dimColor>{`Recommended: ${decision.recommendation}`}</Text>}
            <Link href={decision.reviewUrl} label="Open in OrgX" />
          </Box>
        ))}
        {more > 0 && <Text dimColor>{`+${more} more in OrgX`}</Text>}
        <Box key="activity" flexDirection="column" marginTop={1}>
          <Text bold>Captured turns</Text>
          {!isCapturing ? (
            <Text dimColor>Capture is off. Turn it on in /config (orgx-live, capture: summary).</Text>
          ) : rows.length === 0 ? (
            <Text dimColor>No turns captured yet. Each turn that uses tools sends one summary.</Text>
          ) : (
            rows
              .slice(-ACTIVITY_SHOWN)
              .map(row => <Text dimColor={row.status === 'sent'}>{`${ago(row.at, now)} ${row.status} · ${row.message}`}</Text>)
          )}
          {isCapturing && c.skipReason && <Text color="yellow">{`Skipped: ${c.skipReason}.`}</Text>}
        </Box>
        <Text dimColor>Decide in OrgX. This pane never approves or rejects anything.</Text>
        <Box key="actions" flexDirection="row" gap={1}>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => void refreshPending($)} />
          <Button key="close" label="Close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })

  if (!isCapturing) return

  // Capture hooks exist only while capture is on.

  on('turn.start', ($, e, next) => {
    tally = newTally()
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const failed = ran.deny !== undefined || ran.isError === true
      const tool = String(e.tool)
      const args = e as unknown as Record<string, unknown>
      tallyCall(tally, tool, args, failed, e.agentId !== undefined)
      if (!failed && !configuredInitiative && BOOTSTRAP_TOOL.test(tool)) {
        // The model bound an initiative through orgx_bootstrap: attribute to it.
        const output = ran.result as McpToolResult | undefined
        const fromResult = output && Array.isArray(output.content) ? boundInitiative(output) : null
        const bound = isUuid(args.initiative_id) ? args.initiative_id.trim() : fromResult
        if (bound) {
          void update($, capture, c => ({ ...c, initiativeId: bound, initiativeSource: 'bootstrap' as const })).catch(
            () => undefined,
          )
        }
      }
    } catch {
      // Tallying never touches the call's result.
    }
    return ran
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      try {
        const finished = tally
        tally = newTally()
        if (finished.calls > 0) {
          turnSeq += 1
          enqueue($, summarize(finished, turnSeq, e.durationMs, e.reason))
        }
      } catch {
        // Capture never changes how a turn ends.
      }
    }
    return next(e)
  })
}
