# Context SDK

[English](./README.md)

`@c4a/context` 是 Context 知识工作区使用的声明式 SDK。多数用户通过 Context
Agent 和 CLI 工作；项目作者使用本包声明来源采集与知识包输出。

知识生产只有一条路径：`src/indexers.yaml` 选择 Indexer Provider，并管理需求、
Profile、范围和定制。`src/index.ts` 中的项目阶段不再负责生产代码或 Markdown
知识。

## 项目边界

```text
sources/*/index.yaml       已登记的来源边界
src/index.ts               采集与知识包声明
src/indexers.yaml          知识生产的唯一权威配置
knowledge/                 已批准、可读的知识
dist/                      面向读者的知识包产物
.tmp/context-runtime/      可恢复运行态（不提交）
```

`src/index.ts` 可以声明：

- `source()` / `allSources()` 来源引用；
- `captureFile()`、`captureLark()` 文档快照阶段；
- 不发布知识的 `customPhase()` 项目编排；
- `kbPackage()`、`llmsPackage()` 输出。

示例：

```ts
import {
  captureFile,
  defineProject,
  kbPackage,
  source,
} from "@c4a/context";

const docs = source("product-docs", { type: "file" });

export default defineProject({
  sources: [docs],
  phases: [captureFile({ source: docs })],
  packages: [
    kbPackage({
      name: "product-kb",
      template: "src/package-templates/kb",
      select: { collections: ["product", "architecture"] },
    }),
  ],
});
```

Context 生命周期负责发现或更新 `src/indexers.yaml`、运行选中的 Provider、展示可读
Candidate 供审核、只写入批准后的知识，最后构建声明的知识包。

## 主要 API

| API | 用途 |
|---|---|
| `defineProject()` | 声明项目边界。 |
| `source()` / `allSources()` | 引用已登记的代码仓库、本地文件或飞书来源。 |
| `captureFile()` / `captureLark()` | 生成确定性的文档快照。 |
| `mdxJsonDocs()` | 配置 MDX/JSON 文档采集处理器。 |
| `customPhase()` | 执行不生产知识的项目编排。 |
| `kbPackage()` | 构建 Agent 可读的知识包。 |
| `llmsPackage()` | 构建供模型或检索使用的文本包。 |

本包也导出 Provider 作者和 Context 运行时使用的 Indexer Schema 与校验器。它们
描述的仍是同一套 `src/indexers.yaml` 生命周期，不是第二条用户流程。

`@c4a/extract-ts`、`@c4a/extract-go`、`@c4a/extract-rush` 等解析包属于
Indexer Provider 的实现依赖，工作区不再把它们包装成项目阶段。

## 知识与知识包

批准后的知识位于 `knowledge/<collection>/`，目录和文件名面向人阅读，例如：

```text
knowledge/codeindex/tux-web/avatar.md
knowledge/architecture/tux-official-docs/react-lynx-input-fields.md
```

工作区页面只保留后续重建或更新所需的元数据。`dist/` 中的知识包页面使用更小的
读者投影：有用的标题、类型、摘要/标签（存在时）和正文。内部证据 ID 与摘要除非
恢复需要，否则只留在运行时 Artifact 中。

知识包模板位于 `src/package-templates/`；安装后的示例位于
`node_modules/@c4a/context/templates/package-templates/`。

## 状态边界

不要直接修改 `.tmp/context-runtime/` 下的生命周期文件。Candidate 状态、审核应用、
恢复、close、验证与构建由 CLI 管理。来源注册表、`src/index.ts`、
`src/indexers.yaml`、批准后的 `knowledge/` 和知识包模板才是长期项目输入。

## 参考文档

- [文档索引](./docs/README.zh-CN.md)
- [快速开始](./docs/getting-started.md)
- [Agent 指南](./docs/guides/agent-guide.md)
- [项目 API](./docs/reference/project-api.md)
- [Indexer Provider 协议](./docs/reference/indexer-provider-protocol.md)
- [知识包输出](./docs/guides/package-outputs.md)
- [知识包模板](./docs/reference/package-templates.md)

