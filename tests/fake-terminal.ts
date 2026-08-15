import type { Terminal } from '@earendil-works/pi-tui'

/**
 * Deterministic terminal seam for TUI regression tests.
 *
 * It records control output and forwards synthetic input/resize events
 * without enabling mouse tracking or an alternate screen.
 */
export class FakeTerminal implements Terminal {
  private inputHandler: ((data: string) => void) | undefined
  private resizeHandler: (() => void) | undefined
  private readonly writes: string[] = []
  private _columns: number
  private _rows: number
  started = false

  constructor(columns = 80, rows = 24) {
    this._columns = columns
    this._rows = rows
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput
    this.resizeHandler = onResize
    this.started = true
  }

  stop(): void {
    this.inputHandler = undefined
    this.resizeHandler = undefined
    this.started = false
  }

  async drainInput(): Promise<void> {}

  write(data: string): void {
    this.writes.push(data)
  }

  get columns(): number {
    return this._columns
  }

  get rows(): number {
    return this._rows
  }

  get kittyProtocolActive(): boolean {
    return false
  }

  moveBy(lines: number): void {
    if (lines > 0) this.write(`\u001b[${lines}B`)
    else if (lines < 0) this.write(`\u001b[${-lines}A`)
  }

  hideCursor(): void {
    this.write('\u001b[?25l')
  }

  showCursor(): void {
    this.write('\u001b[?25h')
  }

  clearLine(): void {
    this.write('\u001b[K')
  }

  clearFromCursor(): void {
    this.write('\u001b[J')
  }

  clearScreen(): void {
    this.write('\u001b[2J\u001b[H')
  }

  setTitle(title: string): void {
    this.write(`\u001b]0;${title}\u0007`)
  }

  setProgress(active: boolean): void {
    this.write(active ? '\u001b]9;4;3\u0007' : '\u001b]9;4;0\u0007')
  }

  sendInput(data: string): void {
    this.inputHandler?.(data)
  }

  resize(columns: number, rows: number): void {
    this._columns = columns
    this._rows = rows
    this.resizeHandler?.()
  }

  getOutput(): string {
    return this.writes.join('')
  }

  clearOutput(): void {
    this.writes.length = 0
  }
}
