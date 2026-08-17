import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "../lib/normalize.js";

export type TemplateSlotValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | Array<Record<string, unknown>>;

export interface DirectoryTemplateRoute {
  outputPath: string;
  slots: Record<string, TemplateSlotValue>;
}

export interface DirectoryTemplateRenderedFile {
  template_path: string;
  output_path: string;
  used_slots: string[];
  missing_slots: string[];
}

export interface DirectoryTemplateManifest {
  files: DirectoryTemplateRenderedFile[];
  missing_slots: string[];
}

interface TemplateFile {
  absolutePath: string;
  relativePath: string;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

async function listTemplateFiles(root: string, dir: string = root): Promise<TemplateFile[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: TemplateFile[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTemplateFiles(root, full));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push({
      absolutePath: full,
      relativePath: toPosix(path.relative(root, full)),
    });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function scalarValue(value: TemplateSlotValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return "";
  if (typeof value === "object") return "";
  return String(value);
}

function pathSlotValue(value: TemplateSlotValue): string {
  const scalar = scalarValue(value);
  if (scalar.length === 0) return "";
  return slugify(scalar.replace(/^@/u, "").replace(/[\\/]+/gu, "-"), 120);
}

function valueAt(record: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, record);
}

function renderEachBlocks(
  template: string,
  slots: Record<string, TemplateSlotValue>,
  used: Set<string>,
  missing: Set<string>,
): string {
  return template.replace(/\{\{#each\s+([a-zA-Z0-9_.-]+)\}\}([\s\S]*?)\{\{\/each\}\}/gu, (_match, key: string, body: string) => {
    used.add(key);
    const rows = slots[key];
    if (!Array.isArray(rows)) {
      missing.add(key);
      return "";
    }
    return rows.map((row) =>
      body.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/gu, (_slot, slotKey: string) => {
        used.add(`${key}.${slotKey}`);
        const value = valueAt(row, slotKey);
        if (value === undefined || value === null) missing.add(`${key}.${slotKey}`);
        return value === undefined || value === null ? "" : String(value);
      })
    ).join("");
  });
}

function renderIfBlocks(
  template: string,
  slots: Record<string, TemplateSlotValue>,
  used: Set<string>,
  missing: Set<string>,
): string {
  return template.replace(/\{\{#if\s+([a-zA-Z0-9_.-]+)\}\}([\s\S]*?)\{\{\/if\}\}/gu, (_match, key: string, body: string) => {
    used.add(key);
    const value = slots[key];
    if (!(key in slots) || value === undefined || value === null) missing.add(key);
    return value === undefined || value === null || value === "" || value === false ? "" : body;
  });
}

export function renderTemplateContent(template: string, slots: Record<string, TemplateSlotValue>): {
  body: string;
  usedSlots: string[];
  missingSlots: string[];
} {
  const used = new Set<string>();
  const missing = new Set<string>();
  const withBlocks = renderIfBlocks(renderEachBlocks(template, slots, used, missing), slots, used, missing);
  const body = withBlocks.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/gu, (_match, key: string) => {
    used.add(key);
    if (
      !(key in slots) ||
      slots[key] === undefined ||
      slots[key] === null ||
      Array.isArray(slots[key]) ||
      typeof slots[key] === "object"
    ) {
      missing.add(key);
      return "";
    }
    return scalarValue(slots[key]);
  });
  return {
    body,
    usedSlots: [...used].sort(),
    missingSlots: [...missing].sort(),
  };
}

function renderPath(templatePath: string, slots: Record<string, TemplateSlotValue>): {
  path: string;
  usedSlots: string[];
  missingSlots: string[];
} {
  const used = new Set<string>();
  const missing = new Set<string>();
  const out = templatePath.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/gu, (_match, key: string) => {
    used.add(key);
    const value = pathSlotValue(slots[key]);
    if (value.length === 0) missing.add(key);
    return value;
  });
  return {
    path: out.split("/").filter((part) => part.length > 0 && part !== "." && part !== "..").join("/"),
    usedSlots: [...used].sort(),
    missingSlots: [...missing].sort(),
  };
}

export async function renderDirectoryTemplate(input: {
  templateDir: string;
  outputDir: string;
  routes: readonly DirectoryTemplateRoute[];
  pathFilter?: (relativePath: string) => boolean;
}): Promise<DirectoryTemplateManifest> {
  const files = (await listTemplateFiles(input.templateDir))
    .filter((file) => input.pathFilter?.(file.relativePath) ?? true);
  const rendered: DirectoryTemplateRenderedFile[] = [];
  for (const route of input.routes) {
    for (const file of files) {
      const outputPathTemplate = route.outputPath.length > 0
        ? `${route.outputPath}/${file.relativePath}`
        : file.relativePath;
      const pathRender = renderPath(outputPathTemplate, route.slots);
      if (pathRender.missingSlots.length > 0 || pathRender.path.length === 0) {
        rendered.push({
          template_path: file.relativePath,
          output_path: pathRender.path,
          used_slots: pathRender.usedSlots,
          missing_slots: pathRender.missingSlots,
        });
        continue;
      }
      const contentRender = renderTemplateContent(await readFile(file.absolutePath, "utf8"), route.slots);
      const outputPath = path.join(input.outputDir, ...pathRender.path.split("/"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, contentRender.body, "utf8");
      rendered.push({
        template_path: file.relativePath,
        output_path: pathRender.path,
        used_slots: [...new Set([...pathRender.usedSlots, ...contentRender.usedSlots])].sort(),
        missing_slots: contentRender.missingSlots,
      });
    }
  }
  return {
    files: rendered,
    missing_slots: [...new Set(rendered.flatMap((file) => file.missing_slots))].sort(),
  };
}
