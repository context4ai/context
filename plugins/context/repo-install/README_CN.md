# Context Agent 接入

> 本目录由构建生成，请勿直接编辑。以下说明中的路径以源码仓库根目录为准；文档真源位于 `plugins/context/README_CN.md`。

[English](./README.md)

仓库中的 `plugins/context/` 是 Context Agent 接入唯一的人工维护真源，包含 Context 生产入口和显式触发的 context-inspect-search 技能、
Code/Markdown/Note/Sessions Indexer Provider Skills、各宿主 manifest 模板和共享资产。

运行 `bun run --filter @c4a/context-cli build:plugin` 可重新生成 npm 投影及提交到
仓库的 `plugins/context/repo-install/`。不要直接编辑 `plugins/context/repo-install/` 或
`packages/context-cli/dist/plugins/` 下的生成文件。

`plugins/context/repo-install/{claude,codex,cursor}/` 分别是只包含 Context 主入口的宿主插件根；
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
或指定 `context-inspect-search` 技能。优先使用可用 dist 中的查询技能；没有产物时，当前流程
允许才尝试一次构建，否则从已批准的 `knowledge` 查询。通过构建清单关联批准原稿
并追溯登记来源，不清理工作区、不为查询推进无关生产任务。证据充分时可建议更新，用户采纳后交给
`context` 的当前流程。Codex 配置禁止隐式调用，Claude 命令配置禁止模型自动调用；
其他宿主依赖显式触发指引，不承诺其支持相同的自动调用控制。
