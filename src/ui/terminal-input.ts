/** Terminal control reports that Ink may surface as ordinary input text. */

/** Return whether input contains an SGR mouse press/release report. */
export function isMouseReport(input: string): boolean {
  return /\[<\d+;\d+;\d+[Mm]/u.test(input)
}
