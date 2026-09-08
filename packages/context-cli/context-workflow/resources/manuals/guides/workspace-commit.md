---
id: context.sdk.workspace-commit
kind: procedure
mediaType: text/markdown
---

# Commit workspace results

Use Host Git tools, not an invented Context commit command. Commit only when
the user requests it; fully managed production does not itself authorize Git
commits or pushes. At the end of the entire requested production scope, after
close and all requested builds with no pending tasks, a single optional commit
suggestion is enough. Intermediate delivery is not that endpoint.

## Select the files

Locate the Context workspace and its actual Git root. Inspect status, staged
changes, unstaged changes, untracked files and ignore rules. In an embedded
workspace the Git root may be a much larger source repository. Explicitly select
workspace files; never run blanket `git add -A` or commit the entire staged index.
Check source records for required recovery information; a commit does not bundle
ignored checkouts or runtime progress. Do not force-add ignored files or assume
`dist` belongs in Git. Generated files are included only if the project's rules
and selected scope require them.

If there is no Git repository, establish the intended repository location before
initializing one. If nothing changed, report that no commit is necessary. If the
user asks for an intermediate snapshot, explain which saved files it contains
and that it cannot resume ignored Author state from Git alone.

## Commit the selected change

Summarize the actual change and choose a message consistent with repository rules.
Use precise paths and Git's scoped commit facilities or a carefully isolated
index. `git commit --only -- <paths>` can exclude unrelated staged files; new files
must first be known to the index. Inspect overlapping partially staged files
before selecting this approach: do not silently include changes the user did
not select. Preserve unrelated staged entries, including staged deletions.

Git identity, hooks, signing, conflicts and permissions are environmental
issues for the Agent to diagnose. Do not disable hooks or signing, rewrite global
Git configuration, stash other work or bypass ignore rules to force success.
Use an available authorized alternative or report the specific blocker.

## Verify the result

Read the actual commit SHA and its changed files/diff; compare against the
selected scope. Verify unrelated worktree and index content remain unchanged.
If a hook changed the result, inspect and report it before claiming completion.
Report the SHA and a brief description. Do not push, publish or create a remote
repository without the corresponding explicit request.
