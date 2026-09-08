# Diagnose and recover

This is the page shape for one operational situation. Use it as an outline, not a
form to fill.

## Section blueprint

```markdown
## <the symptom, as an operator first encounters it>
- Symptom: what is observed, including the actual message or signal
- Confirm: how to tell this case apart from ones that present the same way
- Act: the ordered steps, with anything irreversible marked as such
- Verify: how to know recovery actually worked
- Escalate: who or what to fall back on when the steps do not resolve it
```

`Symptom` and `Act` are required; a page missing either is not usable under
pressure. `Verify` is the section most often dropped and the most consequential:
an unverifiable recovery invites an operator to declare success early. When the
discussion never says how recovery was confirmed, record that as a gap rather
than inventing a check. Omit `Escalate` when no fallback is known.

A troubleshooting session is mostly attempts that did not work. Only what
actually resolved the situation belongs in `Act`, and only in the order that was
actually effective — not the order people tried things. A step someone suggested
mid-discussion and nobody ran is not part of the procedure; if it is worth
keeping, it is a hypothesis, not an instruction.

Watch for the case where the incident resolved and nobody established why.
Participants often settle on a cause by agreement rather than by evidence. Keep
that out of `Confirm`, because a guessed discriminator sends the next operator
down the wrong path while a real incident is running.
