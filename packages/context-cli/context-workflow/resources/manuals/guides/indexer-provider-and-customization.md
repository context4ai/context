---
id: context.sdk.indexer-provider-and-customization
kind: procedure
mediaType: text/markdown
---

# Indexer guidance for planning and writing

Follow the current Route returned by `context run` or `context status --format json`.
The CLI prepares a stage directory and returns its instructions, schemas and
submission command. Use those files instead of copying long content into arguments.

## Responsibilities

An Indexer helps expose the source skeleton and guides source-grounded writing.
It is not a mandatory full symbol scan or a semantic classifier owned by the CLI.
Use a visible Skill directly, or its bounded CLI-assisted discovery, as appropriate
for the technology. Multiple Indexers may explain different aspects of one module.
There is no mandatory primary-owner selection or Provider resolution stage.

At the start of this continuous work, declare the available relevant Skills and
whether the Agent can schedule sub-agents. Use the capability schema supplied in
the stage directory. A new session must declare its actual capabilities; do not
inherit another session's parallel scheduling claim. Skill names and optional
configuration are guidance, not version pins or evidence of completed reading.
Do not inspect caches, compare Skill hashes, resolve exact versions or create a
second installation registry. Installation and enabling Skills belong to the Host.

## Confirmed requirements

The configuration Route names the required file and supplies its schema. The
requirements-only registry records reader goals and authorized sources, not
production assignments. For example, replace the source and goals with the
user's actual scope:

```yaml
protocol: context.indexer.registry/v1
requirements:
  - id: integration-guide
    purpose: Help application developers understand and integrate the system.
    reader_goals: [understand-system, integrate-system]
    coverage_domains:
      architecture: required
    target_scope:
      targets:
        - source_ref: repo:sample
    evidence_source_scope:
      targets:
        - source_ref: repo:sample
indexers: []
```

Use registered source identities, not guessed paths or URLs. Keep any confirmed
exclusions and supporting-source boundaries. Sources needed for another requirement
are not globally excluded. Module directory boundaries can be supplied in task
instructions by the Agent or CLI; do not invent persistent article fields or
extra module-path validation. A module name alone does not identify its directory.

## Lightweight investigation and planning

For code, inspect directories, manifests and registration points. Return names,
known counts and locations, not every symbol, call graph or implementation detail.
Discovery has a bounded budget. Report incomplete coverage honestly; partial
feature counts are not totals. Read representative code only when it helps make
the plan. Deep extraction belongs to writing the selected topic.

For documents, start with titles, bounded introductory text and heading outlines.
Read more when necessary. Reuse code topics or existing articles where the content
belongs, without forcing business concepts into physical directory names. Notes
and sessions can directly suggest a new article or an amendment to an existing one.

Submit article paths, reader questions, source associations and writing batches
using the supplied planning schema. Record selected Skill names and configuration
in the temporary plan's `indexer_usage`; the CLI can return it during planning
and writing. It is not persisted on articles, sections or production results.
Known one-to-one tasks can use the direct-writing path without an extra semantic
planning submission. Do not create an inventory-member disposition ledger.

Present the final work-start report after the relevant source overviews and plan
are ready, before bulk writing. Wait for the user's confirmation, including in
managed mode. Do not add approval for internal batch counts or Skill choices.

## Directory-based writing

The CLI determines which batches are ready and supplies their material and
acceptance rules. Within that authorized work the Agent chooses reading order,
writing order and, when supported, sub-agent scheduling. Without sub-agent support,
work serially through the returned batch. Workers may write their assigned draft
files; the coordinator submits completed subsets and owns shared CLI writes.

Write Markdown and references into the stage's temporary output directory. Submit
the short file manifest with stage-relative paths. Whole-article submissions and
section repairs use the returned schemas. Read the receipt for accepted tasks,
precise errors and next ready work; do not resubmit accepted content unnecessarily.
Multiple authorized sources may support an article. A new task or changed plan
must still respect confirmed requirements and the work-start report boundary.

## Storage and continuation

Drafts, capability declarations, plans, candidates, acceptance receipts and
transaction state remain in `.tmp`. Only formal knowledge, necessary source
material and long-term requirements belong in durable project content.
With intact temporary state the current work can resume or retry safely. After
clearing `.tmp` or cloning elsewhere, start new production from formal knowledge
and sources; do not reconstruct the old workflow. There is no historical protocol
migration or compatibility path.

Source authorization, real references, safe file reads and concurrent-write
protection still apply. Skill identity is not a production acceptance condition.

## When maintaining a Skill

For an explicitly requested Skill change, use the
[code Skill authoring guide](./code-indexer-skill-authoring.md) or
[document Skill authoring guide](./markdown-indexer-skill-authoring.md).
These are authoring references, not additional reading required for routine
knowledge production.
