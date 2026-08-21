# Context 终端组件

[English](./README.md)

`@c4a/tui` 提供 Context 仓库开发工具共用的 Ink 和 React 组件，当前主要消费者是
`@c4a/dev-cli`。

这是面向维护者的 UI 库，不是 Context 知识工作流，也不是面向用户的 Agent 接入。
独立 package 让开发菜单可以复用布局、提示和 CJK 字符宽度处理，同时避免给运行时
或 SDK 增加终端 UI 依赖。

## Package 关系

```text
@c4a/tui → @c4a/dev-cli → 仓库维护
```

它不依赖其他内部 package，知识工作区也不需要安装它。

## 主要导出

- `CascadeMenu`：多层交互式终端菜单；
- `Header`：共用菜单标题；
- `HelpPanel`：上下文帮助展示；
- `confirm()`：确认对话；
- `pickDirectory()`：交互式目录选择；
- `displayWidth()`、`padToWidth()` 和 `truncateToWidth()`：支持 CJK 的文本宽度工具；
- `MenuItem`：菜单项类型。

## 开发

```bash
bun run --filter @c4a/tui build
bun run --filter @c4a/tui typecheck
bun run --filter @c4a/tui lint
```

运行时组件保持兼容 Node.js；Bun 专属 API 只允许出现在构建或测试工具中。
