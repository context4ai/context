import YAML from "yaml";
import { indexerProtocolDigest } from "@c4a/context";
import { compactApprovedKnowledgeMarkdown, ensureApprovedKnowledgePresentation } from "./approvedKnowledgeMetadata.js";
import { readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { createHash } from "node:crypto";
import type { DocumentSnapshotManifest } from "@c4a/extract";
import type { IndexerAuthorizedWorksetView } from "@c4a/context";
import { markdownReaderLinks, markdownInlineLinks } from "./markdownLinks.js";
import { walkApprovedMarkdown, isKnowledgeAssetPath } from "./verifyProjectFiles.js";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const START = /<!-- context:visual ([A-Za-z0-9+/=]+) -->\n([\s\S]*?)\n<!-- \/context:visual -->/gu;
export interface VisualDecision {
  resource: string;
  also_read?: string[] | undefined;
  context: string[];
  requirements: string;
  disposition: "converted" | "retained";
  format: "mermaid" | "table" | "original";
  markdown?: string | undefined;
  reason?: string | undefined;
}
interface VisualReceipt extends Omit<VisualDecision, "markdown" | "resource" | "also_read"> {
  source_ref: string;
  document_path: string;
  content_hash: string;
  input_hash: string;
  supporting_hashes?: string[];
}
export interface VisualResource {
  ref: string;
  source_ref: string;
  document_path: string;
  content_hash: string;
  read_path: string;
  original_markdown: string;
  source_path: string;
  replacement_paths: string[];
  selector?: string | undefined;
  document_text: string;
  media_type: string;
  previous: Array<{ receipt: VisualReceipt; markdown: string; page: string }>;
}

/** False disables new interpretation, never capture, source evidence or native tables. */
export async function readVisualConversionPreference(root: string): Promise<boolean> {
  try {
    const config = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    return config?.context?.convertVisuals !== false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return true;
    throw error;
  }
}

/** Presentation is deliberately absent. Exact output bytes still use the existing
 * artifact/approved-file/build digests; this hash only controls rereading a visual. */
export function visualInputHash(input: Pick<VisualReceipt, "source_ref" | "document_path" | "content_hash" | "context" | "requirements" | "supporting_hashes">): string {
  return digest(JSON.stringify([input.source_ref, input.document_path, input.content_hash,
    input.context, input.requirements, [...(input.supporting_hashes ?? [])].sort()]));
}

export function readVisualReceipts(markdown: string): Array<{ receipt: VisualReceipt; markdown: string }> {
  return [...markdown.matchAll(START)].flatMap(match => {
    try {
      const receipt = JSON.parse(Buffer.from(match[1]!, "base64").toString("utf8")) as VisualReceipt;
      if (typeof receipt.source_ref !== "string" || typeof receipt.document_path !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(receipt.content_hash) || !Array.isArray(receipt.context) ||
        !receipt.context.every(value => typeof value === "string") || typeof receipt.requirements !== "string" ||
        !["converted", "retained"].includes(receipt.disposition) ||
        !["mermaid", "table", "original"].includes(receipt.format) || (receipt.supporting_hashes !== undefined && (!Array.isArray(receipt.supporting_hashes) || !receipt.supporting_hashes.every(hash => typeof hash === "string" && /^sha256:[a-f0-9]{64}$/u.test(hash)))) || receipt.input_hash !== visualInputHash(receipt)) return [];
      return [{ receipt, markdown: match[2]! }];
    } catch { return []; } // Old/malformed writing metadata is not a workflow gate.
  });
}

export async function approvedVisualResults(root: string) {
  const results: VisualResource["previous"] = [];
  let approved: Array<{ path: string; approved_content_digest: string }> = [];
  try {
    const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
    if (Array.isArray(structure?.approved_knowledge)) approved = structure.approved_knowledge;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof YAML.YAMLError) return results;
    throw error;
  }
  for (const file of await walkApprovedMarkdown(join(root, "knowledge"))) {
    if (isKnowledgeAssetPath(file.relPath)) continue;
    const content = await readFile(file.absPath, "utf8");
    const version = indexerProtocolDigest(compactApprovedKnowledgeMarkdown(ensureApprovedKnowledgePresentation(content)));
    if (!approved.some(page => page.path === file.relPath && page.approved_content_digest === version)) continue;
    results.push(...readVisualReceipts(content).map(result => ({ ...result, page: `knowledge/${file.relPath}` })));
  }
  return results;
}

/** Only resources linked by this authorized captured document become read targets.
 * No directory scan or filename-based semantic classification. */
