import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { loadSourcesRegistry, type SourcesRegistry } from "@c4a/context";
import { parseDocumentSnapshotForSource } from "./documentBatchManifest.js";

function inside(root: string, path: string): void {
  const value = relative(root, path);
  if (!value || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new TypeError("Article source path escapes its captured scope");
  }
}

/** One submission/check, one read per cited file. Registration identifies the
 * source; a document manifest identifies its files even in a shared date folder.
 * This never prepares parsers or loads uncited document bodies. */
export async function registeredArticleSourceReader(projectRoot: string) {
  const workspace = await realpath(projectRoot);
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const sources = new Map<string, { kind: string; entry: SourcesRegistry["repos"][number]
    | SourcesRegistry["files"][number] | SourcesRegistry["larks"][number] | SourcesRegistry["notes"][number] }>();
  for (const [kind, entries] of [["repo", registry.repos], ["file", registry.files],
    ["lark", registry.larks], ["note", registry.notes], ["sessions", registry.sessions]] as const) {
    for (const entry of entries) {
      sources.set(`${kind}:${entry.id}`, { kind, entry });
      sources.set(`${kind}:${entry.name}`, { kind, entry });
    }
  }
  const descriptors = new Map<string, Promise<{ root: string; files?: Map<string, string> }>>();
  const texts = new Map<string, Promise<{ text: string; contentDigest: string; expected: string | undefined }>>();
  async function descriptor(sourceRef: string) {
    const source = sources.get(sourceRef);
    if (!source) throw new TypeError(`Source is no longer registered: ${sourceRef}`);
    const { kind, entry } = source;
    const managed = kind === "note" || kind === "sessions";
    const root = await realpath(resolve(workspace, managed ? dirname(entry.materializedAt) : entry.materializedAt));
    inside(workspace, root);
    if (managed) return { root, files: new Map([[basename(entry.materializedAt), ""]]) };
    if (kind === "repo") return { root };
    const manifestPath = resolve(workspace, ("snapshot" in entry ? entry.snapshot?.manifest : undefined)
      ?? `${entry.materializedAt}/manifest.json`);
    inside(workspace, manifestPath);
    const actual = await realpath(manifestPath);
    inside(workspace, actual);
    const manifest = parseDocumentSnapshotForSource(JSON.parse(await readFile(actual, "utf8")), entry.name);
    if (manifest.source_type !== kind) throw new TypeError("Captured document manifest has a different source type");
    return { root, files: new Map(manifest.files.map(file => [file.path, file.content_hash])) };
  }
  return async (sourceRef: string, path: string, requireCapturedVersion = false): Promise<string> => {
    const key = JSON.stringify([sourceRef, path]);
    let pending = texts.get(key);
    if (!pending) {
      pending = (async () => {
        let scope = descriptors.get(sourceRef);
        if (!scope) { scope = descriptor(sourceRef); descriptors.set(sourceRef, scope); }
        const { root, files } = await scope;
        if (files && !files.has(path)) throw new TypeError("Source path is not owned by the registered document");
        const lexical = resolve(root, path);
        inside(root, lexical);
        const actual = await realpath(lexical);
        inside(root, actual);
        if (!(await stat(actual)).isFile()) throw new TypeError("Article source must be a regular file");
        const bytes = await readFile(actual);
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        if (text.includes("\0")) throw new TypeError("Article source is not text");
        return { text, contentDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          expected: files?.get(path) };
      })();
      texts.set(key, pending);
    }
    const result = await pending;
    if (requireCapturedVersion && result.expected && result.expected !== result.contentDigest) {
      throw new TypeError("Captured source changed; refresh the source before submitting a revision");
    }
    return result.text;
  };
}
