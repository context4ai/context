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
- Still open: follow-ups that have not landed
```

`Impact` and `Cause` are required. A hypothesis stays labelled as one for as long
as it is unconfirmed; an unlabelled guess in `Cause` is the failure mode this
profile exists to prevent. Under `Changed`, a remediation someone proposed is not
a change — proposals belong in `Still open`. Keep `Sequence` only as long as it
explains the outcome; a minute-by-minute replay is not an explanation.

A note records an incident from one vantage point, often written afterwards from
memory. Attribute observations to what was actually seen, keep the reported
timing as reported, and do not smooth a partial account into a complete
narrative. Where the account cannot establish impact or cause, record that gap:
an incident page that reads as resolved while its cause is unknown is worse than
one that states what is still unexplained.
