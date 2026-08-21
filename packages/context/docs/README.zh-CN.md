# Context SDK 文档

[English](./README.md)

这些手册说明知识项目如何声明来源、处理过程、审核和知识包产物。它们是 Agent
驱动工作流中的参考资料，不是另一套生命周期指令。

进行知识生产时，应先从已安装的 Context Agent 入口开始。Agent 优先消费
`workflow.current` 选择的资源；只有当前 Route 要求编辑项目配置、维护知识包模板
或查询稳定 API 时，才读取对应 SDK 手册，不要预加载整套文档。

## 按当前需要选择文档

| 当前需要 | 阅读内容 |
|---|---|
| 理解完整知识项目的形态 | [Getting Started](./getting-started.md) |
| 判断 Agent 可以决定或修改什么 | [Agent Guide](./guides/agent-guide.md) 和 [Agent Dialogue](./guides/agent-dialogue.md) |
| 配置来源、阶段、审核或产物 | [Project API](./reference/project-api.md) |
| 选择代码提取方式 | [Code Extractor Selection](./reference/code-extractors.md) |
| 选择 Agent 知识包或 LLM 文档 | [Package Outputs](./guides/package-outputs.md) |
| 自定义包文件和索引 | [Package Templates](./reference/package-templates.md) 和 [Template Variables](./reference/template-variables.md) |
| 保留飞书图片和内嵌资源 | [Lark Resource Materialization](./guides/lark-resources.md) |

## 完整参考

- [Getting Started](./getting-started.md)：从来源到知识包的端到端组件库示例。
- [Agent Guide](./guides/agent-guide.md)：Agent 应该执行什么，以及哪些状态不能手工探查或修改。
- [Agent Dialogue](./guides/agent-dialogue.md)：稳定的对话原则和 Route-selected Gate 资源发现方式。
- [Package Outputs](./guides/package-outputs.md)：如何选择 Agent 知识包、LLM 文本或不构建产物。
- [Lark Resource Materialization](./guides/lark-resources.md)：内嵌资源如何从来源证据进入正式知识和知识包。
- [Project API](./reference/project-api.md)：`defineProject`、来源、阶段、审核和知识包声明。
- [Code Extractor Selection](./reference/code-extractors.md)：如何根据技术信号选择内建提取器、结构库或项目适配器。
- [Package Templates](./reference/package-templates.md)：`kbPackage`、`llmsPackage`、模板变量和示例。
- [Template Variables](./reference/template-variables.md)：Handlebars 变量、循环、注释和默认知识清单。

正式 Markdown 使用完整的 Context production profile。知识包内的知识页只保留
面向读者的元数据和正文；Node 身份、来源、Section 证据、审核指纹、符号清单、
生成子项和关系继续留在生产工作区或 `context-build-inventory.json` 中。构建清单
将每个分发路径映射回正式知识路径。知识包根目录可以包含 Agent 文件；可交换知识
位于所选的 `wikis/`、`guides/`、`rules/` 和 `feats/` 子树。

## 已安装模板

知识包模板示例随 SDK 安装在：

```text
node_modules/@c4a/context/templates/package-templates/
```

需要构建产物时，将合适的模板复制或映射到工作区的
`src/package-templates/`。

长期维护、多来源的生产工作区还可以使用可选的项目维护 Skill 模板：

```text
node_modules/@c4a/context/templates/project-skills/maintain-project-knowledge/SKILL.md
```

将它复制到项目 `.agents/skills/`，按项目重命名并填写来源归属与影响映射。它是
项目适配器，不会进入最终知识包，也不替代已安装的 Context Agent 入口。
