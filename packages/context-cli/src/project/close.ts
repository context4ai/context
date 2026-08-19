import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { queueContextRuntimeEvent } from "../runtimeEvents.js";
import { ExitCode } from "../types/exitCode.js";
import { readApprovedStructureEdges, readConfirmedStructureEdgeProjection } from "./approvedStructureEdges.js";
import { verifyProjectWorkspace } from "./verify.js";
import { validateStructureEdgeContract, type StructureEdgeContractResult } from "./structureEdgeContract.js";
import { findContextProjectRoot } from "./workspace.js";
import { withProjectWriteLock } from "./writeLock.js";
import { PARENT_INDEX_GENERATED_KIND } from "./parentIndexView.js";
import { approvedStructureInputHash, sha256Text, type ApprovedStructureInputFile } from "./approvedStructureInputHash.js";
import { readProseCompileBatchProgress } from "./proseCompileBatch.js";
import {
  codegraphEdgesFromFrontmatter,
  codegraphRelationshipCoverage,
  currentCodegraphEdges,
  type CodegraphRelationshipCoverage,
} from "./codegraphRelationshipProjection.js";
import { clearCompletedLifecycle } from "./lifecycleCleanup.js";
import { readCandidateRecords } from "./candidateLedger.js";
import {
  approvedStructureSourceInputsRecord,
  mergedApprovedStructureSourceInputs,
} from "./approvedStructureInputs.js";
import { isKnowledgeAssetPath } from "./verifyProjectFiles.js";
import { repairApprovedKnowledgeAssetProjections } from "./knowledgeAssetRepair.js";

interface ApprovedKnowledgeFile {
  relPath: string;
  absPath: string;
  content: string;
}

export interface ProjectCloseStatus {
  state: "missing" | "ready" | "stale";
  inputHash?: string;
  relationshipCoverage?: CodegraphRelationshipCoverage;
  diagnostics: string[];
}

export interface ProjectCloseResult {
  action: "closed";
  projectRoot: string;
  structure: string;
  nodes: number;
  views: number;
  edges: number;
  edgeContract: StructureEdgeContractResult;
  references: {
    status: "deferred";
    rewritesVerbatim: false;
  };
  resourceProjection: {
    repairedPages: number;
    writtenAssets: number;
    removedAssets: number;
  };
  edgeWarnings: string[];
  relationshipCoverage: CodegraphRelationshipCoverage;
  inputHash: string;
  verifyErrors: number;
  verifyWarnings: number;
}

const KNOWLEDGE_ROOT = "knowledge";
const STRUCTURE_PATH = join(KNOWLEDGE_ROOT, "structure.yaml");
const STRUCTURE_SCHEMA_VERSION = "context.approved-structure.v1";
const LOCAL_REF = /^src-(\d+)(#(?:span|symbol):.+)$/u;
const APPROVED_NODE_TYPES = new Set(["entity", "domain", "action"]);

function isApprovedStructureRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toPosixPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}

function viewLocationFromRelPath(relPath: string): { collection: string; containment: string; slug: string } {
  const parts = relPath.split("/");
  const collection = parts[0] ?? "architecture";
  const bodyParts = parts.slice(1);
  const fileName = bodyParts.at(-1) ?? "index.md";
  const slug = fileName.replace(/\.md$/u, "") || "index";
  const containment = bodyParts.slice(0, -1).join("/") || "root";
  return { collection, containment, slug };
}

function requiredFrontmatterString(
  frontmatter: Record<string, unknown>,
  field: "node_ref" | "view_ref",
  relPath: string,
): string {
  const value = frontmatter[field];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  throw new ContextError(ExitCode.WorkspaceStateError, `approved Markdown is missing ${field}: ${relPath}`, {
    category: ErrorCategory.WorkspaceStateInvalid,
    path: relPath,
    next: "Repair approved Markdown through review apply, then rerun context close --format json.",
  });
}

async function walkFiles(root: string): Promise<Array<{ relPath: string; absPath: string }>> {
  if (!existsSync(root)) return [];
  const files: Array<{ relPath: string; absPath: string }> = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push({ relPath: toPosixPath(relative(root, absPath)), absPath });
    }
  };
  await visit(root);
  files.sort((left, right) => left.relPath.localeCompare(right.relPath));
  return files;
}

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
  const files = await walkFiles(join(projectRoot, KNOWLEDGE_ROOT));
  const markdown = await Promise.all(files
    .filter((file) => file.relPath.endsWith(".md") && !isKnowledgeAssetPath(file.relPath))
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

function htmlAttributeDecode(value: string): string {
  return value
    .replace(/&quot;/gu, "\"")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function parseAttrs(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-z_][a-z0-9_-]*)="([^"]*)"/giu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    const key = match[1];
    const raw = match[2];
    if (key !== undefined && raw !== undefined) attrs[key] = htmlAttributeDecode(raw);
  }
  return attrs;
}

