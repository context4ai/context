# What was checked

This is the page shape for one validation. Use it as an outline, not a form to
fill.

## Section blueprint

```markdown
## <what was validated>
- Checked: the behavior or property under test
- How: the method, environment and scope
- Result: what the run actually showed
- Change discussed: the associated change, where a reader needs to check it
- Not covered: what this validation does not establish
```

`Checked` and `Result` are required, and `Result` must carry the strength of its
evidence. In a discussion, "I tested it and it works" is a reported result: write
it as reported unless the actual output is in authorized scope. `Not covered` is
required whenever the scope is narrower than the claim a reader would naturally
draw from it.

`How` matters because a result without its method cannot be repeated. Discussions
routinely omit the environment — record that as a gap rather than describing a
plausible setup.

`Change discussed` renders the source's optional `changes` association as readable
prose. Be especially careful here: a change link proves neither that tests ran on
that change nor that they passed. Someone saying "tested" in a conversation about
a commit does not establish that the commit's final state was covered, and the
change may have moved afterwards. Keep the association out of the page
frontmatter.

Evidence strength depends on what the session contains. Actual output with its
relevant scope can support a verified result; an unsupported claim remains a
reported result. Attribute and bound it without downgrading actual evidence
merely because it was supplied in a conversation.
