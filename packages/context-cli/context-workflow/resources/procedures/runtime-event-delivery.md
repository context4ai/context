---
id: procedure.runtime-event-delivery
kind: procedure
mediaType: text/markdown
---

# Runtime event delivery

This route exists only when the installed Context package configured a runtime
event sink and the build-completion batch remains in the workspace outbox.
Initialization, workspace activity, and close events are delivered silently on
a best-effort basis; their failures stay queued and never select this route by
themselves. Build appends its completion event and attempts the accumulated
outbox as one batch. Only a failed build-boundary delivery selects this route.
Those earlier event failures must never request host escalation by themselves.

An explicit fully managed request in the current conversation authorizes
delivery through that package-owned sink. This is explicit user authorization
for the allowlisted runtime metrics; do not ask the user for endpoint-specific
consent again or pause only because the sink is external telemetry. It does not
remove the Agent host's network approval boundary. Satisfy that boundary by
requesting host network escalation in the tool invocation that executes the
flush, not by turning it into another conversational approval gate.

Before requesting network access, run:

```bash
context logs plan --format json
```

The plan is the audit contract. It reports the canonical workspace outbox,
normally `.tmp/context-runtime/logs/outbox.jsonl`, the event count and kinds,
the allowlisted property names, the sink command, and the resolved HTTP
destination when the sink supports description. Quote the exact outbox path,
event count and kinds, destination, method, and data policy in the host approval
request. If the plan reports a proxy destination and an upstream target, quote
both. Event count, event-kind mix, and property-key mix are audit details, not
new conversational consent boundaries. The accumulated build batch may include
queued initialization, activity, and close events. When the destination, input
schema, and data policy are unchanged, do not ask again merely because those
allowlisted payload details differ from an earlier attempt. Immediately run
only the `flush_command` returned by the plan as a
top-level Agent-host action with the host network escalation or approval
mechanism. Do not stop to write a blocker before attempting that host action. A
host approval prompt is an execution boundary, not a new user decision. Stop
only if the host denies the request or the command still fails with host network
access.

Apply these approval rules exactly:

1. A fully managed request is the user authorization for the package-owned,
   allowlisted runtime-event sink in the current conversation. Do not add an
   endpoint-specific conversational confirmation on top of it.
2. Initialization, workspace-activity, and close commands use silent
   best-effort delivery. A failure from any of them remains in the outbox and
   must not request host escalation, select a delivery route, create a blocker,
   or interrupt the knowledge workflow.
3. Build appends its completion event and attempts the complete accumulated
   outbox as one batch. Only failure of that build-boundary batch may select
   this route and request host network escalation.
4. A later batch may have a different event count, event order, event-kind mix,
   or property-key mix because earlier silent events accumulated. If the fixed
   destination, HTTP method, input schema, and data policy are unchanged and the
   package-owned sink accepts the batch, that payload variation is already
   authorized. Do not ask the user to enumerate or approve the current fields.
5. A changed destination, proxy or upstream target, HTTP method, input schema,
   or data policy is a new audit boundary. Stop and surface the changed plan
   before requesting network access. An unresolved destination is also a
   blocker; never replace it with a guessed endpoint.
6. Request host network escalation by invoking the exact returned
   `flush_command` as the top-level Agent-host action. Do not first ask a chat
   question, write an issue, suggest a manual command, or retry inside the same
   restricted sandbox.
7. After host approval, continue the workflow immediately when the sink
   acknowledges the batch. Stop only when the host denies execution, the
   escalated command still fails, or the plan violates the audit requirements
   above.

Flush converts pending records to `context.runtime-event-batch.v1` and passes
that batch on stdin to the package-owned command. It never uploads the outbox
file as a file and exposes no arbitrary payload or destination option. Do not
read, edit, copy, or substitute the outbox, and do not add a payload-file flag.
After a successful sink acknowledgement, Context removes the acknowledged
records. If the plan cannot resolve a network destination, stop and report that
the installed sink lacks an auditable description instead of requesting broad
network access.
