import { assertRequiredArticlesReviewed } from "./indexerRequiredArticleReview.js";
import { readProductionStage } from "./productionStageStore.js";
import { assertPartialDeliveryCurrent } from "./partialDelivery.js";
import { closeRevisionDelivery, readRevisionDelivery } from "./revisionDelivery.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { readProcessedScopes, validateArticleStructureEntries } from "@c4a/context";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { approvedKnowledgeSnapshotsFromStructure } from "./approvedKnowledgeSnapshots.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { queueContextRuntimeEvent } from "../runtimeEvents.js";
import { ExitCode } from "../types/exitCode.js";
import { verifyProjectWorkspace } from "./verify.js";
import { findContextProjectRoot } from "./workspace.js";
import { withProjectWriteLock } from "./writeLock.js";
import { approvedStructureInputHash, sha256Text, type ApprovedStructureInputFile } from "./approvedStructureInputHash.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { isKnowledgeAssetPath, walkApprovedMarkdown } from "./verifyProjectFiles.js";
import { repairApprovedKnowledgeAssetProjections } from "./knowledgeAssetRepair.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import {
  compactApprovedKnowledgeMarkdown,
  ensureApprovedKnowledgePresentation,
} from "./approvedKnowledgeMetadata.js";

interface ApprovedKnowledgeFile {
  relPath: string;
  absPath: string;
  content: string;
}

export interface ProjectCloseStatus {
  state: "missing" | "ready" | "stale";
  inputHash?: string;
  diagnostics: string[];
}

export interface ProjectCloseResult {
  action: "closed";
  projectRoot: string;
  structure: string;
  articles: number;
  references: {
    status: "deferred";
    rewritesVerbatim: false;
  };
  resourceProjection: {
    repairedPages: number;
    writtenAssets: number;
    removedAssets: number;
  };
  inputHash: string;
  verifyErrors: number;
  verifyWarnings: number;
}

const KNOWLEDGE_ROOT = "knowledge";
const STRUCTURE_PATH = join(KNOWLEDGE_ROOT, "structure.yaml");
const STRUCTURE_SCHEMA_VERSION = "context.approved-structure.v1";
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (match?.[1] === undefined) return {};
  const parsed = YAML.parse(match[1]) as unknown;
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function isDeprecated(content: string): boolean {
  return parseFrontmatter(content).deprecated === true;
}

async function approvedKnowledgeFiles(projectRoot: string): Promise<ApprovedKnowledgeFile[]> {
  const files = await walkApprovedMarkdown(join(projectRoot, KNOWLEDGE_ROOT));
  const markdown = await Promise.all(files
    .filter((file) => !isKnowledgeAssetPath(file.relPath))
    .map(async (file) => ({
      ...file,
      content: await readFile(file.absPath, "utf8"),
    })));
  return markdown.filter((file) => !isDeprecated(file.content));
}

export async function approvedKnowledgeInputHash(projectRoot: string): Promise<string> {
  const { inputHash } = await deriveApprovedStructure(projectRoot);
  return inputHash;
}

function approvedStructureInputFiles(files: readonly ApprovedKnowledgeFile[]): ApprovedStructureInputFile[] {
  return files.map((file) => ({
    path: file.relPath,
    sha256: sha256Text(file.content),
  }));
}

async function deriveApprovedStructure(projectRoot: string) {
  const files = await approvedKnowledgeFiles(projectRoot);
  const previous = (await readKnowledgeStructure(projectRoot)).parsed;
  const processedScopes = readProcessedScopes(previous);
  const byPath = new Map(approvedKnowledgeSnapshotsFromStructure(previous).map(article => [article.path, article]));
  const articles = validateArticleStructureEntries(files.map(file => {
    const article = byPath.get(file.relPath);
    if (!article) throw new TypeError(`Approved article is missing structure metadata: ${file.relPath}`);
    const markers = approvedContextSectionsInMarkdown(file.content);
    const ids = markers.map(section => section.id);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length ||
        ids.length !== article.sections.length || article.sections.some(section => !ids.includes(section.id))) {
      throw new TypeError(`Article fragment IDs differ from structure: ${file.relPath}`);
    }
    return article;
  }));
  const compactFiles = files.flatMap(file => {
    const content = compactApprovedKnowledgeMarkdown(file.content);
    return content === file.content ? [] : [{ ...file, content }];
  });
  const changed = new Map(compactFiles.map(file => [file.relPath, file]));
  const inputHash = approvedStructureInputHash({
    schemaVersion: STRUCTURE_SCHEMA_VERSION,
    files: approvedStructureInputFiles(files.map(file => changed.get(file.relPath) ?? file)),
    metadata: articles,
  });
  return {
    inputHash, compactFiles,
    structure: { schema_version: STRUCTURE_SCHEMA_VERSION, input_hash: inputHash, articles,
      ...(processedScopes.length ? { processed_scopes: processedScopes } : {}) },
  };
}

export async function writeApprovedStructureProjection(projectRoot: string) {
  const { inputHash, structure, compactFiles } = await deriveApprovedStructure(projectRoot);
  const outputPath = join(projectRoot, STRUCTURE_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, YAML.stringify(structure), "utf8");
  await Promise.all(compactFiles.map(file => writeFile(file.absPath, file.content, "utf8")));
  return { inputHash, articles: structure.articles.length, structure: STRUCTURE_PATH };
}

function referencesReceipt(): ProjectCloseResult["references"] {
  return { status: "deferred", rewritesVerbatim: false };
}

