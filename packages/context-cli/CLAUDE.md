# @c4a/context-cli

`@c4a/context-cli` 同时提供本地 `context` CLI 和 `context` plugin。本文件是包级开发准则;通用 Bun / TypeScript / 测试 / 构建规则看仓库根 `AGENTS.md`,版本特定阈值 / 字段 / Phase 拆分见 `design/<version>/README.md`。

## 设计原则（一切决策的最高优先级）

原则分两层、同等优先级、任何 PR 同时过:

- **编码原则**讲“代码该怎么写” — 命名、抽象、fallback、协议收口、心智复杂度。
- **工作流与协议原则**讲“协议该长成什么样” — CLI vs Agent 职责、自愈、错误恢复、view 预算、序锁。

### 编码原则

- **不拟合数据**：不要把 fixture / 单条 case / 当前实测样本的形态当成 API 协议。决策依据是“长期类型 / 类别上的合理性”，不是“这次跑出来什么字段就把字段固化”。
- **长期合理**：选择能在未来 6-12 个月内仍然成立的设计，哪怕实现成本更高。今天省的 1 小时往往换 3 个版本之后的 1 周返工。
- **只维护当前协议**：beta.x 阶段没有需要保护的外部契约消费者。该改 schema、改字段名、改 view 形态就改，**禁止**为不支持的形态保留别名、fallback 或双入口。
- **一步到位**：发现问题就找根因改根因；不要“先打补丁、回头再说”。补丁会变成下一次审查的债务，且 99% 不会“回头”。
- **不要苟且于低成本方案**：低成本方案 ≠ 正确方案。“加一行 if 绕过这个 case”、“在 helper 外面再包一层兜底”、“先 grep 切一下” 都是典型反例。**真正的低成本是不重复修同一个问题**。
- **面向 Agent DX 友好**：默认输出 / 错误信息 / hint / 命令命名 / 参数语义，第一受众是 LLM agent，第二才是人类开发者。判断标准：**一个全新 agent 拿到这个输出，能不能在零外部上下文下做出正确的下一步动作**？做不到就回去改设计。
- **心智低是第一要务**：
  - 同义字段不要起多个名字（`sourceId` / `source_id` / `sourceID` 三选一，全仓一致）。
  - 同类命令不要有两个入口（`workspace write` 和 `compile draft --input` 干同一件事就废一个）。
  - 同一个概念不要在两个 view 里换形态。
  - 错误必须**显式说怎么修**，不能只说“出错了”。
  - 默认值是 agent 最常需要的形态，不是实现最简单的形态。

### 工作流与协议原则

- **CLI 负责流程，Agent 负责语义**：CLI 决定 stage / route / allowed actions / next_action / view 预算 / repair 路径；Agent 只读 evidence、做语义归类、生成 source-bound payload。能由 schema / mount matrix / raw/source_ref 指针 / coverage / contiguity / citation eligibility 判定的规则必须由 CLI 强制，不要在 skill 里重写一遍。
- **硬约束优先于提示词**：同一条规则不要在 skill checklist 和 CLI validate 里写两遍。能用 CLI hard gate / typed diagnostic 表达的全部下沉；skill 只保留入口说明、evidence boundary 和 next_action 跟随契约。
- **能自愈就自愈，该阻塞才阻塞**：不改变语义、可机械验证、可审计的修复直接自动应用并记录到 `auto_repaired[]`；需要语义判断、用户确认、可能改变知识内容时才返回 blocking question / review。
- **错误输出就是恢复入口**：任何拒绝必须带 typed `reason_code` + 最小诊断 + canonical `next_action.command` + `input_schema`。Agent 不从历史 prompt 反推下一步，stdout 里看到的就是修复路径。不允许 “出错了请重新读 skill” 这种 dead-end。
- **协议幻觉用 guard，证据要求不松动**：协议层（command/flag/schema/view 预算/分页/source-ref 形态）的幻觉用 CLI 硬 guard 兜底；source evidence、coverage、contiguity、citation eligibility、mount matrix 这些内容质量硬约束**不**为流程顺滑而松动。view-count 不能替代 raw/source_ref 指针。
- **弱模型友好 ≠ prompt 膨胀**：弱指令遵循模型踩的机械错误（context_only 误用、summary 噪音、advisory 当 blocking、source_ref 拼写错误）应转化为 CLI envelope、typed diagnostic、safe default 和 patch-ready payload；不要继续往 skill 里塞 checklist / 陷阱表。
- **串行写入，并行读取**：align stage / compile stage / review apply / close / build 等写路径保持串行锁；NodeContext、source-refs、coverage、status 等只读 view 仅当 CLI 明确标注 `prefetch_commands[]` 时才能并行预取。多 Node workset 也按 CLI 顺序逐 Node 闭环，不允许 shell 循环并发 stage/apply/close/build。

### 反例 → 正例 对照

