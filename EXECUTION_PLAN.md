# dsh-tui-astra 执行计划

## 目标

将本项目建设为 DeepSeek Harness 的原生 TUI 客户端：

> 保留 Harness“一切皆插件”的架构，以 TUI 取代 WebUI；命令、技能、模型提供方和会话均由运行时能力动态驱动，而不是写死在界面中。

## 参考基线

- 当前项目使用 DeepSeek Harness SDK `0.1.0-rc.6`。
- 官方源码位于 `../deepseek-harness`。
- 分析基于官方提交 `47f943859bef60e4160492346772ded9b24f765a`（2026-08-13）。
- 当前 SDK JSON-RPC 只提供 `initialize`、`session/prompt`、`shutdown`，command discovery/execution 需要在本项目的 runtime wrapper 中扩展。

## 架构原则

1. **一切皆插件**：Harness 能力通过 Cordis 插件组合，TUI 不复制领域逻辑。
2. **区分三类输入**：
   - TUI 本地命令：控制界面和会话，如 `/clear`、`/resume`。
   - Harness command：运行时直接执行，如 `/compact`、`/goal`、`/plan`。
   - Prompt macro：展开后发送给模型，如 `/init`、`/review`。
3. **动态发现**：commands、skills、providers 和 sessions 不维护第二份硬编码目录。
4. **事件为准**：command、todo、工具调用等展示由持久化 session events 驱动，支持恢复。
5. **渐进交付**：先打通最小纵向链路，再增加更多插件能力。

---

## Phase 1：修正 Todo 状态语义

### 工作项

- [ ] 修改 `Store.clearView()`：清除 messages、activities 和 error，但保留当前 session 的 todos。
- [ ] 保持 `/new`、切换 session 和 restore replay 前清空 todos。
- [ ] 导出可测试的 `todoSummary()`。
- [ ] 增加 todo 状态测试：
  - [ ] `todo/write` 全量替换旧列表。
  - [ ] `/clear` 后 todo 保留。
  - [ ] `/new` 后 todo 清空。
  - [ ] `/resume` replay 恢复最后一次 `todo/write`。
  - [ ] Esc 重启 runtime 后 todo 保留。
  - [ ] command 执行前后 todo 不变。

### 验收

- Footer 始终反映当前 session 的任务状态。
- 清屏、压缩和中断不会导致任务计划消失。

---

## Phase 2：统一 Slash Command 模型

### 工作项

- [ ] 将 `src/ui/commands.ts` 重构为统一 command catalog。
- [ ] 定义 command 来源：

  ```ts
  type CommandSource = 'local' | 'runtime' | 'prompt'
  ```

- [ ] 统一 command descriptor：

  ```ts
  interface CommandDescriptor {
    name: string
    description: string
    inputHint?: string
    source: CommandSource
  }
  ```

- [ ] 本地命令保留：
  - [ ] `/help`
  - [ ] `/new`
  - [ ] `/resume`
  - [ ] `/sessions`
  - [ ] `/clear`
  - [ ] `/status`
  - [ ] `/session`
  - [ ] `/model`
  - [ ] `/quit`、`/exit`
- [ ] Prompt macro 保留：
  - [ ] `/init`
  - [ ] `/review`
- [ ] 实现与 Harness 一致的 command parser，保留原始 `rawInput`，不再用 `split(/\s+/)` 破坏参数。
- [ ] Palette 改为接收动态 catalog。
- [ ] 命令名冲突时采用 `local > prompt > runtime`，并输出诊断信息。

### 验收

- Command 定义不再分别写死在 palette 和 React switch 中。
- 未知 slash command 不会被发送给模型。
- `/feedback   text` 一类输入能够保留原始参数。

---

## Phase 3：扩展 Harness Command JSON-RPC

### 工作项

- [ ] 新增项目内协议文件 `src/harness/command-protocol.ts`。
- [ ] 扩展 `src/runtime-server.ts`，增加：

  ```text
  commands/list
  commands/execute
  ```

- [ ] `commands/list` 返回运行时当前 agent 可见的 command descriptors。
- [ ] `commands/execute` 调用 `ctx.commands.execute(agent, line, signal)`。
- [ ] 未匹配命令返回 `{ matched: false }`，不产生模型消息。
- [ ] 校验所有 JSON-RPC 输入和输出。
- [ ] 保留上游 server 的 `initialize`、`session/prompt`、`shutdown` 行为。
- [ ] 为 runtime server 增加 fake-context 单元测试。

### 验收

- 可以通过 JSON-RPC 查询和执行 Harness command。
- Command 产生 `command/run`、`command/done`，但不产生普通用户 prompt。

---

## Phase 4：Bridge 与 TUI 接入 Runtime Commands

