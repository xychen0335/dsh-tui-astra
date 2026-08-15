# dsh-tui-astra

`dsh-tui-astra` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的交互式终端客户端。安装后在任意目录执行 `dsh`，即可启动一个面向编码任务的 Harness TUI。默认使用 DeepSeek，也支持 OpenAI、Anthropic 和自定义兼容端点。

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

  wheel/trackpad · Shift+PgUp/PgDn · terminal search · select/copy

╭──────────────────────────────────────────────────────────────╮
│ › Describe a task, @file, or type / for commands             │
╰──────────────────────────────────────────────────────────────╯
 deepseek-official/deepseek-v4-flash · ~/Codes/my-project · / commands
```

## 功能

- 实时渲染用户消息、助手回复、推理、工具调用、turn/step 状态和 token 用量。
- 输入 `/` 打开命令面板，支持方向键选择、Tab 补全和输入历史。
- 使用鼠标滚轮、触控板或终端原生快捷键浏览长对话（通常为 `Shift+PageUp/PageDown`；macOS 终端也可使用其 terminal-native shortcut），并使用终端搜索、拖选和复制；中文、emoji 和终端自动换行均按实际显示宽度计算。
- `Esc` 中止当前回合；运行时重启后保留同一会话，并可立即继续发送消息。
- `/resume` 提供可选择的历史会话列表，展示标题、更新时间、工作目录和缩略会话 ID。
- 自动读取原生 Harness 的普通或 Zstandard 压缩 JSONL 会话。
- Ctrl+C、`/quit` 和 SIGTERM 均会关闭订阅并回收运行时子进程。

## 环境要求

- Node.js 22.19 或更高版本
- pnpm
- 至少一个已配置 provider 的 API Key；默认 DeepSeek 使用 `DEEPSEEK_API_KEY`

## 安装

```sh
npm install --global dsh-tui-astra@0.1.0
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

升级或回退时显式指定目标版本，npm 会统一替换现有全局版本：

```sh
npm install --global dsh-tui-astra@<version>
```

卸载：

```sh
npm uninstall --global dsh-tui-astra
```

## 本地开发

```sh
git clone https://github.com/xychen0335/dsh-tui-astra.git
cd dsh-tui-astra
pnpm install
pnpm build
```

直接运行 TypeScript 源码：

```sh
pnpm dev -- --cwd /path/to/project
```

## 配置

### 命令行参数

| 参数 | 说明 |
|---|---|
| `--cwd <dir>` | agent 工作目录，也是 bash 和文件系统工具的根目录 |
| `--model <name>` | 模型 ID，默认读取 `DSH_MODEL`；DeepSeek 默认使用 `deepseek-v4-flash` |
| `--provider <name>` | provider 路由，默认读取 `DSH_PROVIDER` 或使用 `deepseek-official` |
| `--base-url <url>` | 自定义 provider endpoint |
| `--api-key-env <name>` | 保存 API Key 的环境变量名称，不接受明文 key |
| `--api <protocol>` | 自定义 provider 协议，例如 `openai-completions` |
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
| `DSH_PROVIDER` | 默认 provider 路由 |
| `DSH_MODEL` | 默认模型 |
| `DSH_BASE_URL` | 非 DeepSeek provider 的 endpoint |
| `DSH_API_KEY` | 自定义 provider API Key；只从进程环境读取 |
| `DSH_API_KEY_ENV` | API Key 所在环境变量的名称 |
| `DSH_API` | 自定义 provider 协议 |
| `DSH_AGENTS_HOME` | 共享 agent 配置目录，默认 `~/.agents` |
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

### 自定义模型提供方

默认 runtime 同时包含 DeepSeek 官方 adapter 和通用多 provider adapter。使用
DeepSeek 时保持原有方式：

```sh
export DEEPSEEK_API_KEY=...
dsh --provider deepseek-official --model deepseek-v4-flash
```

