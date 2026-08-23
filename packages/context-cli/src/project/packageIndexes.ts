import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix as pathPosix, relative } from "node:path";
import {
  DEFAULT_PACKAGE_NAVIGATION,
  type PackageDefinition,
  type PackageNavigationDefinition,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  okfPackagePathForKnowledgePath,
  type OkfOutputRoot,
} from "./okfTypes.js";
import {
  packageKnowledgeOutputPath,
  packageOkfRootPath,
} from "./packageDistribution.js";
import {
  packageNavigation,
  planKnowledgeDirectoryIndexes,
} from "./packageNavigation.js";
import {
  packageKnowledgeFrontmatter,
  packageKnowledgeMetadata,
  parseKnowledgeFrontmatter,
} from "./packageKnowledgeProjection.js";

export interface ApprovedKnowledgeFile {
  relPath: string;
  absPath: string;
  content: string;
}

interface KnowledgeItemTemplateRecord extends Record<string, unknown> {
  path: string;
  sourcePath: string;
  internalCollection: string;
  internal_collection: string;
  collection: string;
  okf_root: string;
  okf_root_path: string;
  approved_path: string;
  dist_path: string;
  node_ref: string;
  view_ref: string;
  pathWithinCollection: string;
  href: string;
  hrefFromTemplate: string;
  hrefFromPackageRoot: string;
  hrefFromCollectionIndex: string;
  title: string;
  type: string;
  description: string;
  timestamp: string;
  source: string;
  group: string;
  parentPath: string;
  depth: number;
  segments: string[];
  tags: string;
  production_metadata?: Record<string, unknown>;
}

interface KnowledgeGroupTemplateRecord extends Record<string, unknown> {
  name: string;
  collection: string;
  internalCollection: string;
  internal_collection: string;
  okf_root: string;
  okf_root_path: string;
  title: string;
  count: number;
  hasIndex: boolean;
  has_index: boolean;
  indexPath: string;
  indexHrefFromTemplate: string;
  indexHrefFromCollectionIndex: string;
  items: KnowledgeItemTemplateRecord[];
}

interface KnowledgeTreeNodeTemplateRecord extends Record<string, unknown> {
  name: string;
  title: string;
  path: string;
  depth: number;
  count: number;
  items: KnowledgeItemTemplateRecord[];
  children: KnowledgeTreeNodeTemplateRecord[];
}

interface KnowledgeDirectoryIndex {
  okfRoot: string;
  okfRootPath: string;
  relPath: string;
  pathWithinOkfRoot: string;
  title: string;
  depth: number;
  items: KnowledgeItemTemplateRecord[];
  childDirs: Array<{
    name: string;
    title: string;
    relPath: string;
    href: string;
    count: number;
  }>;
  pageGroups: Array<{
    path: string;
    title: string;
    items: KnowledgeItemTemplateRecord[];
  }>;
}

const MARKDOWN_LINK_RE = /(?<!!)\[[^\]\n]*\]\(([^)\n]+)\)/gu;
const OKF_OUTPUT_ROOTS = new Set(["wikis", "guides", "rules", "feats"]);

function toPosixPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}

function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(path)) return false;
  return path.split(/[\\/]+/u).every((part) => part.length > 0 && part !== "." && part !== "..");
}

function assertSafeRenderedPath(path: string, label: string): void {
  if (!isSafeRelativePath(path)) {
    throw new ContextError(ExitCode.WorkspaceStateError, `${label} rendered an unsafe path: ${path}`, {
      category: ErrorCategory.SchemaInvalid,
      path,
    });
  }
}

function packageKind(pkg: PackageDefinition): "kb" | "llms" {
  return pkg.kind === "package.kb" ? "kb" : "llms";
}

async function walkFiles(root: string): Promise<Array<{ relPath: string; absPath: string }>> {
  if (!existsSync(root)) return [];
  const files: Array<{ relPath: string; absPath: string }> = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPath = toPosixPath(relative(root, absPath));
      files.push({ relPath, absPath });
    }
  };
  await visit(root);
  files.sort((left, right) => left.relPath.localeCompare(right.relPath));
  return files;
}

