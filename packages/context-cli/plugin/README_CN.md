# Context Plugin

> [English version](./README.md)

<p align="center"><img src="./assets/logo.svg" alt="C4A Context" width="180"/></p>

Context 为项目内知识工作区提供轻量 Agent 入口。Plugin 不会把完整工作流塞进
一份提示词，而是先观察当前工作区事实，再由 Context CLI 选择当前步骤允许的
路线、命令、门禁以及 Markdown/schema 资源。

## 安装

```bash
npm i -g @c4a/context-cli
context plugin install
```

源码开发模式需要先构建：

```bash
bun run --filter @c4a/context-cli build
context plugin install --dev
```

可用 `context plugin install --dry-run` 查看安装动作，用
`context plugin path` 定位随 CLI 发布的 marketplace。

## Agent 入口

公开入口保持精简：

- `init`：创建 Context 工作区；
- `continue`：观察并推进已有工作区。

Continuation 从以下命令开始：

```bash
context status --format json
```

`workflow.current` 是当前步骤的权威协议。Agent 读取所有标记为
`read_state: read-required` 的 required 资源，只执行返回的命令，完整保留
revision 与 authority 参数，并在每次动作后重新求值。当前会话可通过
`context status --resource-receipts @<file>` 回传读取回执，使未变化资源标记为
`current`。动态资源的 materialize 结果只有在 Agent 完整读取返回文件后才可作为
回执；`context.source-body/*` 是必须阅读的正文，source-index 和标题元数据不能
替代正文。
长篇流程与语义判断规则发布在 Context workflow bundle 中，仅在当前路线或操作
选中时加载。

Gate 的检查动作与决议动作分别保留自己的 Skill 和 Schema 位置。Agent 只在进入
相应阶段时加载这些条件资源，不会把它们提前混入 Route 的普通 required 资源。

这两个入口文档也用于生成仅支持 Agent Skills 的宿主入口。不再发布阶段型
Skill；来源、对齐、编译、审核和构建说明均由当前路线选择的 workflow resources
动态提供。

## 人工门禁与全托管会话

普通模式保留来源、读取权限、提取范围、结构、审阅和包形态等显式门禁。只有用户
在当前对话明确要求全托管时，才使用：

```bash
context status --managed --format json
```

该会话权限不会持久化，也不能选择来源边界、授权尚未允许读取的外部内容、执行
外部仓库操作，或绕过校验与验证。

首次读取托管状态后，可用下面的命令合并连续的确定性步骤：

```bash
context run --managed --until blocked-or-complete --format json
```

遇到需要 Agent 判断、配置修改、额外权限、诊断修复或多条命令的路线时，循环会
立即停止，并返回当前 `workflow.current` 供 Agent 按需加载上下文。

## 工作区与 SDK

Plugin 应在初始化后的 Context 项目根目录运行。`src/index.ts` 保存项目声明；
来源状态、草稿状态、已批准知识、构建产物和临时运行状态均由 Context CLI 管理。

安装工作区依赖后，SDK 手册入口为：

```text
node_modules/@c4a/context/docs/README.md
```

当前 Plugin 不暴露 source 删除、purge 或 retraction，也不会静默执行 clone、
fetch、checkout、install、build、test 或调用 LLM。
