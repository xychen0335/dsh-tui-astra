/** Compact live footer. */

import type { Component } from '@earendil-works/pi-tui'
import type { UiState } from '../store.ts'
import { fitTerminalText } from './width.ts'

export class StatusComponent implements Component {
  constructor(private state: UiState) {}

  update(state: UiState): void {
    this.state = state
  }

  render(width: number): string[] {
    let ok = 0
    let failed = 0
    for (const activity of this.state.activities) {
      if (activity.kind !== 'tool' || activity.result !== true) continue
      if (activity.error) failed += 1
      else ok += 1
    }
    const todos = todoText(this.state)
    const outcomes = ok + failed === 0 ? '' : ` · tools ${ok}✓ ${failed}✗`
    const agents = this.state.activeSubagents === 0 ? '' : ` · agents ${this.state.activeSubagents}`
    const progress = todos === '' ? '' : ` · ${todos}`
    const hint = this.state.phase === 'running' ? 'Esc interrupt' : '/ commands'
    const text = `${hint} · ${this.state.provider}/${this.state.model} · ${this.state.workspace}${progress}${agents}${outcomes}`
    return [`\u001b[90m${fitTerminalText(text, Math.max(0, width - 2))}\u001b[0m`]
  }

  invalidate(): void {}
}

function todoText(state: UiState): string {
  if (state.todos.length === 0) return ''
  const done = state.todos.filter((todo) => todo.status === 'completed').length
  const active = state.todos.find((todo) => todo.status === 'in_progress')
  return `${done}/${state.todos.length} todos${active === undefined ? '' : ` · ${active.content.slice(0, 40)}`}`
}
