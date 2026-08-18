# @c4a/extract-ts

Context 的 TypeScript/TSX 结构提取包。它实现 `@c4a/extract` 的插件协议，
也是 SDK `extractTs({ source, collection: "codegraph" })` 阶段使用的默认
提取器。

除 TypeScript 符号、导出和 AST 关系外，包还提供可独立使用的 React Router
结构提取：

```ts
import { extractReactRouterRoutes } from "@c4a/extract-ts";

const routes = extractReactRouterRoutes(source, "src/router.tsx", {
  routeIdPrefix: "web",
  mountPath: "/web",
});
```

该函数读取 JSX `<Route>` 和 route object 数组，返回路径、组件、重定向、
条件、导入来源、注释及源码位置，不判断业务含义。项目可以在
`extractCustom()` 中将这些结构事实映射为自己的候选。

包还提供单文件导出面读取：

```ts
import { extractTypeScriptModuleExports } from "@c4a/extract-ts";

const exports = extractTypeScriptModuleExports(source, "src/index.ts");
```

返回结果包含具名导出、通配导出目标和全部 re-export 目标。函数不解析文件、
不追踪依赖，也不判断业务含义，适合由定制提取流程继续映射为领域事实。
