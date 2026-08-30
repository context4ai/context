# Context Rush 工作区结构

[English](./README.md)

`@c4a/extract-rush` 为 Rush 工作区生成确定性结构索引。它报告项目身份、标签、
subspace、发布意图、入口信号、直接依赖/消费者边、构建 phase/command、发布单元、解耦依赖和
最近的 `OWNERS` 边界。

这些索引是 Context 知识项目的证据，不是产品分类。项目决定哪些事实对目标读者有
价值，并通过 `extractCustom()` 映射为候选；来源身份、候选新鲜度、审核、正式知识
和知识包产出继续由 Context 负责。

## 在知识生产链中的位置

```text
已确认的 Rush 仓库边界
           ↓
rush.json + package.json + Rush 配置 + OWNERS 事实
           ↓
项目自有候选映射
           ↓
经过审核的架构 / 归属 / package 知识
```

## 使用

```ts
import {
  indexRushWorkspace,
  rushWorkspaceIndexToEvidenceAdapterResult,
} from "@c4a/extract-rush";

const facts = await indexRushWorkspace(repositoryRoot, {
  tags: ["frontend"],
});

const evidence = rushWorkspaceIndexToEvidenceAdapterResult(facts, invocation);
```

不提供 tag filter 时选择所有项目；`includeAll: true` 也会显式选择全部项目。结果
经过排序并保持稳定，适合生成来源指纹和可重复的候选。

索引包含：

- Rush 和 package manager 版本；
- package 名，以及 `package.json` 身份是否与 `rush.json` 一致；
- project folder、subspace、tag 和 publish flag；
- 已登记的 subspace 目录及项目成员；
- `main`、`module`、`types`、`exports` 和 `bin` 入口信号；
- 本地依赖类型、直接消费者和 specifier，包括 decoupled edge；
- phased build 依赖、command 到 phase 的绑定，以及各项目是否实现 phase；
- lock-step、individual-policy 和 standalone 发布单元；
- 最近的 repo-relative `OWNERS` 文件和标准化 reviewer。

构建事实只通过内容摘要保留 command/script 身份；结构索引与 Evidence ABI 均不复制原始 shell
command 或 package script。

这个可选包不会增加公开 Agent 入口或 Context 生命周期阶段，只作为项目 Adapter
可以复用的结构库。
Evidence ABI 转换为每个 `rush.json`、已选择的 `package.json` 和 `OWNERS` 输入指定唯一
primary owner，把项目文件绑定到授权 module ref，并将 workspace/project/dependency/owner
事实作为 catalog protocol item 发布。存在 `subspaces.json`、`command-line.json` 和
`version-policies.json` 时，它们分别成为具有唯一 owner 的 evidence 文件。

## 开发

```bash
bun run --filter @c4a/extract-rush build
bun run --filter @c4a/extract-rush typecheck
bun run --filter @c4a/extract-rush test
bun run --filter @c4a/extract-rush lint
```
