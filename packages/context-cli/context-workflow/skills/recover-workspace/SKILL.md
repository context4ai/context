---
name: context-recover-workspace
description: Recover a stuck existing Context task through the independent diagnostic and scoped recovery commands. Internal entry selected by Context recovery intent; usable even when normal Graph evaluation fails.
---

# Recover a Context workspace

Read [the recovery procedure](../../resources/procedures/task-recovery.md).
Start with `context task recover --format json` in the intended existing workspace,
without a historical workflow revision. This read-only inspection does not invoke
normal status, source parsing, project entry execution or Graph evaluation.
Use the reported operations and current digests, preserving approved work.

If no safe operation succeeds, use [the issue template](../../resources/templates/recovery-issue.md)
to write a sanitized `issue/YYYY-MM-DD-short-description.md` in the workspace.
