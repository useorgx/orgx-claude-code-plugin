import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const INITIATIVE = '2f1c9a7e-4b7d-4c1e-9a55-0d3e8b6f1a20'
const DECISION_A = '8a6b2c1d-1111-4e2f-8a3b-5c6d7e8f9a01'
const DECISION_B = '8a6b2c1d-2222-4e2f-8a3b-5c6d7e8f9a02'
const DECISION_C = '8a6b2c1d-3333-4e2f-8a3b-5c6d7e8f9a03'
const T0 = Date.parse('2026-10-02T12:00:00Z')
const SERVER = 'plugin:orgx-live:orgx'

/** The only OrgX calls this mod may ever make. */
const ALLOWED_CALLS = new Set(['orgx_decide:list_pending', 'orgx_emit_activity:', 'orgx_bootstrap:'])

type McpCall = { server: string; tool: string; args: Record<string, unknown> }
type Responder = (call: McpCall) => { content: { type: string; text?: string }[]; isError: boolean; structuredContent?: unknown }

function decision(id: string, urgency: string, hoursAgo: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title ${id.slice(9, 13)}`,
    urgency,
    created_at: new Date(T0 - hoursAgo * 3_600_000).toISOString(),
    ...extra,
  }
}

function pendingResult(decisions: unknown[]) {
  return { content: [{ type: 'text', text: `${decisions.length} pending` }], isError: false, structuredContent: { decisions } }
}

const OK = { content: [{ type: 'text', text: 'Activity emitted' }], isError: false, structuredContent: { ok: true } }

/**
 * The engine beneath the mod: a mocked clock, an OrgX server answered by
 * `respond`, and the engine's own answers for every event the mod passes on.
 */
function world(on: On, respond: Responder = () => pendingResult([])) {
  const clock = mock.clock(on, { now: T0 })
  const calls: McpCall[] = []
  const statuses: (string | undefined)[] = []
  const opened: string[] = []
  let connects = 0

  on('mcp.connect', () => {
    connects += 1
    return { value: { isConnected: true, server: SERVER } }
  })
  on('mcp.call', ($, e) => {
    calls.push({ server: e.server, tool: e.tool, args: e.args })
    return { value: respond({ server: e.server, tool: e.tool, args: e.args }) }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($, e) =>
    String(e.tool) === 'Bash' && String((e as Record<string, unknown>).command).includes('fail')
      ? { isError: true as const, result: 'exit 1: permission denied on /work/repo/secret', text: 'exit 1' }
      : { result: { ok: true, output: 'contents of /work/repo/src/a.ts: SECRET=abc' } },
  )

  return {
    clock,
    calls,
    statuses,
    opened,
    connects: () => connects,
    emitted: () => calls.filter(call => call.tool === 'orgx_emit_activity'),
    assertOnlyAllowedCalls: () => {
      for (const call of calls) {
        const action = call.tool === 'orgx_decide' ? String(call.args.action) : ''
        expect(ALLOWED_CALLS.has(`${call.tool}:${action}`), `unexpected OrgX call ${call.tool} ${action}`).toBe(true)
        expect(call.server).toBe(SERVER)
      }
    },
  }
}

describe('capture off', () => {
  test('sends nothing and does not observe tools or turns', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work/repo', surface: 'terminal', isInteractive: true })
    await w.clock.settle()

    await $.turn.start({ text: 'refactor the parser', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/repo/src/a.ts', old_string: 'a', new_string: 'b', tool_use_id: 'u1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'u2' })
    await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(60_000)

    expect(w.emitted()).toHaveLength(0)
    // The status line's read is the only call: one list_pending at start.
    expect(w.calls.map(call => `${call.tool}:${String(call.args.action)}`)).toEqual(['orgx_decide:list_pending'])
    w.assertOnlyAllowedCalls()
  })
})

describe('capture summary', () => {
  test('sends one counts-only payload per turn that used tools', { options: { capture: 'summary', initiative: INITIATIVE } }, async ($, on) => {
    const w = world(on, call => (call.tool === 'orgx_emit_activity' ? OK : pendingResult([])))
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })

    await $.turn.start({ text: 'fix the SECRET=abc leak in /work/repo/src/a.ts', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/work/repo/src/a.ts', tool_use_id: 'u0' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/repo/src/a.ts', old_string: 'SECRET=abc', new_string: 'x', tool_use_id: 'u1' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/repo/src/a.ts', old_string: 'y', new_string: 'z', tool_use_id: 'u2' })
    await $.tool.call({ tool: 'Write', file_path: '/home/someone/.ssh/config', content: 'Host *', tool_use_id: 'u3' })
    await $.tool.call({ tool: 'Bash', command: 'cat .env && echo $GITHUB_TOKEN', tool_use_id: 'u4' })
    await $.tool.call({ tool: 'Bash', command: 'make fail', tool_use_id: 'u5' })
    await $.tool.call({ tool: 'mcp__claude_ai_Gmail__send_message', to: 'boss@example.com', tool_use_id: 'u6' })
    await $.turn.complete({ answer: 'Fixed /work/repo/src/a.ts', durationMs: 48_200, isAborted: false, turnId: 't1', reason: 'answer' })

    // Debounced: nothing goes out while the turn's summary waits.
    expect(w.emitted()).toHaveLength(0)
    await w.clock.advance(3_000)
    expect(w.emitted()).toHaveLength(1)

    const args = w.emitted()[0]!.args
    expect(args).toMatchObject({
      initiative_id: INITIATIVE,
      source_client: 'claude-code',
      phase: 'execution',
      level: 'warn',
      message: 'Claude Code turn 1: 7 tool calls (Bash 2, Edit 2, Read 1, Write 1, mcp 1), 2 files changed, 1 failed, 48s',
      metadata: {
        schema: 'orgx-live.turn-summary.v1',
        capture: 'summary',
        turn: 1,
        tool_calls: 7,
        tools: { Read: 1, Edit: 2, Write: 1, Bash: 2, mcp: 1 },
        failed_tool_calls: 1,
        files_changed: 2,
        subagent_tool_calls: 0,
        duration_ms: 48_200,
        outcome: 'answer',
      },
    })
    expect(String(args.correlation_id)).toMatch(/^claude-code:[0-9a-f-]{36}$/u)

    // Redaction: no path, prompt, answer, command, output, secret or server name.
    const sent = JSON.stringify(args)
    expect(sent.includes('/'), `a path-like value was sent: ${sent}`).toBe(false)
    for (const leaked of ['src', 'a.ts', '.ssh', 'SECRET', 'GITHUB_TOKEN', '.env', 'make', 'cat ', 'Gmail', 'claude_ai', 'boss@', 'Fixed', 'leak', 'contents of', 'permission denied', 'Host']) {
      expect(sent.includes(leaked), `sent ${leaked}`).toBe(false)
    }

    // A second turn sends a second summary; a turn without tools sends none.
    await $.turn.start({ text: 'and again', turnId: 't2' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'u7' })
    await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't2', reason: 'answer' })
    await $.turn.start({ text: 'what does this do?', turnId: 't3' })
    await $.turn.complete({ answer: 'It parses.', durationMs: 900, isAborted: false, turnId: 't3', reason: 'answer' })
    await w.clock.advance(3_000)

    expect(w.emitted()).toHaveLength(2)
    expect(w.emitted()[1]!.args).toMatchObject({
      level: 'info',
      message: 'Claude Code turn 2: 1 tool call (Bash 1), 0 files changed, 1s',
      metadata: { turn: 2, tool_calls: 1, files_changed: 0 },
    })
    expect(w.emitted()[1]!.args.correlation_id).toBe(args.correlation_id)
    w.assertOnlyAllowedCalls()
  })

  test('attributes to the initiative orgx_bootstrap bound, and skips without one', { options: { capture: 'summary' } }, async ($, on) => {
    let bound: string | null = null
    const w = world(on, call =>
      call.tool === 'orgx_bootstrap'
        ? { content: [{ type: 'text', text: 'ready' }], isError: false, structuredContent: { initiative: bound ? { id: bound } : null } }
        : OK,
    )
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })

    // Nothing bound: the summary is skipped, counted, and nothing is emitted.
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'u1' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(3_000)
    expect(w.emitted()).toHaveLength(0)
    expect(w.calls.filter(call => call.tool === 'orgx_bootstrap')).toHaveLength(1)
    expect(w.statuses[w.statuses.length - 1]).toBe('OrgX · capture needs an initiative')

    // The model binds one through orgx_bootstrap: later turns are attributed to it.
    bound = INITIATIVE
    await $.turn.start({ text: 'y', turnId: 't2' })
    await $.tool.call({ tool: 'mcp__plugin_orgx-live_orgx__orgx_bootstrap', initiative_id: INITIATIVE, tool_use_id: 'u2' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' })
    await w.clock.advance(3_000)
    expect(w.emitted()).toHaveLength(1)
    expect(w.emitted()[0]!.args.initiative_id).toBe(INITIATIVE)
    expect(w.statuses[w.statuses.length - 1]).toBeUndefined()
    w.assertOnlyAllowedCalls()
  })

  test('an OrgX failure never reaches the tool call or the turn', { options: { capture: 'summary', initiative: INITIATIVE } }, async ($, on) => {
    let isDown = true
    const w = world(on, call => {
      if (isDown) throw new Error('network down')
      return call.tool === 'orgx_emit_activity' ? OK : pendingResult([])
    })
    await $.session.start({ cwd: '/work/repo', surface: 'terminal', isInteractive: true })
    await w.clock.settle()

    await $.turn.start({ text: 'x', turnId: 't1' })
    const ran = await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.ts', old_string: 'a', new_string: 'b', tool_use_id: 'u1' })
    expect(ran).toMatchObject({ result: { ok: true } })
    const failed = await $.tool.call({ tool: 'Bash', command: 'make fail', tool_use_id: 'u2' })
    expect(failed).toMatchObject({ isError: true, text: 'exit 1' })
    const done = await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe('')
    await w.clock.advance(3_000)

    // The summary was attempted, failed quietly, and left one status note.
    expect(w.emitted()).toHaveLength(1)
    expect(w.statuses.filter(text => text !== undefined)).toEqual(['OrgX · unreachable'])

    // Once OrgX answers again, the next refresh clears the note.
    isDown = false
    await w.clock.advance(5 * 60_000)
    expect(w.statuses[w.statuses.length - 1]).toBeUndefined()
  })

  test('an MCP error result is counted, not thrown', { options: { capture: 'summary', initiative: INITIATIVE } }, async ($, on) => {
    const w = world(on, call =>
      call.tool === 'orgx_emit_activity' ? { content: [{ type: 'text', text: 'initiative not found' }], isError: true } : pendingResult([]),
    )
    await $.session.start({ cwd: '/work/repo', surface: null, isInteractive: false })
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'u1' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(3_000)
    expect(w.emitted()).toHaveLength(1)
    const ui = await $.ui.mount({
      plugin: 'orgx-live',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'orgx-needs-you',
      props: { title: 'OrgX', isFocused: false, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /^now failed · Claude Code turn 1: / })).toBeDefined()
    await ui.unmount()
  })
})

describe('status line', () => {
  test('stays quiet at 0 and shows N when decisions wait', async ($, on) => {
    let decisions: unknown[] = []
    const w = world(on, () => pendingResult(decisions))
    await $.session.start({ cwd: '/work/repo', surface: 'terminal', isInteractive: true })
    await w.clock.settle()
    expect(w.statuses.filter(text => text !== undefined)).toEqual([])

    decisions = [decision(DECISION_A, 'high', 2), decision(DECISION_B, 'low', 30), decision(DECISION_C, 'medium', 1)]
    await w.clock.advance(5 * 60_000)
    expect(w.statuses[w.statuses.length - 1]).toBe('OrgX · 3 need you')

    decisions = [decision(DECISION_A, 'high', 2)]
    await w.clock.advance(5 * 60_000)
    expect(w.statuses[w.statuses.length - 1]).toBe('OrgX · 1 needs you')

    decisions = []
    await w.clock.advance(5 * 60_000)
    expect(w.statuses[w.statuses.length - 1]).toBeUndefined()

    // At most one read per refresh period.
    expect(w.calls).toHaveLength(4)
    w.assertOnlyAllowedCalls()
  })
})

describe('needs-you pane', () => {
  test('the command opens the pane, which lists decisions with links to OrgX', async ($, on) => {
    const w = world(on, () =>
      pendingResult([
        decision(DECISION_B, 'low', 50),
        decision(DECISION_A, 'high', 3, {
          initiative_id: INITIATIVE,
          review_url: `https://useorgx.com/decisions/${DECISION_A}`,
          review_packet: { question: 'Ship the parser rewrite behind a flag?', recommendation: { status: 'ready', action: 'Approve with the flag off by default' } },
        }),
      ]),
    )
    await $.session.start({ cwd: '/work/repo', surface: 'terminal', isInteractive: true })
    await w.clock.settle()

    const ran = await $.command.run({
      command: 'orgx-needs-you',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })
    expect(ran.text).toBe('Opened the OrgX needs-you pane.')
    expect(w.opened).toEqual(['orgx-needs-you'])

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'orgx-live',
        surface,
        component: 'Pane',
        requestId: 'orgx-needs-you',
        props: { title: 'OrgX · needs you', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
        viewport: { columns: 160, rows: 40, isFullscreen: true },
      })
      expect(await ui.find({ type: 'Text', text: '2 decisions need you' })).toBeDefined()
      const rows = await ui.findAll({ type: 'Text', text: /· / })
      // Most urgent first, with urgency, age and question.
      expect(rows[0]?.text).toBe('high · 3h · Ship the parser rewrite behind a flag?')
      expect(rows[1]?.text).toBe('low · 2d · Title 2222')
      expect(await ui.find({ type: 'Text', text: 'Recommended: Approve with the flag off by default' })).toBeDefined()
      const links = await ui.findAll({ type: 'Link' })
      expect(links.map(link => link.props.href)).toEqual([
        `https://useorgx.com/decisions/${DECISION_A}`,
        `https://useorgx.com/decisions/${DECISION_B}`,
      ])
      expect(links.every(link => link.text === 'Open in OrgX')).toBe(true)
      expect(await ui.find({ type: 'Text', text: /Capture is off/ })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeDefined()
      await ui.unmount()
    }
    w.assertOnlyAllowedCalls()
  })

  test('shows the last captured turns when capture is on', { options: { capture: 'summary', initiative: INITIATIVE } }, async ($, on) => {
    const w = world(on, call => (call.tool === 'orgx_emit_activity' ? OK : pendingResult([])))
    await $.session.start({ cwd: '/work/repo', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.ts', old_string: 'a', new_string: 'b', tool_use_id: 'u1' })
    await $.turn.complete({ answer: '', durationMs: 2_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(3_000)

    const ui = await $.ui.mount({
      plugin: 'orgx-live',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'orgx-needs-you',
      props: { title: 'OrgX', isFocused: false, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: 'Nothing needs you in OrgX.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'now sent · Claude Code turn 1: 1 tool call (Edit 1), 1 file changed, 2s' })).toBeDefined()
    await ui.unmount()
  })
})
