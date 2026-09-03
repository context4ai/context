import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { PATH_FIELD_INVENTORY } from "../lib/pathFreeContractInventory.js";

const PKG_ROOT = resolve(import.meta.dir, "../..");
const PLUGINS_ROOT = resolve(PKG_ROOT, "dist", "plugins");

const GENERATED_PLUGIN_DIRS = ["claude", "codex", "cursor", "skills"];
const TEXT_EXTENSIONS = [".md", ".json", ".template", ".yaml", ".yml"];

const AUDIT_ROOTS = [
  "../../plugins/context",
  "plugin",
  "README.md",
  "CLAUDE.md",
  "DEVELOPMENT.md",
];
const SRC_ROOT = join(PKG_ROOT, "src");
const SOURCE_AUDIT_EXCLUDED_SOURCE_FILES = new Set([
  "src/commands/debug.ts",
  "src/lib/pathFreeContractInventory.ts",
]);
const PATH_FIELD_INVENTORY_FIELDS = new Set(PATH_FIELD_INVENTORY.map((entry) => entry.field));
const CLASSIFIED_SOURCE_PATH_FIELDS = new Set([
  ...PATH_FIELD_INVENTORY_FIELDS,
  "approved_path",
  "candidate_path",
  "current_path",
  "dist_path",
  "manifest",
  "okf_root",
  "okf_root_path",
  "route_manifest",
]);
const SOURCE_AUDIT_EXCLUDED_FIELDS = new Set(["path", "ctxDir"]);
const SOURCE_PATH_FIELD_ALLOWED_FIELDS = new Set([
  "absPath", "agentsPath", "basePath", "candidatePath", "cachePath", "cacheStatePath", "changelogPath", "claudePath", "configPath", "contextPath", "cursorPath", "decisionsPath",
  "document_path",
  "draftPath", "entryPath", "exec_path", "explicitPath", "fileAbs", "fileRel", "finalizePath", "heading_path", "headingPath", "inputPath", "latestFile", "local_path", "localSettingsPath",
  "manifestFilePath", "module_path", "modulePath", "nextHeadingPath", "outputPath", "packageJsonPath", "packagePath", "patchPath", "planPath", "pluginPath", "preparePath",
  "previousHeadingPath", "rawBlocksByFile", "rawByPath", "rawFile", "rawPath", "relPath", "repo_root_path", "repoPath", "reviewPath", "root", "savePath", "scanFile", "search_path", "settingsPath",
  "node_ref_is_identity_not_path", "snapshot_dir", "snapshotFile", "snapshotPathBySourcePath", "source_manifest_path", "sourceFile", "sourceFilePath", "sourcePath", "sourcesFile", "stderrPath", "stdoutPath", "sub_path", "targetAbsPath", "target_href", "targetPath", "templatesDir",
  "qualified_item_path",
  "tmpPath", "workspace_root", "workspaceDir", "workspaceRoot",
]);
const SOURCE_AUDITED_PATH_FIELDS = PATH_FIELD_INVENTORY.map((entry) => entry.field)
  .filter((field) => !SOURCE_AUDIT_EXCLUDED_FIELDS.has(field));
const PRODUCTION_DOC_GENERIC_PATH_FIELDS = new Set(["path", "file", "dir", "href"]);
const PRODUCTION_DOC_PATH_FIELDS = [...SOURCE_AUDITED_PATH_FIELDS, "ctxDir", "WORKSPACE_DIR"]
  .filter((field) => !PRODUCTION_DOC_GENERIC_PATH_FIELDS.has(field));
const SOURCE_PATH_FIELD_HEURISTIC_RE =
  /(?:^|_)(?:dir|file|href|manifest|path|root)$|^(?:archive|artifact|baseline|cache|latest|manifest|new|old|output|payload|previous|raw|relative|result|review|snapshot|source|storage|workspace).*?(?:Dir|File|Href|Manifest|Path|Root)$/u;
