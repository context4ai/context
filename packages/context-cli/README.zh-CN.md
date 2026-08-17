# Context CLI

[English](./README.md)

`@c4a/context-cli` 提供 **Context CLI** 和全局 Agent 插件安装能力。CLI 负责管理本地知识工作区的状态，Agent 插件负责解释状态、询问用户决策并修改项目配置。

CLI 同时兼容 Node 和 Bun，本身不会调用 LLM。机械操作交给 CLI，语义判断交给 Agent，重要决策交给用户。

CLI 对 Markdown 只做结构解析：源标题会保留在可引用的证据区间中，但标题的含义、分组方式和知识类型均不会由 CLI 推断。

## 安装

```bash
npm install -g @c4a/context-cli
context plugin install
```

全局安装 npm 包时也会尝试刷新插件，但不会因为插件安装失败而阻塞 CLI 安装。安装或升级 Claude、Codex 后，可以再次执行 `context plugin install`，然后重启 Agent。

面向用户的 Agent 入口是：

- `/context:init`：创建一个本地 Context workspace。
- `/context:continue`：读取已有工作区的状态，并从下一步继续。

`/context:continue` 是 Agent 工作指引，不是 CLI 子命令；不存在 `context continue` 命令。

最简安装后流程参见 [CLI 快速开始](./docs/quickstart.md)。

工作区调试追踪默认关闭。仅在需要观察命令调用与 Agent Graph 路由时，使用
`context init context --debug` 或 `context debug enable` 开启；日志只写入已忽略的
`.tmp/context-runtime/debug/`。协议与回放说明见
[工作区调试追踪](./docs/debug-tracing.md)。

## CLI、Agent 和用户的分工

| 职责 | 负责方 |
|---|---|
| 来源登记、内容读取、代码提取、应用审核、验证和构建 | CLI |
| 解释选择、修改 `src/index.ts`、提出知识结构、基于证据生成候选 | Agent |
| 来源授权、知识分类、审核决定和打包方式 | 用户 |

Agent 把 `context status --format json` 返回的 `workflow.current` 作为当前步骤的权威协议，不会凭记忆猜下一条命令。默认 JSON 是紧凑视图，只包含当前路由、所需资源位置、进度、计数和聚合诊断；调试时才使用 `--view full`。长篇流程和语义规则仍以完整 Markdown 资源随包发布，由当前路由按需选择，渐进加载不会删减内容。

## 创建或继续工作区

```bash
# 创建独立工作区
context init context --language zh-CN
cd context
bun install

# 让 Agent 从当前状态继续
/context:continue
```

初始化生成的 `AGENTS.md` 是 Agent 在当前项目中的操作指南。安装依赖后，SDK 手册位于：

```text
node_modules/@c4a/context/docs/README.md
node_modules/@c4a/context/docs/guides/agent-guide.md
node_modules/@c4a/context/docs/reference/project-api.md
node_modules/@c4a/context/docs/reference/package-templates.md
```

工作区状态分布在：

- `src/`：项目声明和知识包模板。
- `sources/`：来源登记和已经读取的证据。
- `.tmp/context-runtime/lifecycle/`：一个开放生命周期轮次中的、被忽略且仅由 CLI 管理的草稿候选和已确认结构快照。
- `knowledge/`：已批准的 Markdown、close 后的 `structure.yaml` 结构投影，以及存在时用于记录被拒候选 fingerprint 的精简 `decisions.json`。已批准页面引用的资源位于内容寻址的 `knowledge/assets/`。
- `dist/`：构建生成的知识包。
- `.tmp/context-runtime/`：其他被忽略的日志、预览、报告、锁和缓存。

生命周期和审核运行态不可由用户编辑，成功执行 `context close` 后会被自动清理。`knowledge/structure.yaml` 是持久的已批准结构投影，其中精简的 `source_inputs` 只记录已关闭 prose 目标消费的 source、collection 和来源快照，以便临时结构清理后仍能区分已完成输入与变化输入；`knowledge/decisions.json` 仅保留被拒候选的 ID 与 fingerprint，避免未变化的候选再次出现。

不要通过手动删除或改写这些目录来修复流程状态，应使用 CLI 返回的命令或下一步操作。

## 知识包输出

`context build` 会把声明好的知识包写入 `dist/<package-name>/`。KB 包直接使用
`wikis/`、`guides/`、`rules/` 和 `feats/` 作为包内 OKF 根目录，不再在这些目录下重复包名。
旧工作区即使仍声明 `distribution.knowledgeNamespace` 也可以继续加载，但该兼容字段不再改变
知识包输出路径。
选中页面引用的资源会复制到包内 `others/assets/`，相对链接由构建器自动改写。

