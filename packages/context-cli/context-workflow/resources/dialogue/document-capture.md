---
id: dialogue.document-capture
kind: procedure
mediaType: text/markdown
---

# Document-capture dialogue

Registration records a document boundary but does not read its body. Before the
capture gate is resolved, explain that capture will:

- read only the registered local or remote module;
- write a normalized committed snapshot under the date directory;
- update that date directory's shared `manifest.json`; and
- provide offline evidence for Review, verify, and fresh-clone reproduction.

For remote documents, credentials stay in the external document client and are
not written to the workspace. Several requested documents may share the date,
while each retains its own module and snapshot identity.

Ask for permission to read the exact pending modules. Do not run capture,
refresh, or capture preview before permission is clear. A request that
explicitly says to ingest, fetch, capture, or read the named documents grants
that scope; merely mentioning a possible source does not.

If deterministic inspection detects `.mdx`, route metadata, sidebars, or a docs
configuration, explain that the boundary looks like a documentation site and
ask whether to use the Context document-site processor. Do not infer that
choice from filenames alone.
