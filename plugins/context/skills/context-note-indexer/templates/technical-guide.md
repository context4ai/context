# Complete the task

This is the page shape for one repeatable task. Use it as an outline, not a form
to fill.

## Section blueprint

```markdown
## <the task, named by what the reader accomplishes>
- Goal: the end state the reader reaches
- Before you start: prerequisites, permissions and required prior state
- Steps: ordered, each one with an observable outcome
- Check: how the reader knows the task succeeded
- When it fails: the failures actually encountered, and what to do about them
```

`Goal`, `Steps` and `Check` are required. A step whose outcome the reader cannot
observe is not a step — either give what it produces or say the outcome is
unknown. `Before you start` is required whenever a missing prerequisite would
fail the task partway; omitting it turns a guide into a trap. Keep `When it
fails` to failures the sources actually record, not imagined ones.

Do not invent step ordering, and do not fill gaps with generic advice such as
"check your configuration". A guide with three verified steps and one stated
unknown is more useful than five steps where two are guesses.

A note may capture a task someone performed once, in their environment. State
the environment it was performed in when the note gives it, and record it as
missing when it does not. A procedure that worked on one setup is not yet a
general procedure, and saying so is what lets the next reader trust the parts
that are solid.
