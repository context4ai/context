---
id: context.code-indexer.composer.examples-and-documentation
kind: procedure
media-type: text/markdown
---

# Examples and documentation composer

Run only when selected for the current profile. The workset-scoped primary
view is the sole input; documentation files outside that view are not implicit
authority.

Require an evidenced `example-candidate` fact and primary `content` Artifact.
Propose an `examples` Artifact only for maintained usage that demonstrates a
supported public target, meaningful setup, expected outcome, and important
constraints. Merge scenario variants and exclude fixtures, generated samples,
and demos that do not represent supported use.

Use the existing target Node and `standard` policy. Evidence must come from the
view. When no representative example closes the reader question, or either
required input is missing, return the structured empty fragment-set result;
never invent tutorial steps.
