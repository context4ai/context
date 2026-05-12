# C4A Context — Advanced Agentic Search Over Compiled Knowledge

> [中文版本](./README_CN.md)

<p align="center"><img src="./assets/logo.svg" alt="C4A Context" width="180"/></p>

An Agentic Search system built for AI Agents. It pre-compiles Feishu docs, local Markdown, code structure, and hand-curated business material into structured, traceable knowledge, so an agent can perform high-precision search over it through a dedicated CLI.

## Why C4A Context

When an AI agent looks up information in a project, it mostly relies on file search (e.g. `grep`) and full-text reading. As documents and codebases grow, two problems surface:

- **Slow retrieval**: the whole repo has to be scanned to locate the relevant piece;
- **Context bloat**: large amounts of raw text are pushed into the context window, dragging down downstream reasoning quality.

Vanilla RAG handles basic retrieval, but relying on Embedding-based chunk recall has inherent flaws: **vector models lose key information and distort semantics at both the indexing and retrieval stages, which significantly amplifies LLM hallucination**; recalled chunks are often misaligned with the actual intent, so the agent still has to do a second-pass filter — accuracy has a clear ceiling.

C4A Context takes a different path: **drop vector embeddings entirely, and let the LLM itself drive structured knowledge management and precise retrieval**. Each piece of raw material is pre-compiled into a structured knowledge unit (Section) carrying a Fact array, cross-references, and traceable source quotes; the agent then queries that base through dedicated tools and lands on Node / Section-level content directly. Backed by a standardized compile flow and a purpose-built query CLI, the knowledge base reaches a precision close to hand-curated material, and in most scenarios outperforms file search and general-purpose RAG.

## Where it fits

Best suited to the **long-term maintenance of project knowledge** — compile material from different versions and sources into orthogonal structured content (orthogonal meaning: knowledge from each source is non-redundant, has a clear boundary, and can be maintained independently), avoiding uncontrolled knowledge-base growth over time. Particularly fits long-running large projects, multi-team collaboration, and complex business systems with many documentation sources.

## Core capabilities

C4A Context creates a `.context/` workspace under your project directory (the name is configurable) and provides a complete closed loop:

- **Capture** — pull in Feishu docs, local Markdown, code structure, design specs, API specs, and other multi-source business material;
- **Compile** — let the AI process raw material into structured knowledge under a single protocol — not a summary, but a standardized Section with a Fact array, cross-references, and source traceability;
- **Query & use** — query local structured knowledge directly from Claude / Cursor / Codex etc., landing on Node and Section precisely; or hand the whole knowledge base to another LLM;
- **Knowledge governance** — drop deprecated material and reclaim its derived knowledge in one go; the knowledge base self-checks integrity and self-heals.

Day to day, work loops through **capture → compile → query & use → governance**; you don't re-run everything from scratch — update incrementally on demand.

## Install

Every Agent needs the `context` CLI first:

```bash
npm i -g @c4a/context-cli
# or
bunx @c4a/context-cli
```

Then install the plugin matching the agent you use:

| Agent | Install |
|---|---|
| Claude Code | `/plugin marketplace add context4ai/context`, then `/plugin install context@context` |
| Cursor | Dashboard → Settings → Plugins → Import → `https://github.com/context4ai/context` |
| Codex CLI | `codex marketplace add context4ai/context` |
| Vercel-style skills (Windsurf / OpenCode / Cline / Copilot, etc.) | `npx skills add github:context4ai/context <skill-name>` |

Once installed, the agent exposes entry points like `/context:*` (Claude) or `/context-*` (Cursor).

## Manual workflow

From your project directory:

1. **Init** — `/context:init` creates the `.context/` workspace;
2. **Capture** — `/context:capture <url-or-path>` pulls in Feishu docs, local Markdown, code snapshots, and so on;
3. **Align** — `/context:align` places raw material onto the Node structure;
4. **Compile** — `/context:compile` lets the AI turn raw material into structured Sections;
5. **Query** — `/context:query <question>` answers from local knowledge, citing Node and Section;
6. **Drop** — `/context:drop <source-id>` reclaims deprecated material and its derived Sections.

Each step writes readable files and a changelog under `.context/`, so you can review or roll back at any time.

## Managed workflow

After completing the **Install** step above, you can hand this document to an AI Agent (or an automation harness such as OpenClaw), point it at the project workspace and any existing knowledge base, and let it run the entire flow autonomously — cutting most of the manual work.

**Environment**: Claude Opus 4.6+ or Codex 5.5+ is recommended, so the agent can resolve instructions correctly and handle the decision/clarification steps during compile.

**Core managed prompt** — paste directly to the Agent or automation tool:

```
Please initialize a project knowledge base in the current directory (choose Chinese as the language; keep all other parameters as defaults), and run the full knowledge-management flow through the context CLI — including but not limited to: workspace init, multi-source capture, alignment, AI compile, and query validation. For any clarification or decision (source priority, compile-rule tweaks, knowledge-unit classification, etc.), make the call on your own and log every operation, keeping the knowledge base structured and traceable.
```

> Knowledge building is a long iterative process: it involves many detail-level decisions and clarifications. Automation can take over most of the repetitive work, but cannot fully replace human judgment.
> For engineering-critical knowledge (code structure, design specs, API details, etc.), prefer manual curation during the cold-start phase; once the base is stable, hand incremental updates and day-to-day governance to the Agent to avoid drift.

## Export & publish

The compiled knowledge base can be packaged for distribution:

- export as a **Skills** package;
- export as **LLMs.txt**;
- [TODO] publish to the **C4A platform** as an MCP service for other AIs to query live;
- [TODO] publish as a standalone Plugin knowledge package, with retrieval quality on par with the MCP service and CLI.

## About this repository

The contents of this repository are auto-generated and published by the [c4a project](https://github.com/context4ai/c4a) — do not edit by hand. Issues and PRs should go to the c4a monorepo.

The c4a project provides end-to-end infrastructure for knowledge processing and hosting, covering the CLI, the knowledge-management Studio, and MCP services; open-source release is planned for late May 2026.

License: MIT
