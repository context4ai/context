# Context 如何使用 Agent Graph

[English](../../en/case-studies/agent-graph-workflow.md) · [交互式回放](https://context4ai.github.io/context/case-studies/workflow/?lang=zh)

Context 是一套知识管理工具：把代码仓库和文档转成经过审核的知识包。它的生命周期足够长，也足够真实——来源要先界定和采集，唯一 Indexer 生命周期要把全部已授权输入收敛为当前 Candidate 批次，人工门禁可能暂停流程，批准知识还要经过关闭、验证和构建。

Context 使用 Agent Graph 承载工作契约。Agent Graph 不提取代码、不理解文档语义，也不批准知识；Context 始终是宿主，负责观察工作区事实、执行生命周期动作、约束权限并产出证据。Agent Graph 根据这些事实求值，选出下一条合法 Route。

![运行在 Agent Graph 上的 Context](../assets/context-agent-graph.svg)

## 一个公开入口驱动一套完整工作流

Context 插件对外只有一个 Agent 入口：

- [`/c4a:context`](https://github.com/context4ai/context/blob/main/plugins/context/skills/context/SKILL.md) 由根级 Context Skill 生成，既能创建用户请求的知识工作区，也能继续已有工作区。首次调用 `context entry` 时，它会先判断应该初始化、定位工作区还是求值当前工作流，再把控制权交给 `workflow.current`。

这个入口有意保持很薄：它只描述 CLI 启动方式和 Route 消费契约，不在入口中复制产品生命周期。详细说明继续分布在可以独立寻址的工作流资源和 Action 契约中。

各阶段的操作说明、Schema、来源视图、审核契约和知识包说明仍是独立资源；只有被当前 Route 选中的那部分才会暴露。同一个公开入口同时处理初始化和继续，不再维护两份职责重叠的 Prompt。

因此，每次调用不必把完整知识生命周期塞进 Prompt。详细文档并没有消失；单一入口取代的是“把所有文档都塞进 Skill”的做法。入口外壳稳定、容易被发现，CLI 仍可以独立演进详细流程和资源，而不把入口变成长篇手册。

## 直接检查这套接入

完整接入公开在 [`context-workflow/`](https://github.com/context4ai/context/tree/main/packages/context-cli/context-workflow)。它展示了一个薄 Skill 如何连接一套更大、又能独立测试的工作契约：

- [`provider.yaml`](https://github.com/context4ai/context/blob/main/packages/context-cli/context-workflow/provider.yaml) 绑定 `workspace` Graph、原因码目录、Action、Resource 和入口。
- [`graphs/workspace.yaml`](https://github.com/context4ai/context/blob/main/packages/context-cli/context-workflow/graphs/workspace.yaml) 是静态顶层生命周期。它通过 `run-indexer-lifecycle` Action 把索引工作交给唯一的 [`indexer` Graph](https://github.com/context4ai/context/blob/main/packages/context-cli/context-workflow/graphs/indexer.yaml)，直到当前 Candidate 批次已经生成，或真正的 Gate 阻塞流程时才返回。
- [`actions/`](https://github.com/context4ai/context/tree/main/packages/context-cli/context-workflow/actions) 包含可执行契约。Action 描述 runner、宿主命令或 handler、副作用、权限边界和预期结果，不承载长篇手册。
- [`resources/`](https://github.com/context4ai/context/tree/main/packages/context-cli/context-workflow/resources) 包含可独立寻址的工作流说明：Procedure 说明当前任务，Dialogue 解释人工决定，View 物化实时工作区事实，Semantic Reference 指导判断，Diagnostic 解释错误，Manual 记录稳定 API。
- [`codes.yaml`](https://github.com/context4ai/context/blob/main/packages/context-cli/context-workflow/codes.yaml) 用稳定状态码解释 Route 与诊断，避免把长段文字塞进日常机器输出。
- [`tests/`](https://github.com/context4ai/context/tree/main/packages/context-cli/context-workflow/tests) 直接用 Facts 验证路由，不需要启动 Agent 或模型。

`context status` 是宿主侧的事实观察边界：它检查工作区、把 Facts 交给 Agent Graph，再返回 `workflow.current`——包括选中的 Route、原因码、命令计划、Gate，以及此刻真正需要的 Resources。静态文件可以按 digest 复用读取回执；动态 View 则绑定选中它的工作流 revision。回执只证明资源已经交付，不会把外部任务冒充成已完成。

因此，一个小的公开入口可以安全承载远大于自身的操作知识。详细内容没有被删除，也没有被摘要替代，而是被分离、由 Graph 按需选择，并以可验证方式交付，不再每轮全部加载。

## 幂等地继续，而不是从头重放

再次调用 Skill，不等于重新执行所有说明或重复每一次写入。在 Provider Bundle、已观察 Facts 和已记录 Outcomes 不变时，Agent Graph 会确定性地选中同一条 Route；Resource Receipt 不变时，读取状态也保持一致。Context 再把写命令绑定到当前工作流 revision，并核验对应的外部证据。已经被工作区事实证明完成的动作会被跳过或推进到下一条 Route，过期命令则会被拒绝，而不是写入更新后的状态。

因此，中断、重试或新的 Agent 回合都可以从可观察状态重新收敛，不依赖对话记忆。幂等边界也很明确：Agent Graph 让求值可重复，并暴露完成契约；Context 宿主负责让文件系统副作用具备原子性、Guard 或可证明的 no-op。Agent Graph 本身不会把任意脚本自动变成幂等操作。

## 各层分别负责什么

| 层 | 在 Context 中的职责 |
|---|---|
| Skill | 能力发现，以及很小的 Route 消费契约 |
| Context 宿主 | 观察文件与外部系统、执行命令、约束权限、记录证据 |
| Provider | 绑定 `workspace` Graph、入口、Action、资源和原因码目录 |
| Graph | 描述合法生命周期状态、依赖、Gate、循环和终局 |
| Route | 只暴露当前动作、所需资源和完成契约 |
| Facts 与 Outcomes | 证明实际发生了什么；对话里的“已经完成”不算证据 |

这套接入的 Graph 节点、人工与权限 Gate、Action 描述、可寻址资源和路由测试都保存在公开工作流目录中。回放页面的“工作图”按钮会把这份静态契约可视化；每一步右侧还会把当前 Action 和 Resources 链回上述真实源码。案例与工作流放在同一仓库后，不再需要在另一个仓库重复维护容易变化的数量清单。

## 一条工作区路线，一套 Indexer 生命周期

代码、Markdown、extension fragment 和 tool snapshot 共用一条生产路径：

1. 来源事实先确定本轮允许使用的代码模块与文档。
2. 文档采集按来源循环，直到每份来源都有可审计快照。
3. `run-indexer-lifecycle` 按 Indexer Graph 依次完成需求确认、Provider 选择、Authorized Workset、分区生成、结果合并、Layout 和 Candidate 编译。
4. 代码与文档材料收敛为唯一一批当前 Candidate。可选结构预览只帮助人查看目录和大纲，不构成第二套生成协议或第二次 Review。
5. 用户只对最终内容做一次 Review，通过后整批进入批准知识。
6. 最后通过确定性的 close、verify、build 和运行事件投递产出消费包，并完成当前范围。

多个来源和 Indexer 分区不需要复制多套顶层 Graph。工作区 Graph 只描述“仍有来源待采集”“Indexer 生命周期尚未 current”这类稳定状态；具体 Provider workset 和合法子步骤由运行时 Facts 与嵌套的 Indexer Graph 决定。公开路线保持稳定，项目仍可使用不同的 registry、Provider 与批次规模。

## Context 全托管映射为 Gate 委托执行

“全托管”是 Context 宿主层的产品模式。宿主会把这个选择映射成 Agent Graph 的会话 Authority 和 Gate `delegated` 策略；Agent Graph 协议本身没有全托管字段。Context 随后可以连续执行确定性的 Route，并在需要语义判断、缺少授权、需要人工决定，或无法安全证明的修复处停止。当前会话授权可以解决符合条件的 Gate，但不会成为永久项目配置。

这样，机械循环和状态刷新不再反复占用 Agent 回合；真正改变语义或权限边界的决定仍然可见。

## 记录、回放，再改进工作图

Context 开启 debug 后，宿主会记录 CLI 调用边界和 Agent Graph 求值结果。回放可以观察：

- 每次事实变化后选中了哪条语义 Route；
- 多来源循环推进到了第几次；
- 哪个授权或审核 Gate 暂停了流程；
- 哪个 reason code 解释了这次流转；
- 最终如何到达知识包完成状态。

[交互式实践回放](https://context4ai.github.io/context/case-studies/workflow/?lang=zh)由一份脱敏 Context 记录按当前工作区契约归一化。已经退役的提取、对齐和文档编译路由被折叠为唯一的 `run-indexer-lifecycle` Route；回放保留仍可对应的路由顺序、状态和相对时间，但不包含来源正文、本机路径、凭证、不透明 ID 或组织相关名称。

这不只是一个展示页面。路由记录能暴露无效循环、重复资源读取、不完整的恢复路径，以及错误的状态优先级；这些观察再进入确定性路由测试和 Graph 修改，形成 Graph Engineering 的反馈闭环。

## 这个案例证明了什么

Context 并不证明每个 Skill 都需要 Graph。它证明的是：当一个 Skill 背后连接了长期、有状态、依赖外部事实、包含多种门禁和批次循环、又必须支持恢复的产品流程时，工作图开始真正产生价值。

单一入口之所以可以保持很小，是因为 Graph、资源和宿主共同承担了其余职责：Agent 只看到此刻重要的内容，宿主证明实际结果，Graph 保证下一步合法并且可以测试。
