---
description: "Initialize a Context knowledge workspace."
argument-hint: "[project-dir] [--name <name>] [--language en|zh-CN] [--debug]"
allowed-tools: Bash(context:*), Bash(bun:*), Bash(cd *)
---

## Your Task

Initialize a Context workspace with the global CLI, complete the returned setup
step, then hand control to the current workflow route.

Use the user's language for conversation. Keep command and payload tokens
unchanged.

Run `context init [project-dir] [--name <name>] --language <language>`. Use the
user's explicit language choice when present; otherwise pass `zh-CN` for a
Chinese conversation and `en` for an English conversation. This explicit CLI
value controls generated workspace instructions and starter templates. Never
substitute `.` when `project-dir` was omitted; the default is `context/`. Use
`--dev` only for an explicitly requested local-link test.
Add `--debug` only when the user explicitly asks to trace this workspace. Debug
mode is otherwise off by default.

If init reports `init-target-nonempty`, explain that existing files would share
the workspace root. Run the returned `--allow-nonempty` command only after
explicit confirmation.

Execute the returned setup command, enter the project root, and read its
generated `AGENTS.md`. Then run `context status --format json`, adding
`--managed` only for fully managed operation explicitly authorized in this
conversation. Treat `workflow.current` as authoritative: read its required
resources, execute only exact commands, honor unresolved human gates, and
reevaluate status after each action.

Do not add extra project-local agent setup or infer sources from the surrounding
monorepo.
