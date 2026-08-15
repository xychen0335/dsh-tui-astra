/**
 * App mount — keeps JSX out of the plain-TS entry point.
 *
 * @module dsh-tui-astra/mount
 */

import { render } from 'ink'
import type { Instance } from 'ink'
import type { HarnessBridge } from './harness/bridge.ts'
import type { Store } from './store.ts'
import { AstraApp } from './ui/app.tsx'

/**
 * Render the TUI.
 * @param store - the UI state store.
 * @param bridge - the runtime bridge.
 * @param quit - clean-shutdown callback (Ctrl+C / /quit / SIGTERM).
 * @returns the Ink instance handle.
 */
export function mountApp(store: Store, bridge: HarnessBridge, quit: () => void): Instance {
  return render(<AstraApp store={store} bridge={bridge} quit={quit} />, {
    exitOnCtrlC: false,
  })
}