function canonicalizeSourceRef(ref: string, sources: readonly string[]): string {
  const match = LOCAL_REF.exec(ref);
  if (match === null) return ref;
  const index = Number(match[1]);
  const suffix = match[2];
  const source = sources[index - 1];
  return source === undefined || suffix === undefined ? ref : `${source}${suffix}`;
}

function parseSummary(body: string): string | undefined {
  const jsonMatch = /<!--\s*context:summary\s*([\s\S]*?)\/context:summary\s*-->/iu.exec(body);
  const jsonRaw = jsonMatch?.[1]?.trim();
  if (jsonRaw !== undefined && jsonRaw.length > 0) {
    try {
      const parsed = JSON.parse(jsonRaw) as unknown;
      if (typeof parsed === "string") return parsed.trim() || undefined;
      if (
        parsed !== null
        && typeof parsed === "object"
        && !Array.isArray(parsed)
        && typeof (parsed as { text?: unknown }).text === "string"
      ) {
        const text = (parsed as { text: string }).text.trim();
        return text.length > 0 ? text : undefined;
      }
    } catch {
      return undefined;
    }
  }
  const match = /<!--\s*context:summary\s*-->\s*([\s\S]*?)<!--\s*\/context:summary\s*-->/iu.exec(body);
  const raw = match?.[1]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  return raw.split(/\r?\n/u)
    .map((line) => line.replace(/^>\s?/u, ""))
    .join("\n")
    .trim();
}

function nodeTypeFromRef(id: string): string | undefined {
  const first = id.split("/")[0] ?? "";
  return APPROVED_NODE_TYPES.has(first) ? first : undefined;
}

function nodeTypeFromFrontmatter(frontmatter: Record<string, unknown>, id: string, collection: string, relPath: string): string {
  const nodeType = typeof frontmatter.node_type === "string" && frontmatter.node_type.trim().length > 0
    ? frontmatter.node_type.trim()
    : undefined;
  const expected = nodeTypeFromRef(id);
  if (nodeType === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `approved Markdown is missing node_type: ${relPath}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      path: relPath,
      next: "Repair approved Markdown through review apply, then rerun context close --format json.",
    });
  }
  if (!APPROVED_NODE_TYPES.has(nodeType) || (collection !== "codegraph" && (expected === undefined || nodeType !== expected))) {
    throw new ContextError(ExitCode.WorkspaceStateError, `approved Markdown node_type does not match node_ref: ${relPath}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      path: relPath,
      node_ref: id,
      node_type: nodeType,
      expected_node_type: collection === "codegraph" ? "entity|domain|action" : expected ?? "entity|domain|action",
      next: "Repair approved Markdown through review apply, then rerun context close --format json.",
    });
  }
  return nodeType;
}

function parseSections(content: string, sources: readonly string[]): Array<Record<string, unknown>> {
  const sections: Array<Record<string, unknown>> = [];
  const regex = /<!--\s*context:section\b([\s\S]*?)-->([\s\S]*?)(?:<!--\s*\/context:section\s*-->|$)/giu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const attrs = parseAttrs(match[1] ?? "");
    const body = match[2] ?? "";
    const sourceRefs = (attrs.source_ref === undefined ? [] : [attrs.source_ref])
      .map((ref) => canonicalizeSourceRef(ref, sources));
    sections.push({
      id: attrs.id ?? `section-${sections.length + 1}`,
      kind: attrs.kind ?? "body",
      ...(parseSummary(body) !== undefined ? { summary: parseSummary(body) } : {}),
      source_refs: sourceRefs,
      ...(attrs.content_mode !== undefined ? { content_mode: attrs.content_mode } : {}),
    });
  }
  return sections;
}

