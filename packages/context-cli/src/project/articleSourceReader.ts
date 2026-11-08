import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { loadSourcesRegistry, type SourcesRegistry } from "@c4a/context";
import { parseDocumentSnapshotForSource } from "./documentBatchManifest.js";
import { repoContentReferenceReader } from "./repoContentEvidence.js";
import { commandGitObjectReader, SourceReadError, SourceUnavailableError } from "./gitObjectReader.js";

const execute = promisify(execFile);

function inside(root: string, path: string): void {
  const value = relative(root, path);
  if (!value || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new SourceUnavailableError("Article source path escapes its captured scope", "source-path-outside-scope");
  }
}

/** Checkouts may be shallow or behind the registered commit. With `fetch`, a missing
 * commit is fetched once; otherwise reads stay local. A missing commit fails every
 * path at once instead of per read. */
function commitAvailability(fetched: Map<string, Promise<boolean>>, fetch = true) {
  return (directory: string, commit: string) => {
    const key = `${directory}\0${commit}`;
    let result = fetched.get(key);
    if (!result) {
      result = execute("git", ["-C", directory, "cat-file", "-e", `${commit}^{commit}`],
        { timeout: 5000, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } }).then(() => true, () => !fetch ? false :
        execute("git", ["-C", directory, "fetch", "--quiet", "--depth=1", "origin", commit], { timeout: 120_000 })
          .then(() => true, () => false));
      fetched.set(key, result);
    }
    return result;
  };
}

function missingCommit(commit: string): SourceUnavailableError {
  return new SourceUnavailableError(`Commit ${commit} is not available in the registered checkout; fetch and check out the registered commit, then retry`, "source-history-missing");
}

/** Reads a registered repository file at an earlier commit; callers must verify
 * the result against a recorded digest before trusting it. */
export async function registeredRepoHistoryReader(projectRoot: string) {
  const workspace = await realpath(projectRoot);
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const roots = new Map<string, Promise<string>>();
  const fetched = new Map<string, Promise<boolean>>();
  const reads = new Map<string, Promise<string>>();
  const objects = commandGitObjectReader();
  const available = commitAvailability(fetched);
  async function readAt(directory: string, path: string, commit: string): Promise<string> {
    if (!await available(directory, commit)) throw missingCommit(commit);
    return decodeSource(await objects.read(directory, commit, path));
  }
  return async (sourceRef: string, path: string, commit: string): Promise<string> => {
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(commit)) throw new TypeError("History reads require a fixed commit");
    let root = roots.get(sourceRef);
    if (!root) {
      const name = sourceRef.startsWith("repo:") ? sourceRef.slice("repo:".length) : undefined;
      const entry = registry.repos.find(item => item.id === name || item.name === name);
      if (!entry) throw new TypeError(`Source is not a registered repository: ${sourceRef}`);
      root = realpath(resolve(workspace, entry.materializedAt)).then(actual => { inside(workspace, actual); return actual; });
      roots.set(sourceRef, root);
    }
    const directory = await root;
    const key = JSON.stringify([directory, commit, path]);
    let read = reads.get(key);
    if (!read) { read = readAt(directory, path, commit); reads.set(key, read); }
    return read;
  };
}

function decodeSource(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes("\0")) throw new TypeError("Binary source");
    return text;
  } catch { throw new SourceUnavailableError("The cited source is not UTF-8 text", "source-not-text"); }
}

/** An observation shares reads, manifest parsing and one object pipe per repo.
 * Repository citations always read the registered commit, never mutable files. */
/** Only a source update may fetch a registered commit; status, verification and
 * production reads never touch the network or the source checkout. */
