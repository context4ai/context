import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { parse as parseYaml } from "yaml";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import {
  flushQueuedContextRuntimeEvents,
  queueContextRuntimeEvent,
  runtimeEventPendingAgentHint,
  type RuntimeEventPendingAgentHint,
} from "../runtimeEvents.js";
import { ExitCode } from "../types/exitCode.js";
import { legacyCodeIndexMigrationRequired } from "./codeIndexMigration.js";
import {
  packageBuildInventory,
  packageScopedKnowledgeStructure,
  readKnowledgeStructure,
  writePackageBuildInventory,
  type KnowledgeStructureInfo,
} from "./packageBuildInventory.js";
import {
  validatePackageIndexLinks,
  writeKnowledgeDirectoryIndexes,
  type ApprovedKnowledgeFile,
} from "./packageIndexes.js";
import { packageNavigation } from "./packageNavigation.js";
import {
  formatPackageBuildSummary,
  knowledgeOutputGroups,
  packageBuildChanges,
  packageOutputFingerprint,
  packageOutputSnapshot,
  walkPackageFiles,
  type PackageBuildSummary,
  type PackageOutputFile,
} from "./packageBuildReceipt.js";
import {
  appendLlmsKnowledge,
  approvedKnowledgeTimestamp,
  packageKnowledgeBundle,
  packageTemplateVars,
  prepareSelectedPackageKnowledge,
  selectPackageKnowledge,
  writeRenderedPackageTemplate,
  writeSelectedPackageKnowledge,
} from "./packageBuildContent.js";
import { validatePackageRenderPlan, validatePackageTemplateContract } from "./packageTemplateGuard.js";
import { projectPackageKnowledgeAssets, type PackageAssetFile } from "./packageAssets.js";
import { resolvePackageImageProcessor } from "./packageAssetOptimization.js";
import {
  packageAssetDeliveryFingerprintInput,
  type PackageAssetDeliverySummary,
} from "./packageAssetDelivery.js";
import {
  assertSafeRenderedPath,
  isSafeRelativePath,
  packageKind,
  type TemplateFile,
} from "./packageTemplateUtils.js";
import { readProjectCloseStatus } from "./close.js";
import { verifyProjectWorkspace } from "./verify.js";
import type { ProjectVerifyResult } from "./verifyTypes.js";
import { findContextProjectRoot, loadContextProjectModule } from "./workspace.js";
import {
  inspectPackageTemplateReviews,
  PACKAGE_TEMPLATE_REVIEW_FILE,
} from "./packageTemplateReview.js";
import { projectDocumentOptimizedKnowledge } from "./documentOptimization.js";
import { isApprovedKnowledgeMarkdownPath } from "./knowledgeFileClassification.js";
import { packageCodeIndexAudit } from "./codeIndexAuditPackage.js";
import {
  hydrateApprovedKnowledgeMarkdown,
  readApprovedKnowledgeMetadataIndex,
} from "./approvedKnowledgeMetadata.js";

export interface ProjectBuildResult {
  projectRoot: string;
  packages: PackageBuildSummary[];
  agent_hints: PackageBuildAgentHint[];
}

export type PackageBuildAgentHint = RuntimeEventPendingAgentHint;

export interface PackageFreshness {
  name: string;
  kind: "kb" | "llms";
  state: "missing" | "ready" | "stale";
  inputFiles: number;
  outputFiles: number;
  assetDelivery?: PackageAssetDeliverySummary;
}

interface PackageBuildManifest {
  builderProtocol: string;
  fingerprint: string;
  outputFingerprint: string;
  outputFiles: number;
  outputs: PackageOutputFile[];
  assetDelivery?: PackageAssetDeliverySummary;
}

const KNOWLEDGE_ROOT = "knowledge";
const PACKAGE_FINGERPRINT_ROOT = join(".tmp", "context-runtime", "packages");
const PACKAGE_BUILDER_PROTOCOL_VERSION = "v18-local-code-index-audit";

