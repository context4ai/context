import { extname } from "node:path";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { normalizeMarkdownDocument } from "@c4a/extract";

export const MDX_COMPONENT_EVIDENCE_DOCUMENT_PATH = "__context_mdx_component_text.md";

type MdxNode = {
  type?: string;
  value?: string;
  name?: string;
  attributes?: unknown;
  children?: unknown;
};

type MdxAttribute = {
  type?: string;
  name?: string;
  value?: unknown;
};

type MdxExpressionValue = {
  type?: string;
  value?: unknown;
};

type MdastToStringInput = Parameters<typeof mdastToString>[0];

export interface MdxSourceFile {
  path: string;
  raw: string;
}

export interface MdxComponentEvidenceResult {
  markdown: string;
  fragments: number;
}

const TEXT_PROP_NAMES = new Set([
  "alt",
  "aria-label",
  "caption",
  "content",
  "description",
  "detail",
  "details",
  "href",
  "label",
  "name",
  "route",
  "summary",
  "title",
  "to",
  "url",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asMdxNode(value: unknown): MdxNode | null {
  return isRecord(value) ? value as MdxNode : null;
}

function asMdxAttribute(value: unknown): MdxAttribute | null {
  return isRecord(value) ? value as MdxAttribute : null;
}

function childrenOf(node: MdxNode): MdxNode[] {
  return Array.isArray(node.children)
    ? node.children.flatMap((child) => {
        const childNode = asMdxNode(child);
        return childNode === null ? [] : [childNode];
      })
    : [];
}

function normalizeEvidenceText(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .replace(/^\s+|\s+$/gu, "")
    .replace(/\s+([,.;:!?，。；：！？])/gu, "$1");
}

function expressionString(value: MdxExpressionValue): string | null {
  const raw = typeof value.value === "string" ? value.value.trim() : "";
  if (raw.length === 0) return null;
  const quoted = /^(["'`])([\s\S]*)\1$/u.exec(raw);
  if (quoted?.[2] !== undefined) return quoted[2];
  if (/^[a-zA-Z0-9 _.,:;!?/()[\]\-#&+=%~\u4e00-\u9fff]+$/u.test(raw)) return raw;
  return null;
}

function attributeValue(attribute: MdxAttribute): string | null {
  if (typeof attribute.value === "string") return normalizeEvidenceText(attribute.value);
  if (isRecord(attribute.value)) {
    return expressionString(attribute.value as MdxExpressionValue);
  }
  return null;
}

function componentName(node: MdxNode): string {
  return typeof node.name === "string" && node.name.trim().length > 0 ? node.name.trim() : "MDXComponent";
}

function componentAttributes(node: MdxNode): Array<{ name: string; value: string }> {
  if (!Array.isArray(node.attributes)) return [];
  const entries: Array<{ name: string; value: string }> = [];
  for (const rawAttribute of node.attributes) {
    const attribute = asMdxAttribute(rawAttribute);
    if (attribute === null || attribute.type !== "mdxJsxAttribute") continue;
    const name = typeof attribute.name === "string" ? attribute.name : "";
    if (!TEXT_PROP_NAMES.has(name)) continue;
    const value = attributeValue(attribute);
    if (value !== null && value.length > 0) entries.push({ name, value });
  }
  return entries;
}

function componentChildText(node: MdxNode): string {
  const children = childrenOf(node);
  if (children.length === 0) return "";
  return normalizeEvidenceText(children.map((child) => mdastToString(child as MdastToStringInput)).join(" "));
}

function collectMdxComponentFragments(input: {
  documentPath: string;
  markdown: string;
}): string[] {
  const tree = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .parse(input.markdown) as unknown;
  const fragments: string[] = [];
  const visit = (rawNode: unknown): void => {
    const node = asMdxNode(rawNode);
    if (node === null) return;
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      const name = componentName(node);
      for (const attribute of componentAttributes(node)) {
        fragments.push(`- ${input.documentPath} component ${name} ${attribute.name}: ${attribute.value}`);
      }
      const childText = componentChildText(node);
      if (childText.length > 0) {
        fragments.push(`- ${input.documentPath} component ${name} children: ${childText}`);
      }
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(tree);
  return fragments;
}

export function renderMdxComponentEvidence(files: readonly MdxSourceFile[]): MdxComponentEvidenceResult | null {
  const sections: string[] = [];
  let fragmentCount = 0;
  for (const file of files) {
    if (extname(file.path).toLowerCase() !== ".mdx") continue;
    const fragments = collectMdxComponentFragments({
      documentPath: file.path,
      markdown: file.raw,
    });
    if (fragments.length === 0) continue;
    fragmentCount += fragments.length;
    sections.push(
      `## ${file.path}`,
      "",
      ...fragments,
      "",
    );
  }
  if (fragmentCount === 0) return null;
  const markdown = normalizeMarkdownDocument([
    "# MDX component text",
    "",
    "This file is generated by Context from static MDX component props and component children. It records text evidence present in MDX source components; it is not authored by an agent.",
    "",
    ...sections,
  ].join("\n"));
  return {
    markdown,
    fragments: fragmentCount,
  };
}
