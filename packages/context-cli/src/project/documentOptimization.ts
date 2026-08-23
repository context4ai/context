import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { extractRawBlocks } from "../incremental/rawBlocks.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import {
  DOCUMENT_OPTIMIZATION_POLICY,
  documentOptimizationRoot,
  isDocumentOptimizationEnabled,
} from "./documentOptimizationConfig.js";

const SPAN_REF_RE = /^src-\d+#span:/u;
const SECTION_RE = /<!--\s*context:section\b([\s\S]*?)-->([\s\S]*?)(?:<!--\s*\/context:section\s*-->|$)/giu;
const OVERRIDE_BODY_RE = /<!--\s*context:optimization-fragment\s*-->([\s\S]*?)<!--\s*\/context:optimization-fragment\s*-->/u;
const GENERATED_SCHEMA = "context.document-optimization-fragment.v1";
const OVERRIDE_SCHEMA = "context.document-optimization-override.v1";

export interface DocumentOptimizationFragment {
  fragment_id: string;
  view_ref: string;
  approved_path: string;
  section_id: string;
  source_ref: string;
  kind: string;
  heading_path: string[];
  line_start: number;
  line_end: number;
  line_range: string;
  content: string;
  input_digest: string;
  context_digest: string;
  policy_digest: string;
}

interface StoredDecision {
  schema: typeof GENERATED_SCHEMA;
  fragment_id: string;
  input_digest: string;
  context_digest: string;
  policy_digest: string;
  action: "keep" | "replace";
  replacement?: string;
  reason?: string;
  updated_at: string;
}

interface ParsedOverride {
  fragment_id: string;
  input_digest: string;
  context_digest: string;
  policy_digest: string;
  replacement: string;
  path: string;
}

export interface DocumentOptimizationStatus {
  schema: "context.document-optimization-status.v1";
  enabled: boolean;
  policy: string;
  overlay_root: string;
  eligible_views: number;
  eligible_fragments: number;
  optimized_fragments: number;
  kept_fragments: number;
  override_fragments: number;
  pending_fragments: number;
  conflict_fragments: number;
  current: boolean;
  pending_fragment_ids: string[];
  conflict_fragment_ids: string[];
}

export interface DocumentOptimizationPlan extends Omit<DocumentOptimizationStatus, "schema"> {
  schema: "context.document-optimization-plan.v1";
  fragments: DocumentOptimizationFragment[];
  payload_target: string;
  next_action: {
    kind: "apply-document-optimization";
    command: string;
  };
}

interface ApplyDecisionInput {
  fragment_id: string;
  input_digest: string;
  context_digest: string;
  policy_digest: string;
  action: "keep" | "replace";
  replacement?: string;
  reason?: string;
}

