---
name: context-purge
description: >
  Permanently delete all archived dropped source/knowledge artifacts after confirmation. Equivalent to Claude /context:purge; use the local `context` CLI for workspace writes.
tools:
  - Bash
---

# Purge

Public C4A Context entry for agents that expose skills instead of Claude slash commands.

- Public entry: `context-purge`
- Claude equivalent: `/context:purge`
- CLI primitive prefix: `context ...`
- Internal procedures live under `references/internal-procedures/`; read each referenced file in full before following that step.

---

## Workflow

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