| 反模式（不要做） | 正例（应该做） |
|---|---|
| “blocks view 一次性吐 71 个 block，agent grep 切一下就行” | blocks view 默认 summary（by_heading + by_window），filter 后再展开详情 |
| “保留 `versionPolicy` 字段做别名，同时输出 `version_policy`” | 直接切 snake_case，别名彻底去掉 |
| “agent 再 finalize 一次会创建新 workflow 但 input_digests 为空——反正它会自己 abandon” | finalize on already-finalized workflow 显式 reject，hint 里给 abandon 命令 |
| “warning hint 里 `command` 放不可执行的 schema lookup，让 agent 自己找下一步” | `command` 必须是 agent 可以**直接执行**的下一步动作命令 |
| “skill checklist 写一遍 + CLI validate 写一遍，双保险” | 规则只在 CLI validate 里强制，skill 只引用 next_action |
| “weak-support 在 review 接受，在 apply 重新判一遍” | review 是 canonical gate，apply 用 ready artifact 直接执行，不二审 |
| “错误输出说 ‘invalid input’，让 agent 再 grep schema” | 错误带 `reason_code` + `valid_kinds` + canonical `next_action.command` |

任何 PR 走 fallback / 别名 / 双入口 / 把可机械判定规则丢回 skill，reviewer 必须问“长期形态是什么？为什么不一步到位？为什么不下沉到 CLI guard？”，回答不上来就回炉。

## 核心边界

- CLI 做机械事务：workspace 定位、文件 I/O、source registry/snapshot、Node/Section 渲染、package index、verify、approved structure projection、build inventory。
- Agent 做综合判断：align 分类、compile draft、语义支持/冲突/弱证据判断、用户问题翻译。
- CLI 不调用 LLM；Agent 不手写 `knowledge/` markdown。
- `sources/` / `knowledge/` / `dist/` / `.tmp/context-runtime/` 只能由当前 CLI 命令维护，不能用通用 workspace write 绕过协议。候选和暂存结构属于 `.tmp/context-runtime/lifecycle/`；成功 close 后必须由 CLI 清理。

## 工作流入口

| Slash command | Skill 链 | CLI 辅助 | 写入边界 |
|---|---|---|---|
| `/c4a:context` | thin Context shell | 运行 `context entry --format json`，按返回动作初始化、进入工作区或消费 `workflow.current` | 单一对话入口；入口解析器只处理 workspace bootstrap，底层 Graph 选择生命周期路线。 |

改 project workflow 协议时，同步更新 `context-workflow/` Provider、CLI
adapter、对应 plugin shell、SDK 手册和 Graph tests，并运行 `bun run build`
重新生成唯一 Provider Bundle 与 `dist/plugins`。

### V1 Agent 入口与写入契约

- 公开 Agent 入口只保留 `/c4a:context`。不要为初始化或 `source` / `run` / `review` / `build` / `verify` / `status` 增加第二个公开 slash command 或 public skill。
- `/c4a:context` 是对话式入口，不是同名 CLI primitive。它先运行只读 `context entry --format json`，只执行返回的 `next_action.command`；工作区就绪后把 `workflow.current` 当作当前步骤权威，完整读取 required 资源，并原样执行 Route 返回的命令。**不要新增或调用 `context continue`**。
- 用户在当前会话明确授权全托管后，默认先调用 `context run --managed --until blocked-or-complete --format json`，不要由 Agent 手工重复 status/action。它不是第二个路由入口：只能执行唯一、immediate、非 read 命令，每步后必须重新求值；遇到语义读取、配置、诊断、权限缺口或多命令时立即返回当前 `workflow.current`。
- 普通模式与全托管模式复用同一 Gate，并完整保留普通模式的 Inspection 与 Resolution 能力。只在 Graph Gate 的 `delegated` 策略中声明全托管可跳过的冗余 inspection、可替换的对话 Resource，以及需要时由 authority 选择的专用 Resolution Action；不要在 Facts、TypeScript 或入口提示词中把 Authority 伪装成已完成业务事实。普通模式在工作区创建后和来源采集完成后通过 Route-selected dialogue 说明模式差异。
- Agent 不得只复述 Route 的机械命令。`availability=immediate` 时读取 required 资源后执行；`gate` 未解析时先执行 read 命令并向用户解释决定；`configuration` 存在时只修改指定项目文件。动作后重新 status，phase-local `next_action` 不得替代 workspace Route。
- `missing-source` 不是自动探索信号。不要根据 cwd、父目录、monorepo 结构、package 名、`git remote` 自行决定 source;用户明确给出 source 名称/路径/ref 后,才运行 `context source add repo ...`。
- `needs-extract-phase` 表示 extract phase 尚未声明。不要扫描源仓库来替用户选 include/exclude;先问用户要摄取哪个已登记 source、哪些目录/包/符号范围,再按 `workflow.current.configuration` 编辑 `src/index.ts`。
- 底层 CLI 命令可以保留，但只作为 `/c4a:context` 驱动的机械动作。默认用户不需要知道命令清单。
- `context init` 生成的 workspace `AGENTS.md` 只放项目边界、SDK 手册位置、CLI-only workspace 规则,不承载长流程 prompt。