export interface DocumentOptimizationApplyInput {
  schema: "context.document-optimization-decisions.v1";
  decisions: ApplyDecisionInput[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeFileName(value: string): string {
  return `${sha256(value).slice(0, 24)}.json`;
}

function generatedFragmentPath(projectRoot: string, fragmentId: string): string {
  return join(
    documentOptimizationRoot(projectRoot),
    "generated",
    "fragments",
    safeFileName(fragmentId),
  );
}

function generatedViewPath(projectRoot: string, approvedPath: string): string {
  return join(
    documentOptimizationRoot(projectRoot),
    "generated",
    "views",
    safeFileName(approvedPath),
  );
}

function overridesRoot(projectRoot: string): string {
  return join(documentOptimizationRoot(projectRoot), "overrides");
}

function fragmentLines(body: string, start: number, end: number): string {
  return body.split(/\r?\n/u).slice(start - 1, end).join("\n");
}

function fragmentIdentity(input: {
  approvedPath: string;
  sectionId: string;
  locator: string;
}): string {
  return `opt-${sha256(`${input.approvedPath}\u0000${input.sectionId}\u0000${input.locator}`).slice(0, 24)}`;
}

function eligibleFile(file: ApprovedKnowledgeFile): boolean {
  if (file.relPath === "structure.yaml" || file.relPath.startsWith("codegraph/")) return false;
  const frontmatter = parseKnowledgeFrontmatter(file.content);
  return frontmatter.generated !== true;
}

function fragmentsForFile(file: ApprovedKnowledgeFile): DocumentOptimizationFragment[] {
  if (!eligibleFile(file)) return [];
  const frontmatter = parseKnowledgeFrontmatter(file.content);
  const viewRef = typeof frontmatter.view_ref === "string" && frontmatter.view_ref.length > 0
    ? frontmatter.view_ref
    : file.relPath;
  return approvedContextSectionsInMarkdown(file.content).flatMap((section, sectionIndex) => {
    const sourceRef = section.refs.find((ref) => SPAN_REF_RE.test(ref));
    if (section.contentMode !== "verbatim" || sourceRef === undefined) return [];
    const sectionId = section.id ?? `section-${sectionIndex + 1}`;
    const blocks = extractRawBlocks(section.readerVisibleBody);
    return blocks.flatMap((block) => {
      const content = fragmentLines(section.readerVisibleBody, block.line_start, block.line_end);
      if (content.trim().length === 0) return [];
      const fragmentId = fragmentIdentity({
        approvedPath: file.relPath,
        sectionId,
        locator: block.block_locator_id,
      });
      const contextDigest = sha256(JSON.stringify({
        viewRef,
        sectionId,
        sourceRef,
        kind: block.kind,
        headingPath: block.heading_path,
      }));
      return [{
        fragment_id: fragmentId,
        view_ref: viewRef,
        approved_path: file.relPath,
        section_id: sectionId,
        source_ref: sourceRef,
        kind: block.kind,
        heading_path: block.heading_path,
        line_start: section.line + block.line_start - 1,
        line_end: section.line + block.line_end - 1,
        line_range: `${section.line + block.line_start - 1}-${section.line + block.line_end - 1}`,
        content,
        input_digest: sha256(content),
        context_digest: contextDigest,
        policy_digest: sha256(DOCUMENT_OPTIMIZATION_POLICY),
      } satisfies DocumentOptimizationFragment];
    });
  });
}

export function collectDocumentOptimizationFragments(
  files: readonly ApprovedKnowledgeFile[],
): DocumentOptimizationFragment[] {
  return files.flatMap(fragmentsForFile).sort((left, right) =>
    left.approved_path.localeCompare(right.approved_path) ||
    left.line_start - right.line_start ||
    left.fragment_id.localeCompare(right.fragment_id)
  );
}

async function readStoredDecision(projectRoot: string, fragmentId: string): Promise<StoredDecision | null> {
  const path = generatedFragmentPath(projectRoot, fragmentId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.schema !== GENERATED_SCHEMA) return null;
    if (
      parsed.fragment_id !== fragmentId ||
      typeof parsed.input_digest !== "string" ||
      typeof parsed.context_digest !== "string" ||
      typeof parsed.policy_digest !== "string" ||
      (parsed.action !== "keep" && parsed.action !== "replace") ||
      (parsed.action === "replace" && typeof parsed.replacement !== "string")
    ) return null;
    return parsed as unknown as StoredDecision;
  } catch {
    return null;
  }
}

async function listOverrideFiles(projectRoot: string): Promise<string[]> {
  const root = overridesRoot(projectRoot);
  if (!existsSync(root)) return [];
  const paths: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) paths.push(path);
    }
  };
  await visit(root);
  return paths.sort();
}

function parseOverride(content: string, path: string): ParsedOverride | null {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  const bodyMatch = OVERRIDE_BODY_RE.exec(content);
  if (frontmatterMatch?.[1] === undefined || bodyMatch?.[1] === undefined) return null;
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(frontmatterMatch[1]);
  } catch {
    return null;
  }
  if (!isRecord(frontmatter) || frontmatter.schema !== OVERRIDE_SCHEMA) return null;
  for (const key of ["fragment_id", "input_digest", "context_digest", "policy_digest"] as const) {
    if (typeof frontmatter[key] !== "string") return null;
  }
  return {
    fragment_id: frontmatter.fragment_id as string,
    input_digest: frontmatter.input_digest as string,
    context_digest: frontmatter.context_digest as string,
    policy_digest: frontmatter.policy_digest as string,
    replacement: bodyMatch[1].replace(/^\r?\n/u, "").replace(/\r?\n$/u, ""),
    path,
  };
}

