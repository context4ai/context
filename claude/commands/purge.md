---
description: "Permanently delete all archived dropped source/knowledge artifacts after confirmation."
argument-hint: "[--yes]"
allowed-tools: Bash(context:*)
---

## Your Task

Purge the workspace archive. This is destructive: it deletes all restorable
source/knowledge artifacts created by `context drop --apply-plan`.
It does not modify active sources or active knowledge.

It does not delete compile/align scratch archives. Those are kept under the
output lifecycle so prior agent inputs remain inspectable; clean them
manually or via a future output-retention policy, not with `context purge`.

Run `context purge $ARGUMENTS`. If `--yes` is absent, the CLI prints a summary
and asks for confirmation. Relay that summary in the user's language and do not
try to inspect archive storage yourself.

Never Read / Glob / Grep / Write workspace files directly. All workspace access
goes through semantic CLI commands such as `context purge` and `context source`.
