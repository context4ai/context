# Context Agent Integration

[简体中文](./README_CN.md)

This directory is the only human-maintained source for the Context Agent
integration. It contains the single Context entry Skill, the Code and Markdown
Indexer Provider Skills, host manifest templates, and shared assets.

Run `bun run --filter @c4a/context-cli build:plugin` to regenerate the npm
projection and the committed `repo-install/` tree. Do not edit generated files
under `repo-install/` or `packages/context-cli/dist/plugins/`.

`repo-install/{claude,codex,cursor}/` contains host-specific plugin roots with
only the public Context entry; `repo-install/skills/` is the portable Skill
projection. In the same install, `context plugin install` projects Providers
to the Codex/Cursor shared `~/.agents/skills` directory and Claude's
`~/.claude/skills`, so Provider names do not inherit a plugin namespace.

The conversational entry delegates workspace state and lifecycle authority to
the local `context` CLI. Indexer Skills are activated only through the verified
Context workflow and Indexer Provider lifecycle.