### Knowledge / OKF Profile

- 新 context 项目的 approved Markdown 遵循完整 **Context production profile**：YAML frontmatter 顶层放 OKF 字段以及来源、节点、代码和审核元数据。kb package `dist/<name>/<okf-root>/...` 使用消费态投影：页面只保留面向阅读和检索的内容字段；节点身份、来源、Section 证据注释和其他生命周期字段不进入发布页。`context-build-inventory.json` 记录 `dist_path → approved_path`、节点身份和包级结构，维护者回到 `knowledge/` 后再使用完整 `sources` / `source_ref` 归因，不得改写 `knowledge/`。`<okf-root>` 直接是 `wikis`、`guides`、`rules` 或 `feats`，不再附加 package namespace。
- prose/structure knowledge 必须写稳定 `node_type`(如 `entity` / `domain` / `action`);路径和 tags 可以辅助浏览或查询,但不能替代 frontmatter `node_type`。
- 代码锚定字段放顶层 `sources`、`visibility`、`code_symbols`;不要再写 `context.sources`、`context.visibility`、`context.code_symbols` 或 `updated`。
- Section source-ref 注释使用 `<!-- context:section ... -->`;不要在新 context 项目输出 `c4a:section`。
- 不写 frontmatter `source_refs`;page-level provenance 由 Section 的 `source_ref` 注释派生。
- accepted Section `source_ref` 文法为 `src-N#symbol:<file>:<symbol-id>:<kind>@<digest>` 和 `src-N#span:<heading-hint> L<start>-<end>@<span-hash>`。代码 ref 的 `file` 用于在当前 symbol index 内消除同名同摘要歧义;整个 `source_ref` 对 Agent 仍是不透明 token。`#span:` 必须保留行号范围,用于 human review、diff 和 re-pin;它走 file/lark snapshot source span resolver,不是 code symbol index,也不是 block/raw evidence identity。
- 当前 Indexer approved Markdown 不保存 `candidate_fingerprint`、Indexer digest 或 `code_origin`；
  current/stale 由本机 runtime 与批准页面的实际正文、来源共同判定。
- 不写 `schema` 字段。协议版本由工具/文档和 verify 约束,不是 approved MD 的 frontmatter 字段。
- `timestamp` 是内容或状态账本实际变化时间,不是 build/run 时间;无变化重跑不得刷新。
- kb package 根目录可以包含 `AGENTS.md` 和 `skills/`;OKF-compatible interchange surface 是 `dist/<name>/wikis/`、`guides/`、`rules/`、`feats/` 子树。默认模板必须包含可编辑的 `src/package-templates/kb/wikis/index.md`,并在生成的 workspace `AGENTS.md` 中提醒用户可定制该入口页。
- package templates 使用 Handlebars 渲染。默认 `wikis/index.md` 应利用 `knowledgeGroups`、`knowledgeItems`、`knowledgeTree` 等变量生成可导航的入口页;模板说明用 Handlebars 注释或 `context:template` HTML 注释,build 输出不得保留这些说明。
- `context build` / `context status` 必须把 kb 模板缺 `wikis/index.md`、模板渲染路径覆盖 copied knowledge 路径这类问题当成 workspace-state-invalid,不能让模板文件静默覆盖知识页。
- KB package 的 `wikis/`、`guides/`、`rules/`、`feats/` 是最终扁平根，不在根内重复 package name。旧工作区的 `distribution.knowledgeNamespace` 仅作为兼容输入读取，不影响输出路径或构建指纹。`skills/**/*.md` 模板优先使用 `{{wikisRoot}}` / `{{guidesRoot}}` / `{{rulesRoot}}` / `{{featsRoot}}`，以便引用随根目录契约统一变化。

### Agent 对话语言

- `plugin/commands/*.md` 和 SDK Agent guide 必须明确:Agent 面向用户的解释、提问、确认和总结使用**用户当前对话语言**。
- CLI 命令、flags、路径、package/source/phase/candidate id、status enum、JSONL payload key、`source_ref` 等协议文本保持英文/原样,不得翻译。
- CLI 默认 text 输出可以继续使用英文稳定标签,但 slash command / skill 不应把英文 stdout 大段原样转发给用户;应读取 stdout 作为证据,再用用户语言说明状态和下一步。
- shipped docs 本身可以是英文,但其中的英文句子是语义模板,不是中文对话里要逐字复制的用户回复。

### Agent 对话 UX（必须遵守）

