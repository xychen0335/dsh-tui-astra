import { chmod } from 'node:fs/promises'

await chmod(new URL('../lib/index.js', import.meta.url), 0o755)
