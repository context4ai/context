# @c4a/extract

[English](./README.md)

`@c4a/extract` 将代码仓库结构转化为 Context 知识工作流可以审核和解释的确定性
证据。它负责语言插件协议、仓库 Runner、原始代码快照契约、digest 生成和共用的
Tree-sitter 解析工具。

它不判断代码对产品或读者意味着什么，也不写入正式知识。语言插件只输出结构事实；
Code Indexer Provider 将这些事实组织成当前 Indexer Result；Context 负责来源身份、
Candidate 状态和审核通过的知识。

## 在知识生产链中的职责

```text
已确认的仓库边界
       ↓
语言插件 + Repository Runner
       ↓
版本化原始代码快照
       ↓
Indexer 事实 → 面向读者的 Candidate → 正式知识
```

- 语言 package 实现 `ExtractionPlugin` 并返回 `ExtractionResult` v2。
- Runner 加载一个或多个插件，扫描仓库模块，输出 progress、module-error 和
  summary 事件，并可生成底层代码快照。
- 选中的 Code Indexer Provider 通过受控 workset 调用 Runner。
- Candidate 和运行快照留在 `.tmp/context-runtime/`；只有 Review apply/close 会写入正式
  Markdown。

知识工作区用户通常通过已安装的 Agent 入口和选中的 Code Indexer Provider 使用
本包，不需要手工构造 Runner 输入。下面的协议主要面向解析器作者、Provider 作者
和 Context 维护者。

**依赖：** `@c4a/core`、`web-tree-sitter`、`zod`

## 协议层

### 1. 语言插件协议

语言 package 实现 `protocol.ts` 中的 `ExtractionPlugin`：

```ts
interface ExtractionPlugin {
  id: string;
  languages: string[];
  packageManagers: string[];
  manifestTypes?: ManifestInfo["type"][];
  canHandle(source: SourceInfo): boolean;
  detectEntries(manifest: ManifestInfo, fs: FileSystem): Promise<EntryDetectionResult>;
  extractSymbols(entries: EntryFile[], fs: FileSystem): Promise<ExtractionResult>;
  detectPatterns?(fs: FileSystem): Promise<PatternDetectionResult>;
}
```

关键约束：

- 插件通过 `FileSystem` 读取，不直接访问 `node:fs`；
- `manifestTypes` 声明哪些 manifest 可以传给 `detectEntries()`；一个模块包含多种
  manifest 时必须显式声明；
- `detectEntries()` 返回稳定的 package 身份、类型、语言、可选版本和入口文件；
- `extractSymbols()` 返回带稳定符号和关系的 `ExtractionResult` v2；
- `detectEntries()` 先于 `extractSymbols()` 调用，插件可以在两步之间保留本次检测
  的 package 上下文。

Indexer 执行通过 `extractionResultToEvidenceAdapterResult()` 将 coverage 完整的
`ExtractionResult` 转成 `context.indexer.evidence-adapter-result/v1`。调用方传入已解析的
package/export/version/digest、授权 source/module scope、input digest、precedence 和 owner role。
缺少逐文件 coverage 时转换直接失败；轻量或 enricher 输出不能贡献 file、LOC、symbol 或 protocol
denominator。

### 2. ExtractionResult v2

每个插件返回：

```ts
{
  version: "2",
  meta: { extractedAt, pluginId, commitHash, language },
  package: { name, kind, language, version? },
  files: [{ path, language, lines }],
  symbols: SymbolInfo[],
  relations: RelationInfo[],
  coverage: {
    tier,
    capabilities,
    files: [{ path, disposition, diagnosticCodes }],
    diagnostics
  },
  stats: { files, lines, exportedSymbols, internalSymbols, relations }
}
```

`SymbolInfo` 保存符号身份、可见性、文件与行范围、成员、参数、返回类型、继承、
实现、Props、联合值和源码文档。`RelationInfo` 可以表达 `imports`、
`imports_type`、`calls`、`extends`、`implements`、`param_type`、
`return_type`、`of_type`、`depends_on` 和 `contains` 等结构关系。

### 3. Repository Runner

包暴露底层 NDJSON Runner `c4a-extract-code`。Code Indexer Provider 可以把它作为
实现细节调用；Agent 不应手工生成 stdin Payload。

Runner 输出一行一个 JSON 对象：

- `{ "type": "progress", "phase": "scanning|parsing|uploading", ... }`
- `{ "type": "module_error", ... }`
- `{ "type": "summary", "extraction": ..., "snapshot": ... }`
- `{ "type": "error", "code": "runner-failed", "message": "..." }`

Runner 不直接写 Context 工作区。它在 summary 中返回快照文件，由 Context runtime
校验后原子写入。

### 4. 原始代码快照

启用 snapshot 输入后，Runner 生成：

| 文件 | 用途 |
|---|---|
| `source.yaml` | 代码来源 manifest |
| `manifest.json` | 契约版本、工具链、数量、hash 和 dirty 状态 |
| `_meta.yaml` | 兼容元数据和输入摘要 |
| `digests.jsonl` | 每个模块的版本化 digest |
| `source-files.jsonl` | 来源到模块和 digest 的映射 |
| `packages.jsonl` | package 身份、类型、语言、模块路径和可选版本 |
| `symbols.jsonl` | 扁平符号行，保留 package 和 module 字段 |
| `edges.jsonl` | 带 package、module、version 和 hash 的代码关系 |

Context runtime 在投影前校验快照契约。正式代码知识中的 Section 使用由这些索引
派生的 `source_ref`，例如：

```text
src-N#package:<package>@<hash>
src-N#symbol:<file>:<symbol>:<kind>@<hash>
```

Agent 将完整 `source_ref` 当作不透明 token 复制，不自行解析或改写。

## 编写新的语言插件

创建类似 `@c4a/extract-python` 的 package 并导出 `ExtractionPlugin`。至少需要：

1. 识别语言 manifest；
2. 返回稳定 package 名、类型、语言和可用版本；
3. 一个 manifest 表达嵌套布局时返回 `subPackages`；
4. 解析公开入口，以区分 exported 和 internal 符号；
5. 输出稳定的符号名、kind、visibility、文件和行范围；
6. 输出导入、调用、类型、继承或使用关系；
7. 插件内部保持 module-relative 路径，由 Runner 加上 repo-relative 前缀；
8. 在 Code Indexer Provider 的 Runner 配置中注册插件。

## 与 Code Indexer 的关系

`@c4a/extract` 位于 Code Indexer Provider 上游，不渲染正式知识。典型流程是：

1. 用户确认代码来源边界；
2. `src/indexers.yaml` 将来源范围和读者需求绑定到 Code Indexer Provider；
3. 当前 Route 准备受控 workset，Provider 返回当前 Indexer Result；
4. Context 生成待审 Candidate 和可恢复运行态；
5. review apply 将批准内容写入正式知识；
6. close、verify 和 build 完成本轮并生成知识包。

因此，更好的符号和关系会产生更可靠的 Candidate、来源引用和知识包，但业务分类继续由
Agent 与用户依据证据决定。

## 开发

```bash
bun run --filter @c4a/extract build
bun run --filter @c4a/extract typecheck
bun run --filter @c4a/extract test
bun run --filter @c4a/extract lint
```