const PRODUCTION_DOC_PATH_FIELD_PATTERN = `\\b(?:${PRODUCTION_DOC_PATH_FIELDS.map(escapeRegExp).join("|")})\\b`;
const PRODUCTION_DOC_PATH_PROTOCOL_PATTERN = new RegExp(
  `(?:\\.context/|\\.context\\*\\*|\\.tmp/context-cli|\\.cache/|raw/|knowledge/|archive/sources|rendered Markdown|${PRODUCTION_DOC_PATH_FIELD_PATTERN})`,
  "gi",
);

interface AuditFile {
  rel: string;
  abs: string;
}

interface AuditFinding {
  rel: string;
  line: number;
  rule: string;
  text: string;
}

const DEFAULT_JSON_OUTPUT_PATH_FIELD_FIXTURE = [
  "process.stdout.write(`${JSON.stringify({", "  workspace: {", "    path: stats.ctxDir,",
  "    root: location.workspaceRoot,", "  },", "}, null, 2)}\\n`);",
].join("\n");

const EXTRA_PATH_FIELD_CANDIDATES = new Set(["payload_path", "storage_path", "raw_relative_path", "source_path", "workspace_path", "output_path"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRepoPath(path: string): string {
  return relative(PKG_ROOT, path).split(sep).join("/");
}

function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.some((extension) => path.endsWith(extension));
}

async function collectFiles(path: string, out: AuditFile[] = []): Promise<AuditFile[]> {
  const rel = toRepoPath(path);
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);

  if (entries === null) {
    if (isTextFile(path)) out.push({ rel, abs: path });
    return out;
  }

  for (const entry of entries) {
    const child = join(path, entry.name);
    if (toRepoPath(child) === "../../plugins/context/repo-install") continue;
    await collectFiles(child, out);
  }

  return out;
}

