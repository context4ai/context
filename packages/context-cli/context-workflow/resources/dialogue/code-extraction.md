# Code Indexer Dialogue

Use this dialogue only when the current Route is preparing or running a Code
Indexer.

Explain the flow in user terms:

1. confirm the repository or module boundary;
2. confirm the reader questions and visible knowledge scope;
3. select the smallest applicable Provider profile;
4. let the Provider choose its parsers and build semantic subjects;
5. show readable Candidate pages for approval.

Do not ask the user to choose internal parser calls, evidence IDs, digest
fields, batch sizes, or ordinal partitions. Raise parser details only when the
required technology is unsupported or executable customization needs approval.

One source file or symbol is not automatically one knowledge page. Prefer
stable capabilities, contracts, flows, and components as subjects. A Provider
may use deterministic symbol, route, dependency, or protocol facts internally,
but Review should show the reader-facing result and useful source paths.

When coverage is incomplete, report the missing reader question or source
boundary. Do not create a project-local parallel extraction phase. Extend or
configure the selected Provider through the declared customization ladder.

