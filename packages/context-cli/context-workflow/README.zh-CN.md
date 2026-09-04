# Context Workflow Provider

[English](./README.md)

本目录是嵌入 `@c4a/context-cli` 的工作流契约源码。

Provider 将长期知识生产生命周期转化为依据事实选择、可以测试的 Route。它不包含
知识正文，也不做语义判断；它负责决定当前允许哪个任务类别、Agent 必须读取哪些
资源、哪个 Gate 尚未解决、宿主可以执行哪个精确动作，以及动作后应该重新观察哪些
工作区事实。

```text
工作区事实 → Agent Graph Route → 资源 / Gate / Action
    ↑                                  ↓
    └──────── 动作后重新观察 ──────────┘
```

它有意保持为 Context 内部实现：

- 用户和 Agent 入口只调用 `context` 运行时；
- Provider Graph 只包含稳定任务类别，不记录来源名、phase id、collection、日期或模块名；
- `src/project/workflow/` 观察工作区并提供当前 Facts；
- Host adapter 使用同一次观察和 revision，将稳定 Action 解析为具体 Context 命令；
- Procedure、Diagnostic、Schema 和模板作为 Graph 引用的文件存在，长篇操作说明不写进 TypeScript 路由分支或入口 Skill；
- `scripts/build-workflow.ts` 校验源码，并在 `dist/providers/context/` 生成唯一不可变 Bundle。

公开生命周期仍然是 Context 产品契约；通用 Graph 协议和命令不是用户需要直接理解
的依赖。

## 源码结构

| 路径 | 职责 |
|---|---|
| `provider.yaml` | Provider 身份、Graph 目录和导出资源 |
| `graphs/workspace.yaml` | 稳定的知识工作任务类别和合法转换 |
| `graphs/indexer.yaml` | digest-bound Indexer 选择、执行、reconciliation 与 gap 子 Route |
| `actions/` | 由 Context Host adapter 解析的 Action 契约 |
| `resources/` | Procedure、对话、诊断、手册、Schema 和动态 View 定义 |
| `schemas/` | Agent 提交的结构化 Payload 契约 |
| `tests/` | 无需调用模型即可运行的 Facts-to-Route 场景 |
| `scripts/build-workflow.ts` | 校验和不可变 Bundle 构建 |

当前来源名、日期、模块、collection 和 phase id 都是运行时 Facts，不能变成 Graph
节点或硬编码 Prompt 状态。

## 运行时不变量

只有满足以下条件时，Provider 才是有效的：

