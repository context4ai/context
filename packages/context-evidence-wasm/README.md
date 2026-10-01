# Context evidence Wasm

Read-only evidence enrichment for Context knowledge. The plugin joins existing
section markers, `knowledge/structure.yaml` and source registrations. It does not
verify source contents, search code, restore sources or modify knowledge.

Build with `bun run --filter @c4a/context-cli build:evidence`. The build uses Rust
with the `wasm32-unknown-unknown` target and the committed Cargo lockfile. End users
receive the compiled artifact with the CLI and do not need Rust.
The binary embeds redistribution notices in the `context.licenses` custom section.

## ABI 2

Exports: `memory`, `alloc(length: i32) -> i32`,
`dealloc(pointer: i32, length: i32)`, `enrich(pointer: i32, length: i32) -> i64`.
Pointers and lengths use unsigned 32-bit interpretation. Packed i64 values contain
the pointer in the high 32 bits and length in the low 32 bits.

The host allocates and writes UTF-8 JSON input, invokes enrich, copies the JSON
object result, then deallocates both independent allocations with exact lengths.
Never reuse an instance after a trap, cancellation or invalid memory access.

Imports from `sourcegraph`:

- `read_file(path_pointer: i32, path_length: i32) -> i64`: raw file bytes in a
  guest allocation made with alloc. The guest owns and releases this buffer.
  Zero signals error (an empty successful file still has a nonzero pointer).
- `last_error() -> i64`: UTF-8 error in the same allocation convention. Diagnostics
  are consumed but not echoed, to avoid leaking host details.

The generic host may also provide read_files; this plugin does not require it.
All host reads must be bound to the invocation's repository, immutable revision
and readable scope, never accept a repo/revision from the guest, and enforce byte,
time and call limits. No WASI, network, filesystem or process capabilities.

Input JSON:

```json
{
  "abi_version": 2,
  "operation": "read",
  "args": {"workspace_root": ".", "include_digest": false},
  "files": [{"item_id": "read-0", "path": "knowledge/example.md", "start_line": 2,
    "end_line": 8, "content": "actual returned text", "truncated": false}]
}
```

read_many uses the same envelope with multiple successfully returned files. Ranges
are actual returned ranges, not requested ranges. Extra generic envelope/file
fields are ignored; unknown plugin args are rejected. Empty args can be omitted
or null (a host's absent argument map).
For scoped repositories the host supplies files.path relative to the registered
plugin root, with root/repository_path as additional context. Host reads and
workspace_root use that same base;
prefix root only when resolving knowledge/snapshot locations, never external
source repository paths. A full-repository host uses the Git root.
Plugin metadata lives in custom section `sourcegraph.plugin.v1`.
The bundled metadata declares `default_enabled: true` for `read` and `read_many`.
Hosts supporting this declaration select the plugin when `plugins` is omitted;
an explicit `plugins: []` disables enhancement, and a nonempty list selects only
the named plugins. Hosts without default selection still require explicit
`plugins: [{"name":"context-evidence"}]`. Business arguments remain optional.

Output is `{"attachments":[{"item_id":"read-0","text":"references:\n- https://example.org/source"}]}`.
The host assigns unique opaque item IDs, including repeated paths or ranges, and
appends each text unchanged to that item's original content. IDs are nonempty,
at most 256 UTF-8 bytes and contain no control characters. They survive scoped
invocation splitting. The host does not parse references or other business fields.
Attachments without an item ID apply to the batch; unknown IDs are diagnostics,
never guessed associations. Empty evidence returns `{"attachments":[]}`.
The text is YAML with deduplicated references per item and diagnostics on failure.
Normal output exposes no section IDs, plugin labels or success flags. Sections
remain internal to selecting evidence for the actual returned range.
Metadata and input both require `abi_version: 2`; low-level exports remain
unchanged. Old JSON contracts are rejected, not interpreted. MCP renders only
standard content text blocks, preserving original text even if enrichment fails.
References are recorded metadata, not proof that the source has been reread.
Repository references with a full 40/64-digit commit and a supported remote shape
return URL strings (objects with `url` and `content_digest` when requested). They use Context's
blob-compatible web URL convention with encoded file segments and line anchors.
No host reachability is implied. Unsupported
remote shapes, known incompatible routes and nonimmutable refs retain the original
structured fields; a private host's web layout must support the blob convention.
Document and captured note/session evidence is unchanged. Ready source URLs do
not require another link-resolution call. For code drill-down, parse recognized
routes into the existing repository/revision/path/range API, not a new MCP URL API.
Repository paths already include registered subpath; do not prepend it twice.
Note/session sources use their committed dated files, not nonexistent registries.

The host may pool instances only for the same repo, revision, artifact, effective
scope and configuration. Each instance is exclusive; parsed metadata/section
outlines are cached with bounded eviction. No output is retained between requests.

## Local development verification

`bun run --filter @c4a/context-cli test:evidence` builds the artifact and runs a
Node WebAssembly contract harness. This is development verification, not a local
query mode or a production sandbox. Sourcegraph service integration is separate.

Before releasing a replacement artifact, add the SHA-256 of each previously
shipped official artifact to `official-digests.json`. The installer upgrades only
an exact known hash, never a filename or self-declared plugin version. Keep the
Rust toolchain and Cargo lockfile pinned; build remaps machine-specific paths.
