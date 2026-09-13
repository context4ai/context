import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import YAML from "yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { toString } from "mdast-util-to-string";
import { loadSourcesRegistry } from "@c4a/context";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { parseDocumentSnapshotForSource } from "./documentBatchManifest.js";
import { productionSourceIsExcluded, type ProductionRequirements } from "./productionRequirements.js";
import type { ProductionStageMaterials } from "./productionStageStore.js";

const execute = promisify(execFile);
const markdownParser = unified().use(remarkParse);
type MarkdownRoot = ReturnType<typeof markdownParser.parse>;
type MarkdownNode = MarkdownRoot | MarkdownRoot["children"][number];

/** Cheap document navigation. The CLI scans text to extract headings; the
 * Agent receives a bounded opening plus the complete H2/H3 outline, not every
 * document body and not an invented semantic partition. */
export function productionDocumentSkeleton(path: string, markdown: string): string {
  const lines = markdown.split(/\r?\n/u);
  let title: string | undefined;
  const headings: string[] = [];
  // Blank frontmatter without shifting source locations. Parse Markdown rather
  // than matching hashes in code examples, HTML blocks or YAML multiline text.
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/u,
    block => block.replace(/[^\r\n]/gu, " "));
  function visit(node: MarkdownNode): void {
    if (node.type === "heading") {
      if (node.depth === 1) title ??= toString(node);
      else if (node.depth <= 3) headings.push(`- line ${node.position!.start.line}: ${"#".repeat(node.depth)} ${toString(node)}`);
    }
    if ("children" in node) for (const child of node.children) visit(child);
  }
  visit(markdownParser.parse(body));
  return [`# ${title ?? basename(path)}`, "", `File: ${path}`, `Lines: ${lines.length}`, "",
    "## Opening excerpt", "", markdown.slice(0, 1200), ...(markdown.length > 1200 ? ["", "[Opening excerpt ends; full text is available at the source entry.]"] : []),
    "", "## Complete H2/H3 outline", "", ...headings, ""].join("\n");
}

function sourceExcludes(requirements: ProductionRequirements, source: string, path: string): boolean {
  const owners = requirements.requirements.filter(item => [...item.target_scope.targets,
    ...item.evidence_source_scope?.targets ?? []].some(target => target.source_ref === source));
  // A source reused by another requirement must remain available for that
  // requirement. Excluding it from one reader purpose is not a global delete.
  return owners.length > 0 && owners.every(item => item.exclusions?.some(exclusion =>
    exclusion.scope.targets.some(target => {
      if (target.source_ref !== source) return false;
      if (!target.module_refs?.length) return true;
      // A module label alone identifies no files. Never turn it into an
      // implicit whole-repository exclusion, even when the labels match.
      if (!exclusion.paths) return false;
      // Without a module-to-path mapping, a narrower module exclusion cannot
      // suppress navigation for an unbounded or differently scoped source.
      const selected = [...item.target_scope.targets, ...item.evidence_source_scope?.targets ?? []]
        .filter(candidate => candidate.source_ref === source);
      return selected.every(candidate => !!candidate.module_refs?.length &&
        candidate.module_refs.every(module => target.module_refs!.includes(module)));
    }) &&
    (exclusion.paths === undefined || exclusion.paths.some(prefix => path === prefix || path.startsWith(`${prefix}/`)))));
}

/** Only captured, registered sources are described. No Indexer script or
 * parser starts during this preparation; code feature investigation belongs
 * to the selected skill/Agent, within the returned repository boundary. */