面向用户的提问不是参数收集表。每个 human gate 必须先解释“用户正在做什么决策、这个决策影响什么、有哪些常见选择”,再给必要的命令或实现细节。禁止用内部 API / 配置项 / 默认值作为开场问题。

必须遵守:

- **有限选项必须用 askUser 形态**。当 human gate 是明确的二选一或少量选项（如“按原文档生成草稿” vs “语义整理候选”、“Agent 知识包” vs “LLM 文本包”、“创建替换候选” vs “确认现有内容仍有效”）时,优先使用宿主原生多选工具:Claude Code `AskUserQuestion`、Codex 当前暴露的 user-input 工具（例如 `request_user_input`）、Cursor Plan Mode `AskQuestion`;不可用时才退回 Markdown `A/B/C` 选项。每个选项必须带一句影响说明,不要只发自由文本问题让用户猜有哪些分支。选项标签必须是用户能理解的语义,不要用 SDK API 名作为选项;API 名只在用户要求实现细节、编辑 `src/index.ts` 总结或精确命令说明中出现。
- **先讲产品语义,后讲实现细节**。例如先说“选择知识来源边界会影响 `knowledge/` 目录、`source_ref` 前缀和 `dist/<name>-kb` 这类包名”,再说需要登记 repo source;不要先问“source name 是什么”。monorepo/subspace 场景中,日期只组织 source 批次并进入 phase id/source_ref;稳定知识路径使用模块名,如 `knowledge/codeindex/<module>/...`,因此抽取前仍要确认具体 package/subdirectory 边界。
- **避免裸露内部协议名**。Provider handler、phase id、payload schema 等只在代码修改总结、精确命令、或用户要求细节时出现。默认对话应说“读取已登记来源并生成待审知识；审阅通过后才写入 `knowledge/`”。
- **每个确认问题都要说明影响面**。source 边界影响输出路径和引用前缀;抽取范围影响哪些文件/符号会进入草稿;review 影响哪些候选会变成 approved Markdown;package 选择影响 `dist/` 输出结构和 Agent 消费方式。
- **不要把 CLI placeholder 原样转成用户问题**。看到 `<name>` / `<repo-or-subdir>` / `<phase-id>` / `<collection>` 时,先翻译成用户决策,并给 1-2 个基于当前上下文的候选示例。只有用户确认后才执行命令。
- **不要把“默认范围”讲成黑盒**。默认提取必须解释为具体范围:选定 source 内的 `src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`、导出符号、draft candidates、先 dry-run 展示数量和 `knowledgeTree`,再真实抽取。
- **不要替用户做语义决策**。可以执行安全机械命令;不能自行决定 source 边界、抽取 include/exclude、review approve/reject、package 类型、远程 clone/checkout。
- **输出要短,但不能省掉决策含义**。报告格式优先是:已完成什么、当前状态、下一步需要用户决定什么、该决定的影响。

Human-gate 话术的权威来源是当前 Provider Graph 选中的
`context-workflow/resources/dialogue/*.md`;SDK
`node_modules/@c4a/context/docs/guides/agent-dialogue.md` 只介绍稳定原则和发现方式。
修改门禁语义时必须更新 Graph 资源引用、可达性测试和必要的 SDK 概览。

### Prose compile 覆盖进度

- Prose compile 按 confirmed structure 的 Node/section 逐项收敛：先读
  `read-plan` / `node-context` / schema，再提交
  `context.compile-actions.v1`。不要 shell 循环或并发 stage/review/apply；
  失败、coverage warning、schema error、unsupported evidence 都在当前 Node
  内收敛。
- 低覆盖 warning 表示 draft 只覆盖部分 citation-eligible source refs；
  `covered/total`、remaining count、planned section id 是进度信号，必须查。
  “第一条 action supported” 不代表 Node 完成。
- 不要求抽满所有 source refs。重复、导航、placeholder、同一事实延续、无
  citation 价值的片段可以 skip，但 skip 必须来自内容判断，不是为了提速。

### 命名边界（必须遵守）

- **Slash command**：只发布 `/c4a:context`。源 `../../plugins/context/skills/context/SKILL.md`，产物 `dist/plugins/claude/commands/context.md`。
- **CLI primitive**：`context <subcommand> ...`（如 `context status`,
  `context run ...`, `context close`）。Slash command / skill 内部调用。
