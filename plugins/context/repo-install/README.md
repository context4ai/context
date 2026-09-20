# Context Agent Integration

> This directory is generated; do not edit it directly. Paths below are relative to the source repository root. Edit `plugins/context/README.md` for this documentation.

[简体中文](./README_CN.md)

`plugins/context/` is the only human-maintained source for the Context Agent
integration in this repository. It contains the Context production and host-routable context-inspect-search Skills, the Code, Markdown, Note and Sessions
Indexer Provider Skills, host manifest templates, and shared assets.

Run `bun run --filter @c4a/context-cli build:plugin` to regenerate the npm
projection and the committed `plugins/context/repo-install/` tree. Do not edit generated files
under `plugins/context/repo-install/` or `packages/context-cli/dist/plugins/`.

`plugins/context/repo-install/{claude,codex,cursor}/` contains host-specific plugin roots with
production, explicit query and Indexer creation entries; `plugins/context/repo-install/skills/` is the portable Skill
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


## Query and attribute workspace knowledge

Explicitly invoke `/c4a:context-inspect-search` (Cursor: `/c4a-context-inspect-search`),
or let a host configuration route knowledge questions to the `context-inspect-search` Skill. It can start from a readable local, global or host-provided knowledge package and its query Skill without a local workspace. Without output, it
queries approved `knowledge` directly; a package build requires prior authorization for that workspace write.
Read-only investigation and bounded non-destructive checks need no further approval. For code attribution, it
retrieves the registered revision and checks relevant differences against current code without asking the user to select a version.
It traces package pages through the build inventory to approved originals and registered sources, without resetting production. Accepted suggestions hand off to `context`.
The user-facing Claude command remains explicit-only. Host skill manifests expose
the Skill so configured knowledge Bots can select it without searching plugin files.
