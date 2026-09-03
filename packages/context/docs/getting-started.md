# Getting Started

Context turns registered code and documents into approved, reader-oriented
knowledge. The normal user starts through the installed Context Agent entry;
the Agent follows the Route returned by `context status --format json`.

## 1. Initialize

```bash
context init ./context
cd ./context
```

Initialization creates source registries, `src/index.ts`, an empty
`src/indexers.yaml`, package templates, `knowledge/`, and `dist/`.

## 2. Register source boundaries

Examples:

```bash
context source add repo 20260901 --module component-lib --local ../component-lib
context source add file product-docs --local ../docs
context source add lark handbook --doc-token <token>
```

Choose a boundary that matches ownership. For a monorepo, register the package
or service directory that should own the resulting knowledge rather than the
whole repository by default.

## 3. Declare capture and packages

Use `src/index.ts` for capture and output only:

```ts
import { captureFile, defineProject, kbPackage, source } from "@c4a/context";

const docs = source("product-docs", { type: "file" });

export default defineProject({
  sources: [docs],
  phases: [captureFile({ source: docs })],
  packages: [
    kbPackage({
      name: "component-kb",
      template: "src/package-templates/kb",
      select: { collections: ["codeindex", "architecture", "product"] },
    }),
  ],
});
```

Repo sources do not need a capture phase. The Code Indexer reads their pinned
source boundary through its controlled workset.

## 4. Let the lifecycle prepare Indexers

Run the current route and follow its declared next action. The Agent will:

1. turn the user goal into explicit requirements and reader questions;
2. inspect source boundaries and select Code or Markdown Providers;
3. prepare a registry-only proposal for `src/indexers.yaml`;
4. ask only for choices that change scope, ownership, or visible output;
5. run the selected Provider through the controlled Agent step.

Do not manually create a second extraction or Markdown pipeline in
`src/index.ts`.

## 5. Review Candidates

Review shows readable paths, titles, summaries, and page content. Internal
evidence IDs remain in runtime artifacts. Approve, reject, or revise based on
whether the pages answer the intended reader questions and accurately reflect
the source.

After approval, `close` writes the accepted pages under readable paths such as:

```text
knowledge/codeindex/component-lib/button.md
knowledge/architecture/product-docs/component-contract.md
```

The CLI retains only metadata needed to update or rebuild those pages.

## 6. Verify and build

The workflow verifies approved knowledge, then builds the declared package in
`dist/<package-name>/`. Package pages are a reader projection and intentionally
omit runtime evidence IDs and most digests.

Source or requirement changes re-enter the same Indexer lifecycle. Successful
work is recovered from persisted runtime state; successful close clears
temporary Candidate and Review state.

## Troubleshooting boundary

- Fix a missing or stale source with `context source ...`.
- Fix capture configuration in `src/index.ts`.
- Fix knowledge requirements, Provider selection, or customization through the
  `src/indexers.yaml` proposal flow.
- Fix reader output through Provider instructions/templates, not by adding a
  parallel project phase.
- Never treat generated `dist/` as source material.

