# Code Extractor Selection

Use this manual only when the current code-extraction Route asks the Agent to
choose or declare an extractor. The CLI reports repository facts; the Agent
chooses how those facts become source-backed code knowledge.

## Inspect Before Declaring

Run every read-only inspection command returned by the extraction-scope Gate.
The result identifies each confirmed module and its recognized `manifests`.
Treat these as deterministic technology signals, not as product semantics:

| Signal | Technology candidate |
|---|---|
| `package.json` | TypeScript, TSX, JavaScript, or JSX |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pyproject.toml` or `setup.py` | Python |
| `pom.xml` or `build.gradle` | Java or JVM |
| multiple manifests | a mixed module that may need more than one extractor |

Do not select `extractTs()` merely because a repository contains some
TypeScript. Decide against the exact confirmed module and include boundary. A
mixed module may compose multiple structural passes; parser selection is not an
exclusive repository-wide switch.

## Selection Order

Use the narrowest reusable capability that covers the confirmed source:

1. Use a Context-owned phase when its contract matches the source.
2. Otherwise use a reusable structural package inside `extractCustom()`.
3. If no reusable package covers the syntax or repository protocol, implement a
   project-owned adapter and keep it in the Context workspace.

Current reusable capabilities are:

| Source fact | Preferred capability | Lifecycle integration |
|---|---|---|
| TypeScript/TSX package or file scope | `extractTs()` | Context-owned phase |
| Go declarations, imports, calls, and common HTTP routes | `@c4a/extract-go` | call from `extractCustom()` |
| Rush workspace packages, tags, dependencies, entries, and owners | `@c4a/extract-rush` | call from `extractCustom()`; may complement a language extractor |
| React Router route declarations | `extractReactRouterRoutes()` from `@c4a/extract-ts` | call from `extractCustom()`; complements TypeScript symbols |
| Rust, Python, Java/JVM, or an unsupported framework/protocol | no assumed built-in parser | project-owned `extractCustom()` adapter |

An optional package does not create a new CLI phase. Add it as an explicit
workspace dependency, then map its structural facts to candidates in the
project callback. Do not add a parser package when its documented coverage does
not match the inspected source.

## Read The Contract Before Extending

Before editing `src/index.ts`, read the relevant installed public manual or
package README. Do not infer APIs from bundled JavaScript.

- Context lifecycle and `extractCustom()`:
  `node_modules/@c4a/context/docs/reference/project-api.md`
- Generic plugin protocol:
  `node_modules/@c4a/extract/README.md`
- TypeScript:
  `node_modules/@c4a/extract-ts/README.md`
- Go:
  `node_modules/@c4a/extract-go/README.md`
- Rush:
  `node_modules/@c4a/extract-rush/README.md`

If an optional package is not installed, use this capability matrix to decide
whether it is relevant, add only that dependency, and then read its shipped
README before implementing the callback.

A project-owned adapter may use an existing parser, compiler API, or command
whose output is deterministic. It must return source-backed candidates through
`extractCustom()`; it must not write lifecycle, knowledge, or Review files.
Framework-specific classification and rendering remain in the project. The CLI
and structural parser must not infer product meaning.

## Decision To Report

Before the first extraction preview, state briefly:

- the inspected module and manifest signals;
- the selected Context phase or structural package;
- whether coverage is complete or which facts remain project-owned; and
- why another available extractor is not needed.

If no current capability can parse the source reliably, stop at configuration
and report the missing generic capability. Do not silently emit an empty
codegraph or reuse an unrelated parser.
