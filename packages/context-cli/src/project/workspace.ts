import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContextProjectModule } from "@c4a/context";
import { createJiti } from "jiti";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  PACKAGE_TEMPLATE_REVIEW_FILE,
  writeStarterTemplateReviewMarker,
} from "./packageTemplateReview.js";
import { enableContextDebug } from "./debugTrace.js";
import {
  disableDocumentOptimization,
  enableDocumentOptimization,
} from "./documentOptimizationConfig.js";
import { renderAgents, renderProjectEntry, renderReadme } from "./workspaceGuidanceTemplates.js";
import { assertTrustedContextProjectConfigBoundary } from "./projectModulePolicy.js";

const PROJECT_DIRS = ["src", "sources", "knowledge", "dist"] as const;
const PROJECT_SCRATCH_DIRS = [join(".tmp", "agent-payloads")] as const;
const DEFAULT_PROJECT_DIR = "context";
const DEFAULT_PROJECT_ENTRY = "src/index.ts";
export const PROJECT_LANGUAGES = ["en", "zh-CN"] as const;
export type ProjectLanguage = typeof PROJECT_LANGUAGES[number];

export interface ContextProjectLocation {
  projectRoot: string;
}

export interface ProjectInitInput {
  cwd: string;
  projectDir?: string;
  name?: string;
  language?: ProjectLanguage;
  dev?: boolean;
  debug?: boolean;
  optimizeDocs?: boolean;
  allowNonempty?: boolean;
}

export interface ProjectInitResult {
  projectRoot: string;
  projectName: string;
  language: ProjectLanguage;
  created: string[];
  kept: string[];
}

interface StaticTemplateFile {
  absolutePath: string;
  relativePath: string;
}

interface PackageJsonContextProject {
  project: true;
  entry: string;
}

