---
id: template.recovery-issue
kind: template
mediaType: text/markdown
---

# Context recovery issue template

Write `issue/YYYY-MM-DD-short-description.md` using the user's local date/language.
Omit this template frontmatter and instructions from the report. Use stable aliases
such as repo-A, module-B and <workspace>; do not include private content or secrets.

# <Short description of the blocking behavior>

- Observed at: <local date/time and timezone>
- Status: unresolved / recovered with remaining defect
- Environment: <Context CLI, SDK, plugin versions; Node and OS when relevant>
- Impact: <blocked stage and scope; which independent work remains usable>

## Expected and actual behavior

<What the user was trying to do, the expected next step, and what actually happened.
Distinguish a CLI failure from an Agent payload mistake; label uncertain causes.>

## Minimal reproduction and diagnostic evidence

1. <Anonymized prerequisites and smallest known source/module shape.>
2. <Command with private arguments replaced by placeholders.>
3. <Exit code, reason_code and short redacted error excerpt.>

<Relevant stage, reference relationships, counts and revision changes; if no
reproduction is known, say so. Do not invent or copy sensitive raw inputs.>

## Recovery attempts

| Attempt | Intended effect | Actual result | Did state advance? |
| --- | --- | --- | --- |
| <Supported command/action, sanitized> | <Scope> | <Observed result> | <Evidence or unknown> |

## Preserved work and current boundary

<Approved pages, menu, sources and usable package status; what drafts were actually
reopened or archived, if any. State what was not verified. No raw archive attachment.>

## Developer investigation needed

<Concrete suspected component/contract and evidence; remaining uncertainty; smallest
additional information or fix needed to continue.>

## Privacy review

<Confirm the report was checked for credentials, personal information, private URLs,
absolute personal paths and source/document bodies. Mention any evidence omitted
for privacy; do not claim automated redaction or upload occurred.>
