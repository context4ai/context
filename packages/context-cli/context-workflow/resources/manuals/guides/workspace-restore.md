---
id: context.sdk.workspace-restore
kind: procedure
mediaType: text/markdown
---

# Restore a historical workspace version

Use the Agent's Git and environment tools. This restores selected workspace
files and usable sources; it does not reset the entire repository, rewind source
repositories, or restore ignored runtime progress.

## Resolve the target

Locate the workspace and Git root, then inspect history for that workspace path.
With no explicit target, select the most recent commit saving its state to undo
uncommitted results. “Previous version” instead selects the preceding relevant
saved state, not mechanically `HEAD~1` of a large repository. Validate an explicit
SHA. For dates, use the user's timezone and actual meaning (for example, as of
end of that day), inspect candidate history and resolve ambiguity with the user.
Git history can be nonlinear; do not choose an unrelated branch by timestamp.
The final target is a concrete SHA and path scope, never a date string alone.

Compare target files with current tracked, untracked and staged files. Include
current additions absent at the target in the proposed removal scope. Keep
unrelated files, existing staged work and ignored source checkouts. Account for
workspace moves or renames instead of treating a missing old path as an empty
version. Reuse explicit authorization; ask when the target or loss is unresolved.

## Restore files and environment

Wait for active Context writers and obtain their result. Use the task-state
preview/apply from [workspace preparation](workspace-prepare.md) to abandon the
authorized old work before restoring files; it also clears pending maintenance.
Do not use an old Route after restoration.

Use Git to restore only the agreed paths from the selected SHA. A scoped
`git restore --source=<sha> --worktree -- <paths>` preserves branch history;
decide separately how authorized overlapping staged changes should be handled.
Use explicit deletion for agreed additions absent at the target. Never use a
whole-repository `reset --hard` or `clean -fdx` as a workspace shortcut.

Use the restored source records with the preparation guide to restore pinned
repository versions, module paths, document snapshots and attachments. New remote
content cannot stand in for lost old snapshots. Do not reclone usable sources.
On interruption, inspect the actual file diff and remaining source gaps and
continue those operations; do not assume the previous Git command completed or
replay old task submissions.

Old build output does not describe the restored version. If output is requested,
follow the current close/build or approved-output rebuild capability from the
[knowledge update guide](knowledge-updates.md); do not start full indexing merely
because the restored source configuration is available. Until rebuilt, state
that existing output is stale. If the historical schema is incompatible, diagnose
the available migration or tool-version choice, report necessary adaptations,
and do not pretend incompatible content is current or silently rewrite all pages.

## Verify and stop

Compare the selected files with the target commit, identify any agreed adaptations,
verify unrelated changes/index entries survived, and check source readiness and
absence of old task state. When building was requested, check the new output as
well. If only some sources could be restored, report partial completion with the
specific missing access or version. No automatic commit, branch rewrite or push;
the user may separately [commit the restored results](workspace-commit.md).