1. 工作区 Route 由本 Graph 根据标准化 Context Facts 选择。
2. 每条写入 Route 都来自同一次 observation 和 revision，执行前拒绝 stale Route。
3. 会话级全托管只解决明确可 delegated 的 Gate，不改变来源、校验、close 或验证事实。
4. 公开 Agent 入口保持精简；Procedure、Dialogue、Diagnostic、Schema 和模板从已发布 Bundle 按需发现。
5. 动态 View 只读、按内容寻址且不获取生命周期写锁；View freshness 依据渲染内容 digest，写命令继续绑定当前 Route revision。
6. source-dev、link、pack 和 npm 安装解析出相同 Provider 语义，不包含构建机器绝对路径。
7. Context 工作区不包含也不需要 Graph manifest 或 Graph runtime 目录。
8. Provider Graph tests、Context adapter tests、生命周期测试、Bundle 完整性测试和 packaged-install smoke tests 全部通过。
9. phase-local `next_action` 只能继续产生它的当前操作；操作完成后返回 `reevaluate_workspace_route`，只有 `workflow.current` 可以选择另一生命周期阶段。
10. semantic resource 文件拥有自己的元数据，包括 `applies-to`；TypeScript 可以选择当前 Node 的资源，但不能复制资源路径清单。
11. managed run-to-completion 是同一张 Graph 上的宿主循环，不是另一套路由器；每次只执行一个 immediate、非读取命令，然后重新观察并求值。
12. 文档解释 Route 将已采集 Markdown 正文作为静态、按内容寻址的资源；读取回执只证明当前对话完整读取了这些字节，索引不能代替正文，CLI 不判断来源含义。
13. Route 为所有直接必需文件返回一个 `resources.after_read.command`；动态资源物化返回自己的本地 receipt-set 文件和精确 post-read command。
14. managed host runtime 只对参数形态已识别且没有外部副作用的命令复用进程；未知形态和外部副作用在子进程执行，两种路径返回相同回执契约。
15. execution scope 只拥有短生命周期运行资源，不拥有持久工作区状态；知识写入继续使用 revision 校验、写锁和原子提交。
16. 每个完整代码索引批次在知识 Review 前必须经过一次 Agent 语义审核。CLI 信号只作为审核证据，Agent 必须选择接受、修订或请求补充材料；全托管遇到真实问题时自动回到 Preview、提取和复审循环。完整报告留在工作区，构建清单只保留精简审核摘要，不发布报告文件。
17. Indexer Graph 只能通过 CLI 校验后的 workset-set Facts 从 partition 进入 author。精确 SubjectKey 解析必须先于 author；post-author composer 只能读取受限 PrimaryResultView。独立 composer 集合未明确标记为 not-required，或尚未全部 accepted 并形成 current envelope 时，不得进入 reconciliation。
18. Main Indexer 调度前必须恢复本机内容寻址 run ledger。Context 为当前 run 暴露唯一 Host-managed Authorized Workset View；Agent 不管理证据专用 reader、cursor 或读取回执。Partition、Author 与 Composer Route 只暴露一个紧凑语义 schema 和一个 `context action complete-current` 提交命令；Agent 不拼装内部 Result envelope，也不创建工作区 payload 脚本。通过校验的 Result 与 accepted 转换共用一个 durable journal；中断且不完整的 running 项恢复为 pending，完整 accepted 缓存（包括合法空结果）不得再次调度。ordinal/fixed-count partition 会自动进入下一项授权策略；策略耗尽后 Graph 启动绑定 CLI release 的 catalog-fallback request，并机械接受唯一父单元。该路径必须存在已持久化的耗尽前驱，不调用 Agent，也不进入用户 Gate。
19. post-author composer 使用独立的本机 ledger。每项 accepted Result/receipt 可独立恢复；只有当前集合全部 accepted 后才原子发布 current envelope。若仅 envelope 指针缺失，只重组 envelope，不得重跑 composer。
20. Result reconciliation 是 CLI 拥有的完成边界。它重新计算 required domain owner，只消费 main author store 中完整 accepted 的 Result，并枚举全部 current question-target pair；Provider 未 emit 的 pair 自动形成 material gap。缺 owner、accepted cache 丢失、unsupported target 或 blocking material gap 时，不得进入 reconciliation ready，也不得报告 complete。
21. material gap 只保留在 current reconciliation report 中，不建立第二份 checkpoint ledger、创作产物或审核界面。
22. 新采集的 Markdown 或其他授权材料重新进入普通 main Indexer 路径。同一次 Result reconciliation 要么从当前来源关闭问题，要么继续保留 unresolved。不存在 answer-only operation、planned landing、post-layout actualization 或第二次内容 Review。
23. 没有必需 gap 时才能 final close；close 只写 approved knowledge structure，然后清理已完成的运行时生命周期状态。可选且未解决的 gap 不进入发布知识元数据。
24. requirement confirmation 必须使用 CLI 重新计算的 canonical comparator。普通变化只能使用显式 session authority；contraction 与不可比较的义务替换进入不可委托人工 Gate。
25. SubjectKey schema authority 只来自 CLI base contract 或唯一 owner extension Provider。已有 approved Node 上的 identity-breaking 变化必须 Provider major，并取得绑定精确映射的人工授权；无效映射在 Gate 前失败。target-resolution ambiguous/invalid 是阻塞或失败的类型化 Outcome，不能进入 author work。
26. 首次 Provider 选择属于同一条 current Indexer Route。Agent Action 直接收到精确 requirements 与 CLI-bundled catalog，只通过 `context action complete-current` 返回非 CLI 的 Host 可见 Skill 身份和语义 Indexer 条目；routing、fallback/conflict、静态校验、解析、stage、最终校验和 registry 原子应用均由 CLI 完成。外部 Bundle 复用现有 Host resolver continuation，非 allowlist program 复用现有执行 Gate，成功 Host result 可恢复且不暴露低层 payload 命令。
27. 全部 Partition shard current 后，Context 暴露一次语义大纲审核；Author/Composer 编译完成后，再暴露普通的最终 Candidate Review。普通模式把两次判断都展示给用户；用户明确授权全托管后，由 Agent 完成两次判断且不向用户展示。destructive 或 ambiguous Layout transition 在所有模式下仍不可委托。

## 全托管宿主循环

`context run --managed --until blocked-or-complete --format json` 返回
`context.workflow.run.v1`。`state` 可以是 `complete`、`blocked`、`planned`、
`failed` 或 `max-steps`，`stop.reasonCode` 说明停止原因。

只有用户在当前对话明确授权全托管后，它才成为默认对话入口。每条投影命令通过
`managed_execution=automatic|agent-required` 显式声明能否自动执行；循环不会根据
命令名猜测。遇到配置、诊断、未解决权限、未读 Agent 资源、只读解释、非唯一命令、
命令失败、超时、无进展或步数预算时，循环机械停止并返回当前 Route。
