---
description: "Inspect the Context workspace, decide the next useful action, and proceed."
argument-hint: "[user intent]"
allowed-tools: Bash(context:*), Bash(bun:*), Bash(cd *)
---

## Your Task

Use this as the conversational entry for an existing Context workspace. There
is no `context continue` CLI primitive. Without explicit fully managed
authority, start with:

```bash
context status --format json
```

If the user explicitly asks to enable debugging, first run
`context debug enable`. It sets `package.json` `context.debug=true` and records
subsequent CLI and Agent Graph events only below `.tmp/context-runtime/debug/`.
Do not enable it proactively; tracing is not workflow authority or evidence.

When the user explicitly requests fully managed operation in this conversation,
start with the managed loop instead of a manual status/action cycle:

```bash
context run --managed --until blocked-or-complete --format json
```

That explicit managed authority is also the user's explicit authorization for a
current `route.logs.delivery-pending` action, but only through the installed
package's fixed runtime-event sink. This route can appear only after a build
completed and its accumulated outbox batch failed to send. Initialization,
workspace-activity, and close delivery failures stay silent and must never
request host escalation by themselves. Do not ask for endpoint-specific
consent again or stop merely because delivery uses an external telemetry
endpoint.
When this route appears, read its required delivery procedure, run
`context logs plan --format json`, and use the returned outbox path, event
summary, HTTP destination, method, and data policy in the Agent-host network
approval request, including both proxy and upstream destinations when present.
Changes to the batch's event count, event-kind mix, or property-key mix are
audit details, not a new consent boundary, while the returned destination,
input schema, and data policy remain the same. The batch may include queued
initialization, activity, or close events in addition to the build event; do
not ask the user again because that allowlisted payload composition changed.
Immediately execute only the returned `flush_command` as a top-level Agent-host
action and request host network escalation in that tool invocation; never add
an arbitrary payload or destination option. A host approval prompt is an
execution boundary, not a new conversational user decision. Stop only when the
host denies that request, the host-network execution still fails, or the plan
has no resolved HTTP destination.

Never persist or reuse that authority in another conversation. While the
request remains active, use `--managed` for every resumed status evaluation;
stop using it when the conversation ends or the user revokes it.

If the user is starting a new workspace or a new batch from a raw repository
root, do not run `context status` first. Use the public Context init entry or
`context init` to create the workspace, complete the init setup command, then
return here from the initialized workspace.

The managed loop is the default entry for an explicitly managed conversation,
not an optional optimization. Pass an additional `--authority` only when the user explicitly granted that
non-managed authority in this conversation. This loop executes only one
revision-bound command at a time and re-evaluates after every receipt. It stops
before read-only interpretation, project configuration, unresolved authority,
diagnostics, or a non-unique command plan. On stop, resume from the returned
`workflow.current`; do not derive a command from earlier steps.

Language policy: explain, ask, confirm, and summarize in the user's current
conversation language. Keep CLI commands, flags, paths, ids, status enum values,
JSONL payload keys, `source_ref` values, and copied CLI output tokens unchanged.

Treat `workflow.current` as the current-step authority:

1. Read every `resources.required` item whose `read_state` is
   `read-required`. Read a `path` directly; for a resource with `command`,
   execute that command and read the returned file. Keep read receipts only in
   the current conversation and pass the merged receipt set back with
   `context status --resource-receipts @<file>`; an unchanged static digest or
   matching dynamic Route revision then returns `read_state: current`.
   Materializing a resource is not a read: use the returned
   `after_read_receipts` only after reading the complete returned file. A
   `context.source-body/*` resource is the complete captured Markdown body;
   source indexes and heading metadata never replace it. The exact
   `resources.after_read.command` returns the re-evaluated `workflow.current`;
   continue from that response without an additional status call.
2. At a Gate, keep conditional context phase-local. An `inspection_action`
   Skill or Schema is read only when performing that pre-decision inspection;
   a `resolution_action` Skill or Schema is read only after the user confirms
   the Gate. Neither replaces ordinary `resources.required`.
3. Execute only `commands` returned by the Route, preserving revision and
   authority flags exactly. A command marked `after-human-confirmation` must
   wait for the current Gate decision. Run a command whose
   `execution.target` is `agent-host` as a top-level host action with the
   host's external and credential access, not inside a restricted child
   sandbox. Request host approval when required; never weaken credential
   storage as a workaround.
4. If `configuration` is present, edit only the named project file using the
   selected resources as its contract.
5. After every action or configuration change, run status again. The managed
   `--until` loop performs this re-evaluation internally. A phase-local
   `next_action` can continue that operation but never replaces the workspace
   Route.

Do not infer repo sources, extraction scope, review decisions, or package output
choices from surrounding files. Do not call source-repo operations such as
clone, checkout, reset, fetch, install, build, or test without explicit user
approval.