- **Cursor command entry**：全局命令名 `c4a-context`，由 `build:plugin` 从根级 Context Skill 生成到 `dist/plugins/cursor/commands/`。
- **Public skill — Codex**（plugin namespace via `.codex-plugin/plugin.json`）：裸 slug `context`，由 plugin namespace 暴露为 `c4a:context`。源 `dist/plugins/codex/skills/context/`，frontmatter `name: context`。
- **Standalone Provider skills**：`context-code-indexer` 与 `context-markdown-indexer` 由同一根级 source 直接投影，不获得 plugin namespace，只能经 Indexer lifecycle 激活。
- 不发布生命周期阶段型 Skill。来源、采集、对齐、编译、审核和构建能力由 `workflow.current.resources` 动态选择；宿主入口始终由根级 `skills/context/SKILL.md` 生成。
- 禁止把底层 CLI primitive 写成公开 Agent 命令,例如 `/context:source`、`/context:run`、`/context:review`、`/context:build`、`/context:verify`、`/context:status`。描述时写“continue will run `context status` and may call `context run ...`”。
- **Workflow resource** 是当前 Route 选择的文件或 Context View，不是 Skill 之间的静态引用。Agent 只消费 `workflow.current.resources.required/recommended` 返回的 `path` 或 `command`，不拼接插件安装路径。

## CLI 输出协议

成功 / no-op 摘要统一用 `formatFeedback(block)`：

```text
<symbol> <action> <subject>: <headline>
  <quantified body line>
  <key params echoed>
  next: <hint>
```

- `<symbol>`：`✓` 成功 / `·` no-op / `⚠` 部分成功 / `✗` 失败。
- 副作用必须量化，关键参数要回显。
- `next:` 仅用于普通命令的人类可读反馈，不是 workspace 路由协议。Project workflow 的唯一推进依据是 `context status` 返回的 `workflow.current.commands`、`configuration`、`gate` 和 `resources`；无法推进时必须给出结构化 reason/diagnostic code。
- payload-style 输出（`compile context` / `extract` / `mdrive *`）保持纯 JSON/YAML/text，不包 feedback wrapper。

### 错误抛出边界

- **必须用 `ContextError`**：命令入口校验（`commands/*.ts` / `cli.ts`）、`project/` 中的 source/run/review/close/build/verify 业务校验、`lib/` 中的用户输入解析。这些失败需要 exit code（`UserError` / `WorkspaceStateError` / `ExternalToolError` / `UserAbort`）+ `ErrorCategory` 让 `handleCliFailure` 统一渲染。
- **可保留 plain `Error`**：内部不变量 / unreachable 断言、parser 内部 invariant、`__tests__/` 测试代码、纯私有工具函数。
- 判断标准：用户跑出这个错时是否需要看到 exit code + 分类提示 + 可操作下一步？需要就转，不需要就别动。不要为了“统计纯净”机械迁移。

### Schema 输出格式

`--schema` 是 agent 和用户发现输入契约的统一入口，所有 schema discovery 命令支持同一组格式：

- `--format text`：默认人类可读，内容用 YAML 形态展示。
- `--format yaml`：显式 YAML，用于 agent draft/review 减少格式转换。
- `--format json`：机器消费，pretty JSON。

实现规则：

- schema command 用共享 `schemaOutputFormat()` / `writeSchemaOutput()`，不在各 command 里手写 `format === "json" ? ... : YAML.stringify(...)`。
- 不支持的 format 错误必须写出 `expected text, json, or yaml`。
- 普通 command 输出格式面不能因 schema 支持 YAML 而扩大；先分流 `--schema`，再对业务 action 走 `outputFormat()`。
- schema 输出属于 payload-style，不包 `formatFeedback()`、不打印 `next:`、不混散文。
- 新增 schema command 同步补测试：至少覆盖 `--format yaml` 可用、非法 format 错误信息。

### Feedback Body 渲染

`formatFeedback({ body })` 走 `text` 输出时 body 给 LLM 转述 + terminal 用户直读双消费。**body 用 markdown 渲染**，不用 `key=val, key=val` dump 风格。JSON `--format json` 路径不动 — 那是机器契约。

block 标题用 `**Label**:` 或 `**Label** (meta):`，统一英文（中文标签是 shipped doc 禁忌）：

- `**Outputs**:` / `**Notes**:` / `**Hints**:` / `**Warnings**:`
- `**Actions** (3 total):` / `**Coverage warnings** (progress signal — address before review/apply):`

格式细节：

- 路径用反引号 + `→`：`- align state → \`<absolute-path>\``。`.cache/align/align.md` 这类 user-reviewable 输出必须在 `**Outputs**` 块显式列出。
- 段落用空字符串行分隔（`formatFeedback` 保留 `""`，drop `false`/`null`/`undefined`）。
- Node tree 按 type 分组（`domain` / `entity` / `action`），用 `title` 不用 `slug`。
- **零值策略**：头部行字段总是显示（保持总览结构稳定）；子块（Special outcomes / Needs decision / Semantic outcomes）仅在 > 0 时整块显示；**例外**：给 agent “审查没意外触发”的字段（如 compile draft 的 update/supersede/deprecate 计数）总是显示。
- headline ≤ 3 个核心数字 + 最终状态（`${applied} applied · ${skipped} skipped · verify ok`）。

不要：`headline: applied=N, skipped=N, ledger=N, verify ok` 这种多字段塞 headline；不要 `merged=N, superseded=N, kept_separate=N` 这种 `key=val` dump；不要中文标签。

