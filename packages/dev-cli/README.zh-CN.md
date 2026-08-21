# Context 开发菜单

[English](./README.md)

`@c4a/dev-cli` 是 Context 贡献者使用的仓库维护入口。它将构建、验证、版本管理、
发布准备和全局 link 操作集中到一个交互式或脚本化菜单中。

这个 package 不属于终端用户的知识生产工作流。用户通过 Context Agent 接入工作；
维护者使用本菜单准备运行时、SDK、提取 package 和插件投影，确保用户入口可用。

## 职责

```text
源码 packages
     ↓
构建 / 验证 / link / 发布准备
     ↓
本地开发安装或可发布产物
```

- 编排仓库构建和验证命令；
- link 或 unlink 本地 Context 运行时，用于集成测试；
- 协调已发布 package 的版本和发布准备；
- 使用 `@c4a/tui` 提供交互菜单；
- 保持 hosted server、storage 和 web application 操作不进入本独立仓库。

## 使用

打开交互菜单：

```bash
bun run --filter @c4a/dev-cli start
```

直接运行已知操作：

```bash
bun run --filter @c4a/dev-cli start build
bun run --filter @c4a/dev-cli start verify
bun run --filter @c4a/dev-cli start link
bun run --filter @c4a/dev-cli start unlink
bun run --filter @c4a/dev-cli start bump <version>
bun run --filter @c4a/dev-cli start publish <version>
```

真实发布仍受仓库 release workflow 约束，并且需要显式授权。本地 build 或 link
成功不能证明 package 已经发布。

源码、packaged-install 和发布检查参见仓库[开发指南](../../DEVELOPMENT.md)。
