# 文档编译优化 overlays

文档编译优化是面向来源可追溯正文的可选构建阶段。它只修复 Markdown
排版和明显的局部问题，不修改正式 `knowledge/`。

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
保守的局部替换。决定保存在 `overlays/document-optimization/generated/`，构建
读取 overlays 后的投影视图，正式知识仍保持来源原貌。

如果需要长期维护一次人工调整，先创建受约束的 override：

```bash
context optimize-docs override <fragment-id>
```

只编辑生成标记之间的正文。上游内容或上下文变化后，旧 override 会成为冲突，
不会被静默应用。

关闭并恢复基础构建结果：

```bash
context optimize-docs disable
```

当前 overlay 会被移动到 Context 的运行时恢复目录，下一次构建直接使用正式知识。
