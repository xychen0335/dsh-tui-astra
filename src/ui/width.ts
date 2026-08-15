import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

/** Clamp a component width without ever expanding the caller's width. */
export function terminalWidth(width: number): number {
  return Math.max(0, Math.floor(width))
}

/** Truncate a styled or Unicode string by terminal cell width. */
export function fitTerminalText(text: string, width: number, ellipsis = '…'): string {
  const maxWidth = terminalWidth(width)
  return visibleWidth(text) <= maxWidth ? text : truncateToWidth(text, maxWidth, ellipsis)
}

/**
 * Render a compact box whose every output row is at most `width` cells.
 *
 * Very narrow overlays cannot retain both padding and borders. They degrade
 * to thinner borders rather than widening past the renderer's contract.
 */
export function boxedLines(lines: readonly string[], width: number): string[] {
  const frameWidth = terminalWidth(width)
  if (frameWidth === 0) return []
  if (frameWidth === 1) return lines.map((line) => fitTerminalText(line, 1, ''))
  if (frameWidth === 2) {
    return ['┌┐', ...lines.map(() => '││'), '└┘']
  }
  if (frameWidth === 3) {
    return ['┌─┐', ...lines.map((line) => `│${fitTerminalText(line, 1, '')}│`), '└─┘']
  }

  const contentWidth = frameWidth - 4
  const top = `┌${'─'.repeat(frameWidth - 2)}┐`
  const bottom = `└${'─'.repeat(frameWidth - 2)}┘`
  const content = lines.map((line) => {
    const clipped = fitTerminalText(line, contentWidth)
    return `│ ${clipped}${' '.repeat(Math.max(0, contentWidth - visibleWidth(clipped)))} │`
  })
  return [top, ...content, bottom]
}
