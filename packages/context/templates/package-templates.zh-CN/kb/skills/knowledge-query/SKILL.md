---
name: {{skillName}}
description: 查询 {{displayName}} 中经过审核、可追溯来源的知识。用于查找包内实体、API、行为、流程、约束、决策、排障信息、关系和覆盖范围。
---

# 知识查询

只根据本包包含的已批准知识回答。先通过索引缩小范围，再打开具体页面；正文是事实证据，frontmatter 摘要只用于导航。

## 查询步骤

1. 判断请求属于实体查找、解释、流程、规则、关系、细节还是覆盖检查。
2. 从最相关的根索引开始，例如 `{{wikisRoot}}/index.md`，再沿链接进入具体页面。
3. 只读取回答所需的章节；frontmatter 用来选择范围，不作为事实依据。
4. 查询关系或影响范围时，先检查 `context-build-inventory.json` 中的 `structure.edge_records`，再读取两端页面。
5. 结论只能来自可见章节正文和来源支持的边记录，并引用对应页面或章节。
6. 如果包内没有证据，明确报告缺口和已经检查的范围，不要根据邻近内容推断。

## 知识根目录

| 根目录 | 用途 |
|---|---|
| `{{wikisRoot}}/` | 来自 codeindex、business、product 的结构化实体和关系。 |
| `{{guidesRoot}}/` | 架构、流程、FAQ、决策、故障和排障说明。 |
| `{{rulesRoot}}/` | 标准、约束、验收条件和测试场景。 |
| `{{featsRoot}}/` | 被选择进入包内的功能知识。 |

缺少某个根目录表示当前知识包没有选择该类别。

## 按意图导航

| 意图 | 第一步 |
|---|---|
| 模糊主题或未知名称 | 打开可能相关的根索引，从分组中选择候选页面。 |
| 指定实体、API、领域或动作 | 打开匹配页面或最近的分组索引；有歧义时列出候选。 |
| 架构、流程、FAQ、决策或故障 | 从 `{{guidesRoot}}/index.md` 开始。 |
| 标准、约束、验收或测试 | 从 `{{rulesRoot}}/index.md` 开始。 |
| 关系或影响范围 | 检查类型化边，再读取两端页面。 |
| 已知页面中的细节 | 读取对应 `context:section`。 |
| 覆盖范围或缺口 | 检查根索引和 `context-build-inventory.json`。 |

## 证据契约

| 证据 | 可支持的内容 |
|---|---|
| 页面路径 | 页面身份和引用位置。 |
| frontmatter 的标题、描述、稳定节点标识和标签 | 导航和范围选择。 |
| `context:section` 的 id、kind、`source_ref` | 章节身份、引用位置和来源边界。 |
| 读者可见的章节正文 | 事实结论的主要依据。 |
| `context-build-inventory.json` 的边记录 | 类型化关系证据。 |
| 根索引和构建清单 | 包的范围和覆盖情况。 |

不要根据页面同时出现来推断关系。如果 `source_ref` 指向未随包分发的来源，只能引用已经过审核的可见章节，不能扩展到正文没有表达的内容。

## 搜索兜底

只有索引和页面结构无法确定范围，或候选页面过大不适合整页读取时才搜索。精确名称、API、配置键、路径或错误字符串可先用 `rg`；包含多个关键词、中文短语或多个大型索引时，执行本 Skill 随附的 [`scripts/search.mjs`](scripts/search.mjs) 做 BM25 排序：

```bash
node <当前 knowledge-query Skill 目录>/scripts/search.mjs --query '<关键词>' --limit 8
```

脚本位于知识包目录内时会自动定位 `{{packageName}}`。如果包管理工具将本 Skill 复制到了其他位置，增加 `--root <包含 context-build-inventory.json 的包目录>`；也可以使用 `--base <多包集合根目录>`，按构建清单中的包名定位。它按 Markdown 标题和固定行块机械切分，返回路径、行号、标题和短预览，不判断内容语义。

搜索命中只是线索。回答前必须打开命中的页面和章节；关系或影响范围仍以 `context-build-inventory.json` 的类型化边为准，不能用 BM25 分数或文本共现替代关系证据。

## 引用与缺口

引用应紧跟结论：

```text
页面：     <结论> [<root>/path/page.md]
章节：     <结论> [<root>/path/page.md#section-id]
来源绑定： <结论> [<root>/path/page.md#section-id, source_ref]
关系：     <结论> [context-build-inventory.json#structure.edge_records edge:<type>]
覆盖：     <结论> [context-build-inventory.json]
```

没有证据时返回：

```text
缺口：本知识包没有包含 <缺失点> 的证据。
已检查：<索引、页面或构建产物>。
下一步来源：<已知时填写来源、页面或 source_ref>。
```

“本包没有证据”不等于“事实不成立”。禁止使用模型记忆、旧对话或包外源码填补缺口。

## 包边界

- 包内兼容 OKF 的根目录是本 Skill 的事实来源。
- 本包只包含 Context 工作区选择并批准的知识，不声明完整覆盖底层产品或代码库。
- 已有更窄索引范围可以回答时，不要扫描所有页面或关系边。

已批准知识文件：`{{knowledgeCount}}`

## 模板作者建议

这是可直接工作的通用查询 Skill。正式发布前，如果知识包存在专用术语、常见用户意图、推荐入口、已知边界或固定任务流程，作者应修改 description、路由表和包边界说明；如果通用行为已经足够，应在 Context 的包模板 Review 中明确接受未修改模板。
