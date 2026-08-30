import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import type { Rule } from "postcss";
import selectorParser, { type Root as SelectorRoot, type Selector } from "postcss-selector-parser";
import type {
  StyleComponentCandidate,
  StyleDiagnostic,
  StyleLocator,
  StyleSelector,
  StyleVariantState,
} from "./styleTypes.js";

const STATE_PSEUDOS = new Set([
  "active", "checked", "disabled", "enabled", "focus", "focus-visible", "focus-within",
  "hover", "indeterminate", "invalid", "open", "optional", "placeholder-shown", "read-only",
  "read-write", "required", "target", "user-invalid", "valid", "visited",
]);
const GENERIC_MODULE_NAMES = new Set(["global", "index", "style", "styles", "theme", "themes", "token", "tokens", "variable", "variables"]);

function locator(path: string, rule: Rule, qualifiedItemPath: string): StyleLocator {
  return { path, line: rule.source?.start?.line ?? 1, column: rule.source?.start?.column ?? 1, qualified_item_path: qualifiedItemPath };
}

function sorted(values: Set<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function inKeyframes(rule: Rule): boolean {
  let parent = rule.parent as { type: string; name?: string; parent?: unknown } | undefined;
  while (parent !== undefined) {
    if (parent.type === "atrule" && parent.name !== undefined && /keyframes$/iu.test(parent.name)) return true;
    parent = parent.parent as typeof parent;
  }
  return false;
}

function classRoot(name: string): string | null {
  if (/^(?:is|has)-/u.test(name)) return null;
  const root = name.split(/__|--/u, 1)[0] ?? "";
  return /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(root) ? root : null;
}

function classModifier(name: string): string | null {
  const bem = /--([A-Za-z0-9_-]+)$/u.exec(name);
  if (bem !== null) return bem[1]!;
  return /^(?:is|has)-[A-Za-z0-9_-]+$/u.test(name) ? name : null;
}

function moduleCandidate(path: string): string | null {
  if (!/\.module\.(?:s?css)$/iu.test(path)) return null;
  const basename = path.split("/").at(-1)?.replace(/\.(?:s?css)$/iu, "") ?? "";
  const name = basename.replace(/\.module$/iu, "");
  return name.length > 0 && !GENERIC_MODULE_NAMES.has(name.toLowerCase()) ? name : null;
}

function parseSelectorNode(input: {
  path: string;
  rule: Rule;
  selector: Selector;
  ordinal: number;
}): { selector: StyleSelector; variants: StyleVariantState[]; candidates: StyleComponentCandidate[] } {
  const classNames = new Set<string>();
  const idNames = new Set<string>();
  const typeNames = new Set<string>();
  const pseudoClasses = new Set<string>();
  const attributeNames = new Set<string>();
  input.selector.walkClasses((node) => { classNames.add(node.value); });
  input.selector.walkIds((node) => { idNames.add(node.value); });
  input.selector.walkTags((node) => { typeNames.add(node.value); });
  input.selector.walkPseudos((node) => {
    if (!node.value.startsWith("::")) pseudoClasses.add(node.value.replace(/^:/u, ""));
  });
  input.selector.walkAttributes((node) => { attributeNames.add(node.attribute); });
  const qualifiedItemPath = `selector:${input.ordinal}`;
  const currentLocator = locator(input.path, input.rule, qualifiedItemPath);
  const selectorText = input.selector.toString();
  const selectorRef = `${input.path}#${qualifiedItemPath}`;
  const catalog: StyleSelector = {
    selector_ref: selectorRef,
    selector_digest: indexerEvidenceAdapterProtocolDigest(selectorText),
    class_names: sorted(classNames),
    id_names: sorted(idNames),
    type_names: sorted(typeNames),
    pseudo_classes: sorted(pseudoClasses),
    attribute_names: sorted(attributeNames),
    locator: currentLocator,
  };
  const variants: StyleVariantState[] = [];
  const addVariant = (kind: StyleVariantState["evidence_kind"], name: string): void => {
    const key = `${kind}:${name}`;
    if (variants.some((item) => `${item.evidence_kind}:${item.name}` === key)) return;
    variants.push({ evidence_ref: `${selectorRef}:${key}`, selector_ref: selectorRef, evidence_kind: kind, name, locator: currentLocator });
  };
  for (const pseudo of pseudoClasses) if (STATE_PSEUDOS.has(pseudo)) addVariant("pseudo-class", pseudo);
  for (const attribute of attributeNames) {
    if (attribute === "disabled" || attribute === "open" || attribute === "checked" || attribute === "selected" || /^(?:aria|data)-/u.test(attribute)) addVariant("state-attribute", attribute);
  }
  for (const name of classNames) {
    const modifier = classModifier(name);
    if (modifier !== null) addVariant("class-modifier", modifier);
  }
  const nestedModifier = /^&--([A-Za-z0-9_-]+)$/u.exec(selectorText.trim());
  if (nestedModifier !== null) addVariant("class-modifier", nestedModifier[1]!);
  const candidates: StyleComponentCandidate[] = [];
  for (const name of classNames) {
    const root = classRoot(name);
    if (root === null) continue;
    candidates.push({ candidate_ref: `${selectorRef}:class-root:${root}`, name: root, basis: "class-root", selector_ref: selectorRef, locator: currentLocator });
  }
  return { selector: catalog, variants, candidates };
}

export function collectStyleSelectors(input: {
  path: string;
  rules: readonly Rule[];
}): {
  selectors: StyleSelector[];
  variants: StyleVariantState[];
  candidates: StyleComponentCandidate[];
  diagnostics: StyleDiagnostic[];
  unsupported: boolean;
} {
  const selectors: StyleSelector[] = [];
  const variants: StyleVariantState[] = [];
  const candidates: StyleComponentCandidate[] = [];
  const diagnostics: StyleDiagnostic[] = [];
  let unsupported = false;
  for (const rule of input.rules) {
    if (inKeyframes(rule)) continue;
    const qualifiedItemPath = `selector:${selectors.length + 1}`;
    if (rule.selector.includes("#{")) {
      unsupported = true;
      diagnostics.push({ code: "style-selector-unsupported", severity: "error", locator: locator(input.path, rule, qualifiedItemPath), detail: "dynamic SCSS selector interpolation is unsupported" });
      continue;
    }
    let root: SelectorRoot;
    try {
      root = selectorParser().astSync(rule.selector);
    } catch (error) {
      unsupported = true;
      diagnostics.push({ code: "style-selector-unsupported", severity: "error", locator: locator(input.path, rule, qualifiedItemPath), detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    for (const selector of root.nodes) {
      const parsed = parseSelectorNode({ path: input.path, rule, selector, ordinal: selectors.length + 1 });
      selectors.push(parsed.selector);
      variants.push(...parsed.variants);
      candidates.push(...parsed.candidates);
    }
  }
  const fileCandidate = moduleCandidate(input.path);
  if (fileCandidate !== null) {
    const rootLocator: StyleLocator = { path: input.path, line: 1, column: 1, qualified_item_path: `component-candidate:module-file:${fileCandidate}` };
    candidates.push({ candidate_ref: `${input.path}#component-candidate:module-file:${fileCandidate}`, name: fileCandidate, basis: "module-file", selector_ref: null, locator: rootLocator });
  }
  const uniqueCandidates = [...new Map(candidates.map((item) => [`${item.basis}:${item.name}:${item.selector_ref ?? "file"}`, item])).values()];
  return { selectors, variants, candidates: uniqueCandidates, diagnostics, unsupported };
}
