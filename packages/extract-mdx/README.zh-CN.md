# Context MDX 目录桥接

[English](./README.md)

`@c4a/extract-mdx` 静态解析已登记的 MDX source，不编译也不执行。它生成 ESM import/export、JSX component reference、fenced example、demo/story/sandbox host，并把示例关联到调用方已登记的公共目标。

公共目标是输入 authority，解析器不会根据大写 JSX 名称自行创建公开 API。示例 identity 包含完整 source path 和 ordinal，不同目录下的同 basename 文件不会碰撞。代码块正文只保留 digest；脚本语言代码块仅静态提取 import 和 JSX reference。代码块语法错误产生 warning，但不会抹掉其他有效 MDX；MDX 本身语法错误时整文件为 `unsupported`，且不发布部分 facts。

## 开发

```bash
bun run --filter @c4a/extract-mdx typecheck
bun run --filter @c4a/extract-mdx lint
bun run --filter @c4a/extract-mdx test
bun run --filter @c4a/extract-mdx build
```
