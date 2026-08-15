/**
 * Wire-notification → UI-action classification.
 *
 * Turns the runtime's open-ended `session.event` stream plus the
 * `session.status` / `subagent.*` notifications into a closed set of UI
 * actions the store applies to its render state. Unknown methods and
 * unknown session-event types are skipped (the log is merge-extensible);
 * nothing here ever throws on a foreign payload.
 *
 * @module dsh-tui-astra/harness/events
 */

import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type {} from '@deepseek-ai/dsh-commands'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TodoItem } from '@deepseek-ai/dsh-session'

/** One closed UI action derived from a wire notification. */
export type UiAction =
  | { kind: 'phase'; status: 'idle' | 'running' }
  | { kind: 'user-message'; id: string; text: string; injected: boolean }
  | { kind: 'assistant-text'; text: string }
  | { kind: 'assistant-reasoning'; text: string }
  | { kind: 'assistant-done'; usage?: TokenUsage }
  | { kind: 'tool-call'; callId: string; name: string; args: string }
  | { kind: 'tool-result'; callId: string; ok: boolean; summary: string }
  | { kind: 'command-start'; commandId: string; name: string; args?: string }
  | { kind: 'command-done'; commandId: string; name?: string; ok: boolean; text?: string }
  | { kind: 'todos'; todos: readonly TodoItem[] }
  | { kind: 'context'; provider: string; model: string }
  | { kind: 'turn'; text: string }
  | { kind: 'step'; text: string }
  | { kind: 'subagent'; id: string; status: 'started' | 'finished'; ok?: boolean }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string }

/** Text blocks joined from a message's content; non-text blocks contribute nothing. */
export function contentToText(blocks: readonly ContentBlock[]): string {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text' || block.type === 'reasoning') text += block.text
  }
  return text
}

const MAX_TOOL_SUMMARY_CHARS = 160

/**
 * One-line summary of a tool result for the activity panel.
 * @param blocks - the tool-result message content; the nested
 * `tool-result` wrapper is unwrapped before text extraction.
 */
export function toolResultSummary(blocks: readonly ContentBlock[]): string {
  let inner = blocks
  const first = blocks[0]
  if (first !== undefined && first.type === 'tool-result') inner = first.content
  const text = contentToText(inner).trim()
  if (text.length === 0) return '(no output)'
  const singleLine = text.replaceAll(/\s+/g, ' ')
  return singleLine.length <= MAX_TOOL_SUMMARY_CHARS
    ? singleLine
    : `${singleLine.slice(0, MAX_TOOL_SUMMARY_CHARS - 1)}…`
}

/** One-line ellipsized rendering of raw tool arguments JSON. */
export function argsSummary(args: string): string {
  const singleLine = args.replaceAll(/\s+/g, ' ')
  return singleLine.length <= 120 ? singleLine : `${singleLine.slice(0, 119)}…`
}

