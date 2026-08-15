# dsh-tui-astra

`dsh-tui-astra` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的交互式终端客户端。安装后在任意目录执行 `dsh`，即可启动一个面向编码任务的 DeepSeek TUI。

它通过 stdio JSON-RPC 启动并连接 Harness 运行时，实时展示模型回复、推理、工具调用、任务阶段和子 agent 状态。会话与原生 Harness 共用持久化目录，可以直接浏览和恢复此前的对话。

```text
╭──────────────────────────────────────────────────────────────╮
│ >_ dsh                                                       │
│ model:     deepseek-official/deepseek-v4-flash               │
│ directory: ~/Codes/my-project                                │
╰──────────────────────────────────────────────────────────────╯

  › You
    检查这个项目并修复测试

  • dsh
    我先查看项目结构和测试配置。

  scroll/trackpad · Ctrl+↑ history · PgUp page

╭──────────────────────────────────────────────────────────────╮
│ › Describe a task, @file, or type / for commands             │
╰──────────────────────────────────────────────────────────────╯
 deepseek-official/deepseek-v4-flash · ~/Codes/my-project · / commands
```

## 功能

- 实时渲染用户消息、助手回复、推理、工具调用、turn/step 状态和 token 用量。
- 输入 `/` 打开命令面板，支持方向键选择、Tab 补全和输入历史。
- 使用鼠标滚轮、触控板或键盘连续浏览长对话；中文、emoji 和终端自动换行均按实际显示宽度计算。
- `Esc` 中止当前回合；运行时重启后保留同一会话，并可立即继续发送消息。
- `/resume` 提供可选择的历史会话列表，展示标题、更新时间、工作目录和缩略会话 ID。
- 自动读取原生 Harness 的普通或 Zstandard 压缩 JSONL 会话。
- Ctrl+C、`/quit` 和 SIGTERM 均会关闭订阅并回收运行时子进程。

## 环境要求

- Node.js 22.19 或更高版本
- pnpm
- `DEEPSEEK_API_KEY`

## 安装

```sh
git clone <repository-url> dsh-tui-astra
cd dsh-tui-astra
pnpm install
pnpm build
npm link
```

安装完成后，可以在任意工作目录启动：

```sh
cd /path/to/project
dsh
```

也可以显式指定工作目录：

```sh
dsh --cwd /path/to/project
```

开发时直接运行 TypeScript 源码：

```sh
pnpm dev -- --cwd /path/to/project
```

## 配置

### 命令行参数

| 参数 | 说明 |
|---|---|
| `--cwd <dir>` | agent 工作目录，也是 bash 和文件系统工具的根目录 |
| `--model <name>` | 模型 ID，默认读取 `DSH_MODEL` 或使用 `deepseek-v4-flash` |
| `--provider <name>` | provider 路由，默认 `deepseek-official` |
| `--session <id>` | 使用指定会话 ID |
| `--max-tokens <n>` | 单次模型请求的最大输出 token 数 |
| `--cordis <path>` | 使用自定义 Cordis 运行时配置 |
| `--runtime-command <command>` | 覆盖 JSON-RPC 运行时命令 |
| `--help` | 显示帮助 |

### 环境变量

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API 凭证 |
| `DEEPSEEK_BASE_URL` | 自定义 API 地址 |
| `DSH_CWD` | 未传入 `--cwd` 时使用的工作目录 |
| `DSH_MODEL` | 默认模型 |
| `DSH_HOME` | Harness 数据目录，默认 `~/.dsh` |
| `DSH_SESSION_ROOT` | 显式覆盖会话目录，默认 `$DSH_HOME/sessions` |
| `DSH_SYSTEM_PROMPT` | 覆盖运行时 system prompt |

会话路径不会硬编码用户名。默认目录为：

```text
~/.dsh/sessions/
  <project-key>/
    <session-id>/
      session.jsonl.zstd
```

## 快捷键

| 按键 | 动作 |
|---|---|
| 鼠标滚轮 / 触控板 | 滚动对话历史 |
| `Ctrl+↑` / `Ctrl+↓` | 逐行滚动历史 |
| `PageUp` / `PageDown` | 整页滚动历史 |
| `Home` / `End` | 跳到最早消息 / 最新消息 |
| `↑` / `↓` | 选择命令、选择会话或浏览输入历史 |
| `Tab` | 补全当前命令 |
| `Enter` | 发送消息或确认选择 |
| `Esc` | 中止当前回合，或关闭会话选择器 |
| `Ctrl+C` | 退出并关闭运行时 |

启用终端鼠标事件后，如需选择和复制终端文字，请按住 `Shift` 再拖动。

## 斜杠命令

| 命令 | 动作 |
|---|---|
| `/new [id]` | 创建新会话；可选指定会话 ID |
| `/resume [id]` | 打开历史会话选择器，或按 ID 恢复会话 |
| `/sessions` | 打开历史会话选择器 |
| `/clear` | 清空当前显示，不删除会话 |
| `/status` | 显示运行阶段、模型、会话和工作目录 |
| `/session` | 显示当前会话 ID |
| `/model [name]` | 查看模型；模型切换需要重启运行时 |
| `/init` | 让 agent 检查仓库并生成项目说明 |
| `/review [scope]` | 让 agent 审查指定范围 |
| `/help` | 显示命令和快捷键帮助 |
| `/quit`、`/exit` | 退出 |

## 项目结构

```text
src/
  index.ts                CLI 入口、运行时生命周期和通知分发
  config.ts               参数、环境变量和默认路径
  runtime-server.ts       支持恢复持久化会话的 JSON-RPC server 包装层
  sessions.ts             原生 Harness 会话发现和解码
  harness/
    bridge.ts             JSON-RPC 客户端、消息发送和中断恢复
    events.ts             Harness 通知到 UI action 的转换
  store.ts                TUI 状态与会话恢复
  ui/
    app.tsx               布局、全局按键和斜杠命令
    chat.tsx              对话渲染、宽度换行和鼠标滚动
    input.tsx             输入框、命令面板和输入历史
    session-picker.tsx    历史会话选择器
    activity.tsx          工具和运行阶段动态
    scroll.ts             自动跟随与历史滚动窗口
runtime/
  tui.cordis.yml          Harness 运行时组合
tests/
  regressions.test.ts     配置、会话、中断和 UI 回归测试
```

## 开发与验证

```sh
pnpm typecheck
pnpm test
pnpm build
```

运行时组合包含 DeepSeek LLM、bash、本地文件系统、todo、子 agent、会话持久化和上下文压缩。需要调整工具或策略时，可以复制 `runtime/tui.cordis.yml`，修改后通过 `--cordis` 加载。

## 当前限制

- `/model` 只能查看当前模型；切换模型需要重新启动 `dsh`。
- 会话选择器默认展示最近 6 个会话；仍可使用 `/resume <session-id>` 恢复其他会话。
- `Esc` 通过替换 JSON-RPC 运行时实现中止，因此会有很短的重连过程。
