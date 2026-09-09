import { createHash } from "node:crypto";
import { projectIndexerPublicContractTable } from "@c4a/context";
import type { IndexerAuthorizedWorksetView, IndexerAuthorizedWorksetViewItem } from "@c4a/context";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function readingDetail(markdown: string) {
  const digest = `sha256:${createHash("sha256").update(markdown).digest("hex")}`;
  return { digest, markdown };
}

// These fields belong to the built-in style adapter, not arbitrary Provider data.
const STYLE_CARRIERS: Record<string, readonly string[]> = {
  "style-selector": ["selector_ref", "selector_digest"],
  "style-component-candidate": ["candidate_ref", "selector_ref"],
  "style-token-reference": ["reference_ref"],
  "style-variant-state": ["evidence_ref", "selector_ref"],
};

/** Keep every Fact and semantic value. Only known carrier fields move to a
 * lossless detail file; no CSS behavior is inferred or merged by the CLI. */
export function compactAuthorFact(item: IndexerAuthorizedWorksetViewItem, view?: IndexerAuthorizedWorksetView) {
  const fact = object(item.value);
  const locator = object(fact?.locator);
  const payload = object(fact?.payload);
  if (item.category !== "fact" || !fact || !locator || !payload ||
      typeof locator.normalized_path !== "string" ||
      !(fact.kind === "code-symbol" || Object.hasOwn(STYLE_CARRIERS, String(fact.kind)))) return undefined;
  const value = { ...payload };
  let declarationSource: string | undefined;
  const declaration = value.typeAnnotation;
  if (fact.kind === "code-symbol" && typeof declaration === "string" && declaration.length > 512 && declaration.includes("\n")) {
    declarationSource = view?.items.find(candidate => {
      const source = object(candidate.value);
      return source !== undefined && candidate.category === "source-text" && source.path === locator.normalized_path &&
        source?.source_ref === locator.source_ref && source?.module_ref === locator.module_ref &&
        Array.isArray(source.spans) && source.spans.some(span => {
          const text = object(span)?.text;
          return typeof text === "string" && text.includes(declaration);
        });
    })?.ref;
    if (declarationSource) delete value.typeAnnotation;
  }
  for (const field of STYLE_CARRIERS[String(fact.kind)] ?? []) delete value[field];
  if (Object.hasOwn(STYLE_CARRIERS, String(fact.kind)) && object(value.locator)) {
    const position = { ...object(value.locator)! };
    if (position.path === locator.normalized_path) delete position.path;
    delete position.qualified_item_path;
    value.locator = position;
  }
  for (const field of ["file", "path"]) {
    if (value[field] === locator.normalized_path) delete value[field];
  }
  if (Array.isArray(value.members)) value.members = value.members.map(member => {
    const original = object(member);
    if (!original) return member;
    const projected = { ...original };
    if (projected.file === locator.normalized_path) delete projected.file;
    if (projected.endLine === projected.line) delete projected.endLine;
    return projected;
  });
  const { fact_ref: _ref, payload_digest: _digest, locator: _locator, payload: _payload, ...rest } = fact;
  void _ref; void _digest; void _locator; void _payload;
  const { source_ref, module_ref, normalized_path, signature_digest: _signature, qualified_item_path: _qualified, ...position } = locator;
  void _signature; void _qualified;
  const table = projectIndexerPublicContractTable({ value: payload });
  return { origin: { source_ref, module_ref, path: normalized_path },
    entry: { ref: item.ref, ...rest, locator: position, payload: value,
      ...(table ? { api_declaration_status: table.declaration_status } : {}),
      ...(declarationSource ? { declaration_source: declarationSource } : {}) } };
}
