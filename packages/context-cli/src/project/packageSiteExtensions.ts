import { createHash } from "node:crypto";
import { lstat, readdir, readFile, mkdir, writeFile, symlink } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import type { PackageSiteDefinition } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";

type Extensions = NonNullable<PackageSiteDefinition["extensions"]>;
export function invalidSiteExtension(message: string): never {
  throw new ContextError(ExitCode.UserError, `Site extensions: ${message}. Update site.extensions, its src files or the knowledge-map target, then retry the build.`, {
    reason_code: "invalid-site-extension",
  });
}
const invalid = invalidSiteExtension;
function relativeFile(path: string) {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === "..")) invalid(`unsafe file path ${path}`);
  return path;
}

/** Snapshot only the declared, trusted presentation tree, not the entire workspace. */
export async function readSiteExtensions(projectRoot: string, extensions?: Extensions) {
  if (!extensions || (!Object.values(extensions.slots ?? {}).some(value => typeof value === "string") &&
    !Object.keys(extensions.pages ?? {}).length)) return { files: [] as { path: string; bytes: Buffer }[], digest: null };
  const root = extensions.root ?? "src/site";
  if (!/^src\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(root)) invalid(`unsafe root ${root}`);
  let cursor = projectRoot;
  for (const part of root.split("/")) {
    cursor = join(cursor, part);
    const info = await lstat(cursor).catch(error => {
      if (error.code === "ENOENT") invalid(`missing directory ${root}`);
      throw error;
    });
    if (info.isSymbolicLink()) invalid(`symlink at ${root}`);
    if (!info.isDirectory()) invalid(`not a directory ${root}`);
  }
  const files: { path: string; bytes: Buffer }[] = [];
  async function walk(directory: string, prefix: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || ["node_modules", "dist"].includes(entry.name)) continue;
      const path = prefix + entry.name;
      if (entry.isSymbolicLink()) invalid(`symlink at ${path}`);
      if (entry.isDirectory()) await walk(join(directory, entry.name), path + "/");
      else if (entry.isFile()) files.push({ path, bytes: await readFile(join(directory, entry.name)) });
    }
  }
  await walk(cursor, "");
  const available = new Set(files.map(file => file.path));
  for (const path of Object.values(extensions.slots ?? {})) {
    if (path === false || path === undefined) continue;
    if (!available.has(relativeFile(path)) || !/\.(?:vue|ts|js|mjs)$/.test(path)) invalid(`missing component ${path}`);
  }
  for (const path of Object.values(extensions.pages ?? {})) {
    if (!available.has(relativeFile(path)) || !path.endsWith(".md")) invalid(`missing Markdown page ${path}`);
  }
  const hash = createHash("sha256");
  for (const file of files) hash.update(file.path + "\0").update(file.bytes).update("\0");
  for (const name of ["package.json", "bun.lock", "pnpm-lock.yaml", "package-lock.json"]) {
    try { hash.update(name).update(await readFile(join(projectRoot, name))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return { files, digest: hash.digest("hex") };
}

export function siteExtensionTargets(site?: PackageSiteDefinition) {
  return new Map(Object.keys(site?.extensions?.pages ?? {}).map(key => [`site:${key}`, `/custom/${key}.html`]));
}

export async function writeSiteExtensions(projectRoot: string, temporary: string, extensions?: Extensions) {
  const { files } = await readSiteExtensions(projectRoot, extensions);
  const root = join(temporary, "_site");
  for (const file of files) {
    const path = join(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
  }
  if (extensions) {
    // Business dependencies resolve from its own workspace. Vue/VitePress are
    // deduplicated by the renderer to avoid duplicate runtime instances.
    try {
      const modules = resolve(projectRoot, "node_modules");
      if ((await lstat(modules)).isDirectory() || (await lstat(modules)).isSymbolicLink()) {
        await mkdir(root, { recursive: true });
        await symlink(modules, join(root, "node_modules"), "dir");
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const imports = ["import { h, defineAsyncComponent, resolveComponent } from 'vue';"];
  const slots: string[] = [];
  for (const [name, path] of Object.entries(extensions?.slots ?? {})) {
    if (path === undefined) continue;
    if (path === false) { slots.push(`${JSON.stringify(name)}: false`); continue; }
    imports.push(`const ${name} = defineAsyncComponent(() => import(${JSON.stringify(`../../_site/${path}`)}));`);
    // Floating widgets can contain browser-only SDKs. The import is deferred
    // until ClientOnly mounts, so it never executes during prerendering.
    slots.push(`${JSON.stringify(name)}: ${name === "floating" ? `() => h(resolveComponent('ClientOnly'), null, { default: () => h(${name}) })` : `() => h(${name})`}`);
  }
  await writeFile(join(temporary, ".vitepress/theme/extensions.js"), imports.join("\n") + `\nexport default {${slots.join(",")}};\n`);
  for (const [key, path] of Object.entries(extensions?.pages ?? {})) {
    await mkdir(join(temporary, "custom"), { recursive: true });
    // Compile the original Markdown in place, retaining relative component and asset imports.
    const content = files.find(file => file.path === path)!.bytes.toString("utf8");
    const metadata = parseKnowledgeFrontmatter(content);
    const title = metadata.title ?? /^#\s+(.+)$/m.exec(content)?.[1] ?? key;
    await writeFile(join(temporary, "custom", `${key}.md`), `---\n${JSON.stringify({ layout: "page", ...metadata, title })}\n---\n<script setup>\nimport Page from ${JSON.stringify(`../_site/${path}`)};\n</script>\n\n<Page />\n`);
  }
}
