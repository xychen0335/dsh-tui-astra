/**
 * Store — the TUI's single source of truth.
 *
 * Applies classified {@link UiAction}s to a render snapshot and notifies
 * subscribers. Deliberately framework-free: the UI connects via
 * {@link useStore}. All state transitions happen in {@link applyMany};
 * nothing outside this module mutates the snapshot.
 *
 * @module dsh-tui-astra/store
 */

import { useSyncExternalStore } from 'react'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { TodoItem } from '@deepseek-ai/dsh-session'
import type { UiAction } from './harness/events.ts'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  reasoning: string
  streaming: boolean
  usage?: TokenUsage
}

export type ActivityKind = 'tool' | 'turn' | 'step' | 'subagent' | 'status' | 'note' | 'error'

export interface Activity {
  id: number
  time: number
  kind: ActivityKind
  text: string
  detail?: string
  error: boolean
}

export interface UiState {
  phase: 'starting' | 'idle' | 'running' | 'error'
  sessionId: string | null
  provider: string
  model: string
  workspace: string
  messages: readonly ChatMessage[]
  activities: readonly Activity[]
  todos: readonly TodoItem[]
  error: string | null
}

const MAX_ACTIVITIES = 300

export class Store {
  private state: UiState
  private readonly listeners = new Set<() => void>()
  private activitySeq = 0
  private readonly toolNames = new Map<string, string>()

  constructor(initial: { provider: string; model: string; workspace: string }) {
    this.state = {
      phase: 'starting',
      sessionId: null,
      provider: initial.provider,
      model: initial.model,
      workspace: initial.workspace,
      messages: [],
      activities: [],
      todos: [],
      error: null,
    }
  }

  /** The current immutable snapshot. */
  getState(): UiState {
    return this.state
  }

  /** Subscribe to snapshot changes. @returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Apply actions in order, notifying at most once when anything changed. */
  applyMany(actions: readonly UiAction[]): void {
    let changed = false
    for (const action of actions) changed = this.apply(action) || changed
    if (changed) {
      for (const listener of this.listeners) listener()
    }
  }

  /** Publish the active session id (after /new or an explicit --session). */
  setSessionId(sessionId: string): void {
    if (this.state.sessionId === sessionId) return
    this.state = { ...this.state, sessionId }
    for (const listener of this.listeners) listener()
  }

  private apply(action: UiAction): boolean {
    switch (action.kind) {
      case 'phase': {
        if (this.state.phase === action.status) return false
        this.state = { ...this.state, phase: action.status }
        return true
      }
      case 'user-message': {
        if (action.injected) {
          this.pushActivity('note', `context: ${firstLine(action.text)}`, false)
          return true
        }
        this.state = {
          ...this.state,
          messages: [...this.state.messages, {
            id: action.id,
            role: 'user',
            text: action.text,
            reasoning: '',
            streaming: false,
          }],
        }
        return true
      }
      case 'assistant-text': {
        const messages = this.state.messages
        const last = messages[messages.length - 1]
        if (last !== undefined && last.role === 'assistant' && last.streaming) {
          const updated = { ...last, text: last.text + action.text }
          this.state = { ...this.state, messages: [...messages.slice(0, -1), updated] }
        } else {
          this.state = {
            ...this.state,
            messages: [...messages, {
              id: `assistant-${messages.length}`,
              role: 'assistant',
              text: action.text,
              reasoning: '',
              streaming: true,
            }],
          }
        }
        return true
      }
      case 'assistant-reasoning': {
        const messages = this.state.messages
        const last = messages[messages.length - 1]
        if (last === undefined || last.role !== 'assistant' || !last.streaming) return false
        const updated = { ...last, reasoning: last.reasoning + action.text }
        this.state = { ...this.state, messages: [...messages.slice(0, -1), updated] }
        return true
      }
      case 'assistant-done': {
        const messages = this.state.messages
        const last = messages[messages.length - 1]
        if (last === undefined || last.role !== 'assistant' || !last.streaming) return false
        const updated = { ...last, streaming: false, usage: action.usage }
        this.state = { ...this.state, messages: [...messages.slice(0, -1), updated] }
        return true
      }
      case 'tool-call': {
        this.toolNames.set(action.callId, action.name)
        this.pushActivity('tool', `${action.name} ${action.args}`, false)
        return true
      }
      case 'tool-result': {
        const name = this.toolNames.get(action.callId) ?? 'tool'
        const label = action.ok ? `${name} → ok` : `${name} → error`
        this.pushActivity('tool', label, !action.ok, action.summary)
        return true
      }
      case 'todos': {
        this.state = { ...this.state, todos: action.todos }
        return true
      }
      case 'context': {
        if (this.state.provider === action.provider && this.state.model === action.model) return false
        this.state = { ...this.state, provider: action.provider, model: action.model }
        return true
      }
      case 'turn':
        this.pushActivity('turn', action.text, false)
        return true
      case 'step':
        this.pushActivity('step', action.text, false)
        return true
      case 'subagent': {
        this.pushActivity('subagent', action.text, action.ok === false)
        return true
      }
      case 'note':
        this.pushActivity('note', action.text, false)
        return true
      case 'error': {
        this.pushActivity('error', action.text, true)
        this.state = { ...this.state, phase: 'error', error: action.text }
        return true
      }
    }
  }

  private pushActivity(kind: ActivityKind, text: string, error: boolean, detail?: string): void {
    const activity: Activity = {
      id: this.activitySeq++,
      time: Date.now(),
      kind,
      text,
      detail,
      error,
    }
    const activities = [...this.state.activities, activity]
    const trimmed = activities.length > MAX_ACTIVITIES
      ? activities.slice(activities.length - MAX_ACTIVITIES)
      : activities
    this.state = { ...this.state, activities: trimmed }
  }
}

/** React binding: re-render whenever the store snapshot changes. */
export function useStore(store: Store): UiState {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
    () => store.getState(),
  )
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? ''
  return line.length <= 100 ? line : `${line.slice(0, 99)}…`
}
