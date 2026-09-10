# Source visuals: conversion and reuse

Use during Author for authorized source images, tables and diagrams; Review checks fidelity. This is shared internal guidance, not another Provider, capture phase or approval step. See [diagram writing](diagrams.md) for diagram types. Follow the workspace's user-editable AGENTS.md for style; default to minimal diagrams, approximately 1px lines and theme-default text/strokes without color decoration. Do not force Mermaid theme directives to emulate viewer styling.

## Preference and access

Read `package.json` → `context.convertVisuals` (missing means true) and current user instructions. A session/image-specific opt-out wins; do not silently persist it. False disables new semantic conversion, not source capture, native tables, existing Mermaid, or downloading evidence. Explicit new user requests can override a saved preference.

Current document material supplies `visual_resources`: registered `ref`, exact `content_hash`, `read_path`, original link, and accepted prior results. Read only authorized resources. No filename, alt text or link proves that an image was read. For code documentation or saved attachments without registered visual resources, preserve the original and use the existing source-material path if registration is necessary; never invent a visual ref or scan an unrelated checkout.

Prefer available structured whiteboard JSON or table CSV. If interpretation uses more than one resource (for example both JSON and preview), list the additional authorized visual refs in `also_read`; all actually used resource hashes participate in reuse. Merely available but unread previews do not. Use a supported image-reading tool when needed. No capability, unreadable input, mixed screenshot or ambiguous relationships means retain; do not install OCR or loop requesting the same unavailable capability. Keep screenshots, photos, visual designs and illustrations when the appearance is the information. Convert clear flow, sequence, state, entity/UML relationships to supported Mermaid; convert tables only when labels, values, units, merged-cell meaning and footnotes survive. Encode meaningful colors as labels/legend. Do not guess relationships or numbers.

## Submit inside the existing article

Keep normal source-backed `sections[].markdown` and `source_items`. For each image represented in that section add `sections[].visuals`:

```json
{
  "resource": "<visual ref from current material>",
  "context": ["<exact source caption or relevant explanation>"],
  "requirements": "English; sequence diagram; preserve all branches",
  "disposition": "converted",
  "format": "mermaid",
  "markdown": "```mermaid\nsequenceDiagram\n  Client->>Service: Request\n```"
}
```

`context` lists the actual source excerpts used to interpret this visual, not nearby unrelated paragraphs. Empty is valid only when no contextual explanation is needed. `requirements` records language/representation/explicit semantic requirements; exclude theme, stroke width, timestamps and ordinary tool versions. `format` is `mermaid`, `table` or `original`; retained decisions use `original` and may give a short `reason` such as `screenshot` or `tool-unavailable`. Keep the source document citation and source_items; the resource identity does not replace section evidence. This is semantic writing, never verbatim capture.

Visual output is appended to the chosen section. Do not duplicate it in prose or template variables. Converted prose must not also include the replaced image, its download link or a resource-selector comment. Retained output keeps the original reference. Never delete captured files or edit managed assets yourself. Shared references determine asset retention; package building continues to include only referenced knowledge assets.

## Incremental decisions

Compare the current resource hash, exact associated context and effective requirements with `previous`. Matching accepted output can be reused by submitting the same resource/context/requirements/disposition/format and omitting markdown. Read the current approved result; revisions are authoritative. Changed resource or meaningful caption → reconsider that visual only. Unrelated paragraphs, movement within a document, temporary URLs, tool versions and style changes do not require reinterpreting unchanged visuals. Identical bytes in another document/context are not automatically the same interpretation.

When several accepted copies disagree, choose the intended article's current result explicitly instead of guessing. Missing/invalid result → read authorized input or retain. A previous tool-unavailable retention may be retried when capability becomes available; no retries in a task without new capability. A user can request a new conversion or style revision explicitly. Style-only changes may replace the presentation using accepted content without rereading the image.

The reuse hash is source-based and excludes presentation. Article integrity, approval and build hashes still cover actual output bytes. This prevents stale packages and does not claim that a changed file has identical bytes. Compact source receipts travel with approved sections; never fabricate hashes, receipt comments or successful conversion claims.

## Review and fallback

Check critical nodes, direction, conditions, units and values against the source. Text/code fences being syntactically present does not prove semantic fidelity. An invalid optional conversion produces an advisory and retains the authorized original. Do not make writing/style differences a hard gate. Existing source-integrity, authorization and required-material checks remain in force. No browser-specific Mermaid renderer is required to finish other articles.
