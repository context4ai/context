# Context Project API

The project has two durable declarations with separate responsibilities:

- `src/index.ts`: source references, document capture, custom non-knowledge
  orchestration, and package outputs.
- `src/indexers.yaml`: knowledge requirements, Provider selection, target/read
  scopes, profiles, and Provider customization.

Do not describe the same knowledge transformation in both files.

## `defineProject`

```ts
defineProject({
  sources: [],
  phases: [],
  packages: [],
});
```

The definition is declarative. Loading it must not mutate knowledge or runtime
state.

## Sources

```ts
const repo = source("20260901", "component-lib");
const docs = source("product-docs", { type: "file" });
const handbook = source("handbook", { type: "lark" });
const everyRepo = allSources("repo");
```

References resolve against `sources/repo/index.yaml`,
`sources/file/index.yaml`, and `sources/lark/index.yaml`. Register or refresh
sources through `context source ...`; do not invent snapshot directories.

## Capture phases

```ts
captureFile({ source: docs });
captureFile({ source: docs, processor: mdxJsonDocs() });
captureLark({ source: handbook });
```

Capture only creates a deterministic readable snapshot. Classification,
partitioning, authoring, Candidate creation, and Review belong to the selected
Markdown Indexer.

## `customPhase`

```ts
customPhase("project:refresh-catalog", async (ctx) => {
  await ctx.ensureSources();
});
```

Use it for project orchestration that does not publish knowledge or bypass the
Indexer lifecycle. Declare stable reads/writes when the phase has them.

## Packages

```ts
kbPackage({
  name: "component-kb",
  template: "src/package-templates/kb",
  select: { collections: ["codeindex", "architecture"] },
});

llmsPackage({
  name: "component-context",
  template: "src/package-templates/llms",
  select: { collections: ["codeindex"] },
});
```

Package selection reads approved `knowledge/` only. `dist/` is generated and
may be rebuilt; it is not an authoring source.

## Indexer registry

The Agent and CLI maintain `src/indexers.yaml` through typed proposals and
Review gates. Each selected Indexer binds requirements and scopes to one
primary Provider, with optional declared layers or composers. Provider code
must return the current Indexer result protocol; it must not write Candidate,
knowledge, or Review files directly.

Detailed Provider protocol and customization guidance is selected by the
current workflow Route when it is needed.

## Persistent versus runtime state

Commit source registries, `src/index.ts`, `src/indexers.yaml`, package templates,
and approved knowledge. Do not commit `.tmp/context-runtime/`; it contains
recoverable execution state and is cleaned after a successful close.