async function readOverrides(projectRoot: string): Promise<Map<string, ParsedOverride | null>> {
  const overrides = new Map<string, ParsedOverride | null>();
  for (const path of await listOverrideFiles(projectRoot)) {
    const parsed = parseOverride(await readFile(path, "utf8"), path);
    const fileFragmentId = basename(path, ".md");
    overrides.set(
      fileFragmentId,
      parsed?.fragment_id === fileFragmentId ? parsed : null,
    );
  }
  return overrides;
}

function decisionMatches(fragment: DocumentOptimizationFragment, decision: {
  input_digest: string;
  context_digest: string;
  policy_digest: string;
}): boolean {
  return fragment.input_digest === decision.input_digest &&
    fragment.context_digest === decision.context_digest &&
    fragment.policy_digest === decision.policy_digest;
}

interface ResolvedFragmentState {
  fragment: DocumentOptimizationFragment;
  state: "optimized" | "kept" | "override" | "pending" | "conflict";
  replacement?: string;
}

async function resolveFragmentStates(
  projectRoot: string,
  fragments: readonly DocumentOptimizationFragment[],
): Promise<ResolvedFragmentState[]> {
  const overrides = await readOverrides(projectRoot);
  return Promise.all(fragments.map(async (fragment): Promise<ResolvedFragmentState> => {
    if (overrides.has(fragment.fragment_id)) {
      const override = overrides.get(fragment.fragment_id);
      if (override === null || override === undefined) return { fragment, state: "conflict" };
      if (!decisionMatches(fragment, override)) return { fragment, state: "conflict" };
      try {
        assertSafeReplacement(fragment, override.replacement);
        return { fragment, state: "override", replacement: override.replacement };
      } catch {
        return { fragment, state: "conflict" };
      }
    }
    const generated = await readStoredDecision(projectRoot, fragment.fragment_id);
    if (generated === null || !decisionMatches(fragment, generated)) {
      return { fragment, state: "pending" };
    }
    return generated.action === "keep"
      ? { fragment, state: "kept" }
      : { fragment, state: "optimized", replacement: generated.replacement! };
  }));
}

function statusFromStates(input: {
  projectRoot: string;
  enabled: boolean;
  states: readonly ResolvedFragmentState[];
}): DocumentOptimizationStatus {
  const pending = input.states.filter((item) => item.state === "pending");
  const conflicts = input.states.filter((item) => item.state === "conflict");
  return {
    schema: "context.document-optimization-status.v1",
    enabled: input.enabled,
    policy: DOCUMENT_OPTIMIZATION_POLICY,
    overlay_root: documentOptimizationRoot(input.projectRoot),
    eligible_views: new Set(input.states.map((item) => item.fragment.view_ref)).size,
    eligible_fragments: input.states.length,
    optimized_fragments: input.states.filter((item) => item.state === "optimized").length,
    kept_fragments: input.states.filter((item) => item.state === "kept").length,
    override_fragments: input.states.filter((item) => item.state === "override").length,
    pending_fragments: pending.length,
    conflict_fragments: conflicts.length,
    current: !input.enabled || (pending.length === 0 && conflicts.length === 0),
    pending_fragment_ids: pending.map((item) => item.fragment.fragment_id),
    conflict_fragment_ids: conflicts.map((item) => item.fragment.fragment_id),
  };
}

export function disabledDocumentOptimizationStatus(projectRoot: string): DocumentOptimizationStatus {
  return statusFromStates({ projectRoot, enabled: false, states: [] });
}