export function capturedVisualResources(input: {
  sourceRef: string; documentPath: string; markdown: string; materializedAt: string;
  manifest: DocumentSnapshotManifest; previous: VisualResource["previous"];
}): VisualResource[] {
  const links = markdownInlineLinks(input.markdown);
  const locators = new Set([...input.markdown.matchAll(/<!--\s*(lark:[^\s]+)\s*-->/gu)].map(match => match[1]));
  return (input.manifest.assets ?? []).flatMap(asset => {
    if (asset.role === "audit" || !asset.content_hash) return [];
    const linked = links.some(link => {
      try { return posix.normalize(posix.join(dirname(input.documentPath), decodeURIComponent(link.target))) === asset.path; }
      catch { return false; }
    });
    if (!linked && !(asset.source?.locator && locators.has(asset.source.locator))) return [];
    const media = asset.media_type ?? "";
    if (!media.startsWith("image/") && !/\.(png|jpe?g|webp|gif|svg|json|csv)$/iu.test(asset.path)) return [];
    const group = (input.manifest.assets ?? []).filter(other => other.role !== "audit" &&
      (other.path === asset.path || !!asset.source?.locator && other.source?.locator === asset.source.locator));
    const original = group.map(other => {
      const target = posix.relative(posix.dirname(input.documentPath), other.path);
      const image = other.media_type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/iu.test(other.path);
      return `${image ? "!" : ""}[Source resource](<${target}>)`;
    }).join("\n\n");
    const receiptIdentity = { source_ref: input.sourceRef, document_path: input.documentPath, content_hash: asset.content_hash };
    return [{
      ref: `visual:${digest(JSON.stringify([input.sourceRef, input.documentPath, asset.path]))}`,
      ...receiptIdentity, source_path: asset.path, replacement_paths: group.map(item => item.path), selector: asset.source?.locator, read_path: join(input.materializedAt, asset.path),
      original_markdown: original,
      document_text: input.markdown, media_type: media,
      previous: input.previous.filter(({ receipt }) => receipt.source_ref === input.sourceRef &&
        receipt.document_path === input.documentPath && receipt.content_hash === asset.content_hash &&
        (receipt.supporting_hashes ?? []).every(hash => (input.manifest.assets ?? []).some(item => item.role !== "audit" && item.content_hash === hash)) &&
        receipt.context.every(text => input.markdown.includes(text))),
    }];
  });
}

export function visualResourcesFromView(view: IndexerAuthorizedWorksetView): VisualResource[] {
  return view.items.flatMap(item => {
    const value = item.value as Record<string, unknown>;
    return Array.isArray(value?.visual_resources) ? (value.visual_resources as unknown as VisualResource[])
      .map(resource => ({ ...resource, document_text: typeof value.visual_context === "string" ? value.visual_context : resource.document_text })) : [];
  });
}

/** Agent owns equivalence and context selection. CLI verifies only references,
 * literal context membership and mechanically reusable input. Bad conversion
 * data falls back to its authorized original without making other pages fail. */
export function renderVisualDecisions(decisions: readonly VisualDecision[], resources: readonly VisualResource[]) {
  const warnings: string[] = [];
  const rendered = decisions.flatMap(decision => {
    const resource = resources.find(item => item.ref === decision.resource);
    if (!resource) { warnings.push(`Unknown visual resource ${decision.resource}; read the current authorized source view.`); return []; }
    const supporting = (decision.also_read ?? []).map(ref => resources.find(item => item.ref === ref &&
      item.source_ref === resource.source_ref && item.document_path === resource.document_path));
    const contextValid = supporting.every(item => item !== undefined) && decision.context.every(text => resource.document_text.includes(text));
    const candidate: VisualReceipt = { source_ref: resource.source_ref, document_path: resource.document_path,
      content_hash: resource.content_hash, context: decision.context, requirements: decision.requirements,
      disposition: decision.disposition, format: decision.format,
      supporting_hashes: [...new Set(supporting.flatMap(item => item ? [item.content_hash] : []))].sort(),
      ...(decision.reason === undefined ? {} : { reason: decision.reason }), input_hash: "" };
    candidate.input_hash = visualInputHash(candidate);
    const previous = resource.previous.filter(result => result.receipt.input_hash === candidate.input_hash &&
      result.receipt.disposition === decision.disposition && result.receipt.format === decision.format);
    // Current accepted body wins, including legitimate user revisions. Ambiguous
    // copies are not an instruction to overwrite one with another.
    const bodies = [...new Set(previous.map(result => result.markdown))];
    const markdown = decision.markdown ?? (bodies.length === 1 ? bodies[0] : undefined);
    const outputValid = !!markdown?.trim() && (candidate.format === "mermaid"
      ? /^```mermaid\s*\n[\s\S]+\n```\s*$/u.test(markdown.trim())
      : candidate.format === "table" && /^\s*\|/mu.test(markdown));
    if (!contextValid || (decision.disposition === "converted" && !outputValid)) {
      warnings.push(`Visual ${resource.ref} retained: context or converted output is unavailable; continue with the original.`);
      return [resource.original_markdown];
    }
    const body = decision.disposition === "retained" ? resource.original_markdown : markdown!;
    return [`<!-- context:visual ${Buffer.from(JSON.stringify(candidate)).toString("base64")} -->\n${body}\n<!-- /context:visual -->`];
  });
  return { markdown: rendered.join("\n\n"), warnings };
}

/** Remove only successfully replaced resource references in this section. Source
 * document citations remain; shared images in other sections/pages remain. */
export function removeConvertedVisualLinks(markdown: string, rendered: string, resources: readonly VisualResource[]): string {
  const receipts = readVisualReceipts(rendered).filter(item => item.receipt.disposition === "converted");
  const converted = resources.filter(resource => receipts.some(({ receipt }) => receipt.source_ref === resource.source_ref &&
    receipt.document_path === resource.document_path && receipt.content_hash === resource.content_hash));
  const links = markdownReaderLinks(markdown).filter(link => converted.some(resource => {
    try { return resource.replacement_paths.includes(posix.normalize(posix.join(posix.dirname(resource.document_path), decodeURIComponent(link.target)))); }
    catch { return false; }
  }));
  for (const link of links.sort((a, b) => b.start - a.start)) markdown = markdown.slice(0, link.start) + markdown.slice(link.end);
  return markdown.replace(/<!--\s*(lark:[^\s]+)\s*-->/gu, (comment, locator: string) =>
    converted.some(resource => resource.selector === locator) ? "" : comment);
}