function stringField(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function tagsField(record: Record<string, unknown>): string {
  const tags = record.tags;
  if (!Array.isArray(tags)) return "";
  return tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).join(", ");
}

function titleFromPath(path: string): string {
  const basename = path.split("/").at(-1)?.replace(/\.md$/u, "") ?? path;
  return basename
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function splitKnowledgePath(relPath: string): {
  collection: string;
  pathWithinCollection: string;
  segments: string[];
  parentPath: string;
} {
  const segments = relPath.split("/").filter(Boolean);
  const collection = segments[0] ?? "";
  const withinSegments = segments.slice(1);
  const pathWithinCollection = withinSegments.join("/");
  const parentPath = withinSegments.slice(0, -1).join("/");
  return { collection, pathWithinCollection, segments: withinSegments, parentPath };
}

function relativeMarkdownHref(fromRelPath: string, targetRelPath: string): string {
  const fromDir = pathPosix.dirname(toPosixPath(fromRelPath));
  const relativePath = toPosixPath(pathPosix.relative(fromDir === "." ? "" : fromDir, toPosixPath(targetRelPath)));
  if (relativePath.length === 0) return "./";
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function titleFromSegment(segment: string): string {
  return segment
    .replace(/\.md$/u, "")
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || segment;
}

function groupNameForSegments(segments: readonly string[]): string {
  if (segments.length <= 1) return "root";
  return segments[0] ?? "root";
}

function collectionIndexPath(collection: string): string {
  return collection.length === 0 ? "index.md" : `${collection}/index.md`;
}

function groupIndexPath(collection: string, group: string): string {
  if (collection.length === 0) return group === "root" ? "index.md" : `${group}/index.md`;
  return group === "root" ? `${collection}/index.md` : `${collection}/${group}/index.md`;
}

function addTreeNode(
  nodes: KnowledgeTreeNodeTemplateRecord[],
  segments: readonly string[],
  item: KnowledgeItemTemplateRecord,
  depth = 0,
  prefix = "",
): void {
  const [head, ...tail] = segments;
  if (head === undefined) return;
  const path = prefix.length > 0 ? `${prefix}/${head}` : head;
  let node = nodes.find((candidate) => candidate.name === head);
  if (node === undefined) {
    node = {
      name: head,
      title: titleFromSegment(head),
      path,
      depth,
      count: 0,
      items: [],
      children: [],
    };
    nodes.push(node);
    nodes.sort((left, right) => left.name.localeCompare(right.name));
  }
  node.count++;
  if (tail.length === 0) {
    node.items.push(item);
    node.items.sort((left, right) => left.path.localeCompare(right.path));
    return;
  }
  addTreeNode(node.children, tail, item, depth + 1, path);
}

export function knowledgeInventory(
  files: readonly ApprovedKnowledgeFile[],
  templateRelPath: string,
  navigation: PackageNavigationDefinition = DEFAULT_PACKAGE_NAVIGATION,
  pkg?: PackageDefinition,
): {
  items: KnowledgeItemTemplateRecord[];
  groups: KnowledgeGroupTemplateRecord[];
  treeNodes: KnowledgeTreeNodeTemplateRecord[];
  treeMarkdown: string;
  itemsMarkdown: string;
  groupsMarkdown: string;
} {
  const items = files.map((file) => {
    const productionFrontmatter = parseKnowledgeFrontmatter(file.content);
    const frontmatter = packageKnowledgeFrontmatter(productionFrontmatter);
    const productionMetadata = packageKnowledgeMetadata(productionFrontmatter);
    const logicalOutputRelPath = okfPackagePathForKnowledgePath(file.relPath);
    const outputRelPath = pkg === undefined
      ? logicalOutputRelPath
      : packageKnowledgeOutputPath(pkg, file.relPath);
    const sourcePath = file.relPath;
    const sourceCollection = splitKnowledgePath(file.relPath).collection;
    const { collection: okfRoot, pathWithinCollection, segments, parentPath } =
      splitKnowledgePath(logicalOutputRelPath);
    const okfRootPath = pkg === undefined
      ? okfRoot
      : packageOkfRootPath(pkg, okfRoot as OkfOutputRoot);
    const group = groupNameForSegments(segments);
    const sources = Array.isArray(productionFrontmatter.sources) ? productionFrontmatter.sources : [];
    const firstSource = sources.find((source): source is string => typeof source === "string");
    const source = (firstSource ?? "").replace(/^repo:/u, "") || group;
    const hrefFromTemplate = relativeMarkdownHref(templateRelPath, outputRelPath);
    const nodeRef = stringField(productionFrontmatter, "node_ref");
    const viewRef = stringField(productionFrontmatter, "view_ref");
    return {
      path: outputRelPath,
      sourcePath,
      internalCollection: sourceCollection,
      internal_collection: sourceCollection,
      collection: sourceCollection,
      okf_root: okfRoot,
      okf_root_path: okfRootPath,
      approved_path: sourcePath,
      dist_path: outputRelPath,
      node_ref: nodeRef,
      view_ref: viewRef,
      pathWithinCollection,
      href: hrefFromTemplate,
      hrefFromTemplate,
      hrefFromPackageRoot: `./${outputRelPath}`,
      hrefFromCollectionIndex: relativeMarkdownHref(collectionIndexPath(okfRootPath), outputRelPath),
      title: stringField(frontmatter, "title", titleFromPath(outputRelPath)),
      type: stringField(frontmatter, "type", "Knowledge"),
      description: stringField(frontmatter, "description"),
      timestamp: stringField(frontmatter, "timestamp"),
      source,
      group,
      parentPath,
      depth: segments.length,
      segments,
      tags: tagsField(frontmatter),
      ...(productionMetadata === undefined ? {} : { production_metadata: productionMetadata }),
    };
  });
  const byGroup = new Map<string, {
    okfRoot: string;
    okfRootPath: string;
    internalCollection: string;
    name: string;
    items: KnowledgeItemTemplateRecord[];
  }>();
  for (const item of items) {
    const key = `${item.okf_root}\u0000${item.group}`;
    const existing = byGroup.get(key);
    if (existing === undefined) {
      byGroup.set(key, {
        okfRoot: item.okf_root,
        okfRootPath: item.okf_root_path,
        internalCollection: item.internalCollection,
        name: item.group,
        items: [item],
      });
      continue;
    }
    existing.items.push(item);
  }
  const navigationPlan = planKnowledgeDirectoryIndexes(items, navigation);
  const generatedIndexes = new Set(navigationPlan.map((directory) => directory.relPath));
  const groups = [...byGroup.values()]
    .map(({ okfRoot, okfRootPath, internalCollection, name, items: groupItems }) => {
      const indexPath = groupIndexPath(okfRootPath, name);
      const hasIndex = generatedIndexes.has(indexPath);
      return {
        name,
        collection: internalCollection,
        internalCollection,
        internal_collection: internalCollection,
        okf_root: okfRoot,
        okf_root_path: okfRootPath,
        title: name === "root" ? titleFromSegment(okfRoot || name) : name,
        count: groupItems.length,
        hasIndex,
        has_index: hasIndex,
        indexPath,
        indexHrefFromTemplate: relativeMarkdownHref(templateRelPath, indexPath),
        indexHrefFromCollectionIndex: relativeMarkdownHref(collectionIndexPath(okfRootPath), indexPath),
        items: groupItems,
      };
    })
    .sort((left, right) => left.okf_root.localeCompare(right.okf_root) || left.name.localeCompare(right.name));
  const treeNodes: KnowledgeTreeNodeTemplateRecord[] = [];
  for (const item of items) {
    addTreeNode(treeNodes, item.segments.length > 0 ? item.segments : [item.path], item);
  }
  const treeMarkdown = groups.length === 0
    ? "- No approved knowledge selected.\n"
    : groups.map((group) => [
      `- ${group.title}/ (${group.count})`,
      ...group.items.slice(0, 12).map((item) => `  - [${item.title}](${item.href}) - ${item.type}`),
      group.items.length > 12 ? `  - ... ${group.items.length - 12} more` : "",
    ].filter(Boolean).join("\n")).join("\n");
  const itemsMarkdown = items.length === 0
    ? "- No approved knowledge selected.\n"
    : items.slice(0, 50).map((item) =>
      `- [${item.title}](${item.href}) - ${item.type}${item.description ? `; ${item.description}` : ""}`
    ).join("\n");
  const currentRoot = templateRelPath.split("/")[0] ?? "";
  const currentDirectory = navigationPlan.find((directory) => directory.relPath === templateRelPath);
  const navigationLines: string[] = [];
  if (currentDirectory !== undefined) {
    const childTitles = navigationChildTitles(
      currentDirectory.pathWithinOkfRoot,
      currentDirectory.childDirectoryPaths,
    );
    for (const childPath of currentDirectory.childDirectoryPaths) {
      const child = navigationPlan.find((directory) =>
        directory.okfRoot === currentDirectory.okfRoot &&
        directory.pathWithinOkfRoot === childPath
      );
      if (child === undefined) continue;
      navigationLines.push(
        `- [${childTitles.get(childPath) ?? titleFromSegment(childPath.split("/").at(-1) ?? childPath)}](${relativeMarkdownHref(templateRelPath, child.relPath)}) - ${child.items.length} item(s)`,
      );
    }
    for (const group of currentDirectory.pageGroups) {
      if (group.path.length > 0) {
        navigationLines.push("", `### ${group.path.split("/").map(titleFromSegment).join(" / ")}`, "");
      }
      for (const item of group.items) {
        navigationLines.push(
          `- [${item.title}](${relativeMarkdownHref(templateRelPath, item.path)}) - ${item.type}${item.description ? `; ${item.description}` : ""}`,
        );
      }
    }
  }
  for (const rootDirectory of navigationPlan.filter((directory) =>
    directory.pathWithinOkfRoot.length === 0 && directory.okfRoot !== currentRoot
  )) {
    navigationLines.push(
      `- [${titleFromSegment(rootDirectory.okfRoot)}](${relativeMarkdownHref(templateRelPath, rootDirectory.relPath)}) - ${rootDirectory.items.length} item(s)`,
    );
  }
  const groupsMarkdown = navigationLines.length === 0
    ? "- No approved knowledge selected.\n"
    : navigationLines.join("\n");
  return { items, groups, treeNodes, treeMarkdown, itemsMarkdown, groupsMarkdown };
}

function navigationChildTitles(parentPath: string, childPaths: readonly string[]): Map<string, string> {
  const parentSegments = parentPath.split("/").filter(Boolean);
  const relativePaths = childPaths.map((path) => ({
    path,
    segments: path.split("/").filter(Boolean).slice(parentSegments.length),
  }));
  if (relativePaths.length > 1) {
    while (
      relativePaths.every((entry) => entry.segments.length > 1) &&
      relativePaths.every((entry) => entry.segments[0] === relativePaths[0]?.segments[0])
    ) {
      for (const entry of relativePaths) entry.segments.shift();
    }
    while (
      relativePaths.every((entry) => entry.segments.length > 1) &&
      relativePaths.every((entry) => entry.segments.at(-1) === relativePaths[0]?.segments.at(-1))
    ) {
      for (const entry of relativePaths) entry.segments.pop();
    }
  }
  return new Map(relativePaths.map(({ path, segments }) => [
    path,
    segments.map(titleFromSegment).join(" / ") || titleFromSegment(path.split("/").at(-1) ?? path),
  ]));
}

function collectKnowledgeDirectoryIndexes(
  pkg: PackageDefinition,
  files: readonly ApprovedKnowledgeFile[],
): KnowledgeDirectoryIndex[] {
  const inventory = knowledgeInventory(
    files,
    `${packageOkfRootPath(pkg, "wikis")}/index.md`,
    packageNavigation(pkg),
    pkg,
  );
  const plan = planKnowledgeDirectoryIndexes(inventory.items, packageNavigation(pkg));
  return plan.map((directory) => {
    const dirSegments = directory.pathWithinOkfRoot.split("/").filter(Boolean);
    const childTitles = navigationChildTitles(directory.pathWithinOkfRoot, directory.childDirectoryPaths);
    return {
      okfRoot: directory.okfRoot,
      okfRootPath: directory.okfRootPath,
      relPath: directory.relPath,
      pathWithinOkfRoot: directory.pathWithinOkfRoot,
      title: titleFromSegment(dirSegments.at(-1) ?? directory.okfRoot),
      depth: dirSegments.length,
      items: directory.items,
      childDirs: directory.childDirectoryPaths.map((childPath) => {
        const child = plan.find((candidate) =>
          candidate.okfRoot === directory.okfRoot &&
          candidate.pathWithinOkfRoot === childPath
        );
        const childRelPath = child?.relPath ?? `${directory.okfRootPath}/${childPath}/index.md`;
        return {
          name: childPath.split("/").at(-1) ?? childPath,
          title: childTitles.get(childPath) ?? titleFromSegment(childPath.split("/").at(-1) ?? childPath),
          relPath: childRelPath,
          href: relativeMarkdownHref(directory.relPath, childRelPath),
          count: child?.items.length ?? 0,
        };
      }),
      pageGroups: directory.pageGroups.map((group) => ({
        path: group.path,
        title: group.path.length === 0
          ? "Pages"
          : group.path.split("/").map(titleFromSegment).join(" / "),
        items: group.items,
      })),
    };
  });
}

export function knowledgeDirectoryIndexPaths(
  pkg: PackageDefinition,
  files: readonly ApprovedKnowledgeFile[],
): Set<string> {
  return new Set(collectKnowledgeDirectoryIndexes(pkg, files).map((directory) => directory.relPath));
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function renderKnowledgeDirectoryIndex(input: {
  pkg: PackageDefinition;
  directory: KnowledgeDirectoryIndex;
  knowledgeTimestamp: string;
}): string {
  const childLines = input.directory.childDirs.map((child) =>
    `- [${child.title}](${child.href}) - ${child.count} item(s)`
  );
  const pageSections = input.directory.pageGroups.flatMap((group) => {
    const pageLines = group.items.map((item) =>
      `- [${item.title}](${relativeMarkdownHref(input.directory.relPath, item.path)}) - ${item.type}${item.description ? `; ${item.description}` : ""}`
    );
    return [`### ${group.title}`, "", ...pageLines, ""];
  });
  return [
    "---",
    "type: Knowledge Directory",
    `title: ${yamlString(input.directory.title)}`,
    `description: ${yamlString(`Approved knowledge pages under ${input.directory.okfRootPath}${input.directory.pathWithinOkfRoot ? `/${input.directory.pathWithinOkfRoot}` : ""}.`)}`,
    "tags:",
    "  - context",
    "  - knowledge-base",
    `timestamp: ${yamlString(input.knowledgeTimestamp)}`,
    `resource: ${yamlString(`context://package/${input.pkg.name}/${input.directory.relPath.replace(/\/index\.md$/u, "")}`)}`,
    `package: ${yamlString(input.pkg.name)}`,
    `package_kind: ${yamlString(packageKind(input.pkg))}`,
    `knowledge_count: ${input.directory.items.length}`,
    "---",
    "",
    `# ${input.directory.title}`,
    "",
    `This directory contains ${input.directory.items.length} approved knowledge page(s).`,
    "",
    "## Contents",
    "",
    ...(childLines.length > 0 ? ["### Directories", "", ...childLines, ""] : []),
    ...pageSections,
    ...(childLines.length === 0 && pageSections.length === 0 ? ["No approved knowledge pages selected.", ""] : []),
  ].join("\n");
}

export async function writeKnowledgeDirectoryIndexes(input: {
  projectRoot: string;
  pkg: PackageDefinition;
  selected: readonly ApprovedKnowledgeFile[];
  knowledgeTimestamp: string;
}): Promise<number> {
  if (packageKind(input.pkg) !== "kb") return 0;
  let written = 0;
  for (const directory of collectKnowledgeDirectoryIndexes(input.pkg, input.selected)) {
    assertSafeRenderedPath(directory.relPath, "knowledge directory index path");
    const outputPath = join(input.projectRoot, input.pkg.outDir, directory.relPath);
    if (existsSync(outputPath)) continue;
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderKnowledgeDirectoryIndex({
      pkg: input.pkg,
      directory,
      knowledgeTimestamp: input.knowledgeTimestamp,
    }), "utf8");
    written++;
  }
  return written;
}

function lineForOffset(text: string, offset: number): number {
  return text.slice(0, offset).split(/\n/u).length;
}

function markdownLinkHref(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("<")) {
    const end = value.indexOf(">");
    return end > 0 ? value.slice(1, end) : value;
  }
  const titleStart = value.search(/\s+(?:"|'|\()/u);
  return titleStart > 0 ? value.slice(0, titleStart) : value;
}

function isExternalMarkdownHref(href: string): boolean {
  return href.length === 0 ||
    href.startsWith("#") ||
    href.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(href);
}

function decodeHrefPath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

function packageLinkTarget(fromRelPath: string, href: string): string | null {
  if (isExternalMarkdownHref(href)) return null;
  const pathOnly = decodeHrefPath((href.split("#")[0] ?? "").split("?")[0] ?? "");
  if (pathOnly.length === 0) return null;
  const rawTarget = pathOnly.startsWith("/")
    ? pathOnly.slice(1)
    : pathPosix.join(pathPosix.dirname(toPosixPath(fromRelPath)), pathOnly);
  return pathPosix.normalize(rawTarget);
}

function packageLinkTargetExists(packageRoot: string, targetRelPath: string): boolean {
  if (
    targetRelPath === "." ||
    targetRelPath === ".." ||
    targetRelPath.startsWith("../") ||
    targetRelPath.startsWith("/")
  ) {
    return false;
  }
  const normalized = targetRelPath.endsWith("/") ? `${targetRelPath}index.md` : targetRelPath;
  const targetPath = join(packageRoot, normalized);
  if (existsSync(targetPath)) {
    const stat = statSync(targetPath);
    if (stat.isFile()) return true;
    if (stat.isDirectory()) return existsSync(join(targetPath, "index.md"));
    return false;
  }
  if (!pathPosix.extname(normalized) && existsSync(join(packageRoot, normalized, "index.md"))) return true;
  return false;
}

export async function validatePackageIndexLinks(input: {
  projectRoot: string;
  pkg: PackageDefinition;
}): Promise<void> {
  if (packageKind(input.pkg) !== "kb") return;
  const packageRoot = join(input.projectRoot, input.pkg.outDir);
  const files = await walkFiles(packageRoot);
  for (const file of files) {
    if (file.relPath !== "index.md" && !file.relPath.endsWith("/index.md")) continue;
    const indexRelPath = toPosixPath(file.relPath);
    const collection = indexRelPath.split("/")[0];
    if (!OKF_OUTPUT_ROOTS.has(collection ?? "")) continue;
    const content = await readFile(file.absPath, "utf8");
    let match: RegExpExecArray | null;
    MARKDOWN_LINK_RE.lastIndex = 0;
    while ((match = MARKDOWN_LINK_RE.exec(content)) !== null) {
      const href = markdownLinkHref(match[1] ?? "");
      const targetRelPath = packageLinkTarget(indexRelPath, href);
      if (targetRelPath === null) continue;
      if (packageLinkTargetExists(packageRoot, targetRelPath)) continue;
      throw new ContextError(ExitCode.WorkspaceStateError, `package index link invalid: ${indexRelPath} -> ${href}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package/index-link-invalid",
        packageName: input.pkg.name,
        path: indexRelPath,
        line: lineForOffset(content, match.index),
        href,
        target: targetRelPath,
        next: "Fix the package template, approved knowledge path, or directory index generation, then rerun context build.",
      });
    }
  }
}
