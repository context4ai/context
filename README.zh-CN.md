# Context

[English](./README.md)

**Context** 是一位运行在 Coding Agent 中的本地知识助理。它可以把代码仓库、本地文档和飞书文档逐步整理成可审查、可追溯、能够持续更新的知识，再构建成可供 Agent 使用的知识包。

你不需要一开始就想清楚最终的分类和知识包结构。只要先告诉 Agent 知识在哪里、希望解决什么问题，Context 就会通过对话陪你完成来源确认、内容提取、知识分类、人工审核、质量验证和打包。

## Context 能做什么

- 创建一个本地 Context workspace，知识生产过程不会藏在远程任务里。
- 读取文档证据，并从代码中提取结构化信息。
- 让生成的知识保留来源依据，方便审核和后续更新。
- 在来源范围、知识结构、候选审核和打包方式等关键环节等待用户确认。
- 把审核通过的知识构建成 Agent 知识库或其他声明好的产物。

和一次性或远程蒸馏相比，Context 更像是一位在本地和你一起工作的知识助理。它适合这样的阶段：你已经知道知识在哪里，但还不确定应该怎么提取、分类、组织和发布。

## 快速开始

安装 CLI 和 Agent 插件：

```bash
npm install -g @c4a/context-cli
context plugin install
```

安装完成后请重启 Agent，然后使用：

- `/context:init`：创建新的知识工作区。
- `/context:continue`：载入已有工作区，并从当前状态继续。

Agent 会解释下一步需要做什么，不需要用户直接操作底层 CLI。安装细节和 CLI 行为参见 [Context CLI 指南](./packages/context-cli/README.zh-CN.md)。

## 工作区概览

```text
context/
|-- AGENTS.md
|-- README.md
|-- package.json
|-- src/          # 项目配置和知识包模板
|-- sources/      # 来源登记和已读取的证据
|-- knowledge/    # 持久知识、结构投影和拒绝指纹
|-- dist/         # 构建生成的知识包（忽略）
`-- .tmp/         # 可删除的生命周期状态（忽略）
```

知识工作区由普通项目文件组成，可以查看、审核和纳入版本管理。`src/index.ts` 描述知识如何生产，`sources/` 与 `knowledge/` 保存来源证据和持久结果；活动候选与暂存结构只存在于被忽略的 `.tmp/context-runtime/lifecycle/`，成功关闭后由 CLI 清理。CLI 负责可靠地修改状态，Agent 负责解释、配置和语义判断，用户负责关键决策。

## 包与文档

- [`packages/context`](./packages/context/README.zh-CN.md) 是 `src/index.ts` 使用的声明式 SDK，主要介绍来源、阶段、知识分类、知识包声明、模板和自定义处理。
- [`packages/context-cli`](./packages/context-cli/README.zh-CN.md) 提供 `context` 命令和 Agent 插件安装能力，主要介绍安装、工作区操作、命令分组和流程规则。

更完整的 SDK 手册位于 [`packages/context/docs`](./packages/context/docs/README.md)，CLI 还提供一份简明的[快速开始](./packages/context-cli/docs/quickstart.md)。

## 有想法，直接告诉 Agent

> Context 插件提供薄入口，并由当前路由按需选择工作流资源和说明文档。载入 Context 工作区后，无论哪里不明白，或者只是有一个不太成形的想法，都可以直接和 Agent 聊。Agent 会结合当前证据和项目状态，把讨论逐步变成可以审核和使用的知识。

## 仓库开发

源码、链接、Agent 插件和 npm 产物的开发方式参见
[`DEVELOPMENT.md`](./DEVELOPMENT.md)。

```bash
bun install
bun run build
bun run typecheck
bun run test
bun run lint
bun run verify
```

把本地 CLI 链接到全局：

```bash
./start.sh link
```