完整配置和模板约定参见 SDK 手册：

- [知识包输出](../context/docs/guides/package-outputs.md)
- [知识包模板](../context/docs/reference/package-templates.md)

## 状态驱动流程

项目流程声明在 `src/index.ts` 中，由 `context status` 背后的 Context 工作图负责路由。这张图是 CLI 内部实现；用户和插件只消费 `workflow.current`、Context 命令以及当前路由选中的资源：

| 阶段 | CLI 入口 |
|---|---|
| 来源设置 | `context source add repo/file/lark`、`context source add batch`、`context source ensure` |
| 文档读取 | 通过 `context run <phase-id>` 执行声明好的 capture 阶段 |
| 代码提取 | 通过 `context run <phase-id>` 执行声明好的 `extractTs` 阶段 |
| 文档结构 | `context run align:<type>:<source>:<collection> ...` 的证据和校验视图 |
| 文档编译 | `context run compile:<type>:<source>:<collection> ...` 的证据和校验视图 |
| 人工审核 | `context review html`、范围化决定和 `context review apply` |
| 收口与质量 | `context close`、`context verify` |
| 知识包输出 | `context build` |

一次构建只完成当前已经确认的知识状态，并不会冻结工作区。后续还可以继续添加和处理新的来源。

## 命令分组

```bash
# 插件安装与诊断
context plugin install
context plugin status

# 工作区创建与状态
context init [project-dir]
context status
context run --managed --until blocked-or-complete --format json

# 当前路由选择的资源
context resource materialize --help
context resource acknowledge-current --help

# 知识来源
context source add repo [YYYYMMDD] --module <module> --local <repo-or-subdir>
context source add file [YYYYMMDD] --module <module> --local <file-or-folder>
context source add lark [YYYYMMDD] --module <module> --url <lark-url>
context source add batch [YYYYMMDD] --input <yaml-or-json>
context source remove <source-id> --format json          # 预览
context source remove <source-id> --yes --plan-digest <预览摘要> --format json
context source ensure [source]
context source inspect [source]

# 声明阶段与审核
context run --list
context run <phase-id> --dry-run
context run <phase-id>
context review html [collection] --open
context review apply <payload-file>

# 知识包模板决策
context package template accept --help

# 最终质量与输出
context close
context verify
context build

# 可选的工作区调试追踪
context debug enable
context debug status
context debug export

# 开发与缓存维护
context clean-cache --dry-run
```

当前参数以 `context <command> --help` 为准。需要工作区的命令会向上查找带有
`context.project=true` 和 `context.entry` 配置的 `package.json`。带 revision
约束的资源和知识包命令通常应直接复制 `workflow.current` 返回的命令；上面的例子只用于
发现命令入口，不能替代当前路由。

## 人工门禁与证据

- CLI 不会悄悄在来源仓库中执行 clone、checkout、reset、fetch、install、build 或脚本。
- 登记来源和读取来源正文是两次独立授权。
- 写入知识候选前，需要确认代码提取范围和文档分类。
- 普通模式下，审核决定来自用户，Agent 不能自行编造批准或拒绝结果；只有当前对话明确启用全托管时，才可执行 `workflow.current` 返回的原子批准命令。
- 正式知识准备好后再选择打包方式；知识包模板是项目配置，不是第二份事实来源。

CLI 返回的来源名称、阶段 ID、候选 ID、诊断和 `source_ref` 都是流程标识。`source_ref` 是不可拆解的证据引用，应原样复制，不能把它当作文件路径解析。

## 继续阅读

- [CLI 快速开始](./docs/quickstart.md)
- [SDK 文档索引](../context/docs/README.md)
- [快速开始](../context/docs/getting-started.md)
- [Agent 指南](../context/docs/guides/agent-guide.md)
- [Agent 对话指南](../context/docs/guides/agent-dialogue.md)
- [飞书资源物化](../context/docs/guides/lark-resources.md)
- [项目 API](../context/docs/reference/project-api.md)
- [知识包模板](../context/docs/reference/package-templates.md)

## 开发

完整的源码、链接、插件和 npm 产物流程参见
[`DEVELOPMENT.md`](../../DEVELOPMENT.md) 和当前包的
[`DEVELOPMENT.md`](./DEVELOPMENT.md)。

```bash
./start.sh link
bun run --filter @c4a/context-cli build
bun run --filter @c4a/context-cli typecheck
bun run --filter @c4a/context-cli lint
bun run --filter @c4a/context-cli test
```

构建会把 Claude、Codex、Cursor 和纯 Skill 形态的插件写入 `dist/plugins`。`context plugin install` 从包内构建产物安装插件，不要直接修改生成目录。

## License

MIT.
