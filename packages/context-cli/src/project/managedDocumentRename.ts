import { replaceMarkdownInlineLinkTargets } from "./markdownLinks.js";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import YAML from "yaml";
import { assertManagedDocumentPath, indexerProtocolDigest, type IndexerProjectFileTarget } from "@c4a/context";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { runDurableMultiFileTransaction, safeProjectTarget } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

async function optionalText(path: string): Promise<string | undefined> {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined; throw error; }
}

async function renameTypedSourceCalls(content: string, type: string, oldName: string, newName: string): Promise<string> {
  const ts = await import("typescript");
  const tree = ts.createSourceFile("index.ts", content, ts.ScriptTarget.Latest, true);
  const aliases = new Set<string>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@c4a/context") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      if ((binding.propertyName ?? binding.name).text === "source") aliases.add(binding.name.text);
    }
  }
  const edits: Array<{ start: number; end: number }> = [];
  const visit = (node: import("typescript").Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && aliases.has(node.expression.text)) {
      const [kind, name] = node.arguments;
      if (kind && name && ts.isStringLiteral(kind) && kind.text === type && ts.isStringLiteral(name) && name.text === oldName) {
        edits.push({ start: name.getStart(tree), end: name.getEnd() });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + JSON.stringify(newName) + content.slice(edit.end);
  return content;
}

/** Rename one source and its exact references, never its prose or unrelated names.
 * Preview is derived from current files; the existing transaction owns recovery. */
export async function renameManagedDocument(input: {
  projectRoot: string; source_ref: string; name: string; apply?: boolean; plan_digest?: string;
}) {
  return withProjectWriteLock(input.projectRoot, "rename-managed-document", async () => {
    const match = /^(note|sessions):(.+)$/u.exec(input.source_ref);
    if (!match) throw new TypeError("Source rename requires the exact note: or sessions: reference returned by source list.");
    const type = match[1] as "note" | "sessions";
    const oldName = match[2]!;
    const oldPath = await assertManagedDocumentPath(input.projectRoot, type, oldName);
    const newPath = await assertManagedDocumentPath(input.projectRoot, type, input.name);
    if (oldName === input.name) throw new TypeError("The source already has this name; no rename is needed.");
    const content = await optionalText(oldPath);
    if (content === undefined) throw new TypeError("The source no longer exists; refresh source list before renaming.");
    if (await optionalText(newPath) !== undefined) throw new TypeError("The destination already exists; choose a distinct semantic name.");
    if (await currentLedger(input.projectRoot) || (await readCandidateRecords(input.projectRoot)).length ||
        await readApprovedRevision(input.projectRoot) || await readKnowledgeUpdate(input.projectRoot)) {
      throw new TypeError("Finish the current source-dependent task before renaming; its fixed input cannot be replaced while drafts remain.");
    }
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    const nextRef = `${type}:${input.name}`;
    const escaped = input.source_ref.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const reference = new RegExp(`${escaped}(?=$|[#\\s"'<>\\]\\[(),}])`, "gu");
    const replace = (value: unknown): unknown => {
      if (typeof value === "string") return value.replace(reference, nextRef);
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
      return value;
    };
    const targets: IndexerProjectFileTarget[] = [
      { path: `sources/${type}/${oldName}`, operation: "delete", base_digest: durableContentDigest(content), target_digest: null },
      { path: `sources/${type}/${input.name}`, operation: "write", base_digest: null, target_digest: durableContentDigest(content), content },
    ];
    const structure = await readKnowledgeStructure(input.projectRoot);
    const views = structure.parsed?.views as Array<{ path: string }> | undefined;
    const paths = ["src/indexers.yaml", "src/index.ts", "knowledge/structure.yaml",
      ...(views ?? []).map((view) => `knowledge/${view.path}`)];
    for (const path of [...new Set(paths)]) {
      if (path.split("/").includes("..") || path.startsWith("/")) throw new TypeError("Source references contain an unsafe knowledge path; repair it before renaming.");
      await safeProjectTarget(input.projectRoot, path);
      const before = await optionalText(join(input.projectRoot, path));
      if (before === undefined) continue;
      let after: string;
      if (path.endsWith(".yaml")) {
        const parsed: unknown = YAML.parse(before);
        const updated = replace(parsed);
        if (JSON.stringify(parsed) === JSON.stringify(updated)) continue;
        after = YAML.stringify(updated);
      } else after = before.replace(reference, nextRef);
      if (path === "src/index.ts") after = await renameTypedSourceCalls(after, type, oldName, input.name);
      if (path.endsWith(".md")) after = replaceMarkdownInlineLinkTargets(after, (link) => {
        if (/^[a-z][a-z0-9+.-]*:|^#|^\/\//iu.test(link.target)) return undefined;
        const match = /^([^#?]+)(.*)$/u.exec(link.target);
        if (!match) return undefined;
        let destination: string;
        try { destination = decodeURI(match[1]!); } catch { return undefined; }
        const rooted = destination.startsWith("sources/") || destination.startsWith("/sources/");
        const resolved = rooted ? destination.replace(/^\//u, "") : posix.normalize(posix.join(posix.dirname(path), destination));
        if (resolved !== `sources/${type}/${oldName}`) return undefined;
        const renamed = `sources/${type}/${input.name}`;
        return encodeURI(rooted ? `${destination.startsWith("/") ? "/" : ""}${renamed}` : posix.relative(posix.dirname(path), renamed)) + match[2];
      });
      if (before === after) continue;
      targets.push({ path, operation: "write", base_digest: durableContentDigest(before),
        target_digest: durableContentDigest(after), content: after });
    }
    targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const digest = indexerProtocolDigest(targets);
    if (input.apply) {
      if (input.plan_digest !== digest) throw new TypeError("The rename preview is missing or stale; preview source rename again and use its plan digest.");
      await runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "rename-managed-document", proposal_digest: digest, targets });
    }
    return { action: input.apply ? "renamed" : "preview", source_ref: input.source_ref,
      next_source_ref: nextRef, plan_digest: digest,
      files: targets.map(({ path, operation }) => ({ path, operation })),
      next: input.apply ? "context status --format json" :
        `context source rename ${quote(input.source_ref)} --name ${quote(input.name)} --yes --plan-digest ${quote(digest)} --format json` };
  });
}