使用通用 adapter 已内置的 provider catalog，例如 OpenAI：

```sh
export OPENAI_API_KEY=...
dsh --provider openai --model gpt-5
```

使用任意 OpenAI-compatible endpoint：

```sh
export DSH_API_KEY=...
dsh \
  --provider my-gateway \
  --model my-model \
  --base-url https://gateway.example/v1 \
  --api openai-completions
```

也可以把凭证放在其他环境变量中：

```sh
export COMPANY_LLM_TOKEN=...
dsh \
  --provider company \
  --model company-large \
  --base-url https://llm.company.example/v1 \
  --api openai-completions \
  --api-key-env COMPANY_LLM_TOKEN
```

CLI 和 Cordis 配置只传递环境变量名称，不复制 API Key 值。为避免凭证进入 shell
history，不提供 `--api-key <value>` 参数。也可以在 TUI 中执行 `/provider`，
输入 route、model、endpoint、protocol 和 API Key；
凭证写入 `$DSH_HOME/.credentials.yaml`，Provider 配置写入
`$DSH_HOME/settings.yaml`，都在下一个请求生效，无需重启。

模型选择是 session 级热切换：当前 turn 已经完成 prompt assembly 时，切换从
下一 step 生效；空闲状态下则从下一条消息生效。`/model <provider>/<model>`
可跳过选择器直接切换。自定义 provider 必须显式指定模型；手工声明的新 route
通常还需要 Base URL 和 protocol。

模型选择与 Provider 管理解耦：

- **`/model`**：输入即搜索，`↑`/`↓` 选择，`Enter` 热切换；
- **`/provider`**：查看已配置、可用和缺少凭证的 Provider；
- 在 `/provider` 中按 `Enter` 可编辑已有配置，API Key 只显示是否已配置；
- “Test connection / discover models” 不保存草稿，可先验证 endpoint、协议和 Key；
- “Save configuration” 只保存，“Save and use” 保存后立即切换；
- 自定义 Provider 可删除；当前正在使用的 Provider 需先切换到其他模型。

编辑字段时第一次输入会替换原值，而不是追加到末尾；`Esc` 退出字段编辑并保留
当前草稿。新建自定义 Provider 默认使用 `openai-completions`，多数兼容接口只需
填写 route、model、Base URL 和 API Key。

## 快捷键

| 按键 | 动作 |
|---|---|
| 鼠标滚轮 / 触控板 | 使用终端原生 scrollback 滚动对话历史 |
| `Shift+PageUp` / `Shift+PageDown` | 常见终端原生整页滚动快捷键（macOS 终端请使用其 terminal-native shortcut） |
| 终端搜索 | 使用终端自己的搜索功能查找已提交的对话内容 |
| 拖选 / 复制 | 使用终端原生选择和复制 |
| `↑` / `↓` | 选择命令、选择会话或浏览输入历史 |
| `Tab` | 补全当前命令 |
| `Enter` | 发送消息或确认选择 |
| `Esc` | 中止当前回合，或关闭会话选择器 |
| `Ctrl+C` | 退出并关闭运行时 |

应用不启用鼠标捕获；滚轮、触控板、终端搜索、拖选和复制均由终端处理。

## 斜杠命令

| 命令 | 动作 |
|---|---|
| `/new [id]` | 创建新会话；可选指定会话 ID |
| `/resume [id]` | 打开历史会话选择器，或按 ID 恢复会话 |
| `/sessions` | 打开历史会话选择器 |
| `/clear` | 清空当前显示，不删除会话 |
| `/status` | 显示运行阶段、模型、会话和工作目录 |
| `/session` | 显示当前会话 ID |
| `/model` | 打开模型搜索与热切换 |
| `/model <provider>/<model>` | 直接热切换当前会话的模型 |
| `/provider` | 新增、编辑、测试或删除 Provider 与凭证 |
| `/init` | 让 agent 检查仓库并生成项目说明 |
| `/review [scope]` | 让 agent 审查指定范围 |
| `/compact` | 使用 Harness 原生 command 压缩较早的对话历史 |
| `/goal [<objective>\|clear\|edit <objective>\|pause\|resume]` | 查看或控制持久化长期目标 |
| `/plan [off\|message]` | 进入计划模式，或使用 `off` 退出 |
| `/help` | 显示命令和快捷键帮助 |
| `/quit`、`/exit` | 退出 |

