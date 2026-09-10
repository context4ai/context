# What was checked

This is the page shape for one validation. Use it as an outline, not a form to
fill.

## Section blueprint

```markdown
## <what was validated>
- Checked: the behavior or property under test
- How: the method, environment and scope
- Result: what the run actually showed
- Not covered: what this validation does not establish
```

`Checked` and `Result` are required, and `Result` must carry the strength of its
evidence. A report that something passed is a reported result until the actual
output is in scope; write "reported as passing" rather than "passes". `Not
covered` is required whenever the scope is narrower than the claim a reader would
naturally draw — a check on one platform does not validate the others.

`How` matters because a result without its method cannot be repeated or trusted;
when the source omits the environment or scope, record that gap instead of
describing a plausible setup.

A note may record a validation second-hand: someone said they checked it. That
establishes the claim was made, not that the check occurred. Keep the attribution
visible and do not upgrade a remembered check into a verified result.
