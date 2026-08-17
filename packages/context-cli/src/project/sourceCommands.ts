import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { loadSourcesRegistry } from "@c4a/context";
import { Command } from "commander";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  addRepoSource,
  ensureRepoSources,
  inspectRepoSources,
  listRepoSources,
} from "./repoSources.js";
import {
  parseRepositoryRecoveryPayload,
  repositoryRecoveryPlan,
  restoreRepositorySources,
} from "./repoSourceRecovery.js";
import { documentSourcesForName, inspectDocumentSources } from "./sourceDocumentStatus.js";
import {
  fileSourceAgentView,
  larkSourceAgentView,
  repoSourceAgentView,
} from "./sourceCommandViews.js";
import {
  addFileSource,
  addLarkSource,
  defaultFileModule,
  defaultLarkModule,
  isDateSourceNamespace,
} from "./documentSourceRegistration.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import { registerSourceBatch } from "./sourceBatchRegistration.js";
import { removeProjectSource } from "./sourceRemoval.js";
import { findContextProjectRoot } from "./workspace.js";

type DataFormat = "json" | "yaml" | "table";

const DATA_FORMATS = ["json", "yaml", "table"] as const;
const SOURCE_TYPES = ["repo", "file", "lark"] as const;
const SOURCE_STATUSES = ["active", "registered"] as const;

function assertChoice<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  label: string,
): T[number] {
  if (typeof value === "string" && (choices as readonly string[]).includes(value)) {
    return value as T[number];
  }
  throw new ContextError(ExitCode.UserError, `${label} must be one of: ${choices.join(" | ")}`, {
    category: ErrorCategory.UserInputInvalid,
    flag: label,
    choices,
  });
}

