# Research report template

`build.mjs` turns a directory of Markdown chapters into a single-page HTML report:
chapter list on the left, one chapter at a time in the middle, the chapter's
outline on the right. It needs only Node.js and has no package dependencies.

```bash
node <skill-dir>/templates/research-report/build.mjs \
  .tmp/context-plans/<slug>/research/report \
  .tmp/context-plans/<slug>/research/report.html \
  --title "<report title>" --subtitle "<date · baseline>"
```

## Chapters

- One file per chapter, ordered by file name: `01-conclusions.md`, `02-approaches.md`, …
- Files whose name starts with a capital letter and a separator (`A-…`, `B-…`)
  are listed as appendices.
- Each file starts with `# Title`; `##` and `###` headings form the right-hand outline.
- Supported Markdown: headings, paragraphs, lists (one nested level), tables,
  block quotes, code, inline code, bold and links. Images and italics are not
  supported. Inline code that looks like a file or directory path (any script)
  is shown shortened and copies the full path on click.
- `example/` contains a small two-chapter report; build it to see the layout.

## Figures

Navigation trees use a `tree` block; end a line with `[add]`, `[mod]`, `[dir]`
or `[keep]` to mark added articles, revised articles, new sections and content
kept unchanged. Lines without a marker are unchanged context:

````markdown
```tree
Knowledge base
├── Business
│   └── Billing rules        [mod]
└── Operations
    └── Incident handbook    [dir]
```
````

Bar charts and score matrices use a `chart` block with JSON:

````markdown
```chart
{"title": "Code check results", "legend": ["consistent", "partial", "inconsistent", "unverifiable"],
 "rows": [{"label": "Wiki A", "values": [7, 0, 2, 1]}, {"label": "Wiki B", "values": [11, 0, 0, 1]}]}
```
````

```chart
{"type": "matrix", "title": "Approach scores", "columns": ["Standard", "Upstream", "Unchanged"],
 "rows": ["Wiki A", "Wiki B"], "values": [[4, 5, 2], [5, 4, 2]], "max": 5}
```

A matrix marks the row maximum unless `recommend` lists the recommended cells as
`[[row, column], …]` (zero-based), which also allows combined recommendations.

A scatter chart places collections on two axes, for example knowledge origin and
maintenance activity:

````markdown
```chart
{"type": "scatter", "title": "Collection map", "xlabel": "from documents → from code",
 "ylabel": "maintenance activity", "xmax": 10, "ymax": 10,
 "points": [{"x": 2, "y": 3, "label": "Wiki A", "note": "mirror plus summary"}]}
```
````

Optional `colors`, `unit`, `max`, `segmentLabels` (print each segment's value) and
per-row `note` adjust a bar chart. Draw process or architecture diagrams as a
`tree` block or a table. An invalid chart stops the build with the chapter file
and line.

## Labels

Pass `--labels labels.json` to translate interface labels, for example
`{"add": "新增", "mod": "修订", "dir": "新目录", "keep": "原样", "report": "报告",
"appendix": "附录", "outline": "本章目录", "prev": "上一章", "next": "下一章", "copied": "已复制"}`.
