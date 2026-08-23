import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import {
  assertSafeDocumentOptimizationReplacement,
  collectDocumentOptimizationFragments,
  isRecord,
  renderDocumentOptimizationPage,
  sha256,
  withDocumentOverlayMetadata,
  type DocumentOptimizationFragment,
} from "./documentOptimizationModel.js";
import {
  DOCUMENT_OPTIMIZATION_POLICY,
  documentOptimizationCacheRoot,
  documentOptimizationRoot,
} from "./documentOptimizationConfig.js";

const DECISION_CACHE_SCHEMA = "context.document-optimization-cache.v2";
const LEGACY_GENERATED_SCHEMA = "context.document-optimization-fragment.v1";
const LEGACY_OVERRIDE_SCHEMA = "context.document-optimization-override.v1";
const LEGACY_OVERRIDE_BODY_RE = /<!--\s*context:optimization-fragment\s*-->([\s\S]*?)<!--\s*\/context:optimization-fragment\s*-->/u;

export interface StoredDocumentOptimizationDecision {
  fragment_id: string;
  input_digest: string;
  context_digest: string;
  policy_digest: string;
  action: "keep" | "replace" | "override";
  replacement?: string;
  reason?: string;
}

interface DecisionCache {
  schema: typeof DECISION_CACHE_SCHEMA;
  policy: string;
  decisions: StoredDocumentOptimizationDecision[];
}

function cachePath(projectRoot: string): string {
  return join(documentOptimizationCacheRoot(projectRoot), "decisions.json");
}

export function pageOverlayPath(projectRoot: string, approvedPath: string): string {
  return join(documentOptimizationRoot(projectRoot), approvedPath);
}

function validDecision(value: unknown): value is StoredDocumentOptimizationDecision {
  if (!isRecord(value)) return false;
  return typeof value.fragment_id === "string" &&
    typeof value.input_digest === "string" &&
    typeof value.context_digest === "string" &&
    typeof value.policy_digest === "string" &&
    (value.action === "keep" || value.action === "replace" || value.action === "override") &&
    ((value.action === "replace" || value.action === "override") ? typeof value.replacement === "string" : true) &&
    (value.reason === undefined || typeof value.reason === "string");
}

export async function readDocumentOptimizationDecisions(
  projectRoot: string,
): Promise<Map<string, StoredDocumentOptimizationDecision>> {
  const path = cachePath(projectRoot);
  if (!existsSync(path)) return new Map();
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (
      !isRecord(value) || value.schema !== DECISION_CACHE_SCHEMA ||
      value.policy !== DOCUMENT_OPTIMIZATION_POLICY || !Array.isArray(value.decisions)
    ) return new Map();
    const decisions = value.decisions.filter(validDecision);
    if (decisions.length !== value.decisions.length) return new Map();
    return new Map(decisions.map((decision) => [decision.fragment_id, decision]));
  } catch {
    return new Map();
  }
}

export async function writeDocumentOptimizationDecisions(
  projectRoot: string,
  decisions: Iterable<StoredDocumentOptimizationDecision>,
): Promise<void> {
  const path = cachePath(projectRoot);
  const records = [...decisions].sort((left, right) => left.fragment_id.localeCompare(right.fragment_id));
  await mkdir(dirname(path), { recursive: true });
  const value: DecisionCache = {
    schema: DECISION_CACHE_SCHEMA,
    policy: DOCUMENT_OPTIMIZATION_POLICY,
    decisions: records,
  };
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readDocumentPageOverlay(
  projectRoot: string,
  approvedPath: string,
): Promise<string | null> {
  const path = pageOverlayPath(projectRoot, approvedPath);
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function pruneEmptyParents(path: string, stop: string): Promise<void> {
  let current = dirname(path);
  while (current !== stop && current.startsWith(`${stop}/`)) {
    try {
      await rm(current);
    } catch {
      break;
    }
    current = dirname(current);
  }
}

export async function removeDocumentPageOverlay(projectRoot: string, approvedPath: string): Promise<void> {
  const path = pageOverlayPath(projectRoot, approvedPath);
  await rm(path, { force: true });
  await pruneEmptyParents(path, documentOptimizationRoot(projectRoot));
}

export async function writeDocumentPageOverlay(input: {
  projectRoot: string;
  file: ApprovedKnowledgeFile;
  replacements: ReadonlyMap<string, string>;
}): Promise<string | null> {
  if (input.replacements.size === 0) {
    await removeDocumentPageOverlay(input.projectRoot, input.file.relPath);
    return null;
  }
  const rendered = renderDocumentOptimizationPage({ file: input.file, replacements: input.replacements });
  const content = withDocumentOverlayMetadata({
    content: rendered,
    approvedPath: input.file.relPath,
    baseDigest: sha256(input.file.content),
    optimizedFragments: input.replacements.size,
  });
  const path = pageOverlayPath(input.projectRoot, input.file.relPath);
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, content);
  return path;
}

async function listFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const paths: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(path);
    }
  };
  await visit(root);
  return paths.sort();
}