function packageAuditInventoryReference(report: Record<string, unknown> | undefined): {
  reportDigest: string;
  decision: string;
  codePages: number;
  signals: number;
} | undefined {
  if (report === undefined) return undefined;
  const decision = report.decision;
  const selection = report.package_selection;
  return {
    reportDigest: typeof report.report_digest === "string" ? report.report_digest : "unknown",
    decision: decision !== null && typeof decision === "object" && !Array.isArray(decision) &&
      typeof (decision as Record<string, unknown>).decision === "string"
      ? (decision as Record<string, unknown>).decision as string
      : "unknown",
    codePages: selection !== null && typeof selection === "object" && !Array.isArray(selection) &&
      typeof (selection as Record<string, unknown>).code_pages === "number"
      ? (selection as Record<string, unknown>).code_pages as number
      : 0,
    signals: Array.isArray(report.signals) ? report.signals.length : 0,
  };
}

function packageSelectsCodeIndex(selected: readonly ApprovedKnowledgeFile[]): boolean {
  return selected.some((file) =>
    file.relPath.startsWith("codeindex/") || file.relPath.startsWith("codegraph/")
  );
}

function packageAssetDeliverySummary(value: unknown): PackageAssetDeliverySummary | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<PackageAssetDeliverySummary>;
  if ((candidate.state !== "bundled" && candidate.state !== "git-raw" && candidate.state !== "omitted") ||
    typeof candidate.sourceFiles !== "number" || typeof candidate.sourceBytes !== "number" ||
    typeof candidate.outputFiles !== "number" || typeof candidate.outputBytes !== "number") return undefined;
  return candidate as PackageAssetDeliverySummary;
}

function assertPackageOutputDir(pkg: PackageDefinition): void {
  const expected = `dist/${pkg.name}`;
  if (pkg.outDir !== expected || !isSafeRelativePath(pkg.outDir)) {
    throw new ContextError(ExitCode.WorkspaceStateError, `package output directory is invalid: ${pkg.name}`, {
      category: ErrorCategory.SchemaInvalid,
      packageName: pkg.name,
      outDir: pkg.outDir,
      expected,
    });
  }
}

function packageFingerprintPath(projectRoot: string, pkg: PackageDefinition): string {
  assertSafeRenderedPath(`${pkg.name}.json`, "package fingerprint path");
  return join(projectRoot, PACKAGE_FINGERPRINT_ROOT, `${pkg.name}.json`);
}

export async function listApprovedKnowledge(projectRoot: string): Promise<ApprovedKnowledgeFile[]> {
  const metadata = await readApprovedKnowledgeMetadataIndex(projectRoot);
  const files = await walkPackageFiles(join(projectRoot, KNOWLEDGE_ROOT));
  const knowledge = await Promise.all(files
    .filter((file) => isApprovedKnowledgeMarkdownPath(file.relPath) && !file.relPath.startsWith("assets/"))
    .map(async (file) => ({
      ...file,
      content: hydrateApprovedKnowledgeMarkdown({
        content: await readFile(file.absPath, "utf8"),
        relPath: file.relPath,
        metadata,
      }),
    })));
  return knowledge.filter((file) => !isDeprecatedKnowledge(file.content));
}

function isDeprecatedKnowledge(content: string): boolean {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (match?.[1] === undefined) return false;
  try {
    const frontmatter = parseYaml(match[1]) as unknown;
    return frontmatter !== null &&
      typeof frontmatter === "object" &&
      !Array.isArray(frontmatter) &&
      (frontmatter as Record<string, unknown>).deprecated === true;
  } catch {
    return false;
  }
}

