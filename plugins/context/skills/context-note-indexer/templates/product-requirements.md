# Expected behavior

This is the page shape for one required behavior. Use it as an outline, not a
form to fill.

## Section blueprint

```markdown
## <the requirement, named by the behavior it demands>
- Expected: the behavior as required
- Accept when: the conditions that make it satisfied
- Today: how the current implementation differs, where that is known
- Undecided: what remains open
```

`Expected` and `Accept when` are required. Keeping `Expected` and `Today` distinct
is the entire reason this profile exists: a required behavior written as a
current one misleads every later reader, and the mistake is invisible once the
page is approved. When no authorized source establishes current behavior, write
that it has not been checked rather than leaving `Today` silently absent.

`Accept when` must be checkable. "Works correctly" is not an acceptance
condition; if the source gives no checkable condition, record that gap — an
untestable requirement will be declared met by whoever wants it met.

A note may record an expectation without recording who required it. State it as
recorded rather than agreed, and keep `Undecided` for anything the note leaves
open. A single participant's expectation is not a commitment, and presenting it
as one creates a requirement nobody actually accepted.
