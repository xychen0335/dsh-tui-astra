/**
 * Terminal size tracking with resize support.
 *
 * Ink re-renders on keystrokes but not on terminal resize, so panels that
 * compute their own height listen to the stdout resize event explicitly.
 *
 * @module dsh-tui-astra/ui/size
 */

import { useEffect, useState } from 'react'
import { useStdout } from 'ink'

export interface TerminalSize {
  columns: number
  rows: number
}

/** Current terminal size, updated on resize. */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout()
  const [size, setSize] = useState<TerminalSize>({ columns: stdout.columns, rows: stdout.rows })

  useEffect(() => {
    const update = (): void => {
      setSize({ columns: stdout.columns, rows: stdout.rows })
    }
    stdout.on('resize', update)
    return () => {
      stdout.off('resize', update)
    }
  }, [stdout])

  return size
}
