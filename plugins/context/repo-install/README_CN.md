# Context Agent 接入

[English](./README.md)

本目录是 Context Agent 接入唯一的人工维护真源，包含单一 Context 入口 Skill、
Code/Markdown Indexer Provider Skills、各宿主 manifest 模板和共享资产。

运行 `bun run --filter @c4a/context-cli build:plugin` 可重新生成 npm 投影及提交到
仓库的 `repo-install/`。不要直接编辑 `repo-install/` 或
`packages/context-cli/dist/plugins/` 下的生成文件。

`repo-install/{claude,codex,cursor}/` 分别是只包含 Context 主入口的宿主插件根；
`repo-install/skills/` 是可移植 Skill 投影。`context plugin install` 在同一次安装中
把 Provider 投影到 Codex/Cursor 共用的 `~/.agents/skills` 与 Claude 的
`~/.claude/skills`，因此 Provider 不获得插件命名空间。

对话入口把工作区状态和 workflow 生命周期权威交给本地 `context` CLI；Indexer
Skills 只能通过完成校验的 Context Indexer Provider 生命周期激活。