/** Classify one durable session event, also used to rebuild a resumed transcript. */
export function classifySessionEvent(event: SessionEvent): UiAction[] {
  switch (event.type) {
    case 'user/message': {
      const text = contentToText(event.data.content)
      const injected = event.data.source.kind !== 'user'
      return [{ kind: 'user-message', id: event.data.id, text, injected }]
    }
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') return [{ kind: 'assistant-text', text: chunk.text }]
      if (chunk.type === 'reasoning-delta') return [{ kind: 'assistant-reasoning', text: chunk.text }]
      return []
    }
    case 'assistant/message':
      return [{ kind: 'assistant-done', usage: event.data.usage }]
    case 'tool/call':
      return [{
        kind: 'tool-call',
        callId: event.data.callId,
        name: event.data.name,
        args: argsSummary(event.data.arguments),
      }]
    case 'tool/result': {
      const first = event.data.message.content[0]
      const callId = first !== undefined && first.type === 'tool-result' ? first.toolCallId : ''
      return [{
        kind: 'tool-result',
        callId,
        ok: event.data.error === undefined,
        summary: toolResultSummary(event.data.message.content),
      }]
    }
    case 'command/run':
      return [{
        kind: 'command-start',
        commandId: String(event.data.commandId),
        name: event.data.name,
        ...(event.data.args === undefined ? {} : { args: event.data.args }),
      }]
    case 'command/done':
      return [{
        kind: 'command-done',
        commandId: String(event.data.commandId),
        ok: event.data.kind === 'success',
        ...(event.data.text === undefined ? {} : { text: event.data.text }),
      }]
    case 'todo/write':
      return [{ kind: 'todos', todos: event.data.todos }]
    case 'request/context':
      return [{ kind: 'context', provider: event.data.provider, model: event.data.model }]
    case 'turn/start':
      return [{ kind: 'turn', text: `turn ${event.data.turn} started` }]
    case 'turn/end': {
      const turn = { kind: 'turn' as const, text: `turn ${event.data.turn} ended (${event.data.reason.kind})` }
      if (event.data.reason.kind !== 'error') return [turn]
      return [turn, { kind: 'error', text: `${event.data.reason.error.message} (${event.data.reason.error.code})` }]
    }
    case 'step/start':
      return [{ kind: 'step', text: `step ${event.data.step} of turn ${event.data.turn}` }]
    case 'step/end':
      return [{ kind: 'step', text: `step ${event.data.step} done` }]
    default:
      return []
  }
}

/**
 * Classify one wire notification into UI actions.
 *
 * Notifications for sessions other than the active root session are
 * dropped: the SDK subscription covers every session in the runtime, and
 * subagent/old-session events must not leak into the root chat or status.
 * (Subagent lifecycle stays visible through `subagent.started/finished`.)
 *
 * @param notification - one server→client notification off the SDK stream.
 * @param rootSessionId - the session the TUI currently owns.
 * @returns the actions to apply, in order; `[]` when nothing is displayable.
 */
export class NotificationClassifier {
  private rootSessionId: string | undefined
  private readonly sessionTree = new Set<string>()

  /** Classify one notification against the current root-session tree. */
  classify(notification: HarnessNotification, rootSessionId: string): UiAction[] {
    if (this.rootSessionId !== rootSessionId) {
      this.rootSessionId = rootSessionId
      this.sessionTree.clear()
      this.sessionTree.add(rootSessionId)
    }

    const params = notification.params as Record<string, unknown>
    switch (notification.method) {
      case 'session.event': {
        const sessionId = (params as { sessionId?: string }).sessionId
        if (sessionId !== undefined && sessionId !== rootSessionId) return []
        const event = (params as { event?: SessionEvent }).event
        if (event === undefined) {
          // Bridge-injected transport failure (delivery loop rejection).
          const error = (params as { error?: unknown }).error
          return error === undefined ? [] : [{ kind: 'error', text: `transport: ${String(error)}` }]
        }
        if (typeof event.type !== 'string') return []
        return classifySessionEvent(event)
      }
      case 'session.status': {
        const sessionId = (params as { sessionId?: string }).sessionId
        if (sessionId !== undefined && sessionId !== rootSessionId) return []
        const status = (params as { status?: 'idle' | 'running' }).status
        if (status !== 'idle' && status !== 'running') return []
        return [{ kind: 'phase', status }]
      }
      case 'subagent.started': {
        const p = params as { parentSessionId?: string; childSessionId?: string }
        if (p.parentSessionId === undefined || p.childSessionId === undefined) return []
        if (!this.sessionTree.has(p.parentSessionId)) return []
        this.sessionTree.add(p.childSessionId)
        return [{ kind: 'subagent', id: p.childSessionId, status: 'started' }]
      }
      case 'subagent.finished': {
        const p = params as { parentSessionId?: string; childSessionId?: string; status?: 'ok' | 'error' }
        if (p.childSessionId === undefined) return []
        const related = this.sessionTree.has(p.childSessionId)
          || (p.parentSessionId !== undefined && this.sessionTree.has(p.parentSessionId))
        if (!related) return []
        return [{
          kind: 'subagent',
          id: p.childSessionId,
          status: 'finished',
          ok: p.status !== 'error',
        }]
      }
      default:
        return []
    }
  }
}