改造 feedback 的不变量：

- JSON `--format json` 路径不动。
- headline 核心 token 保留（`verify ok` / `review ready` / `close ready` / `build complete` 等可能被测试 grep 的状态词）。
- 所有原字段在 body 中至少出现一次（允许换表达 + 换位置，不允许丢弃）。
- 普通命令已有的 `next:` 不动；project workflow 不从它推导 Route。`workflow.current` 的选择与 body 渲染解耦。
- 同步更新依赖原输出子串的测试断言：先 `grep -rn "<原子串>" src/__tests__/`，跟 helper 改动一起提交。

参考实现：`src/project/statusRender.ts`、`src/project/run.ts`、`src/project/review.ts`、`src/project/verify.ts`、`src/project/packageBuilder.ts`。

### Agent-facing 视图与 hint

**Hint 静态 vs 动态分工**：

- 静态 command / skill 只写流程顺序、权限边界、用户确认责任、schema/protocol 发现入口、不可违反的不变量。
- 动态分支建议由 CLI 在 envelope 里给：schema 错误、缺失 decisions、raw/source_ref 指针错误、cache stale、no-op、可拆分 evidence block、stale prepare、workflow lock。
- JSON/YAML 输出用 `next_action` / `allowed_actions[]` / `views[]` / `diagnostics.warnings[]` / `diagnostics.auto_repaired[]` / `issues[].expected_shape` / `questions[]` / raw/source_ref diagnostics 承载提示，不另往 stderr/stdout 拼散文。
- text/feedback 输出只给当前结果的下一步，不复述整条 workflow。
- 增加 CLI guidance 后，若 command/skill 已有重复长分支说明，优先收短静态文案；envelope/diagnostics 是 single source of truth。
- 不把长规则复制进 CLI hint 或薄 Skill；hint 只回答“这次为什么不能继续 / 下一步做什么”。完整规则不能被删减，必须作为当前 Route 选择的 Graph resource 或 Context View 供 Agent 读取。

**长列表查询与预算**：

- 长列表 workflow payload 必须走语义 view + token/stdout budget 机制。过滤参数只收窄同一语义视图,不创建新的工作流协议。Agent 不依赖 host stdout 截断、`tool-results/**`、`jq/head/tail/sed/cat`、脚本切片。
- 预算窗口 view 必须暴露预算、已展示、总量、遗漏、截断、选择策略、稳定 item id、下一页或下一步探索信息。citation-eligible 主体和背景上下文要分桶输出,避免 Agent 把 supporting/context-only 当成可引用事实。
- 高频 payload 的默认阅读路线由 CLI 在 envelope / route plan 中选择。不要在静态文档或 hint 中把多个 detail views 组织成 checklist;detail view 只能作为 CLI-returned drilldown、fallback、debug 或局部展开入口。
- 原文类大 payload 要优先提供接近原文的预算安全表示,同时保留结构化 detail view 作为局部定位和诊断。不要新增同义的 summary/detail/full-text 平行协议;同一概念只能有一个默认入口。
- Agent-facing view 展开预算要暴露规模信号并在超预算时折叠到 narrow/batch hint。任何 `unwrap` 只移除 workflow metadata,不代表绕过该 view 的预算窗口。

**Phase operational rules**：

- Prose document work is status-driven: capture writes source snapshots, align
  writes confirmed `context.structure.v1`, compile writes review candidates from
  confirmed structure, review/apply writes approved Markdown, close derives
  `knowledge/structure.yaml`, and build writes packages.
- `context status --format json` `workflow.current` is the only workspace Route
  authority. A phase `next_action` can continue that operation but cannot
  replace the workspace Route. Do not invent lifecycle commands from unlisted
  surfaces or bypass a human gate by editing workspace files.
- `source_ref` is the source-bound evidence contract, not a prose-quality
  shortcut. Fenced code/config/command blocks can be active example knowledge;
  CLI verifies traceability and structure, while the Agent judges semantic
  faithfulness through current evidence views.
- Citation diagnostics distinguish structural framing from cleanup. Advisory
  cleanup must not trigger content rewrites unless the user requests cleanup or
  the current route marks it blocking.
- Lifecycle changes must be represented by current status guidance and current
  review/apply payloads. If a new lifecycle operation is needed, add a current
  phase or human gate first; do not revive retired workflow surfaces. Do not
  delete `sources/`, `knowledge/`, `dist/`, or `.tmp` to simulate
  a lifecycle command.

**Schema / error / 稳定性**：

