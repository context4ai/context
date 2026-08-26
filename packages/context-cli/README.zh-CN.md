# Context Agent 运行时

[English](./README.md)

`@c4a/context-cli` 提供 Context 知识生产工作流的本地运行时和 Agent 接入。虽然
包名中包含 CLI，但它面向用户的主要体验不是终端命令清单：用户调用一个 Agent
入口，用自然语言说明要生产的知识，再在对话中完成必要决策。

运行时执行确定性工作，包括观察工作区、采集来源、索引代码、校验证据、暂存候选、
应用审核决定、验证质量和构建知识包；Agent 负责语义工作，用户负责权限和重要内容
决定。运行时本身不会调用 LLM。

## 安装 Agent 接入

```bash
npm install -g @c4a/context-cli@latest
context plugin install
```

安装后重启或刷新 Agent 宿主。同一份入口源会被安装器投影到支持的 Claude、Codex、
Cursor 和 Skill-compatible 目录。

社区版公开入口是 `/c4a:context`。它可以创建用户请求的工作区、定位已有工作区，
或从当前状态继续流程。用户应该从知识意图开始，而不是内部命令：

```text
/c4a:context 请把这些产品文档和当前仓库整理成经过审核的 Agent 知识包，所有代码
结论都要保留可追溯引用。
```

如果 Agent 入口已经存在但缺少 `context` 可执行文件，入口会给出准确的安装恢复
方法并停止。它不会为每次调用增加安装预检，也不会把普通工作流中的 `not found`
诊断误判成可执行文件缺失。

## 一个 Agent 入口如何驱动整套工作流

```text
用户知识目标
     ↓
单一 Agent 入口
     ↓
context entry ── 观察工作区位置和状态
     ↓
workflow.current ── 当前 Route、资源、Gate 和精确命令
     ↓
Agent 阅读 / 判断 / 执行一个选中动作
     ↓
工作区事实变化 ── 再次求值
```

`context entry --format json` 是只读的启动解析器，可以返回初始化动作、进入已有
工作区的动作，或当前工作流求值。不存在 `context continue` primitive，也不会为
source、review、build 或 status 提供第二个公开入口。

工作区就绪后，`workflow.current` 是当前步骤的权威协议：

- 执行动作前完整读取所有标记为 `read-required` 的必需资源；
- 只执行 Route 返回的命令，并保留 revision 和 authority 参数；
- 人工 Gate 先解释用户在决定什么以及影响范围，再收集选择；
- 项目配置修改只发生在 Route 指定的文件中；
- 每个动作后重新观察事实，过期命令不能推进已经变化的工作区。

长篇操作说明、Schema、诊断和来源视图继续作为 Workflow Provider 中可寻址的文件。
Agent 只加载当前 Route 选择的内容，不把完整生命周期长期塞在 Prompt 中。

## 知识生产生命周期

| 阶段 | 用户体验 | 运行时保护内容 |
|---|---|---|
| 目标和来源 | 确认要生产什么知识、哪些资料属于范围 | 来源身份、权限边界、固定的仓库或文档输入 |
| 采集和提取 | Agent 阅读文档或检查已确认的代码边界 | 完整正文、资源、符号、关系、指纹和新鲜度 |
| 结构和编译 | 审阅知识组织方式和候选正文 | 绑定来源的 Node/Section、覆盖度、连续性和稳定身份 |
| 审核和关闭 | 批准、拒绝或调整候选 | 原子化审核应用、持久决定和关闭后的结构投影 |
| 验证和构建 | 选择产物并得到可复用知识包 | 质量校验、知识包模板、资源策略和构建清单 |

构建完成的是当前正式状态，不会冻结工作区。以后新增或变化的来源可以开启下一轮
知识生产。

## 普通对话与全托管对话

普通模式是默认模式，保留显式的来源、范围、结构、审核和知识包决定，并可在内容
审核 Gate 提供 HTML 检查报告。

只有用户在当前对话明确授权全托管时，Agent 才使用：

```bash
context run --managed --until blocked-or-complete --format json
```

它会合并连续的确定性动作和可 delegated 的 Gate；遇到 Agent 阅读、项目配置、
额外权限、诊断修复或非唯一计划时立即停止。它复用同一张 Workflow Graph，不会
删除普通模式的审核能力。授权只对当前对话生效，不会持久化，也不能授权新的来源
边界、未读取外部内容、仓库操作、失败的校验或失败的验证。

## 工作区状态

