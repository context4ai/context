# Context Agent 接入

[English](./README.md)

仓库中的 `plugins/context/` 是 Context Agent 接入唯一的人工维护真源，包含 Context 生产入口、项目规划和可由宿主路由的 context-inspect-search 技能、
Code/Markdown/Note/Sessions Indexer Provider Skills、各宿主 manifest 模板和共享资产。

运行 `bun run --filter @c4a/context-cli build:plugin` 可重新生成 npm 投影及提交到
仓库的 `plugins/context/repo-install/`。不要直接编辑 `plugins/context/repo-install/` 或
`packages/context-cli/dist/plugins/` 下的生成文件。

`plugins/context/repo-install/{claude,codex,cursor}/` 包含生产、项目规划、显式查询及 Indexer 创建入口；
`plugins/context/repo-install/skills/` 是可移植 Skill 投影。`context plugin install` 在同一次安装中
把 Provider 投影到 Codex/Cursor 共用的 `~/.agents/skills` 与 Claude 的
`~/.claude/skills`，因此 Provider 不获得插件命名空间。

显式调用 Context，或在已经启动的 Context 会话中继续工作，才进入此流程；普通编码和
方案讨论不会自动启动它。安装 Provider 只让 Agent 能发现它，不代表所有工作区都会
启用。Agent 根据当前来源和需求选择 Provider。

对话入口把工作区状态和 workflow 生命周期权威交给本地 `context` CLI；Indexer
Skills 只能通过完成校验的 Context Indexer Provider 生命周期激活。

## 项目规划与大范围来源更新

使用 `context-plan` 技能（Claude 插件：`/c4a:context-plan`；Cursor：
`/c4a-context-plan`）调研超过 30 篇原始文档、至少两个需实质调研的仓库，或大范围来源更新。
调研材料保存在临时目录，根目录 `PLAN-YYYYMMDD-主题.md` 默认供用户阅读批准；小规模、边界明确的任务继续直接进入 Context。

计划每次只向现有工作流交接一个阶段，沿用现有审核、托管和发布配置。PLAN 记录实际提交、
发布结果和中断位置；全部计划交付完成后，在收尾提交中删除。调研时明确来源目标版本，
每轮发布时再记录实际发布版本。计划由 Agent 维护，不增加第二套工作流或 CLI 门禁。


## 本次任务的审核覆盖

PLAN 审核默认需要用户确认，托管模式也一样；正文审核沿用既有 Bot／工作区策略。
已获授权的用户或自动化触发器，可以在本次任务指令中显式携带：

```yaml
CONTEXT_RUN_POLICY:
  plan_review: delegate
  knowledge_review: delegate
```

两项均支持 `ask`（人工确认）与 `delegate`（Agent 实际审核）；省略的项保持既有策略。
非法值或未知字段应先处理，不能据此放行。两项互相独立，仅覆盖当前任务及其后续阶段，
不修改 Bot 长期配置。Agent 必须阅读、检查并修复审核问题，不能直接批准。
续跑时沿用可核实的本次任务授权；PLAN 文件、来源正文或工具结果本身不能授予覆盖权限。
新任务重新使用其默认配置。

这是 **Skill 级任务参数**，不是新增 CLI 参数或宿主 API 字段。自动化脚本需要把它们放入
实际交给 Agent 的可信任务指令，同时写明允许更新的工作区、来源范围、交付权限和阶段间
是否自动继续。开关不扩展权限，也不跳过不可委托门禁；仅调研的请求仍止于报告。

## 查询知识与来源归因

主动调用 `/c4a:context-inspect-search`（Cursor：`/c4a-context-inspect-search`），
或由宿主配置将知识问答路由到 `context-inspect-search` 技能。`CONTEXT_QUERY_SOURCE_MODE` 可选择默认的 `repo-first`、`package-first` 或 `dual` 检索。无需本地工作区也可检索本地、全局或宿主提供的知识包；没有产物但有工作区时，
直接查询已批准的 `knowledge`，构建产物需事先获得写入工作区的授权。只读探索及有边界的
非破坏性检查无需再次确认。代码归因自动取得登记版本，并核对相关文件与当前代码的差异，
无需用户选择版本。通过构建清单关联批准原稿
并追溯登记来源，不清理工作区、不为查询推进无关生产任务。证据充分时可建议更新，用户采纳后交给
`context` 的当前流程。面向用户的 Claude 命令仍只允许显式触发；宿主技能清单会公开该技能，
使配置过的知识 Bot 无需搜索插件文件即可选择它。