export async function collectDocumentOptimizationStatus(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<DocumentOptimizationStatus> {
  const enabled = await isDocumentOptimizationEnabled(input.projectRoot);
  if (!enabled) return statusFromStates({ projectRoot: input.projectRoot, enabled, states: [] });
  const states = await resolveFragmentStates(
    input.projectRoot,
    collectDocumentOptimizationFragments(input.files),
  );
  return statusFromStates({ projectRoot: input.projectRoot, enabled, states });
}

export async function createDocumentOptimizationPlan(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<DocumentOptimizationPlan> {
  const enabled = await isDocumentOptimizationEnabled(input.projectRoot);
  const fragments = enabled ? collectDocumentOptimizationFragments(input.files) : [];
  const states = enabled ? await resolveFragmentStates(input.projectRoot, fragments) : [];
  const status = statusFromStates({ projectRoot: input.projectRoot, enabled, states });
  const pending = states
    .filter((item) => item.state === "pending" || item.state === "conflict")
    .map((item) => item.fragment);
  const payloadTarget = ".tmp/agent-payloads/document-optimization-decisions.json";
  return {
    ...status,
    schema: "context.document-optimization-plan.v1",
    fragments: pending,
    payload_target: payloadTarget,
    next_action: {
      kind: "apply-document-optimization",
      command: `context optimize-docs apply --input ${payloadTarget} --format json`,
    },
  };
}

function protectedValues(value: string): {
  urls: string[];
  code: string[];
  numbers: string[];
} {
  return {
    urls: [...value.matchAll(/(?:https?:\/\/|mailto:)[^\s)\]>]+/gu)].map((match) => match[0]),
    code: [
      ...value.matchAll(/`([^`\n]+)`/gu),
      ...value.matchAll(/```[^\n]*\n[\s\S]*?```/gu),
    ].map((match) => match[0]),
    numbers: [...value.matchAll(/\b\d+(?:\.\d+)*\b/gu)].map((match) => match[0]),
  };
}

function semanticTokens(value: string): Set<string> {
  return new Set([
    ...value.toLowerCase().matchAll(/[a-z][a-z0-9_.:/-]{1,}|[\p{Script=Han}]/gu),
  ].map((match) => match[0]));
}

function assertSafeReplacement(fragment: DocumentOptimizationFragment, replacement: string): void {
  if (replacement.trim().length === 0) {
    throw new ContextError(ExitCode.UserError, `optimized fragment cannot be empty: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const beforeProtected = protectedValues(fragment.content);
  const afterProtected = protectedValues(replacement);
  if (JSON.stringify(beforeProtected) !== JSON.stringify(afterProtected)) {
    throw new ContextError(ExitCode.UserError, `optimized fragment changed protected URLs, code, or numbers: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      next: "Preserve protected tokens exactly and limit the edit to formatting, Markdown repair, or an obvious typo.",
    });
  }
  const beforeTokens = semanticTokens(fragment.content);
  const afterTokens = semanticTokens(replacement);
  const common = [...beforeTokens].filter((token) => afterTokens.has(token)).length;
  const similarity = beforeTokens.size === 0 ? 1 : common / beforeTokens.size;
  const lengthRatio = replacement.length / Math.max(fragment.content.length, 1);
  if (similarity < 0.78 || lengthRatio < 0.7 || lengthRatio > 1.3) {
    throw new ContextError(ExitCode.UserError, `optimized fragment exceeds the conservative edit envelope: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      similarity,
      length_ratio: lengthRatio,
      next: "Keep the original meaning and ordering; make only local presentation repairs.",
    });
  }
}

function parseApplyInput(value: unknown): DocumentOptimizationApplyInput {
  if (!isRecord(value) || value.schema !== "context.document-optimization-decisions.v1" || !Array.isArray(value.decisions)) {
    throw new ContextError(ExitCode.UserError, "document optimization input must match context.document-optimization-decisions.v1", {
      category: ErrorCategory.SchemaInvalid,
    });
  }
  const decisions = value.decisions.map((raw, index): ApplyDecisionInput => {
    if (!isRecord(raw)) {
      throw new ContextError(ExitCode.UserError, `document optimization decision ${index + 1} must be an object`, {
        category: ErrorCategory.SchemaInvalid,
      });
    }
    if (
      typeof raw.fragment_id !== "string" ||
      typeof raw.input_digest !== "string" ||
      typeof raw.context_digest !== "string" ||
      typeof raw.policy_digest !== "string" ||
      (raw.action !== "keep" && raw.action !== "replace") ||
      (raw.action === "replace" && typeof raw.replacement !== "string")
    ) {
      throw new ContextError(ExitCode.UserError, `document optimization decision ${index + 1} is invalid`, {
        category: ErrorCategory.SchemaInvalid,
      });
    }
    return raw as unknown as ApplyDecisionInput;
  });
  return { schema: "context.document-optimization-decisions.v1", decisions };
}

