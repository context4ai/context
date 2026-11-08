# Align Context versions

Do this once per session when entering production in a workspace (before the
first production Route), and at the start of every routine update. Status
questions, discussion and knowledge queries skip it. Reuse the result for the
rest of the session.

## Read the versions

- Skill: the entry Skill's line "This Skill ships with Context <version>".
- CLI: `context --version`.
- Workspace SDK: the `@c4a/context` version pinned in the workspace
  `package.json`, and the installed one in `node_modules/@c4a/context/package.json`.
- Releases: `npm view @c4a/context-cli versions --json`. Ignore pre-releases.

## Choose the target

The current major version is the workspace SDK's major (the CLI's major before a
workspace exists). The target is the latest release with that major. Never
downgrade: a part already newer than the target stays as it is and is reported.

When a release with a higher major exists, do not move to it. Continue with the
target, and add a decision for the user: the latest release of the current major
and of the newest major, the main changes and migration steps between them from
their changelogs, the expected impact on this workspace, and a recommendation.
Move to the new major only after the user chooses it.

A host minimum version that needs a higher major is the same decision: report it
and wait for the user instead of crossing the major.

## Align

1. CLI below the target: `npm install -g @c4a/context-cli@<target>`, then
   `context --version`. Discard Routes and commands from the old CLI and get a
   new Route; runtime state from older versions stays readable.
2. Skills below the CLI: when they were installed by `context plugin install`,
   run it again and re-read the entry Skill before continuing. When the host
   supplies them (for example a pinned Agent plugin), leave them, continue and
   report the gap so the host can update.
3. Workspace SDK below the target: set the `@c4a/context` dependency in
   `package.json` to the target, install with the workspace's package manager
   (`bun install` for a Bun lockfile) and check the installed version. Keep the
   change with the next delivery: commit it with that batch and add an
   "Upgrade Context SDK to <target>" line to its version entry. Do not commit or
   publish it on its own. In a fresh sandbox the next run repeats it until a
   delivery includes it.

If the release list cannot be read or an installation fails, do not retry: keep
the current versions, report the problem once and continue when they still work.

## Report

State the versions found, what was upgraded and any pending major-version
decision or host-supplied Skill gap.