function actionOptions(...args: unknown[]): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const arg of args) {
    if (arg instanceof Command || (
      arg !== null &&
      typeof arg === "object" &&
      "opts" in arg &&
      typeof (arg as { opts?: unknown }).opts === "function"
    )) {
      Object.assign(options, (arg as { opts: () => Record<string, unknown> }).opts());
    }
  }
  for (const arg of args) {
    if (arg !== null && typeof arg === "object" && !Array.isArray(arg) && !(arg instanceof Command)) {
      Object.assign(options, arg as Record<string, unknown>);
    }
  }
  return options;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultDateSourceName(now = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function resolveSourceName(name: string | undefined): { name: string; generated: boolean } {
  const explicit = optionalString(name);
  if (explicit !== undefined) return { name: explicit, generated: false };
  return { name: defaultDateSourceName(), generated: true };
}

function collectRepeated(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

async function readIncludeList(projectRoot: string, path: string): Promise<string[]> {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    throw new ContextError(ExitCode.UserError, "source add file --include-list requires a file path", {
      category: ErrorCategory.UserInputInvalid,
      flag: "--include-list",
    });
  }
  let content: string;
  try {
    content = await readFile(isAbsolute(trimmed) ? resolve(trimmed) : resolve(projectRoot, trimmed), "utf8");
  } catch (error) {
    throw new ContextError(ExitCode.UserError, `cannot read include list: ${trimmed}`, {
      category: ErrorCategory.UserInputInvalid,
      flag: "--include-list",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function fileIncludesFromOptions(projectRoot: string, options: Record<string, unknown>): Promise<string[] | undefined> {
  const direct = Array.isArray(options.include)
    ? options.include.filter((item): item is string => typeof item === "string")
    : [];
  const includeList = typeof options.includeList === "string"
    ? await readIncludeList(projectRoot, options.includeList)
    : [];
  const merged = [...direct, ...includeList];
  if (merged.length === 0) return undefined;
  return [...new Set(merged)];
}

function requireProjectRoot(cwd: string, name: string): string {
  const found = findContextProjectRoot(cwd);
  if (!found) {
    throw new ContextError(ExitCode.WorkspaceStateError, `${name} requires a context project`, {
      category: ErrorCategory.WorkspaceNotFound,
    });
  }
  return found.projectRoot;
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function rowsFromValue(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : { value: item },
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, next]) => ({ key, value: next }));
  }
  return [{ value }];
}

function renderTable(value: unknown): string {
  const rows = rowsFromValue(value);
  if (rows.length === 0) return "(empty)\n";
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const widths = headers.map((header) =>
    Math.max(header.length, ...rows.map((row) => stringifyCell(row[header]).length)),
  );
  const renderRow = (cells: readonly string[]) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(" | ")} |`;
  return [
    renderRow(headers),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map((row) => renderRow(headers.map((header) => stringifyCell(row[header])))),
  ].join("\n") + "\n";
}

function writeFormatted(value: unknown, format: DataFormat): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (format === "yaml") {
    process.stdout.write(YAML.stringify(value));
    return;
  }
  process.stdout.write(renderTable(value));
}

async function listProjectSources(projectRoot: string, options: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const type = options.type === undefined ? undefined : assertChoice(options.type, SOURCE_TYPES, "--type");
  const status = options.status === undefined ? undefined : assertChoice(options.status, SOURCE_STATUSES, "--status");
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const sources = [
    ...registry.repos.map((source) => repoSourceAgentView({
      id: source.id,
      name: source.name,
      namespace: source.namespace,
      module: source.module,
      ...(source.local !== undefined ? { local: source.local } : {}),
      ...(source.subpath !== undefined ? { subpath: source.subpath } : {}),
      materializedAt: source.materializedAt,
      git: {
        remote: source.remote,
        ref: source.ref,
      },
    })),
    ...registry.files.map(fileSourceAgentView),
    ...registry.larks.map(larkSourceAgentView),
  ];
  return sources.filter((source) =>
    (type === undefined || source.type === type) &&
    (status === undefined || source.status === status)
  );
}

async function getProjectSource(projectRoot: string, id: string): Promise<Record<string, unknown>> {
  const matches = (await listProjectSources(projectRoot, {}))
    .filter((source) => source.name === id || source.id === id);
  if (matches.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `source '${id}' is not registered`, {
      category: ErrorCategory.SourceNotFound,
      sourceId: id,
    });
  }
  if (matches.length > 1) {
    throw new ContextError(ExitCode.WorkspaceStateError, `source '${id}' matches multiple registry entries`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      sourceId: id,
    });
  }
  const match = matches[0];
  if (match === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `source '${id}' is not registered`, {
      category: ErrorCategory.SourceNotFound,
      sourceId: id,
    });
  }
  return match;
}

export function registerProjectSourceCommands(program: Command): void {
  const source = program.command("source").description("Read or update project source registries");
  const sourceAdd = source.command("add").description("Add a project source");

  sourceAdd.command("batch [date]")
    .description("Register multiple repo, file, or Lark modules under one YYYYMMDD batch")
    .requiredOption("--input <file>", "YAML/JSON payload path, or - for stdin")
    .option("--format <format>", "output format: json | yaml | table", "table")
    .addHelpText("after", `
Payload example:
  sources:
    - type: repo
      module: module-a
      local: ../module-a
    - type: file
      local: ../docs/user-guide.md
    - type: lark
      url: https://example.larkoffice.com/wiki/example-token

repo.module is required. file.module and lark.module are optional; when omitted,
the CLI derives a lowercase path-safe module and rejects duplicate batch identities.
`)
    .action(async (namespace: string | undefined, ...args: unknown[]) => {
      const options = actionOptions(...args);
      const format = assertChoice(options.format, DATA_FORMATS, "--format") as DataFormat;
      const projectRoot = requireProjectRoot(process.cwd(), "source add batch");
      const sourceNamespace = resolveSourceName(namespace);
      const payload = await readYamlOrJsonInput({
        path: optionalString(options.input),
        label: "source add batch",
        missingNext: "Pass a YAML/JSON payload with a non-empty sources array.",
        readFailureNext: "Fix the input path or pass --input - for stdin, then retry.",
        parseFailureNext: "Fix the YAML/JSON syntax, then retry the same batch command.",
      });
      const result = await registerSourceBatch({
        projectRoot,
        namespace: sourceNamespace.name,
        payload,
      });
      writeFormatted(result, format);
    });

  sourceAdd.command("repo [date]")
    .description("Add or update a repo module under a valid YYYYMMDD batch in sources/repo/index.yaml")
    .requiredOption("--module <name>", "concrete repo/package module name")
    .option("--remote <url>", "repo remote URL; inferred from local origin when omitted")
    .option("--ref <sha>", "pinned commit/ref; inferred from local HEAD when omitted")
    .option("--local <path>", "local checkout path; may point at a monorepo subdirectory")
    .option("--format <format>", "output format: json | yaml | table", "table")
    .action(async (namespace: string | undefined, ...args: unknown[]) => {
      const options = actionOptions(...args);
      const format = assertChoice(options.format, DATA_FORMATS, "--format") as DataFormat;
      const projectRoot = requireProjectRoot(process.cwd(), "source add repo");
      const sourceNamespace = resolveSourceName(namespace);
      const module = optionalString(options.module);
      if (module === undefined) {
        throw new ContextError(ExitCode.UserError, "source add repo requires --module <name>", {
          category: ErrorCategory.UserInputInvalid,
          flag: "--module",
        });
      }
      const local = optionalString(options.local);
      const remote = optionalString(options.remote);
      const ref = optionalString(options.ref);
      const result = await addRepoSource({
        projectRoot,
        namespace: sourceNamespace.name,
        module,
        ...(local !== undefined ? { local } : {}),
        ...(remote !== undefined ? { remote } : {}),
        ...(ref !== undefined ? { ref } : {}),
      });
      writeFormatted(result, format);
    });

  sourceAdd.command("file [date]")
    .description("Register a file module under a YYYYMMDD batch in sources/file/index.yaml without reading contents")
    .option("--module <name>", "document module name; derived from --local when omitted")
    .option("--local <path>", "local Markdown directory or file path used as a refresh hint")
    .option("--include <glob>", "Markdown include glob relative to --local; repeatable", collectRepeated, undefined)
    .option("--include-list <file>", "newline-delimited include globs relative to --local; blank lines and # comments are ignored")
    .option("--format <format>", "output format: json | yaml | table", "table")
    .action(async (name: string | undefined, ...args: unknown[]) => {
      const options = actionOptions(...args);
      const format = assertChoice(options.format, DATA_FORMATS, "--format") as DataFormat;
      const projectRoot = requireProjectRoot(process.cwd(), "source add file");
      const sourceNamespace = resolveSourceName(name);
      const local = optionalString(options.local);
      if (local === undefined) {
        throw new ContextError(ExitCode.UserError, "source add file requires --local <path>", {
          category: ErrorCategory.UserInputInvalid,
          flag: "--local",
        });
      }
      const requestedModule = optionalString(options.module);
      const batchMode = sourceNamespace.generated || isDateSourceNamespace(sourceNamespace.name) || requestedModule !== undefined;
      const module = batchMode ? requestedModule ?? defaultFileModule(local) : undefined;
      const sourceName = module === undefined ? sourceNamespace.name : `${sourceNamespace.name}/${module}`;
      const include = await fileIncludesFromOptions(projectRoot, options);
      const result = await addFileSource({
        projectRoot,
        name: sourceName,
        ...(module !== undefined ? { namespace: sourceNamespace.name, module } : {}),
        local,
        ...(include !== undefined ? { include } : {}),
      });
      writeFormatted(result, format);
    });

  sourceAdd.command("lark [date]")
    .description("Register a Lark document module under a YYYYMMDD batch without fetching contents")
    .option("--module <name>", "document module name; derived from the URL or token when omitted")
    .option("--url <url>", "Lark/Feishu document or wiki URL")
    .option("--doc-token <token>", "Lark document identity token")
    .option("--wiki-token <token>", "Lark wiki identity token")
    .option("--title <title>", "optional user-readable source title")
    .option("--format <format>", "output format: json | yaml | table", "table")
    .action(async (name: string | undefined, ...args: unknown[]) => {
      const options = actionOptions(...args);
      const format = assertChoice(options.format, DATA_FORMATS, "--format") as DataFormat;
      const projectRoot = requireProjectRoot(process.cwd(), "source add lark");
      const sourceNamespace = resolveSourceName(name);
      const url = optionalString(options.url);
      const docToken = optionalString(options.docToken);
      const wikiToken = optionalString(options.wikiToken);
      const title = optionalString(options.title);
      const requestedModule = optionalString(options.module);
      const batchMode = sourceNamespace.generated || isDateSourceNamespace(sourceNamespace.name) || requestedModule !== undefined;
      const module = batchMode ? requestedModule ?? defaultLarkModule({
        ...(url !== undefined ? { url } : {}),
        ...(docToken !== undefined ? { docToken } : {}),
        ...(wikiToken !== undefined ? { wikiToken } : {}),
        ...(title !== undefined ? { title } : {}),
      }) : undefined;
      const sourceName = module === undefined ? sourceNamespace.name : `${sourceNamespace.name}/${module}`;
      const result = await addLarkSource({
        projectRoot,
        name: sourceName,
        ...(module !== undefined ? { namespace: sourceNamespace.name, module } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(docToken !== undefined ? { docToken } : {}),
        ...(wikiToken !== undefined ? { wikiToken } : {}),
        ...(title !== undefined ? { title } : {}),
      });
      writeFormatted(result, format);
    });

  source.command("ensure [name]")
    .description("Check repo source materialization without clone/checkout/reset")
    .option("--format <format>", "output format: json | yaml | table", "table")
    .action(async (name: string | undefined, ...args: unknown[]) => {
      const options = actionOptions(...args);
      const format = assertChoice(options.format, DATA_FORMATS, "--format") as DataFormat;
      const projectRoot = requireProjectRoot(process.cwd(), "source ensure");
      const documentMatches = await documentSourcesForName({
        projectRoot,
        ...(name !== undefined ? { name } : {}),
      });
      const repoMatches = name === undefined || (await listRepoSources(projectRoot)).some((repo) =>
        repo.name === name || repo.id === name || repo.namespace === name
      );
      const result = [
        ...(repoMatches || documentMatches.length === 0
          ? await ensureRepoSources({
              projectRoot,
              ...(name !== undefined ? { name } : {}),
            })
          : []),
        ...await inspectDocumentSources({
          projectRoot,
          ...(name !== undefined ? { name } : {}),
        }),
      ];
      writeFormatted(result, format);
    });

  source.command("recovery-plan [name]")
    .description("Plan recovery of missing repository checkouts without scanning, cloning, or changing files")
    .option("--format <format>", "output format: json | yaml | table", "json")
    .action(async (name: string | undefined, ...args: unknown[]) => {
      const options = actionOptions(...args);
      const format = assertChoice(options.format, DATA_FORMATS, "--format") as DataFormat;
      const projectRoot = requireProjectRoot(process.cwd(), "source recovery-plan");
      writeFormatted(await repositoryRecoveryPlan({
        projectRoot,
        ...(name === undefined ? {} : { source: name }),
      }), format);
    });

  source.command("restore")
    .description("Restore registered repository checkouts from explicit local or clone decisions")
    .requiredOption("--input <file>", "YAML/JSON recovery payload path, or - for stdin")
    .option("--format <format>", "output format: json | yaml | table", "json")
    .action(async (...args: unknown[]) => {
      const options = actionOptions(...args);
      const format = assertChoice(options.format, DATA_FORMATS, "--format") as DataFormat;
      const projectRoot = requireProjectRoot(process.cwd(), "source restore");
      const raw = await readYamlOrJsonInput({
        path: optionalString(options.input),
        label: "context source restore",
        missingNext: "Use the recovery plan and pass --input <payload.yaml|json> or --input -.",
        readFailureNext: "Check the recovery payload path and retry.",
        parseFailureNext: "Fix the YAML/JSON recovery payload and retry.",
      });
      writeFormatted(await restoreRepositorySources({
        projectRoot,
        payload: parseRepositoryRecoveryPayload(raw),
      }), format);
    });

  source.command("list")
    .description("List source registry entries")
    .option("--type <type>", "source type filter")
    .option("--status <status>", "source status filter")
    .option("--format <format>", "output format: json | yaml | table", "json")
    .action(async (...args: unknown[]) => {
      const options = actionOptions(...args);
      const projectRoot = requireProjectRoot(process.cwd(), "source list");
      const projectSources = await listProjectSources(projectRoot, options);
      const format = assertChoice(options.format, DATA_FORMATS, "--format") as DataFormat;
      writeFormatted(projectSources, format);
    });

  source.command("get <id>")
    .description("Show one source registry entry")
    .option("--format <format>", "output format: json | yaml", "json")
    .action(async (id: string, ...args: unknown[]) => {
      const options = actionOptions(...args);
      const projectRoot = requireProjectRoot(process.cwd(), "source get");
      const projectSource = await getProjectSource(projectRoot, id);
      const format = assertChoice(options.format, ["json", "yaml"] as const, "--format");
      writeFormatted(projectSource, format);
    });

  source.command("remove <id>")
    .description("Preview or remove one unreferenced source and its managed snapshot")
    .option("--yes", "apply the removal after reference checks")
    .option("--plan-digest <digest>", "bind --yes to the exact previewed cleanup plan")
    .option("--format <format>", "output format: json | yaml | table", "json")
    .action(async (id: string, ...args: unknown[]) => {
      const options = actionOptions(...args);
      const projectRoot = requireProjectRoot(process.cwd(), "source remove");
      const format = assertChoice(options.format, DATA_FORMATS, "--format") as DataFormat;
      const result = await removeProjectSource({
        projectRoot,
        selector: id,
        apply: options.yes === true,
        ...(typeof options.planDigest === "string" ? { planDigest: options.planDigest } : {}),
      });
      writeFormatted(result, format);
    });

  source.command("inspect [name]")
    .description("Inspect repo source module boundaries without extraction")
    .option("--format <format>", "output format: json | yaml | table", "table")
    .action(async (name: string | undefined, ...args: unknown[]) => {
      const options = actionOptions(...args);
      const projectRoot = requireProjectRoot(process.cwd(), "source inspect");
      const documentMatches = await documentSourcesForName({
        projectRoot,
        ...(name !== undefined ? { name } : {}),
      });
      const repoMatches = name === undefined || (await listRepoSources(projectRoot)).some((repo) =>
        repo.name === name || repo.id === name || repo.namespace === name
      );
      const result = [
        ...(repoMatches || documentMatches.length === 0
          ? await inspectRepoSources({
              projectRoot,
              ...(name !== undefined ? { name } : {}),
            })
          : []),
        ...await inspectDocumentSources({
          projectRoot,
          ...(name !== undefined ? { name } : {}),
        }),
      ];
      const format = assertChoice(options.format, DATA_FORMATS, "--format") as DataFormat;
      writeFormatted(result, format);
    });
}