```text
context/
├── src/                         # 声明式项目配置和知识包模板
├── sources/                     # 来源登记和采集证据
├── knowledge/                   # 正式 Markdown 和持久决定
├── dist/                        # 构建产物
└── .tmp/context-runtime/
    ├── lifecycle/               # 当前轮候选和结构
    ├── debug/                   # 可选调试轨迹
    └── logs/                    # 可选运行事件 outbox
```

这些目录具有不同的持久性契约。`sources/` 和 `knowledge/` 是项目状态，`dist/` 是
可重复构建产物，lifecycle 和 debug 目录是被忽略的运行状态。成功 close 会清理
已经完成的 lifecycle 暂存区。不要通过手工编辑或删除 CLI-owned 状态修复流程，
应执行当前 Route 返回的恢复动作。

## 证据和安全边界

- 登记来源不等于授权读取来源正文。
- 运行时不会静默在来源仓库中 clone、checkout、reset、fetch、install、build、
  test 或运行脚本。
- Markdown 解析只保留结构证据，不推断产品含义，也不选择知识分类。
- 代码提取只生成结构事实；知识含义和范围由 Agent 与用户决定。
- `source_ref` 是不透明、可验证的证据身份，应完整复制，不能当作文件路径解析。
- 审核决定只能通过原子化 review apply 变成正式 Markdown；Agent 不手写生命周期
  产物。
- 知识包模板只决定分发形态，不会替代正式知识成为事实来源。

## 知识包产物

声明好的知识包构建到 `dist/<package-name>/`。Agent 知识包可以包含 `wikis/`、
`guides/`、`rules/`、`feats/`、Skills、索引和包专属检索工具；LLM 包则把所选
知识聚合为一个文本产物。

每份构建清单都会将分发路径映射回工作区正式知识。资源可以使用仓库 raw URL、
显式 URL 前缀或随包分发；项目在构建前选择策略。

详见 [Package Outputs](../context/docs/guides/package-outputs.md) 和
[Package Templates](../context/docs/reference/package-templates.md)。

## 诊断和直接使用 CLI

普通用户应跟随 Agent 入口。直接命令继续供维护、自动化和诊断使用：

- `context status --format json` 检查当前 Route；
- `context <command> --help` 是当前参数的权威来源；
- `context plugin status` 检查已安装的 Agent 投影；
- `context debug enable` 在 `.tmp/context-runtime/debug/` 记录可选轨迹；
- 新工作区默认开启来源约束的编辑修订；`context optimize-docs enable|disable`
  可调整工作区偏好，同时保持 `knowledge/` 中的正式知识不变；
- `context revise "<标题或正式知识路径>"` 从对话启动一次单页修正，校验后再由
  Route 提示重新构建；
- 代码提取写入 `knowledge/codeindex/**`，并在 Review 前分别检查输入分析、稳定边界
  覆盖、正文密度、证据范围和页面规模；旧 `codegraph` 工作区只通过 Route 返回的
  迁移动作升级；
- `context clean-cache --dry-run` 预览 Context-owned 过期插件缓存清理。

绑定 revision 的命令应从 `workflow.current` 原样复制；文档示例只用于理解入口，
不能替代当前 Route。参见[安装后快速说明](./docs/quickstart.zh-CN.md)和
[debug tracing](./docs/debug-tracing.md)。
文档编译优化与对话修订参见[来源约束的编辑修订](./docs/document-optimization.zh-CN.md)。

## 文档与开发

- [插件契约](./plugin/README_CN.md)
- [Workflow Provider 内部说明](./context-workflow/README.zh-CN.md)
- [SDK 文档索引](../context/docs/README.zh-CN.md)
- [知识项目完整示例](../context/docs/getting-started.md)
- [Agent Guide](../context/docs/guides/agent-guide.md)
- [Project API](../context/docs/reference/project-api.md)

源码、link、打包安装和发布流程参见 [`DEVELOPMENT.md`](../../DEVELOPMENT.md)
以及本包的 [`DEVELOPMENT.md`](./DEVELOPMENT.md)。

```bash
bun run --filter @c4a/context-cli build
bun run --filter @c4a/context-cli typecheck
bun run --filter @c4a/context-cli lint
bun run --filter @c4a/context-cli test
```

构建会在 `dist/plugins` 生成可安装的宿主投影；只修改 `plugin/` 和 Workflow
Provider 源码，不要直接编辑生成产物。

## License

MIT.
