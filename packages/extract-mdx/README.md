# MDX Catalog Bridge for Context

[简体中文](./README.zh-CN.md)

`@c4a/extract-mdx` parses registered MDX sources without compiling or executing them. It catalogs ESM imports/exports, JSX component references, fenced examples, demo/story/sandbox hosts, and links those examples to caller-registered public targets.

```ts
import { mdxSourcesToEvidenceAdapterResult } from "@c4a/extract-mdx";

const evidence = mdxSourcesToEvidenceAdapterResult(files, {
  ...invocation,
  public_targets: [{
    target_ref: "public-target:button",
    export_name: "Button",
    source_module: "@example/ui",
  }],
});
```

Public targets are an input authority, not inferred from uppercase JSX names. Example identities include the complete source path and an ordinal, so equal basenames in different directories cannot collide. Fenced code is retained only by digest; script-language blocks are parsed statically for imports and JSX references. Invalid fenced script receives a warning without making otherwise valid MDX disappear. Invalid MDX makes the whole file `unsupported` and publishes no partial facts.

## Development

```bash
bun run --filter @c4a/extract-mdx typecheck
bun run --filter @c4a/extract-mdx lint
bun run --filter @c4a/extract-mdx test
bun run --filter @c4a/extract-mdx build
```