### 工作项

- [ ] 为 `HarnessBridge` 增加：

  ```ts
  listCommands()
  executeCommand(line)
  ```

- [ ] `send()`、`listCommands()`、`executeCommand()` 统一等待 runtime restart。
- [ ] 以下时机刷新 runtime command catalog：
  - [ ] runtime 启动完成。
  - [ ] `/new`。
  - [ ] `/resume`。
  - [ ] Esc 替换 runtime。
  - [ ] runtime command 执行后。
- [ ] 增加 command router，将输入分流到 local、runtime 或 prompt。
- [ ] 拆出本地命令 handler 和 prompt macro handler，减轻 `app.tsx` 职责。
- [ ] 处理异步刷新竞态，旧 session 的结果不能覆盖新 session catalog。

### 验收

- Palette 同时展示本地命令和 runtime 动态命令。
- Runtime command 通过 `commands/execute` 执行。
- `/review` 等 prompt macro 仍通过 `session/prompt` 执行。

---

## Phase 5：组合官方 Command 插件

### 第一期

- [ ] 将 `@deepseek-ai/dsh-commands` 声明为直接依赖。
- [ ] 加载 `@deepseek-ai/dsh-command-compact`。
- [ ] 在 `runtime/tui.cordis.yml` 中组合 command registry 和 `/compact`。
- [ ] 验证 `/compact` 不影响 todo，且 resume 后状态一致。

### 第二期

- [ ] 加载 `/goal` 需要的 goal domain、driver 和 command 插件。
- [ ] 加载 `/plan` 需要的 plan-mode 插件。
- [ ] 验证：
  - [ ] `/goal`
  - [ ] `/goal <objective>`
  - [ ] `/goal edit <objective>`
  - [ ] `/goal pause`
  - [ ] `/goal resume`
  - [ ] `/goal clear`
  - [ ] `/plan`
  - [ ] `/plan <message>`
  - [ ] `/plan off`

### 暂缓

- [ ] `/permission`：等待完整 sandbox、approval 和 preset UI。
- [ ] `/feedback`：先评审匿名 ID、遥测和隐私文案。
- [ ] `/export`：官方实现是 Web 下载，需设计 TUI 文件路径语义。

### 验收

- 第一期 runtime catalog 至少包含 `/compact`。
- 第二期包含 `/compact`、`/goal`、`/plan`。

---

## Phase 6：Command 事件展示与恢复

### 工作项

- [ ] 在 `classifySessionEvent()` 中识别：
  - [ ] `command/run`
  - [ ] `command/done`
- [ ] Store 按 `commandId` 配对 command 生命周期。
- [ ] Activity feed 增加 `command` 类型。
- [ ] 以 session event 为权威展示来源，避免 RPC result 和 `command/done` 重复显示。
- [ ] Resume replay 能恢复历史 command 记录。
- [ ] 只有 `command/run`、没有 `command/done` 的记录显示为 interrupted/abandoned。
- [ ] Command 失败只影响该 activity，不将整个 TUI 永久置为 error。

### 验收

```text
› /compact
  Compacted older conversation history.
```

- Command 记录可持久化、可恢复、无重复。

---

## Phase 7：Skills 动态发现与调用

### 工作项

- [ ] 启用 Harness skill registry 和 filesystem provider，不在 TUI 自行扫描后复制领域逻辑。
- [ ] 支持 Harness 标准目录，并至少覆盖用户要求的：

  ```text
  ~/.agents/skills
  ```

- [ ] 调研并复用官方 WebUI 的 skill directory/invocation 逻辑。
- [ ] 输入 `/` 时将可调用 skills 与 commands 合并展示，但保留来源标识。
- [ ] 精确匹配 skill 名称；未匹配内容保持普通命令错误或普通文本，不猜测。
- [ ] 技能调用通过 Harness 的共享 invocation policy 进入 agent，不在 TUI 拼装私有 prompt。
- [ ] 处理 command 与 skill 重名，并给出稳定优先级和诊断。
- [ ] 增加 skill 列表刷新机制，支持 session/workspace 变化。

### 验收

- `~/.agents/skills` 中符合规范的技能可以在 `/` 菜单中发现。
- 用户选择技能后由 Harness 原生 skill 机制执行。
- TUI 不维护技能内容的第二份缓存或解析实现。

---

## Phase 8：Provider、Model 与凭证配置

### 工作项

- [ ] 删除 UI 和默认配置中对 `deepseek-official/deepseek-v4-flash` 的硬编码假设。
- [ ] 将 provider/model 视为 runtime 返回或配置解析出的动态值。
- [ ] 支持环境变量：
  - [ ] API key
  - [ ] Base URL
  - [ ] Provider
  - [ ] Model
