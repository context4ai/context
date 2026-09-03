# Structure, Artifact promotion, and candidate resolution

Plan reader output from source-backed Sections outward. Headings and files are
navigation aids; the stable unit is the reader subject plus its evidence-bound
Sections. Context owns identity derivation, schema validation, layout, paths,
conflict detection, Review, and publication.

## Section first, Artifact when justified

Keep a candidate as a Section by default. A heading, table row, FAQ label,
single warning, short example, or local subtopic is not independently a reader
Artifact merely because it has a title.

Record the semantic boundary decision in conformance reasoning as
`retain-section-group` or `promote-reader-artifact`; these are fixture and
guidance labels, not extra fields in `ArtifactResult`.

Promote source material to a dedicated Artifact when evidence supports at least
one of these boundaries:

- it serves a distinct reader task or projection intent from adjacent material;
- it is independently retrievable outside the surrounding page and carries
  enough context to answer that task without the parent prose;
- it has its own authority, lifecycle, owner, timeline, or cross-cutting scope;
- it is a coherent, substantial unit whose inclusion would make the surrounding
  Artifact mix unrelated reader purposes;
- another Section in the proposed Artifact has an incompatible projection
  intent under the current CLI profile contract.

Do not promote solely because the source has many headings, a recognized label,
or a long table. Do not create thin Artifacts to improve counts. If material has
an independent subject rather than merely a separate reader page, use the
workset's target-resolution choices; never invent a Node identity from a title.

Do not collapse a substantial captured document into a page that only lists its
headings or says the source should be consulted. Preserve supported procedures,
API tables, examples, constraints, compatibility notes, and decisions inside
the selected reader Artifact; remove only navigation chrome, conversion noise,
duplicates, and content with an explicit omission disposition.

Within one Artifact, every Section must use that Artifact's `artifact_kind`.
Start by grouping only Sections with the same exact
`document_kind + reader_goal + artifact_kind` intent. Different intents may be
combined only when the current CLI-provided contract proves they share one
layout destination and the combined page remains one coherent reader task. If
the contract would project them differently, return separate Artifacts; do not
return a path or ask Context to move Sections silently.

## Reading density

Density is a private reading and planning strategy, not Result metadata, a
quality score, or a separate stage.

| Mode | Use when | Authoring behavior |
| --- | --- | --- |
| `macro` | A long source has many major headings or broad topic shifts. | Establish major reader-task boundaries first, then inspect each boundary before producing Sections. |
| `meso` | A normal guide or record has several related sections. | Use meaningful local units and preserve precise evidence spans; this is the default. |
| `micro` | Material is fragmented, note-like, or dense with short independent claims. | Keep evidence windows narrow and avoid bundling unrelated claims into one Section. |
| `single-pass` | A short coherent source can be read completely within the supplied budget. | Avoid over-segmentation while still closing every evidence disposition. |

Markdown headings are planning hints, not hard boundaries. Sibling headings can
remain together when they form one coherent reader answer. Unrelated headings
must split even if a common parent exists. Density never chooses authority,
identity, projection intent, or pass/fail status.

## Candidate resolution

Treat CLI anomaly and existing-target views as constraints on a semantic
decision, not as automatic recommendations. For each candidate, choose one
evidence-backed outcome:

- `accept-correction`: the diagnostic identifies a real ownership, grouping,
  projection, or evidence error; return the corrected Result.
- `dismiss-with-rationale`: the signal is mechanically true but the current
  grouping remains semantically coherent; preserve the Result and state the
  source-backed rationale in the supplied diagnostic surface.
- `keep-unresolved`: evidence cannot distinguish valid alternatives; return the
  registered material question, target-resolution, unsupported, or diagnostic
  disposition instead of guessing.

For duplicates, keep one canonical statement when evidence and reader purpose
are the same. Preserve separate Sections only when each has a distinct
authority, lifecycle, reader task, or evidence boundary. For conflicting facts,
do not pick a winner from file order, heading order, recency without authority,
or polished wording. Use source precedence supplied by the workset; otherwise
keep the conflict unresolved.

When the workset offers target-resolution entries:

- reuse an existing subject only for an exact evidence-supported match;
- create an independent subject only when the evidence supports standalone
  identity and reader value;
- request material when the semantic decision is possible but evidence is
  insufficient;
- return unsupported when the required parser or capability is absent.

The CLI validates subject keys, refs, schema, digests, collision rules, stale
state, and output layout. Do not repair those mechanical failures by changing a
semantic label, creating an alias, or returning a hand-authored path.

## Result check

Before returning an `ArtifactResult`, confirm:

- every actual Section has one registered projection intent and current
  evidence;
- mixed reader intents were evaluated Section by Section;
- every dedicated Artifact clears an evidence-backed promotion boundary;
- every Artifact contains only layout-compatible Sections and one Artifact
  kind;
- density affected only reading granularity, not authority or quality claims;
- duplicates, conflicts, and ambiguous targets have an explicit semantic
  disposition;
- no collection, path, temporary batch identity, or unsupported claim appears
  in the Result.
