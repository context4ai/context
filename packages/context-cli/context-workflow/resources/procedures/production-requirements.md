---
id: procedure.production-requirements
kind: procedure
mediaType: text/markdown
---

# Long-term production requirements

Use the reader purpose and source boundaries already confirmed by the user.
Ask for missing decisions before writing; registering a source does not authorize
unrelated modules. This is not the work-start report: the report follows the
lightweight investigation and must still wait for user feedback.

Write `src/indexers.yaml` with this minimal shape, replacing the example values
with the user's actual purpose and registered source reference:

```yaml
requirements:
  - id: service-readers
    purpose: Explain the service responsibilities and supported usage
    target_scope:
      targets:
        - source_ref: repo:service
```

Optional long-term decisions are `reader_goals` and `questions` (text lists),
`coverage_domains` (domain to `required`, `optional` or `out-of-scope`), and
`evidence_source_scope` with the same `targets` shape for authorized supporting
sources. Existing `module_refs` are reading focus, not a module-to-path permission
map. Use an ordinary task brief for relevant directories; no additional module
mapping or scope receipt is required.

An explicit exclusion belongs inside its requirement:

```yaml
exclusions:
  - scope:
      targets:
        - source_ref: repo:service
    paths: [generated]
    reason: Generated outputs are outside the requested reader purpose
```

`paths` contains exact source-relative files or directories, not glob patterns;
omit it only for a confirmed exclusion of the whole selected source scope.
Do not automatically exclude something merely because it is large or costly.

Do not add Provider selections, versions, hashes, run identifiers, candidate
receipts or task assignments. Those are not long-term requirements. Skills and
writing batches are declared in the temporary investigation plan.

After editing, run `context status --format json` and consume its current Route.

When article targets and source grouping are already clear, put the existing
plan fields (`capabilities`, `articles`, optional `indexer_usage`) in a file under
`.tmp/agent-work/`, omitting only `stage`, which does not exist yet. Each article
contains `path`, `question`, `sources` and `batch`, with optional `brief` and
`after`. Add `--input <that-file>` to the returned `action prepare-current`
command to prepare those tasks without a separate investigation-plan submission.
This does not approve the report or permit writing before user feedback.
When targets are unclear, use normal preparation and investigate the skeletons.

## Configured coverage and the current request

`src/indexers.yaml` describes the workspace's standing coverage configuration.
Source registration or presence in that configuration does not, by itself, mean
that the source needs investigation again for this request. For a bounded document
addition or revision, identify its reader task and actual evidence dependencies;
reuse existing approved articles and applicable completed work. Do not broaden a
document task to unrelated code repositories merely because they are configured.

In planning and completion reports distinguish:
- work requested and completed in this task;
- specific content gaps established by reading, with their affected reader tasks;
- source/environment failures, and whether this task depends on those sources.

A `pending_scopes` count is workflow state, not a count of missing topics,
repositories to rewrite, or articles to produce. A Git spawn/baseline-read error
means source availability could not be checked; it does not prove that existing
knowledge is absent or obsolete. If unrelated configured sources remain blocked,
say so as a workflow limitation rather than announcing new investigation work.
Do not delete configured sources, invent exclusions, clear stage files, or mark
unread material investigated to make the current task appear complete. Follow the
returned resolution action when the workflow still needs a decision.