async function listTemplateFiles(projectRoot: string, templatePath: string): Promise<TemplateFile[]> {
  assertSafeRenderedPath(templatePath, "package template path");
  const templateRoot = resolve(projectRoot, templatePath);
  if (!existsSync(templateRoot)) {
    throw new ContextError(ExitCode.WorkspaceStateError, `package template path is missing: ${templatePath}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      path: templatePath,
      next: "Create the package template directory or update src/index.ts.",
    });
  }
  const files = await walkPackageFiles(templateRoot);
  return Promise.all(files.filter((file) =>
    file.relPath.split("/").at(-1) !== PACKAGE_TEMPLATE_REVIEW_FILE
  ).map(async (file) => ({
    ...file,
    content: await readFile(file.absPath, "utf8"),
  })));
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function packageInputFingerprint(input: {
  projectRoot: string;
  pkg: PackageDefinition;
  selected: readonly ApprovedKnowledgeFile[];
  structure: KnowledgeStructureInfo;
  templateFiles: readonly TemplateFile[];
  codeIndexAudit?: Record<string, unknown>;
}): Promise<string> {
  const projectedAssets = await Promise.all(input.selected.map((file) =>
    projectPackageKnowledgeAssets({
      projectRoot: input.projectRoot,
      pkg: input.pkg,
      file,
      content: file.content,
    })
  ));
  const assets = new Map<string, string>();
  const assetFiles = new Map<string, PackageAssetFile>();
  for (const projection of projectedAssets) {
    for (const asset of projection.assets) {
      assets.set(asset.packageRelPath, createHash("sha256").update(asset.bytes).digest("hex"));
      assetFiles.set(asset.packageRelPath, asset);
    }
  }
  const assetDelivery = input.pkg.kind === "package.kb"
    ? await packageAssetDeliveryFingerprintInput({
        projectRoot: input.projectRoot,
        assets: [...assetFiles.values()],
        ...(input.pkg.assets === undefined ? {} : { definition: input.pkg.assets }),
      })
    : null;
  return stableHash({
    builder: PACKAGE_BUILDER_PROTOCOL_VERSION,
    package: {
      kind: input.pkg.kind,
      name: input.pkg.name,
      select: input.pkg.select ?? null,
      navigation: input.pkg.kind === "package.kb" ? packageNavigation(input.pkg) : null,
      assets: input.pkg.kind === "package.kb" ? input.pkg.assets ?? null : null,
      template: input.pkg.template,
      outDir: input.pkg.outDir,
    },
    knowledgeStructure: input.structure.parsed,
    knowledge: input.selected.map((file) => ({
      path: file.relPath,
      content: file.content,
    })),
    assets: [...assets].sort(([left], [right]) => left.localeCompare(right)),
    assetDelivery,
    codeIndexAudit: input.codeIndexAudit ?? null,
    template: input.templateFiles.map((file) => ({
      path: file.relPath,
      content: file.content,
    })),
  });
}

async function readPackageManifest(projectRoot: string, pkg: PackageDefinition): Promise<PackageBuildManifest | null> {
  const filePath = packageFingerprintPath(projectRoot, pkg);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const candidate = parsed as {
        builder_protocol?: unknown;
        fingerprint?: unknown;
        output_fingerprint?: unknown;
        output_files?: unknown;
        outputs?: unknown;
        asset_delivery?: unknown;
      };
      if (typeof candidate.builder_protocol === "string" &&
        typeof candidate.fingerprint === "string" &&
        typeof candidate.output_fingerprint === "string" &&
        typeof candidate.output_files === "number" &&
        Array.isArray(candidate.outputs)) {
        const outputs = candidate.outputs.filter((output): output is PackageOutputFile => {
          if (output === null || typeof output !== "object" || Array.isArray(output)) return false;
          const file = output as Partial<PackageOutputFile>;
          return typeof file.path === "string" &&
            typeof file.sha256 === "string" &&
            (file.kind === "knowledge-page" || file.kind === "index" || file.kind === "file") &&
            (file.group === undefined || typeof file.group === "string");
        });
        if (outputs.length !== candidate.outputs.length) return null;
        const assetDelivery = packageAssetDeliverySummary(candidate.asset_delivery);
        return {
          builderProtocol: candidate.builder_protocol,
          fingerprint: candidate.fingerprint,
          outputFingerprint: candidate.output_fingerprint,
          outputFiles: candidate.output_files,
          outputs,
          ...(assetDelivery === undefined ? {} : { assetDelivery }),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function writePackageFingerprint(input: {
  projectRoot: string;
  pkg: PackageDefinition;
  fingerprint: string;
  outputFingerprint: string;
  outputFiles: number;
  outputs: readonly PackageOutputFile[];
  assetDelivery: PackageAssetDeliverySummary;
}): Promise<void> {
  const filePath = packageFingerprintPath(input.projectRoot, input.pkg);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({
    package: input.pkg.name,
    kind: packageKind(input.pkg),
    builder_protocol: PACKAGE_BUILDER_PROTOCOL_VERSION,
    fingerprint: input.fingerprint,
    output_fingerprint: input.outputFingerprint,
    output_files: input.outputFiles,
    outputs: input.outputs,
    asset_delivery: input.assetDelivery,
    built_at: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
}

async function removeOrphanPackageDirs(projectRoot: string, packages: readonly PackageDefinition[]): Promise<void> {
  const distRoot = join(projectRoot, "dist");
  if (!existsSync(distRoot)) return;
  const declaredNames = new Set(packages.map((pkg) => pkg.name));
  const entries = await readdir(distRoot, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !declaredNames.has(entry.name))
    .map((entry) => rm(join(distRoot, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })));
}

export async function collectPackageFreshness(
  projectRoot: string,
  packages: readonly PackageDefinition[],
): Promise<PackageFreshness[]> {
  const approved = await listApprovedKnowledge(projectRoot);
  const optimized = await projectDocumentOptimizedKnowledge({ projectRoot, files: approved });
  const approvedForBuild = optimized.status.current ? optimized.files : approved;
  return Promise.all(packages.map(async (pkg) => {
    assertPackageOutputDir(pkg);
    const selected = selectPackageKnowledge(approvedForBuild, pkg);
    assertSafeRenderedPath(pkg.template.path, "package template path");
    const templateRoot = join(projectRoot, pkg.template.path);
    const templateExists = existsSync(templateRoot);
    if (!templateExists) {
      throw new ContextError(ExitCode.WorkspaceStateError, `package template path is missing: ${pkg.template.path}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        path: pkg.template.path,
        next: "Create the package template directory or update src/index.ts.",
      });
    }
    const templateFiles = await listTemplateFiles(projectRoot, pkg.template.path);
    validatePackageTemplateContract(pkg, templateFiles);
    const bundle = await packageKnowledgeBundle(projectRoot, pkg, selected);
    const knowledgeTimestamp = approvedKnowledgeTimestamp(selected);
    const structure = packageScopedKnowledgeStructure({
      selected,
      structure: await readKnowledgeStructure(projectRoot),
    });
    const codeIndexAudit = await packageCodeIndexAudit({
      projectRoot,
      packageName: pkg.name,
      selectedApprovedPaths: selected.map((file) => file.relPath),
    });
    const codeIndexAuditReference = packageAuditInventoryReference(codeIndexAudit);
    const buildInventory = packageBuildInventory({
      pkg,
      selected,
      structure,
      verifyEvidenceStatus: null,
      documentOptimization: optimized.status,
      ...(codeIndexAuditReference === undefined ? {} : { codeIndexAudit: codeIndexAuditReference }),
    });
    validatePackageRenderPlan({
      pkg,
      files: templateFiles,
      selected,
      vars: packageTemplateVars({
        pkg,
        bundle,
        knowledgeCount: selected.length,
        knowledgeTimestamp,
        selected,
        buildInventory,
        knowledgeStructure: structure.parsed,
      }),
    });
    const output = await packageOutputFingerprint(projectRoot, pkg);
    if (output.files > 0) {
      await validatePackageIndexLinks({ projectRoot, pkg });
    }
    const builtManifest = await readPackageManifest(projectRoot, pkg);
    if (builtManifest === null && output.files === 0) {
      return { name: pkg.name, kind: packageKind(pkg), state: "missing", inputFiles: selected.length, outputFiles: 0 };
    }
    const currentFingerprint = await packageInputFingerprint({
      projectRoot,
      pkg,
      selected,
      structure,
      templateFiles,
      ...(codeIndexAuditReference === undefined ? {} : { codeIndexAudit: codeIndexAuditReference }),
    });
    const ready = optimized.status.current && builtManifest !== null &&
      builtManifest.builderProtocol === PACKAGE_BUILDER_PROTOCOL_VERSION &&
      builtManifest.fingerprint === currentFingerprint &&
      builtManifest.outputFingerprint === output.fingerprint &&
      builtManifest.outputFiles === output.files;
    return {
      name: pkg.name,
      kind: packageKind(pkg),
      state: ready ? "ready" : "stale",
      inputFiles: selected.length,
      outputFiles: output.files,
      ...(builtManifest?.assetDelivery === undefined
        ? {}
        : { assetDelivery: builtManifest.assetDelivery }),
    };
  }));
}

