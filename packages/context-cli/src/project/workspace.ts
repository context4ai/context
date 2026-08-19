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

const PROJECT_DIRS = ["src", "sources", "knowledge", "dist"] as const;
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
  const entries = (await readdir(projectRoot)).sort();
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
    },
    scripts: {
      check: "context status",
    },
    dependencies: {
      "@c4a/context": resolveSdkDependency(dev, version),
    },
    devDependencies: {
      typescript: "latest",
    },
  }, null, 2)}\n`;
}

function renderProjectEntry(language: ProjectLanguage): string {
  if (language === "zh-CN") {
    return [
      'import { defineProject } from "@c4a/context";',
      "",
      "// 使用 `context source add ...` 添加 repo/file/lark 来源，然后在此声明阶段。",
      "// `context status --format json` 会选择当前步骤所需的流程文档。",
      "// SDK 文档：node_modules/@c4a/context/docs/reference/project-api.md",
      "// 包输出指南：node_modules/@c4a/context/docs/guides/package-outputs.md",
      "// 包模板：node_modules/@c4a/context/docs/reference/package-templates.md",
      "",
      "export default defineProject({",
      "  sources: [],",
      "  phases: [],",
      "  packages: [],",
      "});",
      "",
    ].join("\n");
  }
  return [
    'import { defineProject } from "@c4a/context";',
    "",
    "// Add repo/file/lark sources with `context source add ...`, then declare phases here.",
    "// Step-specific procedures are selected by `context status --format json`.",
    "// SDK docs: node_modules/@c4a/context/docs/reference/project-api.md",
    "// Package output guide: node_modules/@c4a/context/docs/guides/package-outputs.md",
    "// Package templates: node_modules/@c4a/context/docs/reference/package-templates.md",
    "// Example:",
    "//",
    '// import { extractTs, kbPackage, llmsPackage, reviewValidity, source } from "@c4a/context";',
    '// const sampleLib = source("20260712", "sample-lib");',
    "//",
    "// phases: [",
    '//   extractTs({ source: sampleLib, collection: "codegraph" }),',
    '//   reviewValidity({ collection: "codegraph" }),',
    "// ],",
    "// packages: [",
    "//   // Add one package only after the user chooses the output shape and templates.",
    "//   // Recommended first output is a kb package; add llms later only after confirmation.",
    '//   kbPackage({ name: "sample-lib-kb", template: { path: "src/package-templates/kb", vars: { displayName: "Sample Library KB" } } }),',
    "// ],",
    "",
    "export default defineProject({",
    "  sources: [],",
    "  phases: [],",
    "  packages: [],",
    "});",
    "",
  ].join("\n");
}

function renderReadme(projectName: string, language: ProjectLanguage): string {
  if (language === "zh-CN") {
    return [
      `# ${projectName}`,
      "",
      "这是一个项目内的 Context 工作区。",
      "",
      "## 初始化",
      "",
      "```bash",
      "mkdir -p .tmp/install",
      'TMPDIR="$PWD/.tmp/install" bun install',
      "context status --format json",
      "```",
      "",
      "使用 `context plugin install` 安装或刷新全局 Agent 集成。后续以状态返回的合法命令、门禁和手册为准，不要根据记忆选择生命周期命令。",
      "",
      "## 目录",
      "",
      "- `src/index.ts`：来源、阶段和输出包声明。",
      "- `src/package-templates/`：输出包模板。",
      "- `sources/`：来源注册信息和采集快照。",
      "- `knowledge/`：持久知识及其结构投影。",
      "- `dist/`：生成的知识包。",
      "- `.tmp/agent-payloads/`：Agent 可选的临时命令输入，成功 stage/apply 后可以删除。",
      "- `.tmp/install/`：依赖安装使用的工作区本地临时目录。",
      "- `.tmp/context-runtime/`：可删除的 Context 运行时状态。",
      "",
      "不要创建另一个隐藏 Context 工作区，也不要手工修改生命周期状态。",
      "",
      "## 手册",
      "",
      "优先阅读 `context status --format json` 为当前步骤选择的资源。通用 SDK 文档入口：",
      "",
      "- `node_modules/@c4a/context/docs/README.md`",
      "- `node_modules/@c4a/context/docs/reference/project-api.md`",
      "- `node_modules/@c4a/context/docs/reference/package-templates.md`",
      "",
    ].join("\n");
  }
  return [
    `# ${projectName}`,
    "",
    "This is a project-local Context workspace.",
    "",
    "## Setup",
    "",
    "```bash",
    "mkdir -p .tmp/install",
    'TMPDIR="$PWD/.tmp/install" bun install',
    "context status --format json",
    "```",
    "",
    "Install or refresh the global Agent integration with `context plugin install`. The current status response selects the legal commands, gates, and manuals for the next step; do not choose lifecycle commands from a memorized sequence.",
    "",
    "## Project Layout",
    "",
    "- `src/index.ts`: source, phase, and package declarations.",
    "- `src/package-templates/`: package output templates.",
    "- `sources/`: registered sources and captured snapshots.",
    "- `knowledge/`: durable knowledge, its structural projection with minimal closed source inputs, and compact rejected-candidate fingerprints.",
    "- `dist/`: generated packages.",
    "- `.tmp/agent-payloads/`: optional Agent-owned command inputs. These files are transient and can be removed after the corresponding stage or apply succeeds.",
    "- `.tmp/install/`: workspace-local temporary files used during dependency installation.",
    "- `.tmp/context-runtime/`: disposable runtime files, including lifecycle candidates and staged structures. Successful close removes completed lifecycle and Review state.",
    "",
    "Do not create another hidden Context workspace or edit lifecycle-managed state by hand.",
    "",
    "## Manuals",
    "",
    "Use the resources selected by `context status --format json` for step-specific instructions. General SDK documentation starts at:",
    "",
    "- `node_modules/@c4a/context/docs/README.md`",
    "- `node_modules/@c4a/context/docs/reference/project-api.md`",
    "- `node_modules/@c4a/context/docs/reference/package-templates.md`",
    "",
  ].join("\n");
}

