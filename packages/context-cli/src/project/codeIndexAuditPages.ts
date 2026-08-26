import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hydrateApprovedKnowledgeMarkdown, readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { readCandidateRecords, type CandidateRecord } from "./candidateLedger.js";
import { isCodeIndexCollection } from "./codeIndexCollection.js";
import { codeIndexReaderMarkdown, measureCodeIndexMarkdown } from "./codeIndexAuditMetrics.js";
import type { CodeIndexAuditPageMetrics, CodeIndexAuditReport } from "./codeIndexAuditTypes.js";
import { stableHash } from "./extractCandidateArtifacts.js";
import { parseFrontmatterLoose } from "./verifyFrontmatter.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { walkApprovedMarkdown } from "./verifyProjectFiles.js";

const CODE_CANDIDATE_SNAPSHOT_ROOT = ".tmp/context-runtime/extract/candidates";

export interface AuditedPage {
  metrics: CodeIndexAuditPageMetrics;
  sourceNames: string[];
  sectionEvidenceCounts: number[];
  sectionEvidenceGroups: string[][];
  pageEvidenceRefs: string[];
  sectionEffectiveChars: number[];
  relationEvidenceCounts: number[];
  relationEvidenceGroups: string[][];
  boilerplateParagraphs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function evidenceSource(ref: string): string | undefined {
  return /^repo:([^#]+)#/u.exec(ref)?.[1];
}

function evidenceFile(ref: string): string | undefined {
  return /^repo:[^#]+#symbol:([^:]+):/u.exec(ref)?.[1];
}

function evidenceSymbol(ref: string): string | undefined {
  return /^repo:[^#]+#symbol:[^:]+:([^:]+):/u.exec(ref)?.[1];
}

function markdownBody(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "");
}

function semanticContentDigest(markdown: string): string {
  return stableHash(codeIndexReaderMarkdown(markdown).replace(/\r\n/gu, "\n").trim());
}

function genericParagraphs(markdown: string): string[] {
  return codeIndexReaderMarkdown(markdown)
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
    .filter((paragraph) =>
      paragraph.length >= 80 &&
      !/^#{1,6}\s|^(?:[-*+] |\d+[.)] )|^\|/u.test(paragraph) &&
      !/`[^`]+`|https?:\/\/|(?:^|\s)[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*/u.test(paragraph)
    )
    .map((paragraph) => paragraph.toLowerCase());
}

function lineIsMostlyLocator(line: string): boolean {
  const value = line
    .replace(/^\s*(?:[-*+] |\d+[.)] )/u, "")
    .replaceAll("`", "")
    .trim();
  if (value.length === 0 || /\s/u.test(value)) return false;
  return value.includes("/") || /\.[a-z0-9]{1,8}(?:[#?:].*)?$/iu.test(value);
}

export function effectiveMarkdownChars(markdown: string): number {
  const body = codeIndexReaderMarkdown(markdown)
    .replace(/```[^\n]*\n([\s\S]*?)```/gu, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, "");
  const meaningful = body.split(/\r?\n/u)
    .filter((line) => !/^\s*#{1,6}\s+/u.test(line))
    .filter((line) => !lineIsMostlyLocator(line))
    .join("\n")
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
  return [...meaningful].length;
}

function canonicalApprovedSourceRef(ref: string, sources: readonly string[]): string {
  const local = /^src-(\d+)(#.+)$/u.exec(ref);
  if (local === null) return ref;
  const source = sources[Number(local[1]) - 1];
  return source === undefined || local[2] === undefined ? ref : `${source}${local[2]}`;
}

function sectionSourceRefGroups(markdown: string, sources: readonly string[]): string[][] {
  return approvedContextSectionsInMarkdown(markdown).map((section) =>
    stableUnique(section.refs.map((ref) => canonicalApprovedSourceRef(ref, sources)))
  );
}

function scopedEvidenceCount(pageRefs: readonly string[], scopedRefs: readonly string[]): number {
  const scoped = new Set(scopedRefs);
  return stableUnique(pageRefs).filter((ref) => scoped.has(ref)).length;
}

function splitMarkdownSections(markdown: string): string[] {
  const body = markdownBody(markdown);
  const matches = [...body.matchAll(/^##\s+.+$/gmu)];
  if (matches.length === 0) return body.trim().length === 0 ? [] : [body];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    return body.slice(start, end);
  });
}

async function candidateMarkdown(projectRoot: string, record: CandidateRecord): Promise<string> {
  const path = join(projectRoot, CODE_CANDIDATE_SNAPSHOT_ROOT, `${record.candidate_id}.json`);
  if (!existsSync(path)) return record.body ?? "";
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isRecord(parsed) && typeof parsed.markdown === "string" ? parsed.markdown : record.body ?? "";
  } catch {
    return record.body ?? "";
  }
}

function candidatePage(record: CandidateRecord, markdown: string): AuditedPage {
  const sectionEvidenceGroups = (record.sections ?? []).map((section) =>
    stableUnique(section.source_refs ?? [section.source_ref])
  );
  const edgeRefs = stableUnique((record.code_edges ?? []).flatMap((edge) => edge.source_refs));
  const sourceRefs = stableUnique(record.source_refs);
  const sources = stableUnique(sourceRefs.flatMap((ref) => evidenceSource(ref) ?? []));
  const quality = measureCodeIndexMarkdown(markdown);
  return {
    metrics: {
      view_ref: record.view_ref,
      module: record.module,
      path: record.path,
      candidate_fingerprint: record.fingerprint,
      content_digest: semanticContentDigest(markdown),
      effective_chars: effectiveMarkdownChars(markdown),
      section_count: (record.sections ?? []).length || splitMarkdownSections(markdown).length,
      evidence_count: sourceRefs.length,
      section_scoped_evidence_count: scopedEvidenceCount(sourceRefs, [...sectionEvidenceGroups.flat(), ...edgeRefs]),
      relation_count: record.code_edges?.length ?? 0,
      relation_evidence_count: edgeRefs.length,
      source_count: sources.length,
      line_count: quality.lineCount,
      semantic_fact_lines: quality.semanticFactLines,
      table_fact_rows: quality.tableFactRows,
      explanatory_lines: quality.explanatoryLines,
      implementation_body_lines: quality.implementationBodyLines,
      signature_dump_lines: quality.signatureDumpLines,
      generated_type_lines: quality.generatedTypeLines,
      repeated_boilerplate_fact_lines: 0,
      template_residue_count: quality.templateResidueCount,
      placeholder_section_count: quality.placeholderSectionCount,
      referenced_file_count: stableUnique(sourceRefs.flatMap((ref) => evidenceFile(ref) ?? [])).length,
      referenced_symbol_count: stableUnique(sourceRefs.flatMap((ref) => evidenceSymbol(ref) ?? [])).length,
      referenced_files: stableUnique(sourceRefs.flatMap((ref) => evidenceFile(ref) ?? [])),
      referenced_symbols: stableUnique(sourceRefs.flatMap((ref) => evidenceSymbol(ref) ?? [])),
    },
    sourceNames: sources,
    sectionEvidenceCounts: sectionEvidenceGroups.map((refs) => refs.length),
    sectionEvidenceGroups,
    pageEvidenceRefs: sourceRefs,
    sectionEffectiveChars: (record.sections ?? []).map((section) => effectiveMarkdownChars(section.body ?? "")),
    relationEvidenceCounts: (record.code_edges ?? []).map((edge) => stableUnique(edge.source_refs).length),
    relationEvidenceGroups: (record.code_edges ?? []).map((edge) => stableUnique(edge.source_refs)),
    boilerplateParagraphs: genericParagraphs(markdown),
  };
}

function frontmatterModule(frontmatter: Record<string, unknown>, viewRef: string): string {
  const symbol = stringList(frontmatter.code_symbols)[0]?.split("|")[0];
  return symbol !== undefined && symbol.length > 0
    ? symbol
    : viewRef.replace(/^code(?:graph|index):/u, "").split("/")[0] ?? "codeindex";
}

function approvedEdges(frontmatter: Record<string, unknown>): Array<{ source_refs: string[] }> {
  if (!Array.isArray(frontmatter.code_edges)) return [];
  return frontmatter.code_edges.flatMap((edge) =>
    isRecord(edge) ? [{ source_refs: stringList(edge.source_refs) }] : []
  );
}

async function approvedPages(projectRoot: string): Promise<AuditedPage[]> {
  const pages: AuditedPage[] = [];
  const metadata = await readApprovedKnowledgeMetadataIndex(projectRoot);
  const roots = ["codeindex", "codegraph"]
    .map((collection) => ({ collection, root: join(projectRoot, "knowledge", collection) }))
    .filter((entry) => existsSync(entry.root));
  for (const { collection, root } of roots) for (const file of await walkApprovedMarkdown(root)) {
    const content = hydrateApprovedKnowledgeMarkdown({
      content: await readFile(file.absPath, "utf8"),
      relPath: `${collection}/${file.relPath}`,
      metadata,
    });
    const frontmatter = parseFrontmatterLoose(content);
    const viewRef = typeof frontmatter.view_ref === "string" ? frontmatter.view_ref : undefined;
    if (viewRef === undefined || !/^code(?:graph|index):/u.test(viewRef)) continue;
    const symbols = stableUnique(stringList(frontmatter.code_symbols));
    const symbolIdentities = stableUnique(symbols.flatMap((symbol) => symbol.split("|")[1] ?? []));
    const sourceLocators = stringList(frontmatter.sources);
    const sectionEvidenceGroups = sectionSourceRefGroups(content, sourceLocators);
    const edges = approvedEdges(frontmatter);
    const edgeRefs = stableUnique(edges.flatMap((edge) => edge.source_refs));
    const explicitEvidence = stableUnique(stringList(frontmatter.code_evidence));
    const pageEvidenceRefs = explicitEvidence.length > 0
      ? explicitEvidence
      : stableUnique([...sectionEvidenceGroups.flat(), ...edgeRefs]);
    const sources = stableUnique([
      ...sourceLocators.flatMap((source) => source.startsWith("repo:") ? [source.slice(5)] : []),
      ...pageEvidenceRefs.flatMap((ref) => evidenceSource(ref) ?? []),
    ]);
    const sections = splitMarkdownSections(content);
    const quality = measureCodeIndexMarkdown(content);
    pages.push({
      metrics: {
        view_ref: viewRef,
        module: frontmatterModule(frontmatter, viewRef),
        path: `${collection}/${file.relPath}`,
        candidate_fingerprint: typeof frontmatter.candidate_fingerprint === "string"
          ? frontmatter.candidate_fingerprint
          : stableHash({ viewRef, content }),
        content_digest: semanticContentDigest(content),
        effective_chars: effectiveMarkdownChars(content),
        section_count: sections.length,
        evidence_count: pageEvidenceRefs.length,
        section_scoped_evidence_count: scopedEvidenceCount(
          pageEvidenceRefs,
          [...sectionEvidenceGroups.flat(), ...edgeRefs],
        ),
        relation_count: edges.length,
        relation_evidence_count: edgeRefs.length,
        source_count: sources.length,
        line_count: quality.lineCount,
        semantic_fact_lines: quality.semanticFactLines,
        table_fact_rows: quality.tableFactRows,
        explanatory_lines: quality.explanatoryLines,
        implementation_body_lines: quality.implementationBodyLines,
        signature_dump_lines: quality.signatureDumpLines,
        generated_type_lines: quality.generatedTypeLines,
        repeated_boilerplate_fact_lines: 0,
        template_residue_count: quality.templateResidueCount,
        placeholder_section_count: quality.placeholderSectionCount,
        referenced_file_count: stableUnique(pageEvidenceRefs.flatMap((ref) => evidenceFile(ref) ?? [])).length,
        referenced_symbol_count: stableUnique([
          ...symbolIdentities,
          ...pageEvidenceRefs.flatMap((ref) => evidenceSymbol(ref) ?? []),
        ]).length,
        referenced_files: stableUnique(pageEvidenceRefs.flatMap((ref) => evidenceFile(ref) ?? [])),
        referenced_symbols: stableUnique([
          ...symbolIdentities,
          ...pageEvidenceRefs.flatMap((ref) => evidenceSymbol(ref) ?? []),
        ]),
      },
      sourceNames: sources,
      sectionEvidenceCounts: sectionEvidenceGroups.map((refs) => refs.length),
      sectionEvidenceGroups,
      pageEvidenceRefs,
      sectionEffectiveChars: sections.map(effectiveMarkdownChars),
      relationEvidenceCounts: edges.map((edge) => stableUnique(edge.source_refs).length),
      relationEvidenceGroups: edges.map((edge) => stableUnique(edge.source_refs)),
      boilerplateParagraphs: genericParagraphs(content),
    });
  }
  return pages;
}

export async function proposedCodeIndexAuditPages(projectRoot: string): Promise<{
  pages: AuditedPage[];
  source: CodeIndexAuditReport["source"];
}> {
  const approved = await approvedPages(projectRoot);
  const records = (await readCandidateRecords(projectRoot)).filter((record) =>
    record.status === "draft" && isCodeIndexCollection(record.collection)
  );
  if (records.length === 0) {
    return { pages: approved, source: approved.length > 0 ? "approved" : "preview" };
  }
  const draftPages = await Promise.all(records.map(async (record) =>
    candidatePage(record, await candidateMarkdown(projectRoot, record))
  ));
  const merged = new Map(approved.map((page) => [page.metrics.view_ref, page]));
  for (const page of draftPages) merged.set(page.metrics.view_ref, page);
  return { pages: [...merged.values()], source: "draft-and-approved" };
}