- 任何 enum 值都要在 schema 输出中有示例或合法值列表；任何 `invalid-*` 错误在顶层 envelope/diagnostics 暴露 `valid_*[]` / `available_*[]`，Agent 不靠猜字段重试。cutover 期同步 `agent_hints[]` 时内容必须与 envelope 一致。
- Prompt/cache-stable 输出：固定协议 / schema / mount matrix / Term/Entity 判别规则 / 已有 knowledge lookup 结果放输出前段；每次任务才变化的候选 / Node / 用户问题放后段。CLI JSON 字段顺序稳定；默认输出不带当前时间、随机 id、存储路径、host 绝对路径。确需时间时只回显 workspace 事实中的语义时间字段；确需路径时必须是 explicit human/debug surface。
- Knowledge 本身就是 lookup registry。不新增动态 registry 文件；Agent 通过
  当前 status、align/compile views、approved `knowledge/structure.yaml`、OKF
  indexes、build inventory 和生成包里的 `knowledge-query` skill 获取
  term/service/system/action/domain 语义对象。lookup 输出可带匹配类型和排序,
  不带存储路径或临时时间戳。

## Workspace / Source / Cache

### Workspace 规则

- `ctxDir` 是 Context data root：embedded layout 为 `<repo>/.context`，root layout 为 repo root。
- 文档、日志、skill 中的 `raw/...` / `knowledge/...` / `output/...` 相对路径以 `ctxDir` 为根，不写死 `.context/...`。
- 需要扫描整个代码仓的命令（如 `capture --code`）用 `ctx.workspaceRoot` 或 `workspaceRootFromCtxDir(ctx.ctxDir)`，不用 `process.cwd()`。
- `context status` 是 local-only，只在 workspace root 运行，不从子目录定位 workspace。

### Source Ref 行号

- `source_ref` / raw block / internal align binding 的 `mentions[].line` 都用去掉 capture frontmatter 和自动分隔空行后的正文行号。
- 读 internal align binding 不能只按 `mentions[].line` 索引 raw，必须用 `quote` 校验或 fallback;行号口径不一致时以 quote 校验为准。

### Cache Maintenance

`context clean-cache` 仅清理带 `.orphaned_at` 标记的 Claude plugin 版本缓存；`--dry-run` 只报告，不删除。Context 工作区状态与知识生命周期不依赖该缓存。

## 模块职责

- `project/run.ts` 只执行 capture 和明确声明的非知识 `customPhase`；知识生产由 `project/indexer*.ts` 当前生命周期负责。
- `project/indexerParser*.ts` 负责 parser 计划、受控执行和结果导入；不得直接写 approved Markdown。
- `project/indexerCandidateCompileActions.ts` 将已验证 Result 投影为唯一 current Candidate；不得新增旁路 Candidate writer。
- `project/review*.ts` 负责 current Candidate HTML、用户决策和原子 apply；`project/close.ts` 负责 approved `knowledge/structure.yaml` projection 与 final verify gate。
- 800 行限制是**事后体检**（详见根 `CLAUDE.md` §代码规模规则）：实现过程禁止主动探测当前行数，正常完成功能；**每个阶段结束后**才统一检查实际超 800 的文件并走分拆流程。拆分时默认目标 ≤600 行，内聚顶住才接受 600-800。

## Plugin / Shipped Docs

`plugin/` 和 `templates/` 下的 md 文件随 npm tarball / plugin build 分发到用户工作区或 agent plugin 注册表，属于 shipped docs。按用户可见文档处理，不写开发复盘、内部路径、当前版本实现细节。

### 分发路径

仓库根 `plugins/context/` 是唯一人工维护的 plugin source。`build` / `build:plugin`
同时生成 `dist/plugins/{claude,codex,cursor,skills}/`、根级 marketplace 和只读
`plugins/context/repo-install/`。`dist/plugins` 随 npm 包发布；`repo-install` 支持
无需安装阶段 build 的 Git marketplace 安装。

| Source（手改） | Build 产物（只读） | 消费者 |
|---|---|---|
| `../../plugins/context/skills/context/SKILL.md` | Claude/Cursor command adapter 与 Codex/standalone Context Skill | Agent 用户入口 |
| `../../plugins/context/skills/context-*-indexer/` | npm/Git 顶层 `skills/` 中的 Provider Skills | Context Indexer lifecycle |
| `context-workflow/` | `dist/providers/context/` | 唯一 Graph、Procedure、Diagnostic、语义规则和动态 View 定义 |
| `../../plugins/context/assets/` | npm 与 Git 宿主投影资产 | plugin 品牌资产 |
| `../../plugins/context/.{claude,codex,cursor}-plugin/plugin.json.template` | npm 与 Git 投影 manifest | 构建时替换 `__VERSION__` |

构建不变量：

