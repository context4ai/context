# Context SDK

[English](./README.md)

`@c4a/context` 是 Context workspace 使用的声明式 SDK。它为 `src/index.ts` 提供类型化 API，用来描述知识来源、处理阶段、审核门禁和知识包输出。SDK 本身不写入工作区，也不执行流程；这些操作由 [Context CLI](../context-cli/README.zh-CN.md) 负责。

## 项目模型

Context 项目使用“来源 → 阶段 → 知识包”的声明模型：

```ts
import {
  defineProject,
  extractTs,
  kbPackage,
  reviewValidity,
  source,
} from "@c4a/context";

const sampleLib = source("20260712", "sample-lib");

export default defineProject({
  sources: [sampleLib],
  phases: [
    extractTs({ source: sampleLib, collection: "codegraph" }),
    reviewValidity({ collection: "codegraph" }),
  ],
  packages: [
    kbPackage({
      name: "sample-lib-kb",
      template: {
        path: "src/package-templates/kb",
        vars: { displayName: "Sample Library KB" },
      },
      select: { collections: ["codegraph"], okfRoots: ["wikis"] },
    }),
  ],
});
```

`src/index.ts` 有点像知识项目的 Webpack 配置：它定义哪些内容进入项目、经过哪些转换和门禁，以及最终构建什么产物。安装好的 Agent 插件只提供薄入口，当前工作流路由会按需选择维护这份配置所需的流程资源和 SDK 文档。

## 主要 API

| API | 用途 |
|---|---|
| `defineProject()` | 声明完整的项目处理图。 |
| `source()` 和 `allSources()` | 引用已经登记的代码仓库、本地文件或飞书来源边界。 |
| `extractTs()` | 从 TypeScript/TSX 中提取符号和关系，生成 `codegraph` 候选。 |
| `extractCustom()` | 运行项目自有代码提取器，同时由 Context 维护候选、证据、新鲜度和审核状态。 |
| `alignProse()` 和 `compileProse()` | 整理文档证据，并生成与来源绑定的知识候选。 |
| `reviewValidity()` | 声明单个知识类型或整个项目的审核门禁。 |
| `customPhase()` | 在内置阶段无法覆盖时增加项目专用编排。 |
| `kbPackage()` | 使用审核通过的知识和模板构建 Agent 知识库。 |
| `llmsPackage()` | 构建供模型上下文或 RAG 导入使用的单文件文本包。 |

非 TypeScript 或需要聚合代码事实时使用 `extractCustom()`。`customPhase()`
只用于不发布知识候选的项目专用编排，不能绕开来源、提取、审核和打包生命周期。

## 知识分类

审核通过的 Markdown 会存放在 `knowledge/<collection>/`：

| 知识类型 | 主要内容 | 常见来源 |
|---|---|---|
| `codegraph` | 代码符号、模块和调用关系 | 代码仓库 |
| `business` | 业务概念、角色和业务关系 | 业务文档、飞书文档 |
| `product` | 产品能力、功能行为和产品关系 | 产品文档、需求文档 |
| `architecture` | 系统结构、模块职责和设计说明 | 架构文档、设计文档 |
| `sop` | 操作流程、运行手册和处理步骤 | 操作手册、值班文档 |
| `faq` | 常见问题、解释和排障方法 | FAQ、支持文档、经验记录 |
| `decision` | 方案选择、取舍和决策背景 | 设计评审、决策记录 |
| `incident` | 故障过程、处置方式和后续行动 | 故障复盘、事故报告 |
| `standards` | 必须遵守的规范和约束 | 研发规范、业务规则 |
| `test` | 验证规则、测试场景和验收标准 | 测试文档、验收说明 |
| `feats` | 面向具体场景整理的能力记录 | 项目自定义处理和已确认知识 |

知识类型是语义分类，不是最终知识包目录。构建时会把选中的类型映射到 `wikis/`、`guides/`、`rules/`、`feats/` 等 OKF 目录。同一份来源可能贡献多种知识，分类应该依据证据和用户确认，而不是文件名。

## 知识包模板

知识包声明会引用 `src/package-templates/` 下的可编辑模板。安装后的示例位于：

```text
node_modules/@c4a/context/templates/package-templates/
```

默认 KB 模板包含：

```text
kb/
|-- AGENTS.md
|-- skills/
|   `-- knowledge-query/SKILL.md
`-- wikis/index.md
```

`knowledge-query` Skill 会告诉消费知识包的 Agent 如何浏览索引、读取审核通过的知识并引用证据。项目还可以增加更多 Skills，或者在 `wikis/`、`guides/`、`rules/` 等目录中加入模板文件。

模板使用 Handlebars 变量，可以作用于文件内容和路径。常用变量包括 `{{packageName}}`、`{{displayName}}`、`{{knowledgeCount}}`、`{{knowledgeGroups}}`、`{{knowledgeItems}}`、`{{knowledgeTree}}` 和 `{{buildInventory}}`。

每个 KB 包直接输出扁平的 `wikis/`、`guides/`、`rules/`、`feats/` 等根目录；包 `name`
只用于确定 `dist/<package-name>/` 边界，不会再次写入知识路径。旧工作区中的
`distribution.knowledgeNamespace` 仍可被读取，但不再改变构建结果；新声明无需配置它。
Skill 名称继续由作者独立维护。

如果需要更强的路由和检索能力，模板可以携带 `query.ts` 一类本地脚本，再由 Skill 约定 Agent 何时、如何调用。Skill 也可以把 Agent 路由到 MCP、CLI 或其他工具，组成适合当前知识包的 Agentic Search 流程。

长期维护、多来源的知识生产工作区可以从
`templates/project-skills.zh-CN/maintain-project-knowledge/SKILL.md` 复制一份
项目维护 Skill 到 `.agents/skills/`。它不进入知识包，而是补充项目专属的来源
归属、仓库变化影响范围和准出标准；Context 生命周期仍由已安装的 Context Skill
和当前 Route 负责。

## 状态边界

SDK 只负责声明。它可以描述读取、写入、阶段、审核和知识包选择，但来源物化、内容读取、代码提取、审核应用、正式知识写入、质量验证和构建都由 CLI 负责。不要通过直接编辑 `sources/`、`knowledge/`、`dist/` 或被忽略的 `.tmp/context-runtime/lifecycle/` 运行态来替代 CLI 生命周期操作；成功 close 后 CLI 会清理该运行态。

## 参考文档

- [文档索引](./docs/README.md)
- [快速开始](./docs/getting-started.md)
- [Agent 指南](./docs/guides/agent-guide.md)
- [项目 API](./docs/reference/project-api.md)
- [知识包输出](./docs/guides/package-outputs.md)
- [飞书资源物化](./docs/guides/lark-resources.md)
- [知识包模板](./docs/reference/package-templates.md)
- [模板变量](./docs/reference/template-variables.md)
