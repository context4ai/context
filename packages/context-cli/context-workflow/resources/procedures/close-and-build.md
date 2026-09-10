---
id: procedure.close-and-build
kind: procedure
mediaType: text/markdown
---

# Close and build

At completed-scope delivery, follow the version-recording Route. The coordinator
writes the semantic changelog from formal diffs and the conversation, including
the triggering source and an explicitly known user (Git name is the default).
Record after Close and package/template approval, before the final build, so the
selected outputs are built with the new version once. Build records hashes without
increasing versions. Never count temporary progress or a build retry as a change.

Before an authorized external publication, run `context version publish-check
--format json`. If `needs_version` is true, inspect with `context version inspect
--publish --format json`, record a patch changelog using a `dist` trigger, and
rebuild. Do not increment again if the workspace version already changed.
If `unchanged` is true, there is no new delivery. Only after a successful external
publication, use `context version published --hash <checked-hash> --receipt
<successful-publication-reference> --format json`. Failure does not advance that
baseline. These commands do not upload, publish or grant publishing authority.

Close deterministically reconciles approved Markdown and current relationship
inputs into `knowledge/structure.yaml`. It compacts repeated machine fields out
of each Markdown page and validates the hydrated result. When an approved page
still points at a captured source asset, close may mechanically replace that
target with its content-addressed `knowledge/assets` path; it does not rewrite
reader-visible prose. Candidate fingerprints, Section mappings, old prose
`source_inputs`, and Review receipts remain outside long-lived knowledge.

Do not hand-edit, duplicate, or move fields between Markdown and
`structure.yaml`. The CLI owns compaction and hydration. A compact Markdown page
remains readable and keeps enough identity for projection diagnostics; complete
code lifecycle metadata is intentionally not duplicated.

Build runs only after close and verification are current. It writes declared
packages under `dist/` and records an inventory receipt with added, updated,
removed, and index changes.

Follow the returned continuation. Automatic execution runs mechanical close and
build steps and re-evaluates the Graph after each step. Recommended diagnostic
resources are optional; do not materialize or acknowledge them merely to run an
immediate repair command. While a command is running, wait for its result using
the existing process handle; inspect logs only to diagnose an actual failure or
suspected stall, not as a routine prerequisite for progress. A successful build
means the currently declared scope is current; newly captured or newly declared
targets can reopen earlier graph nodes.

The final completion summary must cover the built outputs, validation status,
knowledge scale, and unresolved issues. Add a compact `Review reports` section with every
exact HTML report URL or local report path that the user actually used for a
review decision in this conversation, together with its reviewed scope. Omit
the section when no report was user-reviewed. Do not reconstruct it by scanning
`.tmp`, invent a shareable URL, or classify fully managed or force approval as
user review.

Report every selected output separately: KB root, website `dist/<base>-site/`,
and LLMS file when selected. Distinguish generated, failed and not selected; do not
claim the whole delivery complete if a selected channel is missing. For a website,
include a local preview command (or a URL only after verifying the server), reading
navigation coverage, and the directory a separate hosting tool would deploy.
Preview example: `python3 -m http.server 8000 --bind 127.0.0.1 --directory dist/<base>-site/`.
Provide this command without starting a server unless the user requests a running
preview. Use the build receipt for output paths and validation results; extra
HTTP probes, ad hoc manifest queries and another verify are diagnostic tools,
not mandatory version-recording or successful-build steps. Follow the returned
Route directly instead of polling status after every successful action.
Explain that users may request website output later; it reuses existing approved
articles rather than requiring a new workspace or full source indexing.

## Website deployment handoff after every successful build

After every successful website build, including intermediate delivery and an
unchanged output reused by build, tell the user the website can be deployed with
a deployment skill. Include the actual `dist/<base>-site/` directory and whether
it contains only the currently delivered scope. This notice does not wait for the
whole knowledge task to finish and does not block its next Route.

Reuse existing publishing configuration and the user's chosen target. Otherwise,
inspect the available deployment skills, recommend a compatible static-site skill,
or let the user specify one. Do not invent installed skills or a deployed URL.
If no compatible skill is available, report that and provide the site directory
for the user's deployment tool. Do not install a deployment dependency by default.

When publishing is already authorized for that target, follow the selected skill
with the built site directory; otherwise offer deployment and wait for the user's
publishing instruction. Preserve the configured base path; rebuild if the target
requires a different base. Pass only the website output, not sources, private
workspace state or the entire KB package. Report success only after checking the
hosting result and published URL. A failed deployment leaves the local build valid;
report the deployment failure and its next step separately.
