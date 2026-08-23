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
保守的局部替换。只有实际改写的页面才写入 `overlays/`，并与 `knowledge/`
保持相同的 Markdown 相对路径。片段决定集中保存在
`.tmp/context-runtime/document-optimization/`，只作为可重建的运行时缓存。

如果需要长期维护一次人工调整，先创建或定位对应的页级 overlay：

```bash
context optimize-docs override <fragment-id>
```

只编辑面向读者的正文，不修改 frontmatter 来源信息和 `context:section` 边界，
随后运行 `context optimize-docs validate`。上游内容变化后，旧页级 overlay 会
成为冲突，不会被静默应用。

关闭并恢复基础构建结果：

```bash
context optimize-docs disable
```

文档优化页面会被移动到 Context 的运行时恢复目录，下一次构建直接使用正式知识；
其他未来的 overlay 类型不受影响。