export async function readProjectCloseStatus(projectRoot: string): Promise<ProjectCloseStatus> {
  const approved = await approvedKnowledgeFiles(projectRoot);
  const structurePath = join(projectRoot, STRUCTURE_PATH);
  if (approved.length === 0 && !existsSync(structurePath)) return { state: "missing", diagnostics: [] };
  const inputHash = await approvedKnowledgeInputHash(projectRoot);
  if (!existsSync(structurePath)) return { state: "missing", inputHash, diagnostics: [`close structure is missing: ${STRUCTURE_PATH}`] };
  try {
    const parsed = YAML.parse(await readFile(structurePath, "utf8")) as unknown;
    const record = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    const recorded = record.input_hash;
    const delivery = await readProductionStage(projectRoot) ? undefined : await readRevisionDelivery(projectRoot);
    const deliveryNeedsClose = delivery !== undefined && delivery.closed !== true;
    return recorded === inputHash && !deliveryNeedsClose
      ? { state: "ready", inputHash, diagnostics: [] }
      : { state: "stale", inputHash, diagnostics: [`close structure is stale: ${STRUCTURE_PATH}`] };
  } catch (error) {
    return {
      state: "stale",
      inputHash,
      diagnostics: [`close structure is invalid: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export async function closeProjectWorkspace(projectRoot: string): Promise<ProjectCloseResult> {
  return withProjectWriteLock(projectRoot, "close-knowledge", async () => {
    const candidates = await readCandidateRecords(projectRoot);
    const draftCandidates = candidates.filter((candidate) =>
      candidate.candidate_type === "indexer-artifact" && candidate.status === "draft"
    );
    const production = await readProductionStage(projectRoot);
    const delivery = production ? undefined : await readRevisionDelivery(projectRoot);
    if (delivery?.partial) await assertPartialDeliveryCurrent(projectRoot, delivery.partial);
    else await assertRequiredArticlesReviewed(projectRoot, candidates);
    if (draftCandidates.length > 0 && !delivery?.partial) {
      throw new ContextError(ExitCode.WorkspaceStateError, "close is blocked while draft candidates still need Review", {
        category: ErrorCategory.WorkspaceStateInvalid,
        code: "close-draft-candidates-pending",
        draftCandidates: draftCandidates.length,
        collections: [...new Set(draftCandidates.map((candidate) => candidate.collection))].sort(),
        next: "Run context status --format json and complete the current Review route before close.",
      });
    }
    const resourceProjection = await repairApprovedKnowledgeAssetProjections(projectRoot);
    const descriptionRepairs = (await approvedKnowledgeFiles(projectRoot)).flatMap((file) => {
      const content = ensureApprovedKnowledgePresentation(file.content);
      return content === file.content ? [] : [{ ...file, content }];
    });
    await Promise.all(descriptionRepairs.map((file) =>
      writeFile(file.absPath, file.content, "utf8")
    ));
    const { inputHash, structure, compactFiles } = await deriveApprovedStructure(projectRoot);
    const verify = await verifyProjectWorkspace(projectRoot, { approvedStructureOverride: structure });
    const verifyErrors = verify.issues.filter((issue) => issue.severity === "error").length;
    const verifyWarnings = verify.issues.length - verifyErrors;
    if (verifyErrors > 0) {
      throw new ContextError(ExitCode.WorkspaceStateError, "close blocked because verify still reports errors", {
        category: ErrorCategory.WorkspaceStateInvalid,
        issues: verify.issues,
        next: "Fix context verify errors, then rerun context close --format json.",
      });
    }
    const outputPath = join(projectRoot, STRUCTURE_PATH);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${YAML.stringify(structure)}`, "utf8");
    await Promise.all(compactFiles.map((file) => writeFile(file.absPath, file.content, "utf8")));
    const { readTaskRollback } = await import("./taskRollback.js");
    if (!production && !await readTaskRollback(projectRoot)) await closeRevisionDelivery(projectRoot);
    return {
      action: "closed",
      projectRoot,
      structure: STRUCTURE_PATH,
      articles: structure.articles.length,
      references: referencesReceipt(),
      resourceProjection: {
        repairedPages: resourceProjection.repairedPages.length,
        writtenAssets: resourceProjection.writtenAssets.length,
        removedAssets: resourceProjection.removedAssets.length,
      },
      inputHash,
      verifyErrors,
      verifyWarnings,
    };
  });
}

export async function runProjectCloseCommand(input: {
  cwd: string;
  format?: "text" | "json";
}): Promise<boolean> {
  const found = findContextProjectRoot(input.cwd);
  if (!found) return false;
  const result = await closeProjectWorkspace(found.projectRoot);
  queueContextRuntimeEvent({
    cwd: result.projectRoot,
    kind: "knowledge.closed",
    properties: {
      article_count: result.articles,
      verify_warning_count: result.verifyWarnings,
    },
  });
  if (input.format === "json") {
    process.stdout.write(`${JSON.stringify({ ...result, agent_hints: [] }, null, 2)}\n`);
  } else {
    process.stdout.write([
      `closed context project`,
      `structure: ${result.structure}`,
      `articles: ${result.articles}`,
      `references: ${result.references.status}, rewrites verbatim: ${result.references.rewritesVerbatim}`,
      `verify: ${result.verifyErrors} error(s), ${result.verifyWarnings} warning(s)`,
      "",
    ].join("\n"));
  }
  return true;
}
