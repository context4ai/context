# Context Core 契约

[English](./README.md)

`@c4a/core` 是 Context 项目 SDK、提取框架和本地工作流运行时共同使用的契约包。
它让身份、Schema、错误和引用工具在不同 package 之间保持一致。

这个包面向 Context 维护者和扩展作者。知识工作区用户通常从 Context Agent 入口
工作，不需要单独安装它。

## 在知识生产工作流中的位置

```text
项目 SDK ─┐
提取器 ───┼─→ 共享类型 / Schema / 错误 / 引用
运行时 ───┘
```

Core 契约避免同一个来源、实体、关系或诊断在采集、提取、审核、验证和知识包构建
之间流转时出现不同数据形态。

## 提供内容

- 实体、关系、内容、来源和提取数据的领域类型；
- 用于校验共享输入输出的 Zod Schema；
- 稳定错误码和导出的 `C4AError` API；
- 解析和构造 `ref:*` 指针的工具；
- 提取与工作流 package 共用的常量和辅助函数。

`C4AError` 符号和 `@c4a/core` 包名是已经发布的 API 标识，不是另一套面向用户的
产品模型，也不应该进入生成的知识内容。

## 示例

```ts
import { C4AError, ErrorCode, parseRef } from "@c4a/core";

const parsed = parseRef("ref:entity:ent_123");
if (!parsed) {
  throw new C4AError(ErrorCode.VALIDATION_FAILED, "Invalid ref");
}
```

## 适用场景

- 增加会被多个 Context package 使用的共享协议；
- 在 package 边界校验外部数据或序列化数据；
- 处理跨资源身份和引用；
- 实现需要返回 Context-compatible 结构的提取器。

不要把工作流路由、来源专属业务含义、Agent Prompt 或文件系统生命周期行为放在
本包。它们分别属于 Workflow Provider、项目 SDK、提取插件或运行时。

## 开发

```bash
bun run --filter @c4a/core build
bun run --filter @c4a/core typecheck
bun run --filter @c4a/core test
bun run --filter @c4a/core lint
```

运行时代码保持兼容 Node.js。

## License

MIT.
