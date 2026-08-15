# dsh-tui-astra

A terminal TUI client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It spawns the DSH JSON-RPC runtime (`dsh-jsonrpc-agent`) as a subprocess, drives agent turns over stdio JSON-RPC, and renders the live session stream in a split-pane terminal UI.

```
┌──────────────────────────────────────────────────────────────┐
│ ● dsh-tui-astra · session-a1b2c3   deepseek-official/deepseek-v4-flash │
├───────────────────────────────────────────┬──────────────────┤
│ ❯ you                                    │ ⚙ bash ls -la    │
│                                           │ ✔ bash → ok      │
│ ◈ dsh                                    │ ▸ turn 1 started │
│ Here's what I found…                     │ ⓘ context: …     │
├───────────────────────────────────────────┴──────────────────┤
│ idle · 1/3 todos · tools 1✓ 0✗                               │
│ ❯ ask the agent — Enter sends, Tab switches panels            │
└──────────────────────────────────────────────────────────────┘
```

## Features

- **Live agent stream** — `session.event` notifications render as they are
  recorded: user/assistant messages, streaming chunks, tool calls and
  results, turn/step boundaries, todo updates, and subagent lifecycle.
- **Split-pane UI** — conversation on the left, activity stream on the
  right; both panels scroll independently (PageUp/PageDown/arrows when
  focused).
- **Session control** — `/new [id]` starts or resumes a session; sessions
  persist as JSONL under `.sessions/` (or `$DSH_SESSION_ROOT`).
- **Clean shutdown** — Ctrl+C, `/quit`, or SIGTERM close the runtime
  subprocess cleanly (protocol shutdown → EOF → SIGTERM → SIGKILL ladder).

## Requirements

- Node.js >= 22.19
- A `DEEPSEEK_API_KEY` (the runtime calls the DeepSeek API for agent turns)

## Install & run

```sh
pnpm install
pnpm build
node lib/index.js --cwd /path/to/workspace
```

Or directly from source during development:

```sh
pnpm dev -- --cwd /path/to/workspace
```

The runtime composition is [`runtime/tui.cordis.yml`](runtime/tui.cordis.yml):
a coding agent (agent-spine demo bundle) with bash, filesystem tools,
subagent delegation, todo tracking, JSONL session persistence, and basic
context compaction. Override it with `--cordis <path>` for custom tooling.

## Options

```
--cwd <dir>           agent workspace (bash/fs root) [default: current dir]
--model <name>        model id [default: $DSH_MODEL or deepseek-v4-flash]
--provider <name>     provider route [default: deepseek-official]
--session <id>        reuse a session id
--max-tokens <n>      output-token cap per model request
--cordis <path>       runtime cordis.yml [default: bundled tui.cordis.yml]
--runtime-command <c> runtime executable override
--help                show help
```

## Keys

| Key | Action |
|---|---|
| `Tab` | cycle focus: input → chat → activity |
| `PageUp` / `PageDown`, `↑` / `↓` | scroll the focused panel |
| `Enter` | send the prompt |
| `Ctrl+C` | quit (closes the runtime cleanly) |

## Commands

| Command | Action |
|---|---|
| `/new [id]` | start a fresh session (or adopt an explicit id) |
| `/quit`, `/exit` | quit |
| `/help` | show key/command help inside the TUI |

## Architecture

```
src/
  index.ts            entry: args, bridge boot, lifecycle, SIGTERM
  mount.tsx           Ink render call (keeps JSX out of index.ts)
  config.ts           CLI parsing, runtime bin/cordis resolution
  harness/
    bridge.ts         HarnessBridge: owns HarnessClient, streams notifications
    events.ts         wire notification → closed set of UI actions
  store.ts            Store: single source of truth (useSyncExternalStore)
  ui/
    app.tsx           layout, global keys, slash commands
    header.tsx        phase dot, session id, provider/model
    chat.tsx          conversation panel (auto-follow scroll)
    activity.tsx      live event stream panel
    status.tsx        phase, todo progress, tool counters
    input.tsx         controlled text input (Ink focus-manager aware)
    scroll.ts         line-based scroll window hook
    size.ts           terminal size tracking (resize-aware)
```

The TUI speaks the DSH SDK wire protocol through
[`@deepseek-ai/dsh-sdk-client`](https://www.npmjs.com/package/@deepseek-ai/dsh-sdk-client):
`HarnessClient` with `initialize` / `prompt` / `subscribe`, rather than the
high-level `run()` API, so events stream live instead of being collected
until the agent idles.

## Known limitations

- No mid-turn cancel: the wire has no prompt-cancel method; abandoning a
  turn means quitting the TUI (the runtime then reaps the session).
- No message editing or input history yet.
- The activity panel shows recent tool/turn/subagent lines, not a full
  transcript of every chunk.