export async function buildProjectPackages(projectRoot: string): Promise<ProjectBuildResult> {
  if (await legacyCodeIndexMigrationRequired(projectRoot)) {
    throw new ContextError(ExitCode.WorkspaceStateError, "package build cannot publish the legacy codegraph collection", {
      category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: "package/codeindex-migration-required",
      next: "Run context status --format json and execute the Route-returned context migrate codeindex command.",
    });
  }
  const loaded = await loadContextProjectModule(projectRoot);
  const packages = loaded.project.packages;
  if (packages.length === 0) {
    throw new ContextError(ExitCode.UserError, "no packages are declared in src/index.ts", {
      category: ErrorCategory.UserInputInvalid,
      next: "Declare kbPackage() or llmsPackage() in src/index.ts, then rerun context build.",
    });
  }
  const approved = await listApprovedKnowledge(projectRoot);
  const templateReviews = await inspectPackageTemplateReviews(projectRoot, packages);
  const unresolvedTemplateReviews = templateReviews.filter((review) =>
    review.state === "review-required" || review.state === "invalid"
  );
  if (unresolvedTemplateReviews.length > 0) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "package template review is required before build",
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package/template-review-required",
        packages: unresolvedTemplateReviews,
        next: "Replace or edit the declared template files, or explicitly accept the unchanged generic default through the current Context workflow route.",
      },
    );
  }
  let verifyEvidenceStatus: ProjectVerifyResult["evidenceStatus"] | null = null;
  if (approved.length > 0) {
    const close = await readProjectCloseStatus(projectRoot);
    if (close.state !== "ready") {
      throw new ContextError(ExitCode.WorkspaceStateError, "package build requires deterministic close first", {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package/build-close-required",
        close_state: close.state,
        diagnostics: close.diagnostics,
        next: "Run context close --format json, then rerun context build.",
      });
    }
    const verify = await verifyProjectWorkspace(projectRoot);
    verifyEvidenceStatus = verify.evidenceStatus;
    if (verify.evidenceStatus === "fail") {
      const errors = verify.issues.filter((issue) => issue.severity === "error").length;
      const warnings = verify.issues.length - errors;
      throw new ContextError(ExitCode.WorkspaceStateError, "package build requires verified evidence", {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package/build-verify-required",
        evidence_status: verify.evidenceStatus,
        summary: { errors, warnings },
        issues: verify.issues,
        next: "Run context verify --format json, fix evidence issues, then rerun context close --format json and context build.",
      });
    }
  }
  const optimized = await projectDocumentOptimizedKnowledge({ projectRoot, files: approved });
  if (!optimized.status.current) {
    throw new ContextError(ExitCode.WorkspaceStateError, "document optimization must be current before package build", {
      category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: "package/document-optimization-required",
      pending_fragments: optimized.status.pending_fragments,
      conflict_fragments: optimized.status.conflict_fragments,
      next: "Run context status --format json and follow route.document-optimization.pending.",
    });
  }
  const approvedForBuild = optimized.files;
  const summaries: PackageBuildSummary[] = [];
  const agentHints: PackageBuildAgentHint[] = [];
  await removeOrphanPackageDirs(projectRoot, packages);
  for (const pkg of packages) {
    assertPackageOutputDir(pkg);
    const selected = selectPackageKnowledge(approvedForBuild, pkg);
    const templateFiles = await listTemplateFiles(projectRoot, pkg.template.path);
    validatePackageTemplateContract(pkg, templateFiles);
    const bundle = await packageKnowledgeBundle(projectRoot, pkg, selected);
    const knowledgeTimestamp = approvedKnowledgeTimestamp(selected);
    const structure = packageScopedKnowledgeStructure({
      selected,
      structure: await readKnowledgeStructure(projectRoot),
    });
    const codeIndexAudit = await packageCodeIndexAudit({
      projectRoot,
      packageName: pkg.name,
      selectedApprovedPaths: selected.map((file) => file.relPath),
    });
    const codeIndexAuditReference = packageAuditInventoryReference(codeIndexAudit);
    const buildInventory = packageBuildInventory({
      pkg,
      selected,
      structure,
      verifyEvidenceStatus,
      documentOptimization: optimized.status,
      ...(codeIndexAuditReference === undefined ? {} : { codeIndexAudit: codeIndexAuditReference }),
    });
    const fingerprint = await packageInputFingerprint({
      projectRoot,
      pkg,
      selected,
      structure,
      templateFiles,
      ...(codeIndexAuditReference === undefined ? {} : { codeIndexAudit: codeIndexAuditReference }),
    });
    const previousManifest = await readPackageManifest(projectRoot, pkg);
    const knowledgeGroups = knowledgeOutputGroups(pkg, selected);
    const previousOutput = await packageOutputSnapshot(
      projectRoot,
      pkg,
      knowledgeGroups,
      previousManifest?.outputs ?? [],
    );
    const vars = packageTemplateVars({
      pkg,
      bundle,
      knowledgeCount: selected.length,
      knowledgeTimestamp,
      selected,
      buildInventory,
      knowledgeStructure: structure.parsed,
    });
    validatePackageRenderPlan({ pkg, files: templateFiles, selected, vars });
    if (packageSelectsCodeIndex(selected) && codeIndexAudit === undefined) {
      throw new ContextError(ExitCode.WorkspaceStateError, "package build requires an accepted current code-index Agent audit", {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package/code-index-audit-required",
        package: pkg.name,
        next: "Run context status --format json and follow route.extract.audit-required.",
      });
    }
    const assetProcessor = await resolvePackageImageProcessor(
      projectRoot,
      pkg.kind === "package.kb" ? pkg.assets : undefined,
    );
    const preparedKnowledge = await prepareSelectedPackageKnowledge({
      projectRoot,
      pkg,
      files: selected,
      ...(assetProcessor === undefined ? {} : { assetProcessor }),
    });
    await rm(join(projectRoot, pkg.outDir), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    await mkdir(join(projectRoot, pkg.outDir), { recursive: true });
    const rendered = await writeRenderedPackageTemplate({
      projectRoot,
      pkg,
      files: templateFiles,
      bundle,
      knowledgeTimestamp,
      selected,
      buildInventory,
      knowledgeStructure: structure.parsed,
    });
    const writtenKnowledge = await writeSelectedPackageKnowledge({
      projectRoot,
      pkg,
      files: selected,
      ...(assetProcessor === undefined ? {} : { assetProcessor }),
      prepared: preparedKnowledge,
    });
    await writeKnowledgeDirectoryIndexes({
      projectRoot,
      pkg,
      selected,
      knowledgeTimestamp,
    });
    await writePackageBuildInventory({ projectRoot, pkg, inventory: buildInventory });
    await appendLlmsKnowledge({
      projectRoot,
      pkg,
      bundle,
      knowledgeCount: selected.length,
      templateConsumesKnowledge: rendered.consumesKnowledge,
    });
    await validatePackageIndexLinks({ projectRoot, pkg });
    const output = await packageOutputFingerprint(projectRoot, pkg);
    const currentOutput = await packageOutputSnapshot(projectRoot, pkg, knowledgeGroups);
    const changes = packageBuildChanges(previousOutput, currentOutput);
    const changedFiles = changes.added.length + changes.updated.length + changes.removed.length;
    await writePackageFingerprint({
      projectRoot,
      pkg,
      fingerprint,
      outputFingerprint: output.fingerprint,
      outputFiles: output.files,
      outputs: currentOutput,
      assetDelivery: writtenKnowledge.assetDelivery,
    });
    summaries.push({
      name: pkg.name,
      kind: packageKind(pkg),
      outDir: pkg.outDir,
      inputs: selected.length,
      files: output.files,
      resources: {
        files: writtenKnowledge.resources,
        bytes: writtenKnowledge.resourceBytes,
        delivery: writtenKnowledge.assetDelivery,
      },
      state: changedFiles === 0 ? "unchanged" : previousOutput.length === 0 ? "created" : "updated",
      changes,
    });
  }
  return { projectRoot, packages: summaries, agent_hints: agentHints };
}