export async function applyDocumentOptimizationDecisions(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
  payload: unknown;
}): Promise<{ applied: number; status: DocumentOptimizationStatus }> {
  if (!(await isDocumentOptimizationEnabled(input.projectRoot))) {
    throw new ContextError(ExitCode.UserError, "document optimization is disabled", {
      category: ErrorCategory.WorkspaceStateInvalid,
      next: "Run context optimize-docs enable before applying decisions.",
    });
  }
  const payload = parseApplyInput(input.payload);
  const plan = await createDocumentOptimizationPlan(input);
  const expected = new Map(plan.fragments.map((fragment) => [fragment.fragment_id, fragment]));
  const seen = new Set<string>();
  const validated = payload.decisions.map((decision) => {
    const fragment = expected.get(decision.fragment_id);
    if (fragment === undefined || seen.has(decision.fragment_id) || !decisionMatches(fragment, decision)) {
      throw new ContextError(ExitCode.UserError, `document optimization decision is stale or duplicated: ${decision.fragment_id}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        next: "Run context optimize-docs plan --format json and regenerate the decision payload.",
      });
    }
    seen.add(decision.fragment_id);
    if (decision.action === "replace") assertSafeReplacement(fragment, decision.replacement!);
    return { decision, fragment };
  });
  if (seen.size !== expected.size) {
    throw new ContextError(ExitCode.UserError, "document optimization payload must resolve the complete current batch", {
      category: ErrorCategory.UserInputInvalid,
      expected: expected.size,
      received: seen.size,
    });
  }
  for (const { decision, fragment } of validated) {
    const record: StoredDecision = {
      schema: GENERATED_SCHEMA,
      fragment_id: fragment.fragment_id,
      input_digest: fragment.input_digest,
      context_digest: fragment.context_digest,
      policy_digest: fragment.policy_digest,
      action: decision.action,
      ...(decision.replacement === undefined ? {} : { replacement: decision.replacement }),
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
      updated_at: new Date().toISOString(),
    };
    const path = generatedFragmentPath(input.projectRoot, fragment.fragment_id);
    await mkdir(dirname(path), { recursive: true });
    await atomicWriteFile(path, `${JSON.stringify(record, null, 2)}\n`);
  }
  const byView = new Map<string, DocumentOptimizationFragment[]>();
  for (const fragment of collectDocumentOptimizationFragments(input.files)) {
    const list = byView.get(fragment.approved_path) ?? [];
    list.push(fragment);
    byView.set(fragment.approved_path, list);
  }
  for (const [approvedPath, fragments] of byView) {
    const path = generatedViewPath(input.projectRoot, approvedPath);
    await mkdir(dirname(path), { recursive: true });
    await atomicWriteFile(path, `${JSON.stringify({
      schema: "context.document-optimization-view.v1",
      approved_path: approvedPath,
      policy: DOCUMENT_OPTIMIZATION_POLICY,
      fragments: fragments.map((fragment) => ({
        fragment_id: fragment.fragment_id,
        input_digest: fragment.input_digest,
        context_digest: fragment.context_digest,
        policy_digest: fragment.policy_digest,
        line_range: fragment.line_range,
      })),
    }, null, 2)}\n`);
  }
  return {
    applied: validated.length,
    status: await collectDocumentOptimizationStatus(input),
  };
}

function sectionRanges(content: string): Array<{
  sectionId: string;
  visibleBody: string;
  visibleStart: number;
  visibleEnd: number;
}> {
  const evidence = approvedContextSectionsInMarkdown(content);
  const ranges: Array<{ sectionId: string; visibleBody: string; visibleStart: number; visibleEnd: number }> = [];
  let match: RegExpExecArray | null;
  let index = 0;
  SECTION_RE.lastIndex = 0;
  while ((match = SECTION_RE.exec(content)) !== null) {
    const item = evidence[index];
    const rawBody = match[2] ?? "";
    if (item !== undefined) {
      const offset = rawBody.indexOf(item.readerVisibleBody);
      if (offset >= 0) {
        const rawBodyStart = match.index + match[0].indexOf(rawBody);
        const visibleStart = rawBodyStart + offset;
        ranges.push({
          sectionId: item.id ?? `section-${index + 1}`,
          visibleBody: item.readerVisibleBody,
          visibleStart,
          visibleEnd: visibleStart + item.readerVisibleBody.length,
        });
      }
    }
    index += 1;
  }
  return ranges;
}

function replaceBodyFragments(input: {
  body: string;
  fragments: readonly ResolvedFragmentState[];
}): string {
  let body = input.body;
  const replacements = input.fragments.flatMap((item) => {
    if (item.replacement === undefined) return [];
    const blocks = extractRawBlocks(input.body);
    const block = blocks.find((candidate) =>
      fragmentIdentity({
        approvedPath: item.fragment.approved_path,
        sectionId: item.fragment.section_id,
        locator: candidate.block_locator_id,
      }) === item.fragment.fragment_id
    );
    if (block === undefined) return [];
    const lines = input.body.split(/\r?\n/u);
    const before = lines.slice(0, block.line_start - 1).join("\n");
    const target = lines.slice(block.line_start - 1, block.line_end).join("\n");
    const start = before.length + (block.line_start > 1 ? 1 : 0);
    return [{ start, end: start + target.length, value: item.replacement }];
  }).sort((left, right) => right.start - left.start);
  for (const replacement of replacements) {
    body = `${body.slice(0, replacement.start)}${replacement.value}${body.slice(replacement.end)}`;
  }
  return body;
}

export async function projectDocumentOptimizedKnowledge(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
}): Promise<{ files: ApprovedKnowledgeFile[]; status: DocumentOptimizationStatus }> {
  const enabled = await isDocumentOptimizationEnabled(input.projectRoot);
  if (!enabled) {
    return {
      files: [...input.files],
      status: statusFromStates({ projectRoot: input.projectRoot, enabled, states: [] }),
    };
  }
  const fragments = collectDocumentOptimizationFragments(input.files);
  const states = await resolveFragmentStates(input.projectRoot, fragments);
  const status = statusFromStates({ projectRoot: input.projectRoot, enabled, states });
  if (!status.current) return { files: [...input.files], status };
  const byPath = new Map<string, ResolvedFragmentState[]>();
  for (const state of states) {
    const list = byPath.get(state.fragment.approved_path) ?? [];
    list.push(state);
    byPath.set(state.fragment.approved_path, list);
  }
  const files = input.files.map((file) => {
    const fileStates = byPath.get(file.relPath);
    if (fileStates === undefined) return file;
    let content = file.content;
    for (const section of sectionRanges(file.content).sort((left, right) => right.visibleStart - left.visibleStart)) {
      const sectionStates = fileStates.filter((state) => state.fragment.section_id === section.sectionId);
      if (sectionStates.length === 0) continue;
      const body = replaceBodyFragments({ body: section.visibleBody, fragments: sectionStates });
      content = `${content.slice(0, section.visibleStart)}${body}${content.slice(section.visibleEnd)}`;
    }
    return { ...file, content };
  });
  return { files, status };
}

export async function createDocumentOptimizationOverride(input: {
  projectRoot: string;
  files: readonly ApprovedKnowledgeFile[];
  fragmentId: string;
}): Promise<{ path: string; created: boolean }> {
  const fragments = collectDocumentOptimizationFragments(input.files);
  const fragment = fragments.find((item) => item.fragment_id === input.fragmentId);
  if (fragment === undefined) {
    throw new ContextError(ExitCode.UserError, `document optimization fragment not found: ${input.fragmentId}`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const states = await resolveFragmentStates(input.projectRoot, [fragment]);
  const state = states[0]!;
  const path = join(overridesRoot(input.projectRoot), `${fragment.fragment_id}.md`);
  if (existsSync(path)) return { path, created: false };
  const frontmatter = stringifyYaml({
    schema: OVERRIDE_SCHEMA,
    fragment_id: fragment.fragment_id,
    input_digest: fragment.input_digest,
    context_digest: fragment.context_digest,
    policy_digest: fragment.policy_digest,
    approved_path: fragment.approved_path,
    line_range: fragment.line_range,
  }).trim();
  const replacement = state.replacement ?? fragment.content;
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, [
    "---",
    frontmatter,
    "---",
    "",
    "<!-- Edit only the fragment body between the markers. -->",
    "<!-- context:optimization-fragment -->",
    replacement,
    "<!-- /context:optimization-fragment -->",
    "",
  ].join("\n"));
  return { path, created: true };
}
