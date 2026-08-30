import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import type { AtRule, Declaration } from "postcss";
import valueParser, { type Node as ValueNode } from "postcss-value-parser";
import type { StyleLocator, StyleToken, StyleTokenReference } from "./styleTypes.js";

function locator(path: string, node: Declaration | AtRule, qualifiedItemPath: string): StyleLocator {
  return { path, line: node.source?.start?.line ?? 1, column: node.source?.start?.column ?? 1, qualified_item_path: qualifiedItemPath };
}

function firstWord(nodes: readonly ValueNode[]): string | null {
  const node = nodes.find((item) => item.type === "word" || item.type === "string");
  return node?.type === "word" || node?.type === "string" ? node.value : null;
}

function referencedTokens(value: string): string[] {
  const references = new Set<string>();
  valueParser(value).walk((node) => {
    if (node.type === "function" && node.value.toLowerCase() === "var") {
      const name = firstWord(node.nodes);
      if (name !== null && /^--[A-Za-z0-9_-]+$/u.test(name)) references.add(name);
    }
    if (node.type === "word" && /^\$[A-Za-z_][A-Za-z0-9_-]*$/u.test(node.value)) references.add(node.value);
  });
  return [...references].sort((left, right) => left.localeCompare(right));
}

export function collectStyleTokens(input: {
  path: string;
  declarations: readonly Declaration[];
  atRules: readonly AtRule[];
}): { tokens: StyleToken[]; references: StyleTokenReference[] } {
  const tokens: StyleToken[] = [];
  const references: StyleTokenReference[] = [];
  for (const declaration of input.declarations) {
    const name = declaration.prop;
    if (/^(?:--|\$)[A-Za-z_][A-Za-z0-9_-]*$/u.test(name)) {
      const ordinal = tokens.length + 1;
      const qualifiedItemPath = `token:${ordinal}:${name}`;
      tokens.push({
        token_ref: `${input.path}#${qualifiedItemPath}`,
        name,
        syntax: name.startsWith("--") ? "custom-property" : "scss-variable",
        configurable: /!default\b/u.test(declaration.value),
        value_digest: indexerEvidenceAdapterProtocolDigest(declaration.value),
        locator: locator(input.path, declaration, qualifiedItemPath),
      });
    }
    const ownerQualifiedItemPath = `declaration:${declaration.prop}:${declaration.source?.start?.offset ?? 0}`;
    for (const referenceName of referencedTokens(declaration.value)) {
      const ordinal = references.length + 1;
      references.push({
        reference_ref: `${input.path}#token-reference:${ordinal}:${referenceName}`,
        name: referenceName,
        owner_qualified_item_path: ownerQualifiedItemPath,
        locator: locator(input.path, declaration, `token-reference:${ordinal}:${referenceName}`),
      });
    }
  }
  for (const rule of input.atRules) {
    if (rule.name.toLowerCase() !== "property" || !/^--[A-Za-z_][A-Za-z0-9_-]*$/u.test(rule.params.trim())) continue;
    const name = rule.params.trim();
    const ordinal = tokens.length + 1;
    const qualifiedItemPath = `token:${ordinal}:${name}`;
    tokens.push({ token_ref: `${input.path}#${qualifiedItemPath}`, name, syntax: "property-rule", configurable: false, value_digest: null, locator: locator(input.path, rule, qualifiedItemPath) });
  }
  return { tokens, references };
}
