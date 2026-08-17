## Summary

Describe the problem and the observable behavior introduced by this change.

## Compatibility

Describe any impact on workspaces, source snapshots, approved knowledge, package output, CLI JSON, SDK consumers, or Agent workflow contracts. Write `None` when there is no compatibility impact.

## Verification

List the commands and focused scenarios used to verify the change.

## Checklist

- [ ] `bun run verify:full` passes.
- [ ] Lifecycle changes include route and recovery tests.
- [ ] Published package metadata and local pack behavior were checked when affected.
- [ ] English and Simplified Chinese user documentation remain behaviorally equivalent.
- [ ] Runtime code remains compatible with Node.js 20+.
- [ ] No generated output, secrets, private sources, or local workspaces are included.