export interface ContextWorkspaceExpectation {
  markerRoot: string;
  workspaceDir: string;
  workspaceRoot: string;
  cwd: string;
  exists: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPackageJson(root: string): Record<string, unknown> | null {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readPackageJsonFile(packageJsonPath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveExportImportTarget(packageJsonPath: string): string | null {
  const parsed = readPackageJsonFile(packageJsonPath);
  if (parsed === null) return null;
  const exportsField = parsed.exports;
  if (typeof exportsField === "string") {
    return join(dirname(packageJsonPath), exportsField);
  }
  if (isRecord(exportsField)) {
    const rootExport = exportsField["."];
    if (typeof rootExport === "string") {
      return join(dirname(packageJsonPath), rootExport);
    }
    if (isRecord(rootExport) && typeof rootExport.import === "string") {
      return join(dirname(packageJsonPath), rootExport.import);
    }
  }
  if (typeof parsed.module === "string") {
    return join(dirname(packageJsonPath), parsed.module);
  }
  if (typeof parsed.main === "string") {
    return join(dirname(packageJsonPath), parsed.main);
  }
  return null;
}

function resolveContextSdkImportAlias(entryPath: string): string {
  for (const requireBase of [entryPath, import.meta.url]) {
    try {
      const packageJsonPath = createRequire(requireBase).resolve("@c4a/context/package.json");
      const importTarget = resolveExportImportTarget(packageJsonPath);
      if (importTarget !== null) return importTarget;
    } catch {
      // Try the next resolution base before surfacing a project-entry load error.
    }
  }
  return "@c4a/context";
}

function readCurrentPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index++) {
    const packagePath = join(dir, "package.json");
    if (existsSync(packagePath)) {
      const parsed = readPackageJson(dir);
      if (typeof parsed?.version === "string" && parsed.version.trim().length > 0) {
        return parsed.version;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}

function readContextProjectPackage(root: string): PackageJsonContextProject | null {
  const parsed = readPackageJson(root);
  const context = isRecord(parsed?.context) ? parsed.context : null;
  if (context?.project !== true || typeof context.entry !== "string" || context.entry.trim().length === 0) {
    return null;
  }
  return {
    project: true,
    entry: context.entry,
  };
}

function readContextWorkspaceDir(root: string): string | null {
  const parsed = readPackageJson(root);
  const context = isRecord(parsed?.context) ? parsed.context : null;
  const workspaceDir = context?.workspaceDir;
  if (typeof workspaceDir !== "string" || workspaceDir.trim().length === 0) return null;
  return workspaceDir.trim();
}

function readContextProjectLanguage(root: string): ProjectLanguage | undefined {
  const parsed = readPackageJson(root);
  const context = isRecord(parsed?.context) ? parsed.context : null;
  return context?.language === "en" || context?.language === "zh-CN"
    ? context.language
    : undefined;
}

function isSameOrChildPath(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function findContextWorkspaceExpectation(startDir: string = process.cwd()): ContextWorkspaceExpectation | null {
  const cwd = resolve(startDir);
  let dir = cwd;
  const root = parse(dir).root;
  while (true) {
    const workspaceDir = readContextWorkspaceDir(dir);
    if (workspaceDir !== null) {
      const workspaceRoot = resolve(dir, workspaceDir);
      if (!isSameOrChildPath(cwd, workspaceRoot)) {
        return {
          markerRoot: dir,
          workspaceDir,
          workspaceRoot,
          cwd,
          exists: existsSync(workspaceRoot),
        };
      }
    }
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function assertContextStatusWorkspaceAllowed(startDir: string = process.cwd()): void {
  const expectation = findContextWorkspaceExpectation(startDir);
  if (expectation === null) return;
  if (expectation.exists) {
    throw new ContextError(ExitCode.WorkspaceStateError, "status must run inside the configured Context workspace", {
      category: ErrorCategory.WorkspaceNotFound,
      path: expectation.workspaceRoot,
      next: `cd ${JSON.stringify(expectation.workspaceRoot)} && context status`,
    });
  }
  throw new ContextError(ExitCode.WorkspaceStateError, "configured Context workspace is missing", {
    category: ErrorCategory.WorkspaceNotFound,
    path: expectation.workspaceRoot,
    next: `Run context init ${JSON.stringify(expectation.workspaceDir)} from ${expectation.markerRoot}; use --dev only for local SDK link tests. Then cd ${JSON.stringify(expectation.workspaceRoot)}, read AGENTS.md, and rerun context status.`,
  });
}

export function isContextProjectRoot(root: string): boolean {
  return readContextProjectPackage(root) !== null;
}

export function findContextProjectRoot(startDir: string = process.cwd()): ContextProjectLocation | null {
  let dir = resolve(startDir);
  const root = parse(dir).root;
  while (true) {
    if (isContextProjectRoot(dir)) return { projectRoot: dir };
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function normalizeProjectDir(cwd: string, projectDir: string | undefined): string {
  const raw = projectDir?.trim() || DEFAULT_PROJECT_DIR;
  return raw === "." ? resolve(cwd) : resolve(cwd, raw);
}

export function resolveContextProjectInitTarget(cwd: string, projectDir: string | undefined): string {
  return normalizeProjectDir(cwd, projectDir);
}

function slugifyName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length > 0 ? slug : "context";
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._/=-]+$/u.test(value) ? value : `'${value.replace(/'/gu, "'\\''")}'`;
}

export function projectLanguage(value: unknown): ProjectLanguage {
  if (value === undefined || value === "en") return "en";
  if (value === "zh-CN") return value;
  throw new ContextError(ExitCode.UserError, "--language must be en or zh-CN", {
    category: ErrorCategory.UserInputInvalid,
  });
}

function initCommand(input: ProjectInitInput, allowNonempty: boolean): string {
  const args = ["context", "init", input.projectDir?.trim() || DEFAULT_PROJECT_DIR];
  if (input.name !== undefined) args.push("--name", input.name);
  if (input.language !== undefined) args.push("--language", input.language);
  if (input.dev === true) args.push("--dev");
  if (allowNonempty) args.push("--allow-nonempty");
  return args.map(shellQuote).join(" ");
}

async function assertInitTargetAllowed(input: ProjectInitInput, projectRoot: string): Promise<void> {
  if (!existsSync(projectRoot) || isContextProjectRoot(projectRoot) || input.allowNonempty === true) return;
  const entries = (await readdir(projectRoot)).filter((entry) => entry !== ".git").sort();
  if (entries.length === 0) return;
  const command = initCommand(input, true);
  throw new ContextError(ExitCode.UserError, "init target is non-empty and is not a Context workspace", {
    category: ErrorCategory.UserInputInvalid,
    reason_code: "init-target-nonempty",
    path: projectRoot,
    entries_count: entries.length,
    entries_preview: entries.slice(0, 10),
    next_action: {
      kind: "confirm_nonempty_init",
      command,
      reason_code: "init-target-nonempty-confirmation-required",
    },
    input_schema: {
      confirmation: "Explicit approval to preserve existing files and add the Context workspace skeleton to this directory.",
    },
    next: `Confirm that Context should be initialized inside this existing directory, then run ${command}.`,
  });
}

async function writeIfMissing(path: string, content: string, result: ProjectInitResult): Promise<void> {
  if (existsSync(path)) {
    result.kept.push(path);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  result.created.push(path);
}

async function listStaticTemplateFiles(root: string, dir: string = root): Promise<StaticTemplateFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: StaticTemplateFile[] = [];
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listStaticTemplateFiles(root, absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push({
      absolutePath,
      relativePath: relative(root, absolutePath).split(/[/\\]+/u).join("/"),
    });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function resolveContextPackageTemplatesRoot(): string {
  try {
    const packageJsonPath = createRequire(import.meta.url).resolve("@c4a/context/package.json");
    const templateRoot = join(dirname(packageJsonPath), "templates", "package-templates");
    if (existsSync(templateRoot)) return templateRoot;
  } catch {
    // Report one actionable init failure below.
  }
  throw new ContextError(ExitCode.WorkspaceStateError, "missing @c4a/context package templates", {
    category: ErrorCategory.WorkspaceStateInvalid,
    path: "@c4a/context/templates/package-templates",
    next: "Reinstall or rebuild @c4a/context so package templates are available, then rerun context init.",
  });
}

async function writeDefaultPackageTemplates(
  projectRoot: string,
  result: ProjectInitResult,
  language: ProjectLanguage,
): Promise<void> {
  const defaultRoot = resolveContextPackageTemplatesRoot();
  const templateRoot = language === "zh-CN"
    ? join(dirname(defaultRoot), "package-templates.zh-CN")
    : defaultRoot;
  if (!existsSync(templateRoot)) {
    throw new ContextError(ExitCode.WorkspaceStateError, `missing ${language} @c4a/context package templates`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      path: templateRoot,
      next: "Reinstall or rebuild @c4a/context so localized package templates are available, then rerun context init.",
    });
  }
  const files = await listStaticTemplateFiles(templateRoot);
  for (const file of files) {
    await writeIfMissing(
      join(projectRoot, "src", "package-templates", ...file.relativePath.split("/")),
      await readFile(file.absolutePath, "utf8"),
      result,
    );
  }
  const templateKinds = [...new Set(files.map((file) => file.relativePath.split("/")[0]).filter(
    (value): value is string => value !== undefined && value.length > 0,
  ))];
  for (const templateKind of templateKinds) {
    const root = join(projectRoot, "src", "package-templates", templateKind);
    if (await writeStarterTemplateReviewMarker(root)) {
      result.created.push(join(root, PACKAGE_TEMPLATE_REVIEW_FILE));
    } else {
      result.kept.push(join(root, PACKAGE_TEMPLATE_REVIEW_FILE));
    }
  }
}

function resolveLocalSdkDependency(): string {
  const packageJsonPath = createRequire(import.meta.url).resolve("@c4a/context/package.json");
  return `file:${dirname(packageJsonPath)}`;
}

function resolveSdkDependency(dev: boolean | undefined, version: string): string {
  return dev === true ? resolveLocalSdkDependency() : version;
}

function renderPackageJson(
  name: string,
  version: string,
  dev: boolean | undefined,
  language: ProjectLanguage,
  debug: boolean | undefined,
  optimizeDocs: boolean | undefined,
): string {
  return `${JSON.stringify({
    name,
    private: true,
    type: "module",
    context: {
      project: true,
      entry: DEFAULT_PROJECT_ENTRY,
      language,
      ...(debug === true ? { debug: true } : {}),
      ...(optimizeDocs === true ? { documentOptimization: true } : {}),
    },
    scripts: {
      check: "context status",
    },
    dependencies: {
      "@c4a/context": resolveSdkDependency(dev, version),
    },
    devDependencies: {
      typescript: "^5.5.4",
    },
  }, null, 2)}\n`;
}

function renderRepoIndex(): string {
  return [
    "sources: []",
    "",
  ].join("\n");
}

function renderFileIndex(): string {
  return [
    "sources: []",
    "",
  ].join("\n");
}

function renderLarkIndex(): string {
  return [
    "sources: []",
    "",
  ].join("\n");
}

function renderGitignore(): string {
  return [
    ".tmp/",
    "node_modules/",
    "dist/",
    "sources/repo/*",
    "!sources/repo/index.yaml",
    "sources/**/.tmp/",
    "sources/**/.cache/",
    "",
  ].join("\n");
}

export async function initContextProject(input: ProjectInitInput): Promise<ProjectInitResult> {
  const projectRoot = normalizeProjectDir(input.cwd, input.projectDir);
  await assertInitTargetAllowed(input, projectRoot);
  const projectName = slugifyName(input.name ?? basename(projectRoot));
  const requestedLanguage = projectLanguage(input.language);
  const existingLanguage = readContextProjectLanguage(projectRoot);
  if (
    input.language !== undefined &&
    existingLanguage !== undefined &&
    existingLanguage !== requestedLanguage
  ) {
    throw new ContextError(ExitCode.UserError, `existing Context workspace language is ${existingLanguage}, not ${requestedLanguage}`, {
      category: ErrorCategory.UserInputInvalid,
      next: "Edit maintained workspace and package templates explicitly instead of rerunning init with another language.",
    });
  }
  const language = existingLanguage ?? requestedLanguage;
  const result: ProjectInitResult = {
    projectRoot,
    projectName,
    language,
    created: [],
    kept: [],
  };

  for (const dir of PROJECT_DIRS) {
    await mkdir(join(projectRoot, dir), { recursive: true });
  }
  for (const dir of PROJECT_SCRATCH_DIRS) {
    await mkdir(join(projectRoot, dir), { recursive: true });
  }
  await mkdir(join(projectRoot, "sources", "repo"), { recursive: true });
  await mkdir(join(projectRoot, "sources", "file"), { recursive: true });
  await mkdir(join(projectRoot, "sources", "lark"), { recursive: true });
  await writeIfMissing(
    join(projectRoot, "package.json"),
    renderPackageJson(
      projectName,
      readCurrentPackageVersion(),
      input.dev,
      language,
      input.debug,
      input.optimizeDocs,
    ),
    result,
  );
  await writeIfMissing(join(projectRoot, "src", "index.ts"), renderProjectEntry(language), result);
  await writeDefaultPackageTemplates(projectRoot, result, language);
  await writeIfMissing(join(projectRoot, "sources", "repo", "index.yaml"), renderRepoIndex(), result);
  await writeIfMissing(join(projectRoot, "sources", "file", "index.yaml"), renderFileIndex(), result);
  await writeIfMissing(join(projectRoot, "sources", "lark", "index.yaml"), renderLarkIndex(), result);
  await writeIfMissing(join(projectRoot, ".gitignore"), renderGitignore(), result);
  await writeIfMissing(join(projectRoot, "README.md"), renderReadme(projectName, language), result);
  await writeIfMissing(join(projectRoot, "AGENTS.md"), renderAgents(projectName, language), result);

  if (input.debug === true) await enableContextDebug(projectRoot, "init");
  if (input.optimizeDocs === true) await enableDocumentOptimization(projectRoot);
  if (input.optimizeDocs === false) await disableDocumentOptimization(projectRoot);

  return result;
}

export async function loadContextProjectModule(root: string): Promise<ContextProjectModule> {
  const projectConfig = readContextProjectPackage(root);
  if (projectConfig === null) {
    throw new ContextError(ExitCode.WorkspaceStateError, "package.json must declare context.project=true and context.entry", {
      category: ErrorCategory.SchemaInvalid,
      path: "package.json",
      next: "Ensure package.json declares context.project=true and context.entry points to src/index.ts, then rerun the command.",
    });
  }
  const entryPath = join(root, projectConfig.entry);
  const jiti = createJiti(entryPath, {
    alias: {
      "@c4a/context": resolveContextSdkImportAlias(entryPath),
    },
    // Bun's native resolver applies an ancestor workspace's tsconfig paths
    // before Jiti aliases. A nested Context project must use its own installed
    // SDK, not an unrelated parent monorepo package with the same name.
    tryNative: false,
    fsCache: false,
    interopDefault: true,
    moduleCache: false,
  });
  const loadedProject = await jiti.import<unknown>(entryPath, { default: true });
  if (!isRecord(loadedProject) || loadedProject.kind !== "context.project") {
    throw new ContextError(ExitCode.WorkspaceStateError, "src/index.ts default export must be a @c4a/context project module", {
      category: ErrorCategory.SchemaInvalid,
      path: projectConfig.entry,
      next: "Export default defineProject({...}) from the configured context.entry, then rerun the command.",
    });
  }
  const projectModule = loadedProject as unknown as ContextProjectModule;
  assertTrustedContextProjectConfigBoundary(projectModule);
  const firstPhaseById = new Map<string, { index: number; kind: string }>();
  for (const [index, phase] of projectModule.project.phases.entries()) {
    const first = firstPhaseById.get(phase.id);
    if (first !== undefined) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        `Duplicate Context phase id ${JSON.stringify(phase.id)}: phases[${first.index}] (${first.kind}) conflicts with phases[${index}] (${phase.kind}). Every phase id must be unique.`,
        {
          category: ErrorCategory.SchemaInvalid,
          path: projectConfig.entry,
          next: "Give every phase in src/index.ts a unique derived or explicit id, then rerun context status.",
        },
      );
    }
    firstPhaseById.set(phase.id, { index, kind: phase.kind });
  }
  return projectModule;
}

export function formatProjectInitResult(result: ProjectInitResult): string {
  const rel = (path: string) => isAbsolute(path) ? path : resolve(path);
  const projectRoot = rel(result.projectRoot);
  const next = `cd ${JSON.stringify(projectRoot)} && mkdir -p .tmp/install && TMPDIR="$PWD/.tmp/install" bun install`;
  const workspaceMode = result.created.length === 0 && result.kept.length > 0
    ? "existing workspace reused"
    : result.kept.length > 0
      ? "existing workspace completed"
      : "new workspace created";
  return formatFeedback({
    symbol: "✓",
    action: "initialized",
    subject: JSON.stringify(result.projectName),
    headline: workspaceMode,
    body: [
      "**Project**:",
      `- root → \`${projectRoot}\``,
      `- result → ${workspaceMode}`,
      `- language → ${result.language}`,
      `- created → ${result.created.length}`,
      `- kept → ${result.kept.length}`,
      ...(result.kept.length > 0
        ? [`- preserved existing files → ${result.kept.map((path) => path.replace(`${projectRoot}/`, "")).join(", ")}`]
        : []),
      "",
      "**Next action**:",
      `- command → \`${next}\``,
      "- enter the workspace, install dependencies, then read `AGENTS.md` before running `context status`",
      "- after reading `AGENTS.md`, read `node_modules/@c4a/context/docs/README.md` before editing `src/index.ts` or package templates",
    ],
    next,
  });
}
