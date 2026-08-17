import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { candidateIdFromViewRef } from "./candidateIdentity.js";
import { parseFrontmatterLoose } from "./verifyFrontmatter.js";
import { walkMarkdown } from "./verifyProjectFiles.js";
import { parseLocalCodeSymbolSourceRef } from "./codeSymbolSourceRef.js";

export interface ApprovedCodegraphPage {
  candidateId: string;
  nodeRef: string;
  viewRef: string;
  path: string;
  absPath: string;
  title: string;
  kind: string;
  visibility: string;
  module: string;
  sourceName: string;
  sourceRef: string;
  candidateFingerprint?: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function localCodeRef(content: string) {
  const value = /source_ref="([^"]+)"/iu.exec(content)?.[1];
  return value === undefined ? undefined : parseLocalCodeSymbolSourceRef(value);
}

function sourceNameFrom(frontmatter: Record<string, unknown>): string | undefined {
  const source = stringList(frontmatter.sources).find((item) => item.startsWith("repo:"));
  return source?.slice("repo:".length);
}

function codeSymbolParts(frontmatter: Record<string, unknown>): { module: string; symbol: string; kind: string } | undefined {
  const first = stringList(frontmatter.code_symbols)[0];
  if (first === undefined) return undefined;
  const parts = first.split("|");
  const module = parts[0];
  const symbol = parts[1];
  const kind = parts[2];
  return module !== undefined && symbol !== undefined && kind !== undefined
    ? { module, symbol, kind }
    : undefined;
}

function approvedPageIdentity(
  frontmatter: Record<string, unknown>,
  sourceNames: ReadonlySet<string>,
): { nodeRef: string; viewRef: string; sourceName: string } | undefined {
  const viewRef = stringValue(frontmatter.view_ref);
  const nodeRef = stringValue(frontmatter.node_ref);
  const sourceName = sourceNameFrom(frontmatter);
  if (
    viewRef === undefined ||
    nodeRef === undefined ||
    sourceName === undefined ||
    !viewRef.startsWith("codegraph:") ||
    !sourceNames.has(sourceName)
  ) return undefined;
  return { nodeRef, viewRef, sourceName };
}

function approvedCodeEvidence(
  frontmatter: Record<string, unknown>,
  content: string,
  sourceName: string,
): {
  symbol: string;
  kind: string;
  module: string;
  sourceRef: string;
  candidateFingerprint?: string;
} | undefined {
  const codeSymbol = codeSymbolParts(frontmatter);
  const localRef = localCodeRef(content);
  const symbol = codeSymbol?.symbol ?? localRef?.symbol;
  const kind = codeSymbol?.kind ?? localRef?.kind;
  const digest = localRef?.digest;
  const filePath = localRef?.file;
  if (
    symbol === undefined ||
    kind === undefined ||
    digest === undefined ||
    filePath === undefined
  ) return undefined;
  const candidateFingerprint = stringValue(frontmatter.candidate_fingerprint);
  return {
    symbol,
    kind,
    module: codeSymbol?.module ?? sourceName,
    sourceRef: `repo:${sourceName}#symbol:${filePath}:${symbol}:${kind}@${digest}`,
    ...(candidateFingerprint !== undefined ? { candidateFingerprint } : {}),
  };
}

export async function readApprovedCodegraphPages(input: {
  projectRoot: string;
  sourceNames: ReadonlySet<string>;
}): Promise<ApprovedCodegraphPage[]> {
  const root = join(input.projectRoot, "knowledge", "codegraph");
  const pages: ApprovedCodegraphPage[] = [];
  for (const file of await walkMarkdown(root)) {
    const content = await readFile(file.absPath, "utf8");
    const frontmatter = parseFrontmatterLoose(content);
    const identity = approvedPageIdentity(frontmatter, input.sourceNames);
    if (identity === undefined) continue;
    const evidence = approvedCodeEvidence(frontmatter, content, identity.sourceName);
    if (evidence === undefined) continue;

    pages.push({
      candidateId: candidateIdFromViewRef(identity.viewRef),
      nodeRef: identity.nodeRef,
      viewRef: identity.viewRef,
      path: `codegraph/${file.relPath}`,
      absPath: file.absPath,
      title: stringValue(frontmatter.title) ?? evidence.symbol,
      kind: evidence.kind,
      visibility: stringValue(frontmatter.visibility) ?? "exported",
      module: evidence.module,
      sourceName: identity.sourceName,
      sourceRef: evidence.sourceRef,
      ...(evidence.candidateFingerprint !== undefined ? { candidateFingerprint: evidence.candidateFingerprint } : {}),
    });
  }
  return pages.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}
