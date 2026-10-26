// The orgx-live mod's $.state contract: the values its status line and pane
// draw from. Owned and written by orgx-live alone.

/** One decision waiting on the person, as the pane draws it. */
export type OrgxLivePendingDecision = {
  id: string
  question: string
  urgency: 'low' | 'medium' | 'high' | 'critical'
  /** ISO time the decision was raised, when OrgX said. */
  createdAt: string | null
  /** OrgX's recommended action, when the review packet carries one. */
  recommendation: string | null
  /** Where the person decides: the decision's page in OrgX (https). */
  reviewUrl: string
}

/** The last read of pending decisions. */
export type OrgxLivePending = {
  /** How many decisions need the person; null before the first good read. */
  count: number | null
  decisions: OrgxLivePendingDecision[]
  /** $.clock time of the last read attempt, good or not. */
  checkedAt: number | null
}

/**
 * Whether OrgX answered the last call: `auth` means the server needs sign-in
 * through /mcp, `unreachable` that it failed or could not be connected.
 */
export type OrgxLiveReach = {
  status: 'unknown' | 'ok' | 'auth' | 'unreachable'
  /** One plain sentence about the last failure; never the server's raw text. */
  note: string | null
}

/** One turn summary the mod queued, sent, or could not send. */
export type OrgxLiveActivityRow = {
  turn: number
  at: number
  message: string
  status: 'queued' | 'sent' | 'failed' | 'skipped'
}

/** Capture counters and attribution for this session. */
export type OrgxLiveCapture = {
  /** Turns with tool calls summarized so far; numbers the next one. */
  turns: number
  sent: number
  failed: number
  skipped: number
  /** Why the latest summary was skipped, when it was; null once one is sent. */
  skipReason: string | null
  /** Random per-session id OrgX groups this session's summaries under. */
  correlationId: string | null
  /** The initiative summaries are attributed to, once known. */
  initiativeId: string | null
  initiativeSource: 'config' | 'bootstrap' | null
  /** Whether the mod already asked orgx_bootstrap for the bound initiative. */
  bootstrapAsked: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'orgx-live': {
      pending: OrgxLivePending
      reach: OrgxLiveReach
      activity: OrgxLiveActivityRow[]
      capture: OrgxLiveCapture
    }
  }
}