`/compact`、`/goal` 和 `/plan` 不是写死在 TUI 中的提示词，而是从当前
Harness runtime 动态发现并直接执行的插件命令。自定义 runtime 注册的其他
command 也会自动进入 `/` 命令面板。

### Skills

TUI 使用 Harness 原生 skill registry，自动发现以下目录中的技能：

```text
<project>/.dsh/skills/
<project>/.agents/skills/
~/.dsh/skills/
~/.agents/skills/
```

技能可以使用 `<name>/SKILL.md` 或 `<name>.md` 形式。输入 `/` 和技能名前缀
即可筛选并补全；提交 `/skill-name [任务说明]` 后，原始文本作为用户消息进入
session，Harness 在 pre-step 边界注入技能内容。命令与技能重名时，direct
command 优先，避免将直接操作误发给模型。

示例：

```markdown
---
name: code-review
description: Review code changes for correctness and regressions
user-invocable: true
---

Review the requested changes. Report findings by severity.
```

设置 `user-invocable: false` 的技能不会出现在 TUI 菜单；设置
`disable-model-invocation: true` 可保留用户显式调用，同时从模型自己的 skill
目录中隐藏。

## 自定义插件

目前允许用户通过 `--cordis <path>` 使用自定义 Harness/Cordis 组合：

```sh
cp runtime/tui.cordis.yml ~/.config/dsh/my-runtime.cordis.yml
dsh --cordis ~/.config/dsh/my-runtime.cordis.yml
```

自定义配置可以加载：

- 已安装且可由 Node.js 解析的 npm 插件；
- 配置文件引用的本地 JavaScript 插件；
- Harness 官方插件及其 `config`。

例如一个插件只要向 `ctx.commands` 注册 command，TUI 就会动态发现它，无需
修改 `src/ui/commands.ts`。当前 `--cordis` 会**替换整套运行时组合**，所以
配置仍需包含 JSON-RPC server、agent、LLM、session persistence 等基础组件。
尚未提供插件目录扫描、基础配置 overlay、安装管理或 TUI 开关；这些属于后续
插件管理里程碑。

> 自定义插件与 TUI 通信时，应复用 Harness 的 command、session event 和 tool
> 接口，不要向 stdout 输出日志；stdout 已被 JSON-RPC transport 占用。

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
    chat.tsx              对话渲染和宽度换行
    input.tsx             输入框、命令面板和输入历史
    session-picker.tsx    历史会话选择器
    activity.tsx          工具和运行阶段动态
    row.ts                对话和活动行的共享显示类型
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

运行时组合包含 DeepSeek LLM、bash、本地文件系统、todo、skills、子 agent、
持久化 goal、plan mode、会话持久化和上下文压缩。需要调整工具或策略时，
可以复制 `runtime/tui.cordis.yml`，修改后通过 `--cordis` 加载。

## 当前限制

- `/model` 已支持 session 内热切换；当前 turn 已组装完成的请求不会被中途改写。
- `/plan` 支持直接进入和通过 `/plan off` 退出；模型调用
  `exit_plan_mode` 时所需的交互式计划审批 UI 尚未接入。
- 自定义插件目前通过完整 `--cordis` 配置加载，还没有 overlay 和安装管理。
- 会话选择器默认展示最近 6 个会话；仍可使用 `/resume <session-id>` 恢复其他会话。
- `Esc` 通过替换 JSON-RPC 运行时实现中止，因此会有很短的重连过程。
