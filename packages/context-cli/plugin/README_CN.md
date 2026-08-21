# Context Agent 接入

[English](./README.md)

<p align="center"><img src="./assets/logo.svg" alt="Context" width="180"/></p>

这个插件是 Context 知识生产工作流的对话入口。用户向 Agent 说明知识目标，插件再
把对话连接到本地 Context 运行时、当前工作区事实和 Route 选择的操作资源。

插件有意只暴露一个精简入口，不为初始化、来源采集、审核和构建分别提供公开命令。
详细工作流保存在运行时的 Provider bundle 中，可以依据当前事实按需选择、校验、
测试和升级，而不会让入口 Prompt 越来越长。

## 用户体验

安装接入并刷新 Agent 宿主后，调用 Context 入口并说明期望知识：

```text
/c4a:context 请把架构文档和当前仓库整理成可搜索的 Agent 知识包，保留来源证据，
最终结构批准前先让我确认。
```

同一个入口可以初始化用户请求的工作区、定位已有工作区，或继续当前知识生产轮次。
Agent 在对话中解释用户决策，并使用运行时完成机械状态变更；用户不需要自行选择
底层生命周期命令。

## 安装

插件随 Context 运行时一起发布：

```bash
npm install -g @c4a/context-cli@latest
context plugin install
```

从源码开发时，先构建再安装开发投影：

```bash
bun run --filter @c4a/context-cli build
context plugin install --dev
```

`context plugin install --dry-run` 可以预览宿主投影，`context plugin status`
用于诊断安装。修改或重装插件后需要刷新 Agent 宿主。

## 入口契约

人工维护的源文件是 [`commands/context.md`](./commands/context.md)，启动流程为：

1. 运行只读的 `context entry --language <language> --format json`；
2. 只执行它返回的 `next_action.command`；
3. 工作区就绪后，将 `workflow.current` 视为当前步骤权威；
4. 完整读取当前 Route 的所有必需资源；
5. 只执行选中的动作或配置修改；
6. 再次求值工作区。

入口不会根据周边文件自行推断工作区状态。只有用户明确请求或确认时才执行初始化；
进入或求值已有工作区是只读行为。不存在 `context continue` primitive，也没有阶段
专属的公开 Skill。

## 按需加载工作流上下文

操作说明、对话、诊断、Schema、来源正文和生成 View 都是可寻址的工作流资源。
静态资源使用内容 digest，动态 View 绑定选择它的 workflow revision。读取回执可以
在同一对话中复用未变化资源，但不能证明外部动作已经完成。

人工 Gate 的检查和决议资源保持阶段隔离：Agent 在决定前加载 inspection 内容，
用户确认后才加载 resolution 内容。这样既保留普通审核能力，也不会预加载所有可能
的决策界面。

## 全托管对话

只有用户在当前对话明确授权后，才使用全托管模式。Agent 从以下命令开始：

```bash
context run --managed --until blocked-or-complete --format json
```

循环会执行连续的确定性动作和 Route-delegated Gate，并在每个动作后重新求值。遇到
语义阅读、项目配置、未解决权限、诊断修复或非唯一计划时停止。全托管权限不会被
持久化，也不能在另一场对话复用。

## 边界

- 插件本身不调用 LLM，而是由宿主 Agent 消费。
- 所有工作区生命周期写入都通过 Route 选择的 Context Action 完成。
- 不会在缺少相应授权时静默 clone、fetch、checkout、install、build、test 或
  读取外部内容。
- 不在 Prompt 中复制工作流事实或生命周期路由。
- CLI token、路径、id、flag 和 `source_ref` 保持原样；面向用户的解释使用当前
  对话语言。

## 维护说明

`plugin/` 是唯一人工维护的接入源。构建会将它投影为 `dist/plugins` 下的 Claude
commands、Codex Skills、Cursor commands 和纯 Skill 目录。不要直接编辑生成投影。
