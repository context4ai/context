# Workspace debug tracing

Context debug tracing is an explicit, workspace-local observation mode. It is
disabled by default. It does not change Agent Graph facts, route selection,
human gates, command eligibility, lifecycle writes, or command exit status.

Enable it while initializing a workspace:

```bash
context init context --debug
```

Or enable it later:

```bash
context debug enable
```

Both forms set `package.json` `context.debug` to `true`. Disabling tracing
removes that property but keeps the existing trace for inspection:

```bash
context debug disable
```

## Files

Tracing writes only below the ignored workspace `.tmp` directory:

```text
.tmp/context-runtime/debug/
├── events.jsonl
├── state.json
└── replay.json
```

- `events.jsonl` is the append-only source of truth. Each line conforms to
  [`context.debug.event.v1`](./context-debug-event-v1.schema.json).
- `state.json` owns the trace id, monotonic sequence, and last observed graph
  state. It is recorder state, not workflow state.
- `replay.json` is a disposable projection produced by `context debug export`
  and conforms to [`context.debug.replay.v1`](./context-debug-replay-v1.schema.json).

No command stdout, source body, knowledge page, or resource body is copied into
the trace. Sensitive option values are redacted. Command receipts contain only
status, duration, byte counts, and hashes already available to the managed
runner.

## Event model

The event stream records:

- CLI invocation and completion, including parent invocation identity for
  managed child commands;
- Agent Graph evaluation revision, status, selected route, alternatives, and
  whether the observable graph position changed;
- managed workflow action start and completion with deterministic receipts;
- the reason and graph position at which a managed loop stopped.

`trace_id` groups the workspace-local debug history, `sequence` defines replay order,
`invocation_id` groups work performed by one CLI process, and
`parent_invocation_id` connects managed child commands to their runner. A UI
can animate `agent-graph.evaluated` events whose `data.transition.changed` is
true, then associate intervening command and action events by sequence and
invocation identity.

## Inspect and export

```bash
context debug status --format json
context debug export --format json
```

Status returns configuration, event counts, and relative trace paths. Export
mechanically derives a replay document containing the complete event stream and
its changed graph transitions. A custom export path must remain below the
workspace `.tmp` directory:

```bash
context debug export --output .tmp/analysis/replay.json --format json
```

Recorder failures are intentionally non-fatal. They can make a trace
incomplete, but they cannot alter the command being observed. Consumers should
therefore validate monotonic `sequence` values before presenting a replay as
complete.
