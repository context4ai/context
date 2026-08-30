import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parseMdxCodeBlock, exampleKind } from "./mdxCodeExamples.js";
import { parseMdxEsmNode } from "./mdxEsm.js";
import type {
  MdxAstNode,
  MdxComponentReference,
  MdxDocumentCatalog,
  MdxExample,
  MdxImportBinding,
  MdxLocator,
  MdxPublicTarget,
} from "./mdxTypes.js";

function portablePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

function node(value: unknown): MdxAstNode | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as MdxAstNode
    : null;
}

function children(value: MdxAstNode): MdxAstNode[] {
  return Array.isArray(value.children)
    ? value.children.flatMap((child) => node(child) ?? [])
    : [];
}

function locator(path: string, value: MdxAstNode): MdxLocator {
  return {
    path,
    line: value.position?.start?.line ?? 1,
    column: value.position?.start?.column ?? 1,
  };
}

function componentRoot(name: string): string {
  return name.split(".")[0] ?? name;
}

function isComponentName(name: string): boolean {
  const root = componentRoot(name);
  return /^[A-Z]/u.test(root);
}

function targetKey(target: MdxPublicTarget): string {
  return `${target.source_module ?? "*"}\0${target.export_name}`;
}

function validateTargets(targets: readonly MdxPublicTarget[]): void {
  const refs = new Set<string>();
  const keys = new Set<string>();
  for (const target of targets) {
    if (!/^[a-z][a-z0-9.-]*:[A-Za-z0-9][A-Za-z0-9._~:/#@+-]*$/u.test(target.target_ref)) {
      throw new TypeError(`invalid MDX public target ref ${target.target_ref}`);
    }
    if (refs.has(target.target_ref)) throw new TypeError(`duplicate MDX public target ref ${target.target_ref}`);
    const key = targetKey(target);
    if (keys.has(key)) throw new TypeError(`ambiguous MDX public target ${key.replace("\0", ":")}`);
    refs.add(target.target_ref);
    keys.add(key);
  }
}

function resolveTarget(input: {
  rootName: string;
  documentPath: string;
  imports: ReadonlyMap<string, MdxImportBinding>;
  targets: readonly MdxPublicTarget[];
}): { sourceModule: string | null; importedName: string | null; targetRef: string | null } {
  const binding = input.imports.get(input.rootName);
  const names = new Set([input.rootName]);
  if (binding !== undefined) names.add(binding.imported_name);
  const expectedSource = binding?.source_module ?? input.documentPath;
  const exact = input.targets.filter((target) => names.has(target.export_name) && target.source_module === expectedSource);
  const fallback = input.targets.filter((target) => names.has(target.export_name) && target.source_module === undefined);
  const matches = exact.length > 0 ? exact : fallback;
  if (matches.length > 1) {
    throw new TypeError(`ambiguous MDX target resolution for ${input.documentPath}:${input.rootName}`);
  }
  return {
    sourceModule: binding?.source_module ?? null,
    importedName: binding?.imported_name ?? null,
    targetRef: matches[0]?.target_ref ?? null,
  };
}

function emptyDocument(path: string, disposition: MdxDocumentCatalog["disposition"]): MdxDocumentCatalog {
  return { path, disposition, imports: [], exports: [], components: [], examples: [], diagnostics: [] };
}

function parseDocument(path: string, source: string, targets: readonly MdxPublicTarget[]): MdxDocumentCatalog {
  const document = emptyDocument(path, "analyzed");
  let root: MdxAstNode;
  try {
    root = unified().use(remarkParse).use(remarkMdx).parse(source) as unknown as MdxAstNode;
  } catch (error) {
    const unsupported = emptyDocument(path, "unsupported");
    unsupported.diagnostics.push({
      code: "mdx-source-unsupported",
      severity: "error",
      locator: { path, line: 1, column: 1 },
      detail: error instanceof Error ? error.message : String(error),
    });
    return unsupported;
  }

  const allNodes: MdxAstNode[] = [];
  const collect = (current: MdxAstNode): void => {
    allNodes.push(current);
    for (const child of children(current)) collect(child);
  };
  collect(root);
  for (const current of allNodes) {
    if (current.type !== "mdxjsEsm") continue;
    const parsed = parseMdxEsmNode(current, locator(path, current));
    document.imports.push(...parsed.imports);
    document.exports.push(...parsed.exports);
  }
  const importMap = new Map(document.imports.map((binding) => [binding.local_name, binding]));
  const detectedDocumentKind = exampleKind(path);
  const documentKind = detectedDocumentKind === "code-block" && /(?:^|\/)(?:examples?|samples?)(?:\/|$)/iu.test(path)
    ? "document-host" as const
    : detectedDocumentKind;
  const documentExample = documentKind === "code-block" ? null : {
    example_ref: `${path}#document-host:1`,
    kind: documentKind,
    language: null,
    meta_tokens: [documentKind],
    content_digest: indexerEvidenceAdapterProtocolDigest({ path, kind: documentKind }),
    component_names: [],
    target_refs: [],
    parse_supported: true,
    locator: { path, line: 1, column: 1 },
  };
  if (documentExample !== null) document.examples.push(documentExample);

  let hostOrdinal = 0;
  let codeOrdinal = 0;
  const addComponent = (current: MdxAstNode, exampleRef: string | null): MdxComponentReference | null => {
    const name = typeof current.name === "string" ? current.name : "";
    if (!isComponentName(name)) return null;
    const rootName = componentRoot(name);
    const resolved = resolveTarget({ rootName, documentPath: path, imports: importMap, targets });
    const reference = {
      component_name: name,
      root_name: rootName,
      source_module: resolved.sourceModule,
      imported_name: resolved.importedName,
      target_ref: resolved.targetRef,
      example_ref: exampleRef,
      locator: locator(path, current),
    };
    document.components.push(reference);
    return reference;
  };
  const visit = (current: MdxAstNode, parentExampleRef: string | null): void => {
    const isJsx = current.type === "mdxJsxFlowElement" || current.type === "mdxJsxTextElement";
    let example = parentExampleRef;
    if (isJsx && typeof current.name === "string") {
      const kind = exampleKind(current.name);
      if (kind !== "code-block") {
        hostOrdinal += 1;
        example = `${path}#${kind}:${hostOrdinal}`;
        document.examples.push({
          example_ref: example,
          kind,
          language: null,
          meta_tokens: [current.name.toLowerCase()],
          content_digest: indexerEvidenceAdapterProtocolDigest({ path, kind, ordinal: hostOrdinal }),
          component_names: [],
          target_refs: [],
          parse_supported: true,
          locator: locator(path, current),
        });
      }
      addComponent(current, example ?? documentExample?.example_ref ?? null);
    }
    if (current.type === "code") {
      codeOrdinal += 1;
      const currentLocator = locator(path, current);
      const parsed = parseMdxCodeBlock({
        path,
        ordinal: codeOrdinal,
        language: current.lang ?? null,
        meta: current.meta ?? null,
        value: current.value ?? "",
        locator: currentLocator,
      });
      const imports = new Map([
        ...document.imports.map((binding) => [binding.local_name, binding] as const),
        ...parsed.imports.map((binding) => [binding.local_name, binding] as const),
      ]);
      const targetRefs = parsed.componentNames.flatMap((name) => {
        const resolved = resolveTarget({ rootName: componentRoot(name), documentPath: path, imports, targets });
        return resolved.targetRef === null ? [] : [resolved.targetRef];
      });
      const kind = exampleKind(`${path} ${parsed.metaTokens.join(" ")}`);
      document.examples.push({
        example_ref: `${path}#code-block:${codeOrdinal}`,
        kind,
        language: parsed.language,
        meta_tokens: parsed.metaTokens,
        content_digest: parsed.contentDigest,
        component_names: parsed.componentNames,
        target_refs: [...new Set(targetRefs)].sort(),
        parse_supported: parsed.parseSupported,
        locator: currentLocator,
      });
      if (parsed.syntaxError !== null) document.diagnostics.push({ code: "mdx-code-block-syntax-unsupported", severity: "warning", locator: currentLocator, detail: parsed.syntaxError });
    }
    for (const child of children(current)) visit(child, example);
  };
  visit(root, documentExample?.example_ref ?? null);

  const byExample = new Map<string, MdxExample>();
  for (const example of document.examples) byExample.set(example.example_ref, example);
  for (const component of document.components) {
    if (component.example_ref === null) continue;
    const example = byExample.get(component.example_ref);
    if (example === undefined) continue;
    example.component_names.push(component.component_name);
    if (component.target_ref !== null) example.target_refs.push(component.target_ref);
  }
  for (const example of document.examples) {
    example.component_names = [...new Set(example.component_names)].sort();
    example.target_refs = [...new Set(example.target_refs)].sort();
  }
  return document;
}

export function parseMdxSources(
  files: Readonly<Record<string, string>>,
  options: { public_targets?: readonly MdxPublicTarget[] } = {},
): MdxDocumentCatalog[] {
  const paths = Object.keys(files).sort();
  if (paths.some((path) => !portablePath(path))) throw new TypeError("MDX source paths must be portable relative paths");
  const targets = options.public_targets ?? [];
  validateTargets(targets);
  return paths.map((path) => path.toLowerCase().endsWith(".mdx")
    ? parseDocument(path, files[path]!, targets)
    : emptyDocument(path, "excluded"));
}