function renderAgents(projectName: string, language: ProjectLanguage): string {
  if (language === "zh-CN") {
    return [
      `# ${projectName} Context 项目`,
      "",
      "这是项目内的 Context 工作区。Context CLI 负责生命周期事实和合法动作；Agent 负责解释选择、获得决定和编辑项目声明。",
      "",
      "## 执行契约",
      "",
      "- 使用已安装的 Context 命令或 Skill 开始或恢复工作；CLI 入口是 `context status --format json`。",
      "- 将 `workflow.current` 视为当前步骤的权威。读取所有 `read_state: read-required` 的必需资源，只执行返回的命令，并原样保留 revision 与 authority 参数。阶段内的 `next_action` 只能继续当前操作，不能取代工作区 Route。",
      "- 读取全部直接必读路径后，仅执行一次 `resources.after_read.command`；它会直接返回重新求值后的 `workflow.current`，无需再运行 status。动态资源按 `materialize → 读取完整文件 → 执行 next_action.command` 处理。Context 会自动携带合并后的 Receipt；仅 materialize 不代表已阅读。内容 digest 不变时可以跨 revision 复用，内容变化必须重读。来源索引不能代替正文。",
      "- Route 返回 `configuration` 时，只修改指定项目文件，然后重新运行 status。不要从记忆中选择下一条生命周期命令。",
      "- `execution.target: agent-host` 的命令必须作为宿主顶层动作执行，不能嵌套到受限子沙箱；宿主需要授权时按其机制申请，禁止通过降低凭据存储安全性绕过。",
      "- 全托管只在用户于当前会话明确提出时生效。明确授权后默认先运行 `context run --managed --until blocked-or-complete --format json`，不要手工重复 status/action；循环停止后才消费返回的 `workflow.current`。会话结束或用户撤销后立即停止，禁止持久化或跨会话复用授权。全托管不能选择来源、授权未请求的外部读取，也不能绕过验证。",
      "- Managed loop 会连续执行确定性 Route；遇到 Agent 判断、项目配置、缺失授权、诊断或多项选择时停止。恢复 status 时必须继续携带 `--managed`。",
      "- 使用用户当前会话语言解释、提问和总结；命令、路径、ID、状态值、Payload 字段及 `source_ref` 保持原样。",
      "",
      "## 安全边界",
      "",
      "- 来源边界、正文读取、提取范围、语义分类、结构确认、Review 和包形态均是显式门禁，除非当前 Route 已证明可以继续。",
      "- 不得根据目录、文件名、URL、示例或旧会话推断用户决定；没有明确授权时不得扫描或对来源仓库执行 clone、fetch、checkout、install、build、test 或脚本。已登记仓库 checkout 缺失时，使用 Route 返回的恢复计划和恢复动作，不手工创建来源软链。",
      "- 生命周期写入必须使用 Context CLI，不得用临时脚本修改 `sources/`、`knowledge/`、`dist/` 或 `.tmp/context-runtime/`。",
      "- 飞书采集只在 `evidence_status: error` 时停止；`projection_status: generic|warning` 表示原始 XML 已保留且可继续。不得在用户工作区修补 CLI 或手改快照来增加 renderer。",
      "- Agent 编写的临时输入优先放在 `.tmp/agent-payloads/`；这是推荐而非强制。不要自行创建 `inputs/` 等顶层临时目录。",
      "- Context 完成只证明知识工作流状态，不证明 Git 提交范围安全。保留任务开始前已有的工作树变更，只按明确路径暂存；不要用 `git add -A` 把无关修改、删除或未跟踪目录带入提交。",
      "- 调试追踪默认关闭；仅在用户明确要求时使用 `context debug enable`。追踪只写入 `.tmp/context-runtime/debug/`，属于观测数据，不能作为生命周期事实或授权依据。",
      "- 普通 Review 使用用户原样提供的 Payload；托管批准只能使用托管 status 返回的 revision-bound 原子命令。",
      "- Route 允许时，只读证据可以并行；注册、stage、confirm、Review apply、close 和 build 必须串行。",
      "- build 成功只代表当前已声明范围完成；新增或尚未处理的来源会重新打开更早的 Route。",
      "",
      "## 标准手册",
      "",
      "- 只读取 `workflow.current.resources` 为当前步骤选择的手册和 Schema。",
      "- SDK 总入口：`node_modules/@c4a/context/docs/README.md`。",
      "- 项目声明：`node_modules/@c4a/context/docs/reference/project-api.md`。",
      "- 可选项目维护 Skill 模板：`node_modules/@c4a/context/templates/project-skills.zh-CN/maintain-project-knowledge/SKILL.md`。",
      "- 使用 `context plugin install` 安装或刷新全局 Agent 集成。",
      "",
    ].join("\n");
  }
  return [
    `# ${projectName} Context Project`,
    "",
    "This is a project-local Context workspace. Context CLI owns lifecycle facts and legal actions; the Agent explains choices, obtains decisions, and edits declared project configuration.",
    "",
    "## Operating Contract",
    "",
    "- Start or resume with the installed Context command/skill. Its CLI entry is `context status --format json`.",
    "- Treat `workflow.current` as the current-step authority. Read every `resources.required` item whose `read_state` is `read-required`, execute only returned commands, and preserve revision/authority flags exactly. A phase-local `next_action` may continue that operation but never replaces the workspace route.",
    "- Read every required direct `path` marked `read-required`, then execute `resources.after_read.command` once when present; it returns the re-evaluated `workflow.current`, so do not run another status command. For a materialized resource, execute its `command`, read the complete returned file, then execute its exact `next_action.command`. Context carries the merged receipt file forward automatically; materialization alone is not a read. An unchanged digest returns `read_state: current` across workflow revisions, while changed bytes require a new read. Every required `context.source-body/*` resource is full source evidence; an index or heading list never replaces body reading. Use `resources.recommended` only when needed.",
    "- When the route returns `configuration`, change only the named project file using the selected resources, then rerun status. After every action, rerun status instead of choosing the next lifecycle command from memory.",
    "- Run commands with `execution.target: agent-host` as top-level host actions, not inside a restricted child sandbox. Use the host's approval flow when needed; never weaken credential storage as a workaround.",
    "- Fully managed mode applies only when the user explicitly requests it in the current conversation. After that grant, start with `context run --managed --until blocked-or-complete --format json` instead of manually repeating status/action. When the loop stops, resume from its returned `workflow.current`; use `context status --managed --format json` for every status evaluation and stop using it when the conversation ends or the user revokes it; never store or reuse that authority. It cannot choose sources, authorize unrequested source-body reads or external operations, or bypass validation and verification. When the user explicitly asks to capture named documents, follow the source-read Gate's returned authority-carrying command instead of running a bare capture phase.",
    "- The managed loop executes consecutive deterministic routes and stops before Agent interpretation, project configuration, missing authority, diagnostics, or multiple commands.",
    "- Explain, ask, and summarize in the user's current conversation language. Keep commands, paths, ids, status values, payload keys, and `source_ref` tokens unchanged.",
    "",
    "## Safety Boundaries",
    "",
    "- Source boundaries, source-body reads, extraction scope, semantic classification, structure confirmation, Review, and package shape remain explicit gates unless the current route proves otherwise.",
    "- Never infer source or review decisions from repository layout, filenames, URLs, examples, or prior conversations. Never scan for, clone, fetch, checkout, install, build, test, or run source-repository scripts without explicit authority. When registered repository checkouts are missing, use the Route-selected recovery plan and resolution action instead of creating source links by hand.",
    "- Use Context CLI for lifecycle writes. Do not inspect or repair `sources/`, `knowledge/`, `dist/`, or `.tmp/context-runtime/` with ad hoc scripts.",
    "- Stop Lark capture only for `evidence_status: error`. A `projection_status` of `generic` or `warning` means the original XML is preserved and the route may continue. Never patch the CLI or edit snapshots in a user workspace to add a renderer.",
    "- Prefer `.tmp/agent-payloads/` for Agent-authored transient command inputs. This is a recommendation, not a CLI requirement; explicit custom paths remain valid. Avoid inventing top-level scratch directories such as `inputs/`.",
    "- Context completion proves knowledge-workflow state, not Git commit safety. Preserve worktree changes that existed before the task, stage only explicit paths, and never use `git add -A` to mix unrelated modifications, deletions, or untracked directories into the deliverable.",
    "- Debug tracing is off by default; use `context debug enable` only when the user explicitly requests it. Trace files stay in `.tmp/context-runtime/debug/` and are observational data, never lifecycle facts or authority.",
    "- Review uses the user's exact Payload in ordinary mode. Managed approval uses only the revision-bound atomic command returned by managed status.",
    "- Evidence reads may be parallel when the route says so; registry, stage, confirm, Review apply, close, and build mutations are serial.",
    "- A successful build covers the currently declared scope only. New or unprocessed sources can reopen earlier routes.",
    "- Use Context CLI lifecycle commands for writes to `sources/`, `knowledge/`, `dist/`, and `.tmp/context-runtime/`. Do not repair those states by hand.",
    "",
    "## Standard Manual",
    "",
    "- Read only the manuals and schemas selected by `workflow.current.resources` for the current step.",
    "- General SDK index: `node_modules/@c4a/context/docs/README.md`.",
    "- Project declarations: `node_modules/@c4a/context/docs/reference/project-api.md`.",
    "- Optional project maintenance Skill template: `node_modules/@c4a/context/templates/project-skills/maintain-project-knowledge/SKILL.md`.",
    "- Install or refresh the global Agent integration with `context plugin install`.",
    "",
  ].join("\n");
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
  await mkdir(join(projectRoot, "sources", "repo"), { recursive: true });
  await mkdir(join(projectRoot, "sources", "file"), { recursive: true });
  await mkdir(join(projectRoot, "sources", "lark"), { recursive: true });
  await writeIfMissing(
    join(projectRoot, "package.json"),
    renderPackageJson(projectName, readCurrentPackageVersion(), input.dev, language, input.debug),
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