function legacyDecision(value: unknown): StoredDocumentOptimizationDecision | null {
  if (!isRecord(value) || value.schema !== LEGACY_GENERATED_SCHEMA) return null;
  if (
    typeof value.fragment_id !== "string" || typeof value.input_digest !== "string" ||
    typeof value.context_digest !== "string" || typeof value.policy_digest !== "string" ||
    (value.action !== "keep" && value.action !== "replace") ||
    (value.action === "replace" && typeof value.replacement !== "string")
  ) return null;
  return {
    fragment_id: value.fragment_id,
    input_digest: value.input_digest,
    context_digest: value.context_digest,
    policy_digest: value.policy_digest,
    action: value.action,
    ...(typeof value.replacement === "string" ? { replacement: value.replacement } : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
}

function legacyOverride(content: string): StoredDocumentOptimizationDecision | null {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  const bodyMatch = LEGACY_OVERRIDE_BODY_RE.exec(content);
  if (frontmatterMatch?.[1] === undefined || bodyMatch?.[1] === undefined) return null;
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(frontmatterMatch[1]);
  } catch {
    return null;
  }
  if (!isRecord(frontmatter) || frontmatter.schema !== LEGACY_OVERRIDE_SCHEMA) return null;
  for (const key of ["fragment_id", "input_digest", "context_digest", "policy_digest"] as const) {
    if (typeof frontmatter[key] !== "string") return null;
  }
  return {
    fragment_id: frontmatter.fragment_id as string,
    input_digest: frontmatter.input_digest as string,
    context_digest: frontmatter.context_digest as string,
    policy_digest: frontmatter.policy_digest as string,
    action: "override",
    replacement: bodyMatch[1].replace(/^\r?\n/u, "").replace(/\r?\n$/u, ""),
  };
}

function decisionMatches(fragment: DocumentOptimizationFragment, decision: StoredDocumentOptimizationDecision): boolean {
  return fragment.input_digest === decision.input_digest &&
    fragment.context_digest === decision.context_digest;
}

function recoveryTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

export async function migrateLegacyDocumentOptimization(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<string | null> {
  const legacyRoot = join(documentOptimizationRoot(input.projectRoot), "document-optimization");
  if (!existsSync(legacyRoot)) return null;
  const decisions = new Map<string, StoredDocumentOptimizationDecision>();
  for (const path of await listFiles(join(legacyRoot, "generated", "fragments"))) {
    try {
      const parsed = legacyDecision(JSON.parse(await readFile(path, "utf8")) as unknown);
      if (parsed !== null) decisions.set(parsed.fragment_id, parsed);
    } catch {
      continue;
    }
  }
  for (const path of await listFiles(join(legacyRoot, "overrides"))) {
    if (!path.endsWith(".md")) continue;
    const parsed = legacyOverride(await readFile(path, "utf8"));
    if (parsed !== null && basename(path, ".md") === parsed.fragment_id) decisions.set(parsed.fragment_id, parsed);
  }
  const fragments = collectDocumentOptimizationFragments(input.files);
  const current = new Map<string, StoredDocumentOptimizationDecision>();
  for (const fragment of fragments) {
    const decision = decisions.get(fragment.fragment_id);
    if (decision === undefined || !decisionMatches(fragment, decision)) continue;
    const migrated: StoredDocumentOptimizationDecision = {
      ...decision,
      policy_digest: fragment.policy_digest,
    };
    if (migrated.replacement !== undefined) {
      try {
        assertSafeDocumentOptimizationReplacement(fragment, migrated.replacement);
      } catch {
        continue;
      }
    }
    current.set(fragment.fragment_id, migrated);
  }
  for (const file of input.files) {
    const replacements = new Map(fragments
      .filter((fragment) => fragment.approved_path === file.relPath)
      .flatMap((fragment) => {
        const decision = current.get(fragment.fragment_id);
        return decision?.replacement === undefined ? [] : [[fragment.fragment_id, decision.replacement] as const];
      }));
    await writeDocumentPageOverlay({ projectRoot: input.projectRoot, file, replacements });
  }
  await writeDocumentOptimizationDecisions(input.projectRoot, current.values());
  const recoveryRoot = join(input.projectRoot, ".tmp", "context-runtime", "recovery");
  await mkdir(recoveryRoot, { recursive: true });
  const recoveryPath = join(recoveryRoot, `document-optimization-v1-${recoveryTimestamp()}`);
  await rename(legacyRoot, recoveryPath);
  return recoveryPath;
}