export async function prepareProductionPlanningMaterials(input: {
  projectRoot: string;
  requirements: ProductionRequirements;
  scopes?: ReadonlySet<string>;
}): Promise<{ materials: ProductionStageMaterials; gaps: Array<{ scope: string; reason: string }> }> {
  const registry = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const readSource = await registeredArticleSourceReader(input.projectRoot);
  const scopes = [...new Set(input.requirements.requirements.flatMap(item => [
    ...item.target_scope.targets, ...item.evidence_source_scope?.targets ?? [],
  ].map(target => target.source_ref)))];
  const sources = new Map<string, string>();
  const gaps: Array<{ scope: string; reason: string }> = [];
  for (const scope of scopes) {
    if (input.scopes && !input.scopes.has(scope)) continue;
    if (productionSourceIsExcluded(input.requirements, scope)) {
      sources.set(scope, `# ${scope}\n\nThis entire source is explicitly excluded from every selected requirement; no investigation was performed.\n`);
      continue;
    }
    try {
      const separator = scope.indexOf(":");
      const type = scope.slice(0, separator);
      const name = scope.slice(separator + 1);
      const entries = type === "repo" ? registry.repos : type === "file" ? registry.files : type === "lark" ? registry.larks
        : type === "note" ? registry.notes : type === "sessions" ? registry.sessions : [];
      const selected = entries.filter(entry => entry.id === name || entry.name === name);
      if (selected.length !== 1) throw new TypeError(`Source must identify one registered input: ${scope}`);
      const entry = selected[0]!;
      const root = join(input.projectRoot, entry.materializedAt);
      if (type === "repo") {
        const repo = registry.repos.find(repo => repo.id === name || repo.name === name)!;
        if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(repo.ref)) throw new TypeError("Planning requires a captured fixed commit, not a moving ref");
        await execute("git", ["-C", root, "diff", "--quiet", repo.ref, "--", "."], {
          timeout: 5000, maxBuffer: 64 * 1024,
        });
        const targets = input.requirements.requirements.flatMap(item => [...item.target_scope.targets,
          ...item.evidence_source_scope?.targets ?? []]).filter(target => target.source_ref === scope);
        const modules = [...new Set(targets.flatMap(target => target.module_refs ?? []))];
        const result = await execute("git", ["-C", root, "ls-tree", "-r", "--name-only", "-z", repo.ref], {
          encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024,
        });
        const files = result.stdout.split("\0").filter(path => path && !sourceExcludes(input.requirements, scope, path));
        const directories = new Map<string, number>();
        for (const file of files) {
          const directory = file.includes("/") ? file.split("/")[0]! : "(root)";
          directories.set(directory, (directories.get(directory) ?? 0) + 1);
        }
        sources.set(scope, [`# ${scope}`, "", `Authorized repository boundary: ${root}`, `Captured commit: ${repo.ref}`,
          ...(modules.length ? [`Module focus: ${modules.join(", ")}`] : []),
          "Choose relevant directories while investigating. Module names are work guidance, not inferred path permissions; put useful reading scope in the task brief without a separate mapping or receipt.",
          `Complete authorized tracked-file count: ${files.length}`, "", "## Directory skeleton", "",
          ...[...directories].sort(([a], [b]) => a.localeCompare(b)).map(([directory, count]) => `- ${directory}: ${count} files`),
          "", "## File navigation sample", "", ...files.slice(0, 128).map(path => `- ${path}`),
          ...(files.length > 128 ? [`${files.length - 128} additional filenames are omitted here; investigate the relevant directory within the authorized boundary.`] : []),
          "", "No component, route, symbol or relationship totals were inferred. Use a relevant Indexer skeleton capability or selectively investigate; do not deeply parse every file just to plan.", ""].join("\n"));
        continue;
      }
      const managed = type === "note" || type === "sessions";
      const manifestPath = "snapshot" in entry ? entry.snapshot?.manifest : undefined;
      const paths = managed ? [basename(entry.materializedAt)] : parseDocumentSnapshotForSource(JSON.parse(await readFile(
        join(input.projectRoot, manifestPath ?? `${entry.materializedAt}/manifest.json`), "utf8")), entry.name).files.map(file => file.path);
      const overviews = [];
      const included = paths.filter(path => !sourceExcludes(input.requirements, scope, path));
      for (const path of included) {
        if (!/\.(?:md|markdown|mdx|txt)$/iu.test(path)) continue;
        overviews.push(productionDocumentSkeleton(path, await readSource(scope, path, true)));
      }
      if (included.length > 0 && overviews.length === 0) throw new TypeError("No readable text snapshot is available for this source; capture a text representation before planning");
      sources.set(scope, [`# ${scope}`, "", `Full captured material entry: ${root}`, "",
        managed ? "Read this saved note/session and directly propose its target article or amendment." : "Use the outline first, optionally read full text, and decide topics and writing batches against existing topics.",
        "", ...(included.length === 0 ? ["All captured files are explicitly excluded from the selected requirements."] : overviews)].join("\n"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      gaps.push({ scope, reason });
      sources.set(scope, `# ${scope}\n\nInvestigation incomplete: ${reason}\n\nNo complete feature or file count is available.\n`);
    }
  }
  return { materials: { requirements: YAML.stringify(input.requirements), sources }, gaps };
}