function parseParentIndexChildren(frontmatter: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  if (frontmatter.generated !== PARENT_INDEX_GENERATED_KIND) return undefined;
  const rawChildren = frontmatter.children;
  if (!Array.isArray(rawChildren)) return [];
  return rawChildren.flatMap((rawChild) => {
    if (rawChild === null || typeof rawChild !== "object" || Array.isArray(rawChild)) return [];
    const child = rawChild as Record<string, unknown>;
    const viewRef = typeof child.view_ref === "string" && child.view_ref.trim().length > 0 ? child.view_ref.trim() : undefined;
    const nodeRef = typeof child.node_ref === "string" && child.node_ref.trim().length > 0 ? child.node_ref.trim() : undefined;
    const title = typeof child.title === "string" && child.title.trim().length > 0 ? child.title.trim() : undefined;
    const path = typeof child.path === "string" && child.path.trim().length > 0 ? child.path.trim() : undefined;
    if (viewRef === undefined || nodeRef === undefined || title === undefined || path === undefined) return [];
    const location = viewLocationFromRelPath(path);
    return [{
      view_ref: viewRef,
      node_ref: nodeRef,
      containment: location.containment,
      slug: location.slug,
      title,
      path,
      ...(typeof child.summary === "string" && child.summary.trim().length > 0 ? { summary: child.summary.trim() } : {}),
    }];
  });
}

async function deriveApprovedStructure(projectRoot: string): Promise<{
  inputHash: string;
  structure: Record<string, unknown>;
  edgeWarnings: string[];
}> {
  const files = await approvedKnowledgeFiles(projectRoot);
  const views = files.map((file) => {
    const frontmatter = parseFrontmatter(file.content);
    const location = viewLocationFromRelPath(file.relPath);
    const nodeRef = requiredFrontmatterString(frontmatter, "node_ref", file.relPath);
    const viewRef = requiredFrontmatterString(frontmatter, "view_ref", file.relPath);
    const collection = viewRef.split(":", 1)[0] ?? location.collection;
    const sources = Array.isArray(frontmatter.sources)
      ? frontmatter.sources.filter((item): item is string => typeof item === "string")
      : [];
    const nodeTags = Array.isArray(frontmatter.node_tags)
      ? frontmatter.node_tags.filter((item): item is string => typeof item === "string")
      : undefined;
    return {
      view_ref: viewRef,
      node_ref: nodeRef,
      collection,
      containment: location.containment,
      slug: location.slug,
      title: typeof frontmatter.title === "string" ? frontmatter.title : nodeRef,
      node_type: nodeTypeFromFrontmatter(frontmatter, nodeRef, collection, file.relPath),
      path: file.relPath,
      ...(frontmatter.generated === PARENT_INDEX_GENERATED_KIND ? { generated: PARENT_INDEX_GENERATED_KIND } : {}),
      ...(parseParentIndexChildren(frontmatter) !== undefined ? { children: parseParentIndexChildren(frontmatter) } : {}),
      ...(typeof frontmatter.description === "string" ? { summary: frontmatter.description } : {}),
      ...(nodeTags !== undefined ? { node_tags: nodeTags } : {}),
      ...(Array.isArray(frontmatter.tags) ? { tags: frontmatter.tags.filter((item): item is string => typeof item === "string") } : {}),
      ...(typeof frontmatter.relationship_mode === "string"
        ? { relationship_mode: frontmatter.relationship_mode }
        : {}),
      code_edges: codegraphEdgesFromFrontmatter(frontmatter, file.relPath),
      sources,
      sections: parseSections(file.content, sources).map((section) => ({
        ...section,
        section_ref: `${viewRef}#${String(section.id)}`,
      })),
    };
  });
  const nodeByRef = new Map<string, Record<string, unknown>>();
  for (const view of views) {
    if (!nodeByRef.has(view.node_ref)) {
      nodeByRef.set(view.node_ref, {
        node_ref: view.node_ref,
        title: view.title,
        node_type: view.node_type,
        ...(view.summary !== undefined ? { summary: view.summary } : {}),
        ...(Array.isArray(view.node_tags) ? { tags: view.node_tags } : {}),
      });
    }
  }
  const nodes = [...nodeByRef.values()];
  const projectedViews = views.map(({ code_edges: codeEdges, ...view }) => {
    void codeEdges;
    return view;
  });
  const approvedEndpointRefs = new Set<string>();
  for (const view of projectedViews) {
    approvedEndpointRefs.add(view.node_ref);
    approvedEndpointRefs.add(view.view_ref);
    for (const section of view.sections) {
      if (typeof section.section_ref === "string" && section.section_ref.length > 0) {
        approvedEndpointRefs.add(section.section_ref);
      }
    }
  }
  const edgeWarnings: string[] = [];
  const confirmedEdges = await readConfirmedStructureEdgeProjection(projectRoot, approvedEndpointRefs, {
    tolerateInvalidYaml: true,
    tolerateMissingEndpoints: true,
    onInvalidYaml: (message) => {
      edgeWarnings.push(`Dropped confirmed structure edges because .tmp/context-runtime/lifecycle/structure.yaml could not be parsed: ${message}`);
    },
    onMissingEndpoint: (message) => {
      edgeWarnings.push(message);
    },
  });
  const existingEdges = confirmedEdges === null
    ? await readApprovedStructureEdges(projectRoot, approvedEndpointRefs, {
        tolerateInvalidYaml: true,
        tolerateMissingSourceBackedAstEndpoints: true,
        onInvalidYaml: (message) => {
          edgeWarnings.push(`Dropped existing approved edges because ${STRUCTURE_PATH} could not be parsed: ${message}`);
        },
        onMissingEndpoint: (message) => edgeWarnings.push(message),
      })
    : [];
  const markdownCodeEdges = views.flatMap((view) => view.code_edges);
  const edges = uniqueEdges(currentCodegraphEdges({
    baseEdges: confirmedEdges ?? existingEdges,
    markdownEdges: markdownCodeEdges,
    endpointRefs: approvedEndpointRefs,
    onMissingEndpoint: (message) => edgeWarnings.push(message),
  }));
  const sourceInputs = await mergedApprovedStructureSourceInputs(projectRoot);
  const inputHash = approvedStructureInputHash({
    schemaVersion: STRUCTURE_SCHEMA_VERSION,
    files: approvedStructureInputFiles(files),
    edges,
    sourceInputs,
  });
  return {
    inputHash,
    structure: {
      schema_version: STRUCTURE_SCHEMA_VERSION,
      input_hash: inputHash,
      nodes,
      views: projectedViews,
      edges,
      ...(sourceInputs.length === 0
        ? {}
        : { source_inputs: approvedStructureSourceInputsRecord(sourceInputs) }),
    },
    edgeWarnings,
  };
}

