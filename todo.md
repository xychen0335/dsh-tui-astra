## to do

一句话，该项目需要保留原生 deepseek harness 的理念 -- 一切皆插件，但形态为 tui 而非 webui。

1. 问题

* 模型写死了 deepseek 系列（显示和运行都有这个问题）
* 缺少自由配置 api-key，baseurl（自定义 model provider 的能力缺失）

2. 需要完成

* 常用的 command /skills 可以列出来 ~/.agents/skills 下面的技能（按 / 即可选取技能）
* /resume 应该也能访问到 webui 的 session（deepseek 的官方实现即为 webui，但 session 其实存储的地方是一致的）

3. 可以参考

* deepseek harness webui 的一些实现
* codex cli 的一些封装 