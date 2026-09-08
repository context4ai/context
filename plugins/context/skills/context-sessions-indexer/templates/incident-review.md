# What happened and what changes

This is the page shape for one incident. Use it as an outline, not a form to
fill.

## Section blueprint

```markdown
## <the incident, named by its impact rather than its date>
- Impact: who or what was affected, and for how long
- Sequence: what happened, only to the detail that explains the outcome
- Cause: established causes, kept separate from hypotheses still open
- Changed: what was actually changed as a result
- Change discussed: the associated change, where a reader needs to check it
- Still open: follow-ups that have not landed
```

`Impact` and `Cause` are required. A hypothesis stays labelled as one for as long
as it is unconfirmed; an unlabelled guess in `Cause` is the failure mode this
profile exists to prevent. Keep `Sequence` only as long as it explains the
outcome — a troubleshooting discussion contains many attempts, and reproducing
them in order is not an explanation.

Separate what was tried and failed from what actually resolved the incident.
Under `Changed`, a remediation someone proposed during the discussion is not a
change; proposals belong in `Still open` until an authorized source shows they
landed. The same distinction applies to causes: "we think it was the cache" from
mid-discussion is a hypothesis even when the incident later resolved.

`Change discussed` renders the source's optional `changes` association as readable
prose, for a reader who needs to open the fix and see it. It does not establish
that the fix shipped or worked; keep it out of the page frontmatter.

A session records the incident as the participants understood it at the time.
Where their account cannot establish impact or cause, record that gap rather than
completing the story — a review that reads as resolved while its cause is
unknown is the version people stop questioning.
