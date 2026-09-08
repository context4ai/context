# Expected behavior

This is the page shape for one required behavior. Use it as an outline, not a
form to fill.

## Section blueprint

```markdown
## <the requirement, named by the behavior it demands>
- Expected: the behavior as agreed
- Accept when: the conditions that make it satisfied
- Today: how the current implementation differs, where that is known
- Change discussed: the associated change, where a reader needs to check it
- Undecided: what the discussion left open
```

`Expected` and `Accept when` are required. Keeping `Expected` and `Today` distinct
is the entire reason this profile exists: a requirement agreed in a discussion
written as current behavior misleads every later reader, and the mistake becomes
invisible once the page is approved. When no authorized source establishes current
behavior, write that it has not been checked rather than leaving `Today` absent.

`Accept when` must be checkable. Requirements clarified in conversation often
arrive as intent — "it should retry" — with no condition attached. If the
discussion gives no checkable condition, record that gap; an untestable
requirement will be declared met by whoever wants it met.

Distinguish what participants agreed from what one participant proposed. An
unanswered suggestion is not a requirement, and `Undecided` is where it belongs.
A requirement agreed for a future release coexists with current behavior that
does not satisfy it; keep both, and keep them labelled.

`Change discussed` renders the source's optional `changes` association as readable
prose, for a reader checking how far the requirement has been carried. It does
not establish that the requirement is met. Keep it out of the page frontmatter.