function formatProjectBuildResult(
  result: ProjectBuildResult,
  format: "text" | "json" = "text",
  verbose = false,
): string {
  if (format === "json") {
    if (verbose) return `${JSON.stringify(result, null, 2)}\n`;
    return `${JSON.stringify({
      agent_hints: result.agent_hints,
      packages: result.packages.map((pkg) => ({
        name: pkg.name,
        kind: pkg.kind,
        outDir: pkg.outDir,
        state: pkg.state,
        inputs: pkg.inputs,
        files: pkg.files,
        resources: pkg.resources,
        changes: {
          added: summarizePackageChanges(pkg.changes.added),
          updated: summarizePackageChanges(pkg.changes.updated),
          removed: summarizePackageChanges(pkg.changes.removed),
        },
      })),
    }, null, 2)}\n`;
  }
  return formatFeedback({
    symbol: "✓",
    action: "built",
    subject: "project packages",
    headline: `${result.packages.length} package(s)`,
    body: result.packages.flatMap((pkg) => formatPackageBuildSummary(pkg)),
  });
}

function summarizePackageChanges(
  changes: PackageBuildSummary["changes"]["added"],
): {
  total: number;
  knowledge_pages: Record<string, number>;
  indexes: number;
  other_files: number;
} {
  const knowledgePages: Record<string, number> = {};
  let indexes = 0;
  let otherFiles = 0;
  for (const change of changes) {
    if (change.kind === "knowledge-page") {
      const group = change.group ?? "knowledge";
      knowledgePages[group] = (knowledgePages[group] ?? 0) + 1;
    } else if (change.kind === "index") {
      indexes += 1;
    } else {
      otherFiles += 1;
    }
  }
  return {
    total: changes.length,
    knowledge_pages: Object.fromEntries(
      Object.entries(knowledgePages).sort(([left], [right]) =>
        left.localeCompare(right)
      ),
    ),
    indexes,
    other_files: otherFiles,
  };
}

export async function runProjectBuildCommand(input: {
  cwd: string;
  format?: "text" | "json";
  verbose?: boolean;
}): Promise<boolean> {
  const found = findContextProjectRoot(input.cwd);
  if (found === null) return false;
  const result = await buildProjectPackages(found.projectRoot);
  queueContextRuntimeEvent({
    cwd: result.projectRoot,
    kind: "package.build.completed",
    properties: {
      package_count: result.packages.length,
      created_count: result.packages.filter((pkg) => pkg.state === "created").length,
      updated_count: result.packages.filter((pkg) => pkg.state === "updated").length,
      unchanged_count: result.packages.filter((pkg) => pkg.state === "unchanged").length,
      output_file_count: result.packages.reduce((total, pkg) => total + pkg.files, 0),
      resource_file_count: result.packages.reduce((total, pkg) => total + pkg.resources.files, 0),
    },
  });
  const deliveryHint = runtimeEventPendingAgentHint(
    await flushQueuedContextRuntimeEvents(result.projectRoot),
  );
  if (deliveryHint !== undefined) result.agent_hints.push(deliveryHint);
  process.stdout.write(formatProjectBuildResult(
    result,
    input.format ?? "text",
    input.verbose === true,
  ));
  return true;
}
