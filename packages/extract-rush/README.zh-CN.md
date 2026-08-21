# Context Rush 工作区结构

[English](./README.md)

`@c4a/extract-rush` 为 Rush 工作区生成确定性结构索引。它报告项目身份、标签、
subspace、发布意图、入口信号、本地依赖边、解耦依赖和最近的 `OWNERS` 边界。

这些索引是 Context 知识项目的证据，不是产品分类。项目决定哪些事实对目标读者有
价值，并通过 `extractCustom()` 映射为候选；来源身份、候选新鲜度、审核、正式知识
和知识包产出继续由 Context 负责。

## 在知识生产链中的位置

```text
已确认的 Rush 仓库边界
           ↓
rush.json + package.json + OWNERS 事实
           ↓
项目自有候选映射
           ↓
经过审核的架构 / 归属 / package 知识
```

## 使用

```ts
import { indexRushWorkspace } from "@c4a/extract-rush";

const facts = await indexRushWorkspace(repositoryRoot, {
  tags: ["frontend"],
});
```

不提供 tag filter 时选择所有项目；`includeAll: true` 也会显式选择全部项目。结果
经过排序并保持稳定，适合生成来源指纹和可重复的候选。

索引包含：

- Rush 和 package manager 版本；
- package 名，以及 `package.json` 身份是否与 `rush.json` 一致；
- project folder、subspace、tag 和 publish flag；
- `main`、`module`、`types`、`exports` 和 `bin` 入口信号；
- 本地依赖类型和 specifier，包括 decoupled edge；
- 最近的 repo-relative `OWNERS` 文件和标准化 reviewer。

这个可选包不会增加公开 Agent 入口或 Context 生命周期阶段，只作为项目 Adapter
可以复用的结构库。

## 开发

```bash
bun run --filter @c4a/extract-rush build
bun run --filter @c4a/extract-rush typecheck
bun run --filter @c4a/extract-rush test
bun run --filter @c4a/extract-rush lint
```
