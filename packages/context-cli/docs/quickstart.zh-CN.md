# 通过 Agent 开始使用 Context

[English](./quickstart.md)

本文件随安装后的运行时一起发布。Context 的设计入口是 Agent：用户说明知识目标，
Agent 跟随当前工作流 Route。底层 CLI 用于执行这套工作流，不是普通用户首先需要
学习的界面。

## 1. 安装 Agent 接入

```bash
npm install -g @c4a/context-cli@latest
context plugin install
```

重启或刷新 Agent 宿主，使其发现新安装的入口。

## 2. 调用唯一入口

无论创建新工作区还是继续已有工作区，都使用 `/c4a:context`。直接用自然语言说明
来源资料、目标读者和期望产物：

```text
/c4a:context 请把 docs/ 下的 Markdown 和 packages/example 的导出 API 整理成
可追溯的 Agent 知识包，知识结构批准前先让我确认。
```

入口首先运行只读的 `context entry --format json` 解析器，并返回以下一种结果：

- 提议在明确的项目路径初始化；
- 进入已经存在的 Context 工作区；
- 返回当前 `workflow.current` Route。

初始化会写入新工作区，因此必须保持显式。进入或求值已有工作区是只读动作，不需要
第二次确认。

## 3. 跟随对话完成知识生产

Agent 会引导本轮流程完成来源权限、采集或代码提取、结构设计、候选编译、审核、
close、验证和知识包产出。每个步骤都应该说明：

- 工作区事实已经确认了什么；
- 现在需要做什么决定，以及该决定影响什么；
- 哪些证据或报告支持这个决定；
- 确认后会发生什么。

Agent 读取 Route 选择的资源，并执行 Route 返回的精确命令。用户不需要把
`<phase-id>`、`<collection>` 等占位符翻译成内部 CLI 参数。

## 4. 选择对话模式

普通模式是默认模式，会展示审核决定和 HTML 检查报告，方便用户调整中间内容。

全托管模式必须由用户在当前对话中明确授权。它允许 Agent 合并确定性工作并跳过
可 delegated 的审核界面，但仍保留权限、证据检查、校验和验证。遇到语义阅读、
项目配置、外部权限或诊断修复时，Agent 仍会停止。

## 5. 理解工作区

初始化后，项目内 `AGENTS.md` 是 Agent 的入口契约。`src/index.ts` 声明项目，
`sources/` 保存采集证据，`knowledge/` 保存正式知识，`dist/` 保存可重复构建的
产物，`.tmp/context-runtime/` 保存可丢弃运行状态。

不要通过编辑 CLI-owned 生命周期文件强行推进流程。遇到阻塞时，当前 Route 或诊断
会给出权威恢复动作。

## 维护者参考

如果 Agent 接入不可用，可以用 `context status --format json` 手工查看同一条当前
Route。精确参数以 `context <command> --help` 为准，并优先执行
`workflow.current` 返回的命令，而不是复制文档示例。

工作区安装后的 SDK 参考入口是：

```text
node_modules/@c4a/context/docs/README.md
```

当 Route 要求配置项目或修改知识包模板时再读取对应手册。
