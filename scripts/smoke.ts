/** One-shot bridge smoke test: spawn the runtime, handshake, prompt, close. */
import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'
import { resolveRuntimeBin, defaultCordisPath } from '../src/config.ts'

const bin = resolveRuntimeBin()
const cordis = defaultCordisPath()
console.log('runtime bin:', bin)
console.log('cordis:', cordis)

const client = new HarnessClient({
  command: 'node',
  args: [bin, cordis],
  cwd: process.cwd(),
  env: { ...process.env, DSH_CWD: process.cwd() },
  requestTimeoutMs: 30_000,
})

const seen: string[] = []
const sub = client.subscribe()
void (async () => {
  for await (const n of sub) {
    seen.push(n.method)
    if (n.method === 'session.event') {
      const { event } = n.params as { event: { type: string } }
      console.log('event:', event.type)
      if (event.type === 'assistant/message') {
        console.log('ASSISTANT MESSAGE ARRIVED — smoke test OK')
        await client.close()
        process.exit(0)
      }
    }
  }
})()

try {
  client.start()
  const info = await client.initialize({ cwd: process.cwd(), provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  console.log('initialize OK:', info.serverInfo?.name, info.serverInfo?.version)
  const messageId = await client.prompt('session-smoke', [{ type: 'text', text: 'reply with exactly: smoke-ok' }])
  console.log('prompt queued:', messageId)
  setTimeout(() => {
    console.error('TIMEOUT waiting for assistant message; seen:', seen.join(', '))
    void client.close().then(() => process.exit(1))
  }, 60_000)
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error)
  await client.close()
  process.exit(1)
}
