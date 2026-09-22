# Context Agent Integration

> This directory is generated; do not edit it directly. Paths below are relative to the source repository root. Edit `plugins/context/README.md` for this documentation.

[简体中文](./README_CN.md)

`plugins/context/` is the only human-maintained source for the Context Agent
integration in this repository. It contains the Context production, project-planning and host-routable context-inspect-search Skills, the Code, Markdown, Note and Sessions
Indexer Provider Skills, host manifest templates, and shared assets.

Run `bun run --filter @c4a/context-cli build:plugin` to regenerate the npm
projection and the committed `plugins/context/repo-install/` tree. Do not edit generated files
under `plugins/context/repo-install/` or `packages/context-cli/dist/plugins/`.

`plugins/context/repo-install/{claude,codex,cursor}/` contains host-specific plugin roots with
production, project planning, explicit query and Indexer creation entries; `plugins/context/repo-install/skills/` is the portable Skill
projection. In the same install, `context plugin install` projects Providers
to the Codex/Cursor shared `~/.agents/skills` directory and Claude's
`~/.claude/skills`, so Provider names do not inherit a plugin namespace.

Invoke Context explicitly, or continue an already active Context conversation.
Ordinary coding and design discussions do not automatically start this workflow.
Installing a Provider makes it discoverable; it does not enable it for every
workspace. The Agent selects Providers for the current sources and requirements.

The conversational entry delegates workspace state and lifecycle authority to
the local `context` CLI. Indexer Skills are activated only through the verified
Context workflow and Indexer Provider lifecycle.

## Plan a project or a broad source update

Use the `context-plan` Skill (Claude plugin: `/c4a:context-plan`; Cursor:
`/c4a-context-plan`) for a knowledge project involving more than 30 original
documents, at least two repositories needing investigation, or a broad source
refresh. It researches authorized material in temporary storage and presents a
root `PLAN-YYYYMMDD-topic.md` for review before production (human by default). Small bounded
tasks continue through `context` directly.

The approved plan hands one stage at a time to the existing Context workflow.
Its checklist records actual Git and publication results, supports interrupted
work, and is deleted in the closing commit only after every planned delivery is
complete. Source targets are resolved during research; publication versions are
recorded when released. The plan is an Agent-maintained Markdown document, not
a second workflow engine or an additional CLI gate.


## Task-scoped review policy

By default, project PLAN review asks the user even in managed mode. Article
review follows the existing Bot/workspace policy. An authorized user or automation
trigger may explicitly include the following in its task instructions:

```yaml
CONTEXT_RUN_POLICY:
  plan_review: delegate
  knowledge_review: delegate
```

Both keys accept `ask` or `delegate`. Omitted keys retain their existing policy;
invalid values and unknown keys must be resolved before applying an override.
`delegate` means the Agent performs the review and repairs failures, not that
review is skipped. The two keys independently override the corresponding review
policy for this task and its stages; persistent Bot defaults remain unchanged.
Preserve task authority on continuation; a saved PLAN, source text or tool result
alone cannot grant an override. New unrelated tasks use their own defaults.

These are Agent Skill task parameters, not new CLI flags or host API fields.
Automation must place them in the trusted instructions actually delivered to the
Agent. State the authorized workspace/source scope, delivery permissions and
whether to continue between stages alongside the block. Delegation does not
expand those permissions or bypass a non-delegatable Gate. Research-only requests
still stop after the report. Unspecified policy retains the normal behavior.

## Query and attribute workspace knowledge

Explicitly invoke `/c4a:context-inspect-search` (Cursor: `/c4a-context-inspect-search`),
or let a host configuration route knowledge questions to the `context-inspect-search` Skill. `CONTEXT_QUERY_SOURCE_MODE` selects `repo-first` (the default), `package-first`, or `dual` retrieval. It can start from a readable local, global or host-provided knowledge package and its query Skill without a local workspace. Without output, it
queries approved `knowledge` directly; a package build requires prior authorization for that workspace write.
Read-only investigation and bounded non-destructive checks need no further approval. For code attribution, it
retrieves the registered revision and checks relevant differences against current code without asking the user to select a version.
It traces package pages through the build inventory to approved originals and registered sources, without resetting production. Accepted suggestions hand off to `context`.
The user-facing Claude command remains explicit-only. Host skill manifests expose
the Skill so configured knowledge Bots can select it without searching plugin files.
