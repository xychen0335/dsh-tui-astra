/** Unicode grapheme helpers retained for provider-form editing and tests. */

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Return the preceding Unicode grapheme boundary for a UTF-16 offset. */
export function previousGraphemeBoundary(text: string, offset: number): number {
  let previous = 0
  for (const segment of graphemeSegmenter.segment(text)) {
    if (segment.index >= offset) break
    previous = segment.index
  }
  return previous
}

/** Return the following Unicode grapheme boundary for a UTF-16 offset. */
export function nextGraphemeBoundary(text: string, offset: number): number {
  for (const segment of graphemeSegmenter.segment(text)) {
    if (segment.index > offset) return segment.index
  }
  return text.length
}