export async function registeredArticleSourceReader(projectRoot: string, options: { fetchMissingCommits?: boolean } = {}) {
  let repoContentRead: ReturnType<typeof repoContentReferenceReader> | undefined;
  const workspace = await realpath(projectRoot);
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const objects = commandGitObjectReader();
  const available = commitAvailability(new Map(), options.fetchMissingCommits === true);
  const sources = new Map<string, { kind: string; entry: SourcesRegistry["repos"][number]
    | SourcesRegistry["files"][number] | SourcesRegistry["larks"][number] | SourcesRegistry["notes"][number] }>();
  for (const [kind, entries] of [["repo", registry.repos], ["file", registry.files],
    ["lark", registry.larks], ["note", registry.notes], ["sessions", registry.sessions]] as const) {
    for (const entry of entries) {
      sources.set(`${kind}:${entry.id}`, { kind, entry });
      sources.set(`${kind}:${entry.name}`, { kind, entry });
    }
  }
  type Descriptor = { root: string; files?: Map<string, string>; commit?: string; incomplete?: boolean };
  const descriptors = new Map<string, Promise<Descriptor>>();
  const manifests = new Map<string, Promise<unknown>>();
  const texts = new Map<string, Promise<{ text: string; digest: string; expected: string | undefined }>>();
  async function descriptor(sourceRef: string): Promise<Descriptor> {
    const source = sources.get(sourceRef);
    if (!source) throw new SourceUnavailableError(`Source is no longer registered: ${sourceRef}`, "source-unregistered");
    const { kind, entry } = source;
    const managed = kind === "note" || kind === "sessions";
    const root = await realpath(resolve(workspace, managed ? dirname(entry.materializedAt) : entry.materializedAt)).catch(error => {
      if (kind === "repo") throw new SourceReadError("The registered source checkout is not accessible. Restore the source before checking citations.", "context source recovery-plan --format json");
      throw error;
    });
    inside(workspace, root);
    if (managed) return { root, files: new Map([[basename(entry.materializedAt), ""]]) };
    if (kind === "repo") {
      if (!("ref" in entry) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(entry.ref)) {
        throw new SourceUnavailableError("Article source requires a captured fixed commit, not a moving ref", "source-ref-unpinned");
      }
      if (!await available(root, entry.ref)) throw missingCommit(entry.ref);
      return { root, commit: entry.ref };
    }
    const manifestPath = resolve(workspace, ("snapshot" in entry ? entry.snapshot?.manifest : undefined)
      ?? `${entry.materializedAt}/manifest.json`);
    inside(workspace, manifestPath);
    const actual = await realpath(manifestPath);
    inside(workspace, actual);
    let manifestRead = manifests.get(actual);
    if (!manifestRead) { manifestRead = readFile(actual, "utf8").then(JSON.parse); manifests.set(actual, manifestRead); }
    const manifest = parseDocumentSnapshotForSource(await manifestRead, entry.name);
    if (manifest.source_type !== kind) throw new SourceUnavailableError("Captured document manifest has a different source type", "source-manifest-invalid");
    const report = manifest.metadata?.capture?.report;
    const incomplete = report !== undefined && (report.fidelityStatus === "error" || report.projectionStatus === "error" ||
      report.resourceStatus !== "complete");
    return { root, files: new Map(manifest.files.map(file => [file.path, file.content_hash])), incomplete };
  }
  function scope(sourceRef: string) {
    let result = descriptors.get(sourceRef);
    if (!result) { result = descriptor(sourceRef); descriptors.set(sourceRef, result); }
    return result;
  }
  async function read(sourceRef: string, path: string, requireCapturedVersion = false): Promise<string> {
    if (sourceRef.startsWith("repo-content:")) {
      repoContentRead ??= repoContentReferenceReader(projectRoot);
      return (await repoContentRead)(sourceRef, path, requireCapturedVersion);
    }
    const key = JSON.stringify([sourceRef, path]);
    let pending = texts.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const { root, files, commit } = await scope(sourceRef);
          if (files && !files.has(path)) throw new SourceUnavailableError("Source path is not owned by the registered document", "source-path-unregistered");
          const lexical = resolve(root, path);
          inside(root, lexical);
          let bytes: Uint8Array;
          if (commit) bytes = await objects.read(root, commit, path);
          else {
            const actual = await realpath(lexical);
            inside(root, actual);
            if (!(await stat(actual)).isFile()) throw new SourceUnavailableError("Article source must be a regular file", "source-file-type");
            bytes = await readFile(actual);
          }
          return { text: decodeSource(bytes), digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
            expected: files?.get(path) };
        } catch (error) {
          if (error instanceof SourceReadError || error instanceof SourceUnavailableError) throw error;
          if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
            throw new SourceUnavailableError("The captured source file is missing; restore the source before checking it", "source-file-missing");
          }
          throw new SourceReadError("Cannot complete the source read; check access and retry the current command.");
        }
      })();
      texts.set(key, pending);
    }
    const result = await pending;
    if (requireCapturedVersion && result.expected && result.expected !== result.digest) {
      throw new SourceUnavailableError("Captured source changed; refresh the source before submitting a revision", "source-snapshot-changed");
    }
    return result.text;
  }
  return Object.assign(read, {
    incomplete: async (sourceRef: string) => (await scope(sourceRef)).incomplete ?? false,
  });
}
