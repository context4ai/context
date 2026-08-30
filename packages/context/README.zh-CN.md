# Context SDK

[English](./README.md)

`@c4a/context` 是 Context 知识工作区背后的声明模型。它让工作区说明哪些来源会
贡献知识、证据经过哪些处理、哪些地方需要人工审核，以及最终应该构建哪些可复用
产物。

多数用户不需要单独安装或直接操作这个 SDK。他们从 Context Agent 入口开始，说明
知识目标；当 `src/index.ts` 需要配置时，当前工作流 Route 会引导 Agent 完成修改。
这份 README 面向知识项目作者、Agent 维护者和需要理解项目声明的开发者。

SDK 有意保持声明式：它本身不读取来源、不写入工作区状态、不运行 Agent，也不
构建知识包。这些操作由 [Context 工作流运行时](../context-cli/README.zh-CN.md)
负责。

## 在知识生产工作流中的位置

```text
用户意图 + 来源边界
         ↓
  src/index.ts 项目声明   ← 本包
         ↓
Context Route + Agent 判断
         ↓
正式知识 → 知识包产物
```

项目声明回答四个长期稳定的问题：

- 哪些已经登记的来源边界可以贡献证据？
- 存在哪些采集、提取、对齐、编译和审核阶段？
- 每种产物应该选择哪些正式知识分类？
- 哪些模板和资源分发策略决定最终包的结构？

它不记录当前进度。工作区事实和随包发布的 Workflow Provider 会在运行时选择下一
条 Route，因此 `src/index.ts` 是项目契约，不是第二套状态机。

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
    extractTs({ source: sampleLib, collection: "codeindex" }),
    reviewValidity({ collection: "codeindex" }),
  ],
  packages: [
    kbPackage({
      name: "sample-lib-kb",
      template: {
        path: "src/package-templates/kb",
        vars: { displayName: "Sample Library KB" },
      },
      select: { collections: ["codeindex"], okfRoots: ["wikis"] },
    }),
  ],
});
```

`src/index.ts` 类似知识项目的构建配置：它定义哪些内容进入项目、可以经过哪些转换
和门禁，以及最终能够构建什么产物。安装好的 Agent 入口保持精简，当前工作流
Route 会按需选择维护这份声明所需的操作说明、Schema 和手册。

## 主要 API

| API | 用途 |
|---|---|
| `defineProject()` | 声明完整的项目处理图。 |
| `source()` 和 `allSources()` | 引用已经登记的代码仓库、本地文件或飞书来源边界。 |
| `extractTs()` | 从 TypeScript/JavaScript 与 TSX/JSX 中提取符号和关系，生成 `codeindex` 候选。 |
| `extractCustom()` | 运行项目自有代码提取器，同时由 Context 维护候选、证据、新鲜度和审核状态。 |
| `alignProse()` 和 `compileProse()` | 整理文档证据，并生成与来源绑定的知识候选。 |
| `reviewValidity()` | 声明单个知识类型或整个项目的审核门禁。 |
| `customPhase()` | 在内置阶段无法覆盖时增加项目专用编排。 |
| `kbPackage()` | 使用审核通过的知识和模板构建 Agent 知识库。 |
| `llmsPackage()` | 构建供模型上下文或 RAG 导入使用的单文件文本包。 |

非 TypeScript 或需要聚合代码事实时使用 `extractCustom()`。`customPhase()`
只用于不发布知识候选的项目专用编排，不能绕开来源、提取、审核和打包生命周期。

Context CLI 不会把所有语言和仓库解析器都打入自身。知识项目可以按需安装结构
提取库，并在 `extractCustom()` 中使用：

| 包 | 提供的结构事实 |
|---|---|
| `@c4a/extract-go` | Go 声明、导入、调用和常见 HTTP 路由注册 |
| `@c4a/extract-rush` | Rush 项目、标签、入口信号、工作区依赖和所有者边界 |
| `@c4a/extract-ts` | TypeScript 提取，以及可复用的 React Router 路由事实 |

这些库本身不会创建 Context 阶段或候选。项目负责把确定性事实映射为自己的候选
身份和审核摘要；证据校验、新鲜度、审核、close 和打包仍由 Context 管理。

## 知识分类

审核通过的 Markdown 会存放在 `knowledge/<collection>/`：

| 知识类型 | 主要内容 | 常见来源 |
|---|---|---|
| `codeindex` | 代码符号、模块和调用关系 | 代码仓库 |
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

新建 KB 时优先选择 `assets: { delivery: "git-raw" }`：构建器把资源链接改写到
Git raw 地址；资源的提交和发布由知识包作者负责，Context 不做远端探测。
非 Git 工作区也可以配置显式 `urlPrefix`，引用另一个仓库已经发布的资源；没有
可用 Git 或显式前缀时，可选择 `delivery: "bundle"` 随包分发，或显式选择
`delivery: "omit"` 不输出资源并保留失效引用。随包分发还可以在工作区安装 `sharp` 并通过
`assets.optimize` 仅优化生成的知识包；Context 本身不依赖图片处理库。

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

[文档索引](./docs/README.zh-CN.md)说明每类工作流决策应该查看哪些参考资料。Agent
应优先读取 Route 选择的资源，不要预加载整套手册。
