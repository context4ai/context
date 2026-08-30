# Context Thrift IDL 目录解析

[English](./README.md)

`@c4a/extract-thrift` 把调用方已登记的 Apache Thrift IDL 文件解析为确定性的 service、method、type、include、namespace、annotation、generated boundary、locator 和 disposition Evidence。

解析器不会读取输入 source map 之外的 include。include 缺失、使用绝对路径或越出登记范围时，引用文件整体标记为 `unsupported`，且不发布部分 facts。生成边界只声明 Thrift IDL 是权威 contract source、各语言 binding 是派生输出，不推断私有 owner 或 codegen 平台状态。

## 开发

```bash
bun run --filter @c4a/extract-thrift typecheck
bun run --filter @c4a/extract-thrift lint
bun run --filter @c4a/extract-thrift test
bun run --filter @c4a/extract-thrift build
```
