# 文档修订页

文档编译优化是面向来源可追溯正文的可选构建阶段。它只修复 Markdown
排版和明显的局部问题，不修改正式知识页。

初始化时开启：

```bash
context init context --optimize-docs
```

已有工作区可以运行：

```bash
context optimize-docs enable
context status --format json
```

开启后，工作流只规划新增或发生变化的片段。Agent 可以保持片段不变，或提交
保守的局部替换。只有实际改写的页面才在原文旁生成完整修订页：

```text
knowledge/guides/setup.md
knowledge/guides/setup__revision.md
```

`__revision.md` 是保留后缀。默认知识发现、结构、检索和包选择都排除修订页；
校验和构建根据文件名把它关联回同目录原文，并仍按原文件名输出。修订页只额外
记录无法推导的原文摘要；原文路径和修订片段由文件名与正文差异推导。完整修订
页中未变化的片段直接推导为 `keep`；整页都不修改时，运行时只保存一个页级负
缓存键，不重复保存改写正文或片段元数据。

工作区采集、审核或构建完成后，用户可以直接通过对话要求修正某篇知识。Agent
先使用标题、正式知识路径或 ViewRef 启动修订：

```bash
context revise "<标题、正式知识路径或 ViewRef>" --format json
```

CLI 只在目标唯一时创建或复用该页修订，并由 Agent Graph 返回
`route.document-revision.requested`。若有多个候选，Agent 必须依据当前对话选定，
否则询问用户。Agent 只编辑面向读者的正文，不修改来源信息和
`context:section` 边界，随后运行 `context optimize-docs validate`。校验成功后，
请求自动结束；若产物因此过期，下一条 Route 会直接提示重新构建。即使工作区
此前没有开启整库文档编译优化，这个入口也只激活目标页面，不会让其他页面进入
待优化队列。上游内容变化后，旧修订页会成为冲突，不会被静默应用。

关闭并恢复基础构建结果：

```bash
context optimize-docs disable
```

修订页会被移动到 Context 的运行时恢复目录，下一次构建直接使用正式知识。
