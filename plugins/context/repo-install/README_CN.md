# Context Agent 接入

> 本目录由构建生成，请勿直接编辑。以下说明中的路径以源码仓库根目录为准；文档真源位于 `plugins/context/README_CN.md`。

[English](./README.md)

仓库中的 `plugins/context/` 是 Context Agent 接入唯一的人工维护真源，包含 Context 生产入口和可由宿主路由的 context-inspect-search 技能、
Code/Markdown/Note/Sessions Indexer Provider Skills、各宿主 manifest 模板和共享资产。

运行 `bun run --filter @c4a/context-cli build:plugin` 可重新生成 npm 投影及提交到
仓库的 `plugins/context/repo-install/`。不要直接编辑 `plugins/context/repo-install/` 或
`packages/context-cli/dist/plugins/` 下的生成文件。

`plugins/context/repo-install/{claude,codex,cursor}/` 包含生产、显式查询及 Indexer 创建入口；
`plugins/context/repo-install/skills/` 是可移植 Skill 投影。`context plugin install` 在同一次安装中
把 Provider 投影到 Codex/Cursor 共用的 `~/.agents/skills` 与 Claude 的
`~/.claude/skills`，因此 Provider 不获得插件命名空间。

显式调用 Context，或在已经启动的 Context 会话中继续工作，才进入此流程；普通编码和
方案讨论不会自动启动它。安装 Provider 只让 Agent 能发现它，不代表所有工作区都会
启用。Agent 根据当前来源和需求选择 Provider。

对话入口把工作区状态和 workflow 生命周期权威交给本地 `context` CLI；Indexer
Skills 只能通过完成校验的 Context Indexer Provider 生命周期激活。


## 查询知识与来源归因

主动调用 `/c4a:context-inspect-search`（Cursor：`/c4a-context-inspect-search`），
或由宿主配置将知识问答路由到 `context-inspect-search` 技能。`CONTEXT_QUERY_SOURCE_MODE` 可选择默认的 `repo-first`、`package-first` 或 `dual` 检索。无需本地工作区也可检索本地、全局或宿主提供的知识包；没有产物但有工作区时，
直接查询已批准的 `knowledge`，构建产物需事先获得写入工作区的授权。只读探索及有边界的
非破坏性检查无需再次确认。代码归因自动取得登记版本，并核对相关文件与当前代码的差异，
无需用户选择版本。通过构建清单关联批准原稿
并追溯登记来源，不清理工作区、不为查询推进无关生产任务。证据充分时可建议更新，用户采纳后交给
`context` 的当前流程。面向用户的 Claude 命令仍只允许显式触发；宿主技能清单会公开该技能，
使配置过的知识 Bot 无需搜索插件文件即可选择它。
