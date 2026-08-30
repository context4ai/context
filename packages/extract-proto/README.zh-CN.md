# Context Protocol Buffers 目录解析

[English](./README.md)

`@c4a/extract-proto` 把调用方已登记的 Protocol Buffers 文件解析为确定性的 package、import、option、message、enum、service、RPC、generated boundary、locator 和 disposition Evidence。

import 解析只允许访问输入 source map 和显式 import root。import 缺失、使用绝对路径或越出登记范围时，引用文件整体标记为 `unsupported`，且不发布部分 facts。解析器覆盖公开语法中的 proto2/proto3 声明和 Editions syntax，不推断私有 codegen 平台状态。

## 开发

```bash
bun run --filter @c4a/extract-proto typecheck
bun run --filter @c4a/extract-proto lint
bun run --filter @c4a/extract-proto test
bun run --filter @c4a/extract-proto build
```
