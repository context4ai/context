# @c4a/extract-go

面向 Context `ExtractionResult v2` 协议的 Go 提取插件。它提取声明、签名、
文档、导入、调用关系和常见 HTTP 路由注册，不加入任何业务分类。

```ts
import { GoPlugin, indexGoRepository, indexGoSource } from "@c4a/extract-go";
```

标准代码图谱使用 `GoPlugin`；项目自有提取器需要先读取细粒度 Go 事实时，
可以直接使用 `indexGoSource()`。`indexGoRepository()` 提供仓库级结构事实，
并通过确定性参数控制扫描根目录、测试文件、生成文件和排除目录。

这是可选包。Context CLI 不会内置它，也不会新增 Go 生命周期阶段；知识项目
需要在自己的 `extractCustom()` 回调中显式使用。