function uniqueEdges(edges: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const unique: Array<Record<string, unknown>> = [];
  for (const edge of edges) {
    const key = JSON.stringify(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(edge);
  }
  return unique.sort((left, right) => edgeSortKey(left).localeCompare(edgeSortKey(right)));
}

function edgeSortKey(edge: Record<string, unknown>): string {
  return JSON.stringify({
    type: edge.type,
    from: edge.from,
    to: edge.to,
    source_refs: edge.source_refs,
    relationship_mode: edge.relationship_mode,
    relation_type: edge.relation_type,
    confidence: edge.confidence,
    note: edge.note,
  });
}

export async function writeApprovedStructureProjection(projectRoot: string): Promise<{
  edgeWarnings: string[];
  edges: number;
  inputHash: string;
  nodes: number;
  structure: string;
  views: number;
}> {
  const { inputHash, structure, edgeWarnings } = await deriveApprovedStructure(projectRoot);
  const edgeContract = validateStructureEdgeContract(structure);
  if (!edgeContract.valid) {
    throw new ContextError(ExitCode.WorkspaceStateError, "approved structure projection produced invalid edge contract", {
      category: ErrorCategory.WorkspaceStateInvalid,
      structure: STRUCTURE_PATH,
      edge_contract: edgeContract,
    });
  }
  const outputPath = join(projectRoot, STRUCTURE_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${YAML.stringify(structure)}`, "utf8");
  return {
    edgeWarnings,
    edges: Array.isArray(structure.edges) ? structure.edges.length : 0,
    inputHash,
    nodes: Array.isArray(structure.nodes) ? structure.nodes.length : 0,
    structure: STRUCTURE_PATH,
    views: Array.isArray(structure.views) ? structure.views.length : 0,
  };
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
    const relationshipCoverage = codegraphRelationshipCoverage({
      views: Array.isArray(record.views) ? record.views.filter(isApprovedStructureRecord) : [],
      edges: Array.isArray(record.edges) ? record.edges.filter(isApprovedStructureRecord) : [],
    });
    return recorded === inputHash
      ? { state: "ready", inputHash, relationshipCoverage, diagnostics: [] }
      : { state: "stale", inputHash, relationshipCoverage, diagnostics: [`close structure is stale: ${STRUCTURE_PATH}`] };
  } catch (error) {
    return {
      state: "stale",
      inputHash,
      diagnostics: [`close structure is invalid: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export async function closeProjectWorkspace(projectRoot: string): Promise<ProjectCloseResult> {
  return withProjectWriteLock(projectRoot, "close-prose", async () => {
    const draftCandidates = (await readCandidateRecords(projectRoot)).filter((candidate) => candidate.status === "draft");
    if (draftCandidates.length > 0) {
      throw new ContextError(ExitCode.WorkspaceStateError, "close is blocked while draft candidates still need Review", {
        category: ErrorCategory.WorkspaceStateInvalid,
        code: "close-draft-candidates-pending",
        draftCandidates: draftCandidates.length,
        collections: [...new Set(draftCandidates.map((candidate) => candidate.collection))].sort(),
        next: "Run context status --format json and complete the current Review route before close.",
      });
    }
    const compileBatch = await readProseCompileBatchProgress({ projectRoot });
    if (compileBatch !== undefined && !compileBatch.complete) {
      throw new ContextError(ExitCode.WorkspaceStateError, "close is blocked until the confirmed compile batch is fully reviewed", {
        category: ErrorCategory.WorkspaceStateInvalid,
        planned: compileBatch.plannedViewRefs.length,
        drafts: compileBatch.draftViewRefs,
        rejected: compileBatch.rejectedViewRefs,
        remaining: compileBatch.remainingViewRefs,
        next: "Run context status --format json and finish the remaining compile or batch Review route before close.",
      });
    }
    const resourceProjection = await repairApprovedKnowledgeAssetProjections(projectRoot);
    const { inputHash, structure, edgeWarnings } = await deriveApprovedStructure(projectRoot);
    const nodes = Array.isArray(structure.nodes) ? structure.nodes.length : 0;
    const views = Array.isArray(structure.views) ? structure.views.length : 0;
    const edges = Array.isArray(structure.edges) ? structure.edges.length : 0;
    const relationshipCoverage = codegraphRelationshipCoverage({
      views: Array.isArray(structure.views) ? structure.views.filter(isApprovedStructureRecord) : [],
      edges: Array.isArray(structure.edges) ? structure.edges.filter(isApprovedStructureRecord) : [],
    });
    const edgeContract = validateStructureEdgeContract(structure);
    if (!edgeContract.valid) {
      throw new ContextError(ExitCode.WorkspaceStateError, "close produced invalid approved structural edge contract", {
        category: ErrorCategory.WorkspaceStateInvalid,
        structure: STRUCTURE_PATH,
        edge_contract: edgeContract,
      });
    }
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
    await clearCompletedLifecycle(projectRoot);
    return {
      action: "closed",
      projectRoot,
      structure: STRUCTURE_PATH,
      nodes,
      views,
      edges,
      edgeContract,
      references: referencesReceipt(),
      resourceProjection: {
        repairedPages: resourceProjection.repairedPages.length,
        writtenAssets: resourceProjection.writtenAssets.length,
        removedAssets: resourceProjection.removedAssets.length,
      },
      edgeWarnings,
      relationshipCoverage,
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
  if (input.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write([
      `closed context project`,
      `structure: ${result.structure}`,
      `nodes: ${result.nodes}`,
      `views: ${result.views}`,
      `edges: ${result.edges}`,
      `codegraph relationships: ${result.relationshipCoverage.state} (${result.relationshipCoverage.emitted_edges} edge(s))`,
      `edge structural contract: ${result.edgeContract.valid ? "valid" : "invalid"} (${result.edgeContract.checked} edge(s))`,
      ...(result.edgeWarnings.length > 0 ? [`edge warnings: ${result.edgeWarnings.join("; ")}`] : []),
      `references: ${result.references.status}, rewrites verbatim: ${result.references.rewritesVerbatim}`,
      `verify: ${result.verifyErrors} error(s), ${result.verifyWarnings} warning(s)`,
      "",
    ].join("\n"));
  }
  queueContextRuntimeEvent({
    cwd: result.projectRoot,
    kind: "knowledge.closed",
    properties: {
      node_count: result.nodes,
      view_count: result.views,
      edge_count: result.edges,
      verify_warning_count: result.verifyWarnings,
      relationship_coverage: result.relationshipCoverage.state,
    },
  });
  return true;
}
