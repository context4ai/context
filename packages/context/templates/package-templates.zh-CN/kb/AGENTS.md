# {{displayName}}

本知识包由 Context 工作区生成。

- 包名：`{{packageName}}`
- 类型：`{{packageKind}}`
- 已批准知识文件：`{{knowledgeCount}}`

## 使用方式

将包内 Markdown 作为经过审核、可追溯来源的产品与代码知识。回答问题时优先使用知识页中的可见正文，不要依赖记忆补全。

随包提供的 knowledge-query Skill 会指导 Agent 从 `{{wikisRoot}}/` 等 OKF 索引开始导航，并引用实际读取的知识页。

包内可能包含以下 OKF 根目录：

- `{{wikisRoot}}/`：结构化实体和关系，对应 codegraph、business、product。
- `{{guidesRoot}}/`：架构、流程、FAQ、决策和故障记录。
- `{{rulesRoot}}/`：标准、约束、验收条件和测试场景。
- `{{featsRoot}}/`：被选择进入包内的功能知识。

这些目录使用兼容 OKF 的 Context profile：OKF 字段和 Context 扩展字段保持在顶层，不生成额外的 `context` 或 `schema` 包装字段。`{{wikisRoot}}/` 是实体与关系层，guides 和 rules 可以围绕其中内容进行解释或约束。

## 包含的知识

`context build` 会把已批准且被当前包选择的 Markdown 复制到这里。目录索引和 `context-build-inventory.json` 用于导航、覆盖检查与关系查询。

## 模板作者建议

这是可直接工作的通用模板。正式发布前，如果知识包存在专用术语、常见用户意图、推荐入口、已知边界或固定任务流程，作者应替换或编辑本文件及 knowledge-query Skill；如果通用行为已经足够，应在 Context 的包模板 Review 中明确接受未修改模板。
