# @c4a/extract-ts

[English](./README.md)

`@c4a/extract-ts` 将 TypeScript 和 TSX 结构转化为 Context 知识生产可使用的确定性
代码证据。它实现 `@c4a/extract` 的 `ExtractionPlugin` 协议，也是 npm-style
package 使用 `extractTs({ source, collection: "codegraph" })` 阶段时的默认插件。

它只提取代码事实，不判断产品含义、不写正式 Markdown，也不替用户选择来源边界。
知识工作区用户通过 Context Agent 入口和已确认的提取阶段使用它；直接 API 面向
可复用结构分析和项目自有 Adapter。

## 在知识生产链中的职责

```text
已确认的 TypeScript 边界
          ↓
入口检测 + 导出追踪 + AST 事实
          ↓
原始代码快照 → 审核候选 → 正式知识
```

`@c4a/extract-ts` 负责 TypeScript package 入口检测和 AST 提取。它不直接写工作区；
`@c4a/extract` 运行插件，Context runtime 保存并校验原始代码快照。

**依赖：** `@c4a/extract`、`web-tree-sitter`

## 可复用结构 API

### React Router 结构事实

使用 `extractCustom()` 的项目可以复用 `extractReactRouterRoutes()`，索引 JSX
`<Route>` 声明和 route-object 数组：

```ts
import { extractReactRouterRoutes } from "@c4a/extract-ts";

const routes = extractReactRouterRoutes(source, "src/router.tsx", {
  routeIdPrefix: "web",
  mountPath: "/web",
});
```

结果包含路径、组件、重定向、条件、导入来源、注释和源码位置，但不会把路由分类为
产品能力或业务页面。

### TypeScript 模块导出面

`extractTypeScriptModuleExports()` 读取单个 TypeScript/TSX 模块，返回确定性的具名
导出、通配导出目标和全部 re-export 目标：

```ts
import { extractTypeScriptModuleExports } from "@c4a/extract-ts";

const exports = extractTypeScriptModuleExports(source, "src/index.ts");
```

它不解析文件依赖，也不判断业务含义，适合由项目自有提取器继续映射为领域事实。

## 当前提取范围

### 入口检测

`detectEntries()` 读取 `package.json` 并支持：

- `exports` map，包括 conditional `import`、`default` 和 `main`；
- `main` 和 `bin`；
- 以 `/*` 结尾的 `workspaces` glob；
- 通过 `resolveEntrySourcePath()` 将 `dist/` 入口回退到 `src/`；
- `lib`、`cli`、`service` package 类型识别；
- 将 package version 写入 `ExtractionResult.package.version`。

Context 项目可以使用 source-relative `extractTs.entries` 覆盖自动检测，或用
`mode: "scan"` 把所有 `include` 命中的文件作为提取根。这些设置属于知识工作区，
无需修改被分析 package。

入口文件以 module-relative 路径返回，Repository Runner 再为原始快照补充
repo-relative 前缀。

### 符号提取

`extractSymbols()` 从检测到的入口开始追踪导出，将可达声明标记为 `exported`。
当前支持：

- function、class、interface、type alias、enum 和 variable；
- TSX component-like variable；
- 下游投影按名称识别的 hook-like function；
- class/interface/type 的嵌套成员；
- 声明和成员 JSDoc；
- function 参数和返回类型；
- type annotation、extends 和 implements；
- union/intersection/parenthesized type 中的 object member；
- string-literal union value；
- 通过 `FC<Props>` 或 `{ComponentName}Props` 约定识别的 `propsType`。

输出关系包括 `imports`、`imports_type`、`extends`、`implements`、
`param_type`、`return_type` 和 `of_type`。这些关系均由 AST 直接支撑，confidence
为 `1`。

### 导出追踪

`exportTracer.ts` 支持：

- 本地导出声明；
- 本地标识符形式的 `export default`；
- `export * from "./module"`；
- `export { A } from "./module"`；
- 别名 export specifier；
- 通过 in-flight guard 处理循环 re-export。

只有从入口导出面可达的声明会标记为 `exported`，同一已追踪文件中的其他声明保持
`internal`。

## 与代码知识投影的契约

插件返回 `ExtractionResult` v2，`@c4a/extract` Runner 将其转成原始快照：

- `packages.jsonl`：package 名、类型、语言、版本和可用描述；
- `symbols.jsonl`：带 `symbol_id`、`package_name` 和 `module_path` 的扁平符号；
- `edges.jsonl`：带 package、module、version 和 hash 元数据的关系；
- `digests.jsonl`：版本化模块 digest。

Context runtime 使用这些行生成 package/category/symbol 知识候选。重要输入是稳定
package 名和版本、稳定导出符号、准确 kind/visibility、文件与行范围、关系端点、
JSDoc 和类型成员信息。

知识包构建读取 review apply 后的正式 Markdown 和项目元数据，不直接读取
`@c4a/extract-ts` 输出。

## 使用方式

手工注册插件：

```ts
import { ExtractionPluginRegistry } from "@c4a/extract";
import { TypeScriptPlugin } from "@c4a/extract-ts";

const registry = new ExtractionPluginRegistry();
registry.register(new TypeScriptPlugin());
```

正常工作区在 `src/index.ts` 声明项目阶段：

```ts
import { defineProject, extractTs, reviewValidity, source } from "@c4a/context";

const componentLib = source("component-lib");

export default defineProject({
  sources: [componentLib],
  phases: [
    extractTs({ source: componentLib, collection: "codegraph" }),
    reviewValidity({ collection: "codegraph" }),
  ],
  packages: [],
});
```

实际提取由当前 Context Route 驱动。Agent 不应在正常知识生产中手工构造 Runner
输入或原始快照。

## 开发

```bash
bun run --filter @c4a/extract-ts build
bun run --filter @c4a/extract-ts typecheck
bun run --filter @c4a/extract-ts test
bun run --filter @c4a/extract-ts lint
```
