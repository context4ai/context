import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const EVIDENCE_PLUGIN = "context-evidence.sourcegraph.wasm";
export interface EvidencePluginResult {
  path: string;
  status: "installed" | "unchanged" | "upgraded" | "conflict" | "needs-repository-root";
  message?: string;
}
const missing = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function gitRoot(directory: string): Promise<string | undefined> {
  let cursor = directory;
  while (true) {
    try { await lstat(join(cursor, ".git")); return cursor; } catch (error) { if (!missing(error)) throw error; }
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

async function bundledEvidence(): Promise<string> {
  let cursor = dirname(fileURLToPath(import.meta.url));
  while (true) {
    for (const candidate of [join(cursor, "evidence"), join(cursor, "dist/evidence")]) {
      try { if ((await lstat(join(candidate, "manifest.json"))).isFile()) return candidate; }
      catch (error) { if (!missing(error)) throw error; }
    }
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error("Bundled evidence plugin is missing; rebuild or reinstall the Context CLI.");
    cursor = parent;
  }
}

async function readArtifact(artifact: string): Promise<{ bytes: Buffer; manifest: { sha256: string; previous: string[] } }> {
  const bytes = await readFile(join(artifact, EVIDENCE_PLUGIN));
  const manifest = JSON.parse(await readFile(join(artifact, "manifest.json"), "utf8")) as { sha256: string; previous: string[] };
  if (hash(bytes) !== manifest.sha256 || !Array.isArray(manifest.previous) || !manifest.previous.every(value => /^[a-f0-9]{64}$/u.test(value))) {
    throw new Error("Invalid bundled evidence artifact manifest");
  }
  const module = new WebAssembly.Module(bytes);
  const metadata = WebAssembly.Module.customSections(module, "sourcegraph.plugin.v1");
  const declaration = metadata.length === 1 ? JSON.parse(new TextDecoder().decode(metadata[0])) : undefined;
  if (declaration?.name !== "context-evidence" || declaration.abi_version !== 2) {
    throw new Error("Invalid bundled evidence plugin metadata");
  }
  return { bytes, manifest };
}

/** Does not execute project configuration, Git hooks or source material. */
export async function installEvidencePlugin(input: {
  projectRoot: string;
  repositoryRoot?: string;
  pluginRoot?: string;
  artifactRoot?: string;
}): Promise<EvidencePluginResult> {
  const project = await realpath(resolve(input.projectRoot));
  const detected = await gitRoot(project);
  const requested = input.repositoryRoot === undefined ? undefined : await realpath(resolve(input.repositoryRoot));
  const scoped = input.pluginRoot === undefined ? undefined : await realpath(resolve(input.pluginRoot));
  if (requested && scoped) throw new Error("Choose --repository-root or --plugin-root, not both.");
  if (scoped) {
    const fromGit = relative(detected ?? project, scoped);
    const toProject = relative(scoped, project);
    if ([fromGit, toProject].some(path => path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))) {
      throw new Error("--plugin-root must be an ancestor of the workspace inside the same repository.");
    }
  }
  if (requested !== undefined && requested !== (detected ?? project)) {
    throw new Error("--repository-root must be the actual enclosing Git root (or workspace root before Git initialization).");
  }
  if (detected && detected !== project && requested === undefined && scoped === undefined) {
    return { path: join(detected, EVIDENCE_PLUGIN), status: "needs-repository-root",
      message: "Nested workspace: explicitly choose --repository-root for full-repository hosting or --plugin-root for the host's registered content root." };
  }
  const root = scoped ?? requested ?? project;
  const target = join(root, EVIDENCE_PLUGIN);
  const { bytes, manifest } = await readArtifact(input.artifactRoot ?? await bundledEvidence());
  let original: Buffer | undefined;
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return { path: target, status: "conflict", message: "Existing plugin is not a regular file; preserved." };
    original = await readFile(target);
  } catch (error) { if (!missing(error)) throw error; }
  if (original && hash(original) === manifest.sha256) return { path: target, status: "unchanged" };
  if (original && !manifest.previous.includes(hash(original))) return { path: target, status: "conflict", message: "Unknown or modified plugin preserved." };
  if (!original) {
    try { await writeFile(target, bytes, { flag: "wx" }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return { path: target, status: "conflict", message: "Plugin was created concurrently; preserved." };
      throw error;
    }
  } else {
    // Stage an atomic replacement on the same filesystem; recheck ownership before rename.
    const scratch = join(project, ".tmp/evidence-install");
    await mkdir(scratch, { recursive: true });
    const temp = join(scratch, `${randomUUID()}.wasm`);
    await writeFile(temp, bytes, { flag: "wx" });
    try {
      if ((await lstat(target)).isSymbolicLink() || hash(await readFile(target)) !== hash(original)) {
        return { path: target, status: "conflict", message: "Plugin changed during upgrade; preserved." };
      }
      await rename(temp, target);
    } finally { await unlink(temp).catch(error => { if (!missing(error)) throw error; }); }
  }
  return { path: target, status: original ? "upgraded" : "installed",
    ...(relative(root, project) ? { message: `Use workspace_root=${relative(root, project).split(sep).join("/")} when reading this workspace.` } : {}) };
}
