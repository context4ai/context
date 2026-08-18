# @c4a/extract-rush

确定性索引 Rush 工作区中的包身份、标签、subspace、入口信号、本地依赖边、
解耦依赖以及最近的 `OWNERS` 边界。业务分类由调用方自行维护。

```ts
import { indexRushWorkspace } from "@c4a/extract-rush";

const facts = await indexRushWorkspace(repositoryRoot, { tags: ["frontend"] });
```

这是可选包，不会给 Context CLI 增加阶段。知识项目可以在自己的
`extractCustom()` 回调中把这些事实映射为候选。
