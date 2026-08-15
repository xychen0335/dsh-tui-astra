/**
 * App mount for the imperative pi-tui composition root.
 */

import type { Terminal } from '@earendil-works/pi-tui'
import type { HarnessBridge } from './harness/bridge.ts'
import type { Store } from './store.ts'
import { mountApp as mountImperativeApp, type AstraApp } from './ui/app.ts'

export function mountApp(
  store: Store,
  bridge: HarnessBridge,
  quit: () => void,
  sessionRoot: string,
  terminal?: Terminal,
): AstraApp {
  return mountImperativeApp(store, bridge, quit, sessionRoot, terminal)
}
