import { dirname, relative } from "node:path/posix";
import type { AlignPayload, StructureEdgePlan, StructureViewPlan } from "./proseAlignTypes.js";

export const PARENT_INDEX_GENERATED_KIND = "parent_index";

export interface ParentIndexChild {
  view_ref: string;
  node_ref: string;
  title: string;
  path: string;
  summary?: string;
}

export interface ParentIndexModel {
  children: ParentIndexChild[];
  source_refs: string[];
  contains_edges: StructureEdgePlan[];
}

function relativeMarkdownLink(fromPath: string, toPath: string): string {
  const link = relative(dirname(fromPath), toPath);
  return link.length === 0 ? toPath : link;
}

function childLine(parentPath: string, child: ParentIndexChild): string {
  const suffix = child.summary === undefined || child.summary.trim().length === 0
    ? ""
    : ` — ${child.summary.trim()}`;
  return `- [${child.title}](${relativeMarkdownLink(parentPath, child.path)})${suffix}`;
}

export function renderParentIndexBody(input: {
  title: string;
  path: string;
  children: readonly ParentIndexChild[];
}): string {
  return [
    `# ${input.title}`,
    "",
    ...input.children.map((child) => childLine(input.path, child)),
  ].join("\n").trimEnd();
}

export function parentIndexModel(input: {
  structure: AlignPayload;
  view: StructureViewPlan;
}): ParentIndexModel | undefined {
  const viewByRef = new Map(input.structure.views.map((view) => [view.view_ref, view]));
  const containsEdges = input.structure.edges
    .filter((edge) => edge.type === "contains" && edge.from === input.view.view_ref)
    .filter((edge) => viewByRef.has(edge.to));
  if (containsEdges.length === 0) return undefined;
  const seen = new Set<string>();
  const children: ParentIndexChild[] = [];
  for (const edge of containsEdges) {
    if (seen.has(edge.to)) continue;
    const child = viewByRef.get(edge.to);
    if (child === undefined) continue;
    seen.add(edge.to);
    children.push({
      view_ref: child.view_ref,
      node_ref: child.node_ref,
      title: child.title,
      path: child.path,
      ...(child.summary !== undefined ? { summary: child.summary } : {}),
    });
  }
  return {
    children,
    source_refs: [...new Set(containsEdges.flatMap((edge) => edge.source_refs))],
    contains_edges: containsEdges,
  };
}

export function isParentIndexView(input: {
  structure: AlignPayload;
  view: StructureViewPlan;
}): boolean {
  return input.view.sections.length === 0 &&
    (parentIndexModel(input)?.children.length ?? 0) > 0;
}
