import postcss, { type AtRule, type Declaration, type Root, type Rule } from "postcss";
import scss from "postcss-scss";
import { collectStyleImports } from "./styleImports.js";
import { collectStyleSelectors } from "./styleSelectors.js";
import { collectStyleTokens } from "./styleTokens.js";
import type { StyleDocumentCatalog } from "./styleTypes.js";

function portablePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

function empty(path: string, syntax: StyleDocumentCatalog["syntax"], disposition: StyleDocumentCatalog["disposition"]): StyleDocumentCatalog {
  return { path, syntax, disposition, imports: [], tokens: [], token_references: [], selectors: [], variants_and_states: [], component_candidates: [], diagnostics: [] };
}

function parseRoot(path: string, source: string, syntax: "css" | "scss"): Root {
  return syntax === "scss" ? scss.parse(source, { from: path }) : postcss.parse(source, { from: path });
}

function parseStyleDocument(path: string, source: string, syntax: "css" | "scss", files: Readonly<Record<string, string>>): StyleDocumentCatalog {
  const document = empty(path, syntax, "analyzed");
  let root: Root;
  try {
    root = parseRoot(path, source, syntax);
  } catch (error) {
    document.disposition = "unsupported";
    document.diagnostics.push({ code: "style-source-unsupported", severity: "error", locator: { path, line: 1, column: 1, qualified_item_path: "file" }, detail: error instanceof Error ? error.message : String(error) });
    return document;
  }
  const atRules: AtRule[] = [];
  const declarations: Declaration[] = [];
  const rules: Rule[] = [];
  root.walkAtRules((rule) => { atRules.push(rule); });
  root.walkDecls((declaration) => { declarations.push(declaration); });
  root.walkRules((rule) => { rules.push(rule); });
  const imports = collectStyleImports({ path, files, atRules });
  const tokens = collectStyleTokens({ path, declarations, atRules });
  const selectors = collectStyleSelectors({ path, rules });
  document.imports.push(...imports.imports);
  document.tokens.push(...tokens.tokens);
  document.token_references.push(...tokens.references);
  document.selectors.push(...selectors.selectors);
  document.variants_and_states.push(...selectors.variants);
  document.component_candidates.push(...selectors.candidates);
  document.diagnostics.push(...imports.diagnostics, ...selectors.diagnostics);
  if (imports.unsupported || selectors.unsupported) document.disposition = "unsupported";
  return document;
}

/** Parses only caller-registered CSS/SCSS sources without compiling them. */
export function parseStyleSources(files: Readonly<Record<string, string>>): StyleDocumentCatalog[] {
  const entries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  for (const [path, source] of entries) {
    if (!portablePath(path)) throw new TypeError(`style source path is not portable: ${path}`);
    if (typeof source !== "string") throw new TypeError(`style source must be text: ${path}`);
  }
  const normalizedFiles = Object.fromEntries(entries);
  return entries.map(([path, source]) => {
    if (/\.scss$/iu.test(path)) return parseStyleDocument(path, source, "scss", normalizedFiles);
    if (/\.css$/iu.test(path)) return parseStyleDocument(path, source, "css", normalizedFiles);
    return empty(path, "excluded", "excluded");
  });
}
