# Place supporting session material

Use the current article's reader question and supplied revision base, not a
profile binding. Integrate relevant explanations into the appropriate sections
without opening a parallel page or collecting everything under a generic
"Discussion" heading. The article can use several skills.

Code may establish entry points, signatures, registrations and current
branches. Saved material can explain why a limit was chosen, an intentionally
unsupported case, an operational exception or a known pitfall. Put those
contributions where the reader needs them; do not repeat signatures or replace
authoritative behavior with recollection.

## How the material reads once placed

Attribute it, and keep its state. An existing article's other sections are backed by code
or contracts, so a sentence sourced from a discussion has to carry its own
strength. Distinguish what was proposed, what was agreed, what is implemented and
what has been verified — a placed sentence that loses this distinction is worse
here than on a standalone page, because the surrounding sections are
authoritative and the reader will not question this one.

"Agreed in a design discussion: the retry limit stays at three to stay under the
downstream quota" is placeable next to a code-established limit. "The retry limit
is three" is the existing section's line, not the supporting summary's.

An optional `changes` association on the source names what the discussion was
about. It does not establish that the change merged, deployed or passed tests, so
it can never be what makes a statement `implemented`. When the base page's reader
would want to open the change, name it in the prose of the section it belongs to;
never in the page frontmatter.

When a summary contradicts what the code establishes, do not silently pick one.
The code establishes current behavior; the discussion may record an intention, a
state since changed, or a decision not yet carried out. Say which, in the section
where a reader would otherwise be misled.