- `dist/plugins/claude/` 只通过 `commands/context.md` 发布单一入口。
- `dist/plugins/cursor/` 只通过 `commands/c4a-context.md` 发布用户入口。
- `dist/plugins/codex/skills/` 只包含 `context`，由 plugin namespace 暴露为 `c4a:context`；Claude/Cursor plugin root 也不内嵌 Provider。
- `dist/plugins/skills/` 直接投影根级全部 Skills；安装器把其中 lifecycle Provider 原子复制到 `~/.agents/skills` 和 `~/.claude/skills`，而不是复制进 Host plugin root。
- `dist/plugins/{claude,codex,cursor}/` 各带 generated guard（`CLAUDE.md` 或 `AGENTS.md` + `.generated`）；看到 guard 不要编辑 build 产物。`dist/plugins/skills/` 顶层 README 统一说明。
- 生命周期规则、长诊断、Schema 发现说明和语义规则统一住在
  `context-workflow/` Route resources 或 CLI 动态 View，不复制到入口文档。
- npm tarball（`@c4a/context-cli`）包含 CLI + `dist/plugins`；一次 `context plugin install` 同时安装 Host 主入口和无命名空间 Provider Skills，并支持 Claude、Codex、Cursor。根级 marketplace 另行指向 `repo-install`。

### Shipped Docs 写作禁忌

- 不硬编码版本叙事：避免 `v0.5.x` / `in this version` / `pre-fix` 这类会漂移说法。
- 不泄漏中文错误字符串：描述为稳定 category 或英文行为（如 `workspace-not-found error`）。
- 不引用 monorepo-only 路径、源码文件、函数名、实现细节（如 `packages/context-cli/src/...`、`runWithPrelude`）。
- 不写审查过程用语：`review finding` / `regression guard` / `temporary hack`。
- 文档只写当前命令形态：status-driven flow 用 `context status`,
  `context run <phase-id>`, `context review html/apply`, `context close`,
  `context verify`, and `context build`。语义用户问题不能被 `--yes` 或
  delegated execution 跳过。

### Skill 文档结构

Context Skill 是薄入口，不再用 L1/L2/L3 层级承载生命周期正文。它只保留：

1. 能力用途与适用边界；
2. `context status --format json` 启动方式；
3. `workflow.current`、required/recommended resources 的消费循环；
4. revision、authority、gate、configuration 和重新求值规则；
5. 少量不允许绕过 Context CLI 的安全边界。

超过这个范围的 Procedure、Schema 说明、Diagnostic 恢复手册、语义判断
规则和动态工作区上下文必须进入 `context-workflow/resources/`，并由需要
它的 Graph 节点选择。按需加载只改变读取时机，不能删减经过验证的长篇
内容。

### Slash Command 结构

`plugin/commands/*.md` 不是 skill，不套 skill 骨架。默认 ≤ 30 行；超出时要么因为命令本身就是协议，要么因为多模式命令必须 inline 路由，否则下沉到 skill reference。

标准骨架：

```markdown
---
description: "<one-line description shown in command completion>"
argument-hint: "<argument shape>"
allowed-tools: Bash(context:*)
---

## Your Task

<1-2 paragraphs describing what the agent should do.>

- <routing rule, if needed>
- <error handling rule, if needed>

Use the packaged Context shell and follow `workflow.current`.
```

硬规则：

- frontmatter 三字段齐全（`description` / `argument-hint` / `allowed-tools`）；缺字段时 runtime 可能静默丢命令。
- `allowed-tools` 按最小权限列；纯 CLI 代理命令通常只需 `Bash(context:*)`。
- 单一 `context` agent-driven command 只说明如何消费 `context entry` 和 `workflow.current`。不要在 command 中复制分支流程，也不要重新引入 init / align / compile / drop / query 等公开 slash command。
- command md 不写 `${CLAUDE_PLUGIN_ROOT}/skills/...`，只指向打包后的 Context shell。
- command md 只负责流程入口；schema、mount matrix、source_ref 规则通过当前 Graph resource 或 CLI View 发现。

### Aspect README 结构

`templates/aspects/<name>/README.md` 进入用户 workspace 长期存在：

- 只写 target、schema、notes 三段。
- 不写固定版本号、monorepo 路径、源码函数名。
- 不描述未上线实现细节；规划中能力只写用户可理解的边界。

## 测试与构建

- `bun test` 在 Claude Code shell 下 spawn 子进程时 stdout/stderr 偶发为空。验证 subprocess 行为时：优先把逻辑拆成 pure function 做 in-process 测试；必须 spawn 时加针对空 stdout/stderr 的 sandbox-skip 分支，并用 in-process 测试保底；测试注释说明为什么不能只依赖 subprocess。
- `bun run build` 走 `packages/build.ts`，context-cli build 还会跑 `scripts/build-plugin.ts` 从 `plugin/` 生成到 `dist/plugins/`；不要生成或维护独立 plugin 仓库。
- 依赖 `@c4a/extract` 的包自动复制 `tree-sitter*.wasm` 到 `dist/wasm/`，不手工维护 dist wasm。
- `postinstall.mjs` 是 hint-only：plugin install 后 `context` 不在 PATH 时只打印安装提示，不自动全局安装。
