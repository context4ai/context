---
type: Knowledge Bundle
title: "{{displayName}}"
description: "由 Context 工作区生成的已批准知识包。"
tags:
  - context
  - knowledge-base
timestamp: "{{knowledgeTimestamp}}"
resource: "context://package/{{packageName}}/{{wikisRoot}}"
package: "{{packageName}}"
package_kind: "{{packageKind}}"
knowledge_count: {{knowledgeCount}}
---

<!-- context:template
这是一个起始模板。`context build` 渲染后会将其复制到
`dist/<package-name>/{{wikisRoot}}/index.md`。

以 context:template 开头的模板注释不会进入构建产物。
修改前请阅读模板变量手册：
node_modules/@c4a/context/docs/reference/template-variables.md

正式发布前，应补充知识包范围、目标读者、推荐阅读顺序、已知缺口、使用场景或任务入口。
小目录会直接列出内容，超过导航阈值时会链接到子目录 index.md。
-->

# {{displayName}}

本知识包包含 `{{knowledgeCount}}` 个已批准知识页面。请先使用本索引定位范围，再打开具体知识页获取可追溯来源的细节。

## 内容

{{knowledgeGroupsMarkdown}}

## 使用方式

- 从上方导航开始，再进入知识页或子目录索引。
- 安装为 Agent 知识包后，可以使用随包提供的 knowledge-query Skill。
- 如果包需要专用范围、已知缺口、阅读路径或任务入口，作者应替换或编辑本通用索引；否则应在 Context 包模板 Review 中明确接受未修改模板。
