# Context Go 结构提取

[English](./README.md)

`@c4a/extract-go` 为 Context 知识项目提供确定性的 Go 结构事实。它提取声明、签名、
源码文档、导入、调用关系和常见 HTTP 路由注册，但不赋予产品专属含义。

这是可选结构包。Context 运行时不会内置它，也不会自动增加 Go 生命周期阶段。知识
项目通过自己的 `extractCustom()` Adapter 显式使用，把结构事实映射成项目候选；
审核、证据、新鲜度、close 和构建继续由标准 Context 工作流负责。

## 在知识生产链中的位置

```text
已确认的 Go 仓库边界
          ↓
Go 结构索引
          ↓
项目自有 extractCustom() 映射
          ↓
Context 候选 → 审核 → 正式知识
```

## 公开 API

```ts
import {
  GoPlugin,
  goExtractionToEvidenceAdapterResult,
  indexGoRepository,
  indexGoSource,
} from "@c4a/extract-go";
```

- `GoPlugin` 实现标准 `@c4a/extract` 插件协议；
- `GoPlugin` 声明 `ast-catalog` capability，并为每个解析的 Go 文件返回显式 disposition；
- `goExtractionToEvidenceAdapterResult()` 发布统一的
  `context.indexer.evidence-adapter-result/v1` 线协议结果；
- `indexGoSource()` 解析一个源码单元，供 Adapter 在生成候选前读取细粒度事实；
- `indexGoRepository()` 索引仓库树，并通过确定性参数控制 include root、测试文件、
  生成文件和排除目录。

输出始终由代码事实支撑。package 命名、业务分类、知识路径、候选摘要和审核决定属于
知识项目及其 Agent 工作流。

## 适用场景

当 Context 工作区需要 Go 符号或关系，并且项目能够说明这些结构应该如何转化为知识
时使用本包。不要仅为了省去项目映射就添加通用 Go phase：语言解析器无法知道目标
读者、产品边界或有价值的知识形态。

## 开发

```bash
bun run --filter @c4a/extract-go build
bun run --filter @c4a/extract-go typecheck
bun run --filter @c4a/extract-go test
bun run --filter @c4a/extract-go lint
```
