# The choice and why

This is the page shape for one adopted choice. Use it as an outline, not a form
to fill.

## Section blueprint

```markdown
## <the decision, named by what it settles>
- Decision: the choice as adopted
- Status: proposed, agreed, implemented or verified — and what establishes it
- Because: the reasons that actually drove the choice
- Instead of: alternatives considered, and why each lost
- Applies to: the scope, version or platform the decision governs
- Change discussed: the associated change, where a reader needs to check it
- Open: what the discussion explicitly did not settle
```

`Decision`, `Status` and `Because` are required — a choice without its reasons
cannot be re-evaluated later, which is the only reason this page exists. List an
alternative under `Instead of` only when it explains the choice or prevents
someone repeating a failed approach. Keep `Open` whenever the discussion left
something unresolved that a reader would assume was closed.

`Status` follows the evidence, not the tone of the last message. `agreed` needs
explicit confirmation by the relevant decision maker, or a summary that records
that confirmation with attribution. Silence and an Agent declaring agreement do
not establish approval. `implemented` needs supporting code or maintained
material in authorized scope; `verified` needs an actual relevant result.
Attribute reported outcomes as reports. Explain the distinction where it changes
what a reader can rely on, without requiring a separate status audit.

`Change discussed` renders the source's optional `changes` association as readable
prose — a repository, commit or MR link a reader can open to check the change
itself. Include it when the decision is about a specific change and a reader would
otherwise have to go looking. Leave it out when the association adds nothing, and
never put it in the page frontmatter: the source holds that metadata, and the
structure relationship already links the page to the source. A change link states
what was discussed; it does not establish that the change merged, deployed or
passed its tests, so it can never be the thing that establishes `implemented`.

A discussion that ended without a decision does not produce this page. Save the
source and say so.
