# Interpret a sessions summary

A sessions source is a bounded summary from a conversation. It may describe
requirements, design choices, troubleshooting, operational practice or general
knowledge discussion. It need not concern code and need not have a commit.
Only the host or external supplier prepares that summary; the Indexer does not
scan chat history, load a full transcript, or synthesize a conversation from a
diff. Read only the summary and other sources authorized by the current Route.

Extract the problem, the decisions actually reached, the reasons needed to
understand them, remaining questions and applicability. A discarded alternative
is useful only when it explains a current choice or prevents repeating a failed
approach. Do not reproduce turn order, repeated summaries, tool logs or every
intermediate attempt. Keep “proposed”, “agreed”, “implemented” and “verified”
distinct; a confident final message does not prove all four.

For example, a discussion of a review process may agree that urgent changes
need a second reviewer, leave weekend coverage unresolved, and abandon a
three-reviewer proposal. With no code involved, a process guide can state the
agreed rule and its unresolved coverage boundary. Do not invent a commit or
publish the abandoned proposal as policy. A design discussion that ends without
a decision may be saved for context without creating approved knowledge.

For a code-related session, optional source frontmatter `changes` can identify
one or more changes: each entry has a full `commit` SHA or an `mr` URL, optionally
`repository`. No associations is normal. These links state what was discussed;
they do not prove merging, deployment, successful tests or source-read permission.
Do not guess missing identifiers or copy them into every knowledge header.

When a session explains why a retry limit was chosen, code can establish the
actual limit and branches, while the summary establishes the stated rationale.
If the summary says a fallback was only proposed and code lacks it, do not write
that the fallback exists. If code changed later, preserve still-applicable
reasoning and mark superseded details only where that affects the reader.
Where no code has been read, qualify implementation claims rather than hiding
that limitation behind a change URL.
