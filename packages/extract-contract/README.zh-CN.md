# @c4a/extract-contract

面向 Context 的 OpenAPI 与 GraphQL 静态 contract catalog adapter。

该包只解析调用方登记的 source map。OpenAPI 外部引用只能解析到已登记的相对路径；同一次调用中的 GraphQL 文件构成一个 schema scope，使 type extension 能解析到唯一且精确的基础定义。依赖缺失、逃逸、歧义、循环或不受支持时，受影响文件记为 `unsupported`，且不发布部分 facts。

输出统一的 `context.indexer.evidence-adapter-result/v1` ABI，包含 endpoint、operation、type、reference、生成代码边界、locator、disposition 和 diagnostic evidence。不会拉取远程 schema、执行 GraphQL operation、生成客户端，也不会发布源码描述正文。
