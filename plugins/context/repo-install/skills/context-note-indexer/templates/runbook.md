# Diagnose and recover

This is the page shape for one operational situation. Use it as an outline, not
a form to fill.

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
source never says how recovery was confirmed, record that as a gap rather than
inventing a check. Omit `Escalate` when no fallback is known.

Never order steps the source did not order, and never merge two symptoms with
different confirmations into one entry because the recovery happens to match.

A note usually records one incident and one recovery that worked that time.
Write it as the observed case. A single success is not a validated procedure, and
"this fixed it" does not establish why. If the note speculates about a cause,
keep the speculation out of `Confirm` and `Act`; a guessed root cause acted on
under pressure is worse than an acknowledged unknown.
