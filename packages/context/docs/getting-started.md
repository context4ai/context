# Getting Started

Context turns selected code, documents, notes and conversation summaries into
approved knowledge. Start through the installed Context Agent entry and follow
the current Route returned by the CLI.

## 1. Initialize the workspace

```bash
context init ./context
cd ./context
bun install
context status --format json
```

Use the dependency-install command returned by initialization if it differs.
Initialization creates the project configuration, source directories, package
templates and workspace rules. Read the generated `AGENTS.md`. It does not create
an empty `src/indexers.yaml`: the later configuration Route supplies its schema
and asks for the confirmed requirements with `indexers: []`.

Run workspace commands inside this initialized directory. Route paths and
`.tmp/` belong to this workspace, not the surrounding repository.

## 2. Select and register sources

This example uses a code module and a local documentation directory:

```bash
context source add repo 20260901 --module component-lib --local ../component-lib
context source add file 20260901 --module product-docs --local ../docs
```

Replace the date and paths with the actual inputs. Both commands register a
boundary; they do not decide what knowledge to write. For a monorepo, select the
package or service needed for the reader's task. Discuss obsolete or unrelated
areas before indexing them: unnecessary material costs reading time and tokens.
Do not exclude content merely because a filename looks old.

For an authorized Lark document, registration instead looks like:

```bash
context source add lark 20260901 --module handbook --doc-token "<actual-token>"
```

Use `captureLark()` for that registered document. Notes and conversation summaries
use `context source import`, without a source registry or capture phase. Read
[note preparation](guides/note.md) or [sessions preparation](guides/sessions.md)
for the actual input. Saving them alone does not start knowledge production.

## 3. Declare capture and output

For the code and local-document example, `src/index.ts` contains:

```ts
import { captureFile, defineProject, kbPackage, source } from "@c4a/context";

const repo = source("20260901", "component-lib");
const docs = source("20260901/product-docs", { type: "file" });

export default defineProject({
  sources: [repo, docs],
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

This example assumes an Agent knowledge-base package is the intended output;
see [Package Outputs](guides/package-outputs.md) for alternatives. Repo sources
need no capture phase. For saved text, declare an explicit typed `source()` or
`allSources()` selection as described in [Project API](reference/project-api.md).

## 4. Follow requirements and Provider selection

The Agent researches representative material, reuses the user's stated goals,
and asks about missing information that would change the scope or useful output.
Fully managed mode does not authorize guessing those answers. For substantial
new work, the selected workflow provides an opening report under `.tmp/`, with
scope, Provider choices and the first pages to expect. The Agent invites the user
to read it before continuing unless that pause was explicitly waived; this is
conversation coordination, not a new approval record.

The configuration Route supplies the initial registry schema and guide. Declare
requirements with no selected Indexers, re-read the Route, then submit Provider
selection through its completion command. The shipped Code, Markdown, Note and
Sessions Providers share the same lifecycle. A compatible business Provider may
replace a default; installation alone does not enable it.

Partition organizes the selected material into reader topics. Its task batches
are planning work, not finished-page deliveries. After the outline is reviewed,
Author writes complete pages, selected Composers contribute where applicable,
and the CLI compiles Candidates. Do not create a second knowledge pipeline in
`src/index.ts`.

## 5. Review and deliver pages

In ordinary mode, the user reviews the proposed structure and then the actual
Candidate pages. In explicitly authorized fully managed mode, the Agent performs
delegatable reviews and reports the results. Human-only decisions, such as
protected changes to an approved layout, still stop at their returned Gate.

Review shows readable titles, paths, summaries and content. Approval applies the
pages to `knowledge/`; rejection or revision follows the current Route back to
writing. `close` rebuilds `knowledge/structure.yaml` and verifies the approved
knowledge without rewriting its prose. Build produces `dist/<package-name>/`.
The first readable delivery normally contains 1–3 pages, followed by batches of
30–50 pages or a smaller remaining tail. Each delivery completes review, close
and build before continuing. These page counts do not count Partition tasks.

## 6. Continue or update

Use the latest Route and revision. Accepted tasks must not be resubmitted. If a
completion points to `result_file` or `next_route.file`, read those files; do not
infer failure from a shortened console response. Follow its recovery command if
preparing the next Route failed after acceptance.

Approved knowledge and `structure.yaml` retain the durable information needed
for updates; `.tmp/context-runtime/` holds unfinished execution state and can be
cleaned after completed work. Its absence is not permission to replay accepted
work or advance an unfinished source baseline.

Use `context revise` for a selected page correction, and `context update` for a
selected source change. [Update existing knowledge](guides/knowledge-updates.md)
explains their inputs, same-task adjustment and explicit rollback.

## Troubleshooting boundary

- Fix a missing or stale source through the source commands returned by the Route.
- Fix capture and output configuration in `src/index.ts`.
- Fix requirements or Provider selection through the current configuration or
  proposal Route; use its supplied schema rather than guessing payload fields.
- Correct page content through revision and Review. Change Provider guidance when
  the same writing problem affects future pages.
- Keep temporary input files under this workspace's `.tmp/`. Never use `dist/`
  as an authoring source or hand-edit internal lifecycle state.