async function collectAuditFiles(): Promise<AuditFile[]> {
  const files: AuditFile[] = [];
  for (const root of AUDIT_ROOTS) {
    await collectFiles(join(PKG_ROOT, root), files);
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function collectSourceFiles(path = SRC_ROOT, out: AuditFile[] = []): Promise<AuditFile[]> {
  const rel = toRepoPath(path);
  const name = rel.split("/").at(-1) ?? rel;
  const entries = await readdir(path, { withFileTypes: true });

  if (name === "__tests__") return out;

  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(child, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const childRel = toRepoPath(child);
      if (!SOURCE_AUDIT_EXCLUDED_SOURCE_FILES.has(childRel)) out.push({ rel: childRel, abs: child });
    }
  }

  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function isProductionDoc(rel: string): boolean {
  return rel === "README.md"
    || rel === "CLAUDE.md"
    || rel === "DEVELOPMENT.md"
    || rel.startsWith("plugin/")
    || rel.startsWith("../../plugins/context/");
}

function isDebugOnlyContext(line: string, matchIndex: number): boolean {
  const lower = line.toLowerCase();
  const context = lower.slice(Math.max(0, matchIndex - 180), Math.min(lower.length, matchIndex + 180));
  const explicitDebugBoundary =
    /\bcontext debug\b/.test(context) ||
    /\bdebug-only\b/.test(context) ||
    /\bdeveloper\/debug\b/.test(context);
  if (!explicitDebugBoundary) return false;

  const positiveWorkflowInput =
    /\b(?:use|pass|feed|provide|submit|load|consume|treat)\b.{0,160}\b(?:workflow\s+inputs?|input|handoff|next\s+workflow|protocol|contract)\b/.test(context) &&
    !/\b(?:do not|don't|never|must not|not)\b.{0,160}\b(?:workflow\s+inputs?|input|handoff|next\s+workflow|protocol|contract)\b/.test(context);

  return !positiveWorkflowInput;
}

function isInitLayoutDescription(line: string, matchIndex: number): boolean {
  const lower = line.toLowerCase();
  const context = lower.slice(Math.max(0, matchIndex - 160), Math.min(lower.length, matchIndex + 160));
  return /\bcontext init\b/.test(context) &&
    /\b(?:creat\w*|append\w*|embedded|root-layout|layout|default)\b/.test(context) &&
    !/\bafter\s+`?context init\b/.test(context) &&
    !/\b(?:workflow\s+inputs?|input|handoff|next\s+workflow|protocol|contract)\b/.test(context) &&
    !/\b(?:read|grep|cat|find|inspect|open|search|glob|ls|head|tail|less|more|parse|dereference|derive)\b/.test(context);
}

function isAllowedContext(line: string, matchIndex: number): boolean {
  const lower = line.toLowerCase();
  const prefix = lower.slice(Math.max(0, matchIndex - 140), matchIndex);
  const shortPrefix = lower.slice(Math.max(0, matchIndex - 80), matchIndex);
  const context = lower.slice(Math.max(0, matchIndex - 160), Math.min(lower.length, matchIndex + 160));

  if (
    /\bcontext workspace read agents\.md\b/.test(context) &&
    /\b(?:after init|generated|workspace instructions|self-bootstrap|bootstrap)\b/.test(context)
  ) return true;
  if (/\b(do not|don't|never|must not|no)\b/.test(prefix)) return true;
  if (/\bnot\s+(?:read|list|grep|cat|inspect|open|search|write|ls|head|tail|less|more|parse|dereference|derive)\b/.test(prefix)) {
    return true;
  }
  if (/\bdoes not\s+(?:read|list|grep|cat|inspect|open|search|write|edit|modify|ls|head|tail|less|more|parse|dereference|derive)\b/.test(prefix)) {
    return true;
  }
  if (/\bwithout touching\b/.test(prefix)) return true;
  if (/(?:不能|不得|不要|禁止|不应).{0,80}(?:workspace write|read|list|grep|cat|inspect|open|search|write|ls|head|tail|less|more|parse|dereference|derive|手写|编辑|绕过)/.test(context)) {
    return true;
  }
  if (isInitLayoutDescription(line, matchIndex)) return true;
  if (isDebugOnlyContext(line, matchIndex)) return true;
  if (/\bnot\s+(?:a|the|part of|valid)\s+(?:workflow|production|agent|source|input)\b/.test(shortPrefix)) return true;
  if (/\bnot\s+(?:workflow|production|agent)\s+inputs?\b/.test(shortPrefix)) return true;

  return false;
}

function scanLine(rel: string, lineNumber: number, line: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const workspaceCommand = /context workspace (?:locate|read|list|search|write)/gi;
  for (const match of line.matchAll(workspaceCommand)) {
    if (!isAllowedContext(line, match.index ?? 0)) {
      findings.push({
        rel,
        line: lineNumber,
        rule: "workspace-probing-command",
        text: line.trim(),
      });
    }
  }

  const probingVerb =
    /\b(?:read|grep|cat|find|inspect|open|search|glob|write|edit|modify|ls|head|tail|less|more|parse|dereference|derive)\b|\blist\b(?! item)/i;
  const workflowInputVerb = /\b(?:use|pass|feed|provide|submit|load|consume|treat)\b/i;
  const workflowInputNoun = /\b(?:workflow\s+inputs?|input|handoff|next\s+workflow|protocol|contract)\b/i;

  for (const match of line.matchAll(PRODUCTION_DOC_PATH_PROTOCOL_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const prefix = line.slice(Math.max(0, matchIndex - 80), matchIndex);
    const suffix = line.slice(matchIndex, Math.min(line.length, matchIndex + 80));
    const window = `${prefix}${suffix}`;
    const positivePathAsInput = workflowInputVerb.test(window) && workflowInputNoun.test(window);
    if ((probingVerb.test(window) || positivePathAsInput) && !isAllowedContext(line, matchIndex)) {
      findings.push({
        rel,
        line: lineNumber,
        rule: "storage-path-probing",
        text: line.trim(),
      });
    }
  }

  return findings.filter(
    (finding, index) =>
      findings.findIndex(
        (candidate) =>
          candidate.rel === finding.rel &&
          candidate.line === finding.line &&
          candidate.rule === finding.rule &&
          candidate.text === finding.text,
      ) === index,
  );
}

function scanProductionDoc(rel: string, body: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const lines = body.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    findings.push(...scanLine(rel, index + 1, line));
  }
  return findings;
}

function scanSourcePathFieldInventory(rel: string, body: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const source = ts.createSourceFile(rel, body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const visit = (node: ts.Node): void => {
    const field = pathFieldNameFromNode(node);
    if (field !== undefined && isSourcePathFieldCandidate(field)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      findings.push({
        rel,
        line,
        rule: CLASSIFIED_SOURCE_PATH_FIELDS.has(field) ? "classified-source-path-field" : "unclassified-source-path-field",
        text: field,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return findings;
}

function isSourcePathFieldCandidate(field: string): boolean {
  if (SOURCE_AUDIT_EXCLUDED_FIELDS.has(field)) return false;
  if (CLASSIFIED_SOURCE_PATH_FIELDS.has(field)) return true;
  if (SOURCE_PATH_FIELD_ALLOWED_FIELDS.has(field)) return false;
  return EXTRA_PATH_FIELD_CANDIDATES.has(field) || SOURCE_PATH_FIELD_HEURISTIC_RE.test(field);
}

function pathFieldNameFromNode(node: ts.Node): string | undefined {
  if (ts.isPropertyAssignment(node)) return propertyNameText(node.name);
  if (ts.isShorthandPropertyAssignment(node)) return node.name.text;
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function scanDefaultJsonOutputPathFields(rel: string, body: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const lines = body.split(/\r?\n/);
  let inJsonOutput = false;
  for (const [index, line] of lines.entries()) {
    if (/process\.stdout\.write/.test(line) && /JSON\.stringify\(\{/.test(line)) {
      inJsonOutput = true;
    }
    if (inJsonOutput && /\b(?:path|root)\s*:\s*(?:stats\.ctxDir|location\.workspaceRoot|ctx\.ctxDir|ctxDir)\b/.test(line)) {
      findings.push({
        rel,
        line: index + 1,
        rule: "default-json-output-path-field",
        text: line.trim(),
      });
    }
    if (inJsonOutput && /\},\s*null,\s*2\)/.test(line)) {
      inJsonOutput = false;
    }
  }
  return findings;
}

describe("path-free plugin source audit", () => {
  test("[P12][P13] source audit includes hidden plugin templates and lives outside generated build outputs", async () => {
    const files = await collectAuditFiles();
    const rels = files.map((file) => file.rel);

    expect(rels).toContain("../../plugins/context/.claude-plugin/plugin.json.template");
    expect(rels).toContain("../../plugins/context/.codex-plugin/plugin.json.template");
    expect(rels).toContain("../../plugins/context/.cursor-plugin/plugin.json.template");
    expect(rels.some((rel) => rel.startsWith("../../plugins/context/repo-install/"))).toBe(false);

    expect(rels.some((rel) => GENERATED_PLUGIN_DIRS.includes(rel.split("/")[0]!))).toBe(false);

    if (await readdir(PLUGINS_ROOT).then(() => true).catch(() => false)) {
      for (const dir of GENERATED_PLUGIN_DIRS) {
        expect(
          await readdir(join(PLUGINS_ROOT, dir)).then((entries) => entries.length > 0).catch(() => false),
          dir,
        ).toBe(true);
      }
    }

    const buildScript = await readFile(join(PKG_ROOT, "scripts/build-plugin.ts"), "utf8");
    expect(buildScript).toContain("Source of truth:");
    expect(buildScript).toContain("Generated outputs");
  });

  test("[P15][P16] production plugin docs do not teach workspace path probing", async () => {
    const files = (await collectAuditFiles()).filter((file) => isProductionDoc(file.rel));
    const rels = files.map((file) => file.rel);
    expect(rels).toContain("CLAUDE.md");
    expect(rels).toContain("DEVELOPMENT.md");
    const findings: AuditFinding[] = [];

    for (const file of files) {
      const body = await readFile(file.abs, "utf8");
      findings.push(...scanProductionDoc(file.rel, body));
    }

    expect(findings).toEqual([]);
  });

  test("[P17] production plugin docs do not promote secondary shared evidence through full-text expansion", async () => {
    const forbiddenPatterns: Array<{ rule: string; pattern: RegExp }> = [
      {
        rule: "secondary-request-full-text-promotes-evidence",
        pattern: /secondary shared block is needed as evidence[^.\n]*request(?:_|-)full(?:_|-)text/iu,
      },
      {
        rule: "secondary-without-source-ref-only",
        pattern: /secondary shared snippets without [`']?source_ref[`']? are background only/iu,
      },
      {
        rule: "ambiguous-owned-shared-support",
        pattern: /owned\/shared evidence can support|no owned\/shared basis exists/iu,
      },
    ];
    const findings: AuditFinding[] = [];

    for (const file of (await collectAuditFiles()).filter((candidate) => isProductionDoc(candidate.rel))) {
      const lines = (await readFile(file.abs, "utf8")).split(/\r?\n/u);
      for (const [index, line] of lines.entries()) {
        for (const { rule, pattern } of forbiddenPatterns) {
          if (pattern.test(line)) {
            findings.push({
              rel: file.rel,
              line: index + 1,
              rule,
              text: line.trim(),
            });
          }
        }
      }
    }

    expect(findings).toEqual([]);
  });

  test("[P15] source path-shaped output fields are inventoried", async () => {
    const findings: AuditFinding[] = [];
    const sourceFiles = await collectSourceFiles();
    expect(sourceFiles.map((file) => file.rel)).not.toContain("src/lib/pathFreeContractInventory.ts");

    for (const file of sourceFiles) {
      const body = await readFile(file.abs, "utf8");
      findings.push(...scanSourcePathFieldInventory(file.rel, body));
    }

    expect(findings.filter((finding) => finding.rule === "unclassified-source-path-field")).toEqual([]);
    for (const requiredField of ["cache_path", "cache_root", "payload.path", "relative_path", "snapshot_file", "body_ref"]) {
      expect(CLASSIFIED_SOURCE_PATH_FIELDS, requiredField).toContain(requiredField);
    }
    expect(scanSourcePathFieldInventory(
      "fixture.ts",
      [
        "const leak = {",
        "  payload_path: value,",
        "  storage_path: value,",
        "  raw_relative_path: value,",
        "  result_path: value,",
        "  artifact_path: value,",
        "  workspaceRootPath: value,",
        "  cache_dir: value,",
        "  manifestFile: value,",
        "  snapshotFilePath: value,",
        "  outputFile: value,",
        "};",
      ].join("\n"),
    ).filter((finding) => finding.rule === "unclassified-source-path-field").map((finding) => finding.text)).toEqual([
      "payload_path",
      "storage_path",
      "raw_relative_path",
      "result_path",
      "artifact_path",
      "workspaceRootPath",
      "cache_dir",
      "manifestFile",
      "snapshotFilePath",
      "outputFile",
    ]);

    const outputFieldFindings: AuditFinding[] = [];
    for (const file of sourceFiles) {
      const body = await readFile(file.abs, "utf8");
      outputFieldFindings.push(...scanDefaultJsonOutputPathFields(file.rel, body));
    }
    expect(outputFieldFindings).toEqual([]);
  });

  test("[P16] audit classification allows explicit safe path contexts", () => {
    expect(scanProductionDoc("fixture.md", "Do not use `context workspace read` in production flow.")).toEqual([]);
    expect(scanProductionDoc(
      "fixture.md",
      "After init, read generated workspace instructions with `context workspace read AGENTS.md --format text`.",
    )).toEqual([]);
    expect(scanProductionDoc("fixture.md", "Do not run `ls .context/raw/` in production flow.")).toEqual([]);
    expect(scanProductionDoc("fixture.md", "Treat `source_ref` as an opaque citation token.")).toEqual([]);
    expect(scanProductionDoc("fixture.md", "Write scratch payload JSON and pass it with `--input`.")).toEqual([]);
    expect(scanProductionDoc("fixture.md", "Use the current Route's `context action complete-current --input <file> --format json` command.")).toEqual([]);
    expect(scanProductionDoc("fixture.md", "Register local `.md` inputs with `context source add file docs --local . --include docs/**/*.md`.")).toEqual([]);
    expect(scanProductionDoc("fixture.md", "Do not ask users to inspect or repair a code `.evidence` manifest.")).toEqual([]);
    expect(scanProductionDoc(
      "fixture.md",
      "Developer/debug-only: treat `.context/raw/foo.md` as internal storage; it is not a production input.",
    )).toEqual([]);
    const initLayoutLine = "`context init` creates an embedded `.context/` workspace.";
    expect(isInitLayoutDescription(initLayoutLine, initLayoutLine.indexOf(".context/"))).toBe(true);
    expect(scanProductionDoc("fixture.md", initLayoutLine)).toEqual([]);
  });

  test("[P15] audit classification rejects positive path leaks", () => {
    expect(scanProductionDoc("fixture.md", "Use `context workspace read` to inspect the payload.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "workspace-probing-command",
        text: "Use `context workspace read` to inspect the payload.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "Open `.context/.tmp/context-cli/workflows/node-context.json`.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "Open `.context/.tmp/context-cli/workflows/node-context.json`.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "Read `.context/.tmp/context-cli/workflows/node-context.json` into scratch.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "Read `.context/.tmp/context-cli/workflows/node-context.json` into scratch.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "Run `ls .context/raw/` to inspect the raw bucket.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "Run `ls .context/raw/` to inspect the raw bucket.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "Run `head .context/raw/foo.md` to inspect the raw bucket.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "Run `head .context/raw/foo.md` to inspect the raw bucket.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "Use `.context/.tmp/context-cli/run/node-context.json` as the next production input.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "Use `.context/.tmp/context-cli/run/node-context.json` as the next production input.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "Use rendered Markdown as production input.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "Use rendered Markdown as production input.",
      },
    ]);

    for (const text of [
      "Open `review_artifact` for the latest review.",
      "Inspect `archive_path` before applying the review.",
      "Read `payload.path` as the saved production input.",
    ]) {
      expect(scanProductionDoc("fixture.md", text)).toEqual([
        {
          rel: "fixture.md",
          line: 1,
          rule: "storage-path-probing",
          text,
        },
      ]);
    }

    expect(scanProductionDoc("fixture.md", "After `context init`, open `.context/config.yaml`.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "After `context init`, open `.context/config.yaml`.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "Inspect `.context/raw/` directly. This is not a production input.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "Inspect `.context/raw/` directly. This is not a production input.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "Debug: open `.context/.tmp/context-cli/workflows/node-context.json`.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "Debug: open `.context/.tmp/context-cli/workflows/node-context.json`.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "Run diagnostics and inspect `.context/raw/foo.md`.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "Run diagnostics and inspect `.context/raw/foo.md`.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "If diagnostics fail, inspect `.context/raw/`.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "If diagnostics fail, inspect `.context/raw/`.",
      },
    ]);

    expect(scanProductionDoc("fixture.md", "After `context init`, use `.context/` as the default production protocol.")).toEqual([
      {
        rel: "fixture.md",
        line: 1,
        rule: "storage-path-probing",
        text: "After `context init`, use `.context/` as the default production protocol.",
      },
    ]);

    expect(scanDefaultJsonOutputPathFields("fixture.ts", DEFAULT_JSON_OUTPUT_PATH_FIELD_FIXTURE)).toEqual([
      {
        rel: "fixture.ts",
        line: 3,
        rule: "default-json-output-path-field",
        text: "path: stats.ctxDir,",
      },
      {
        rel: "fixture.ts",
        line: 4,
        rule: "default-json-output-path-field",
        text: "root: location.workspaceRoot,",
      },
    ]);
  });
});