- [ ] 设计配置文件入口，允许声明自定义 OpenAI-compatible provider。
- [ ] 凭证不得写入 session log、activity、错误详情或 shell history。
- [ ] `/model` 从“提示重启参数”升级为读取 provider/model catalog；运行时切换若暂不支持，应明确提示。
- [ ] 参考官方 WebUI 的 provider/model selection 与 settings 实现。
- [ ] 对缺失凭证、无效 Base URL、未知 provider/model 提供清晰错误。

### 验收

- 可以使用非 DeepSeek provider/model 启动 runtime。
- Header、status 和 session context 显示实际 provider/model。
- API key 不出现在持久化数据和 UI 日志中。

---

## Phase 9：Session 与官方 WebUI 互通

### 当前基础

项目已经：

- 使用与 Harness 一致的 session root；
- 跨项目扫描 session；
- 解码普通及 Zstandard JSONL；
- 对持久化 session 使用 `agents.resume()`。

### 工作项

- [ ] 使用官方 WebUI 创建 session，加入跨客户端兼容 fixture。
- [ ] 验证 session header、title、todo、command、compaction 和 subagent events 的解码。
- [ ] `/resume` 同时列出 TUI 与 WebUI 创建的 session。
- [ ] Session picker 显示来源无关的 workspace、title 和更新时间。
- [ ] 未知扩展 event 必须安全跳过。
- [ ] 压缩或 checkpoint 后仍能恢复当前 todo 和 command 状态。
- [ ] 增加 WebUI → TUI → WebUI 往返测试，确保 TUI 不写入不兼容记录。

### 验收

- 官方 WebUI 创建的 session 能在 TUI 中浏览、恢复并继续对话。
- TUI 继续后的 session 仍能被官方实现读取。

---

## Phase 10：Todo 可视化增强

### 工作项

- [ ] 增加只读本地命令 `/todos`。
- [ ] 提供可关闭的任务面板，展示 pending、in-progress、completed。
- [ ] 收到 `todo/write` 时显示紧凑差异，而不是重复打印完整列表。
- [ ] Todo 保持模型工具的单一 writer；暂不增加 `/todo add`、`/todo done`。
- [ ] 验证 `/compact`、Esc、`/clear` 和 session resume 均不破坏当前 todo projection。

### 验收

- Footer 与 `/todos` 面板一致。
- Todo 更新、command 活动和模型输出在时间线上互不混淆。

---

## 测试矩阵

### 单元测试

- [ ] Command parser 和 raw input。
- [ ] Command catalog 合并及冲突。
- [ ] Todo reducer、summary 和 clear/reset 语义。
- [ ] Command lifecycle event 配对。
- [ ] Provider 配置解析和凭证脱敏。
- [ ] Skill/command discovery 合并。

### Runtime 集成测试

- [ ] `commands/list`
- [ ] `commands/execute`
- [ ] `/compact`
- [ ] `/goal`
- [ ] `/plan`
- [ ] Session create/resume
- [ ] Runtime restart

### 端到端验收

- [ ] Runtime command 不触发 `session/prompt`。
- [ ] Prompt macro 会触发模型 turn。
- [ ] 未知 slash command 不进入模型。
- [ ] `/clear` 保留 todos。
- [ ] `/resume` 可恢复 WebUI session。
- [ ] 自定义 provider/base URL 可工作。
- [ ] `~/.agents/skills` 中的技能可发现和调用。

---

## 推荐提交顺序

1. `fix(todo): preserve session todo state when clearing the view`
2. `refactor(commands): introduce a unified slash command catalog`
3. `refactor(commands): extract local and prompt command handlers`
4. `feat(runtime): expose Harness command discovery over JSON-RPC`
5. `feat(runtime): expose Harness command execution over JSON-RPC`
6. `feat(bridge): add runtime command discovery and execution`
7. `feat(runtime): compose the Harness command registry and compact command`
8. `feat(ui): merge runtime commands into the command palette`
9. `feat(ui): render durable command lifecycle events`
10. `feat(runtime): compose goal and plan commands`
11. `feat(skills): discover and invoke Harness skills from the TUI`
12. `feat(config): support dynamic providers models and credentials`
13. `test(sessions): verify WebUI and TUI session interoperability`
14. `feat(todo): add a persistent read-only task panel`
15. `docs: document the plugin-driven TUI architecture`

## 第一里程碑

第一里程碑只完成以下纵向链路：

```text
保留 todo
→ 统一 command catalog
→ commands/list
→ commands/execute
→ 加载 /compact
→ 动态 palette
→ command events
→ session resume
```

完成后再依次接入 `/goal`、`/plan`、skills、provider 配置和 WebUI session 兼容测试。
