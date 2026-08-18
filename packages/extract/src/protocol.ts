import { PackageKind } from "@c4a/core";
import { z } from "zod";
import type { ExtractionResult } from "./types.js";

const packageKindSchema = z.enum(Object.values(PackageKind) as [PackageKind, ...PackageKind[]]);

export const manifestTypeSchema = z.enum([
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
]);

export const entryFileSchema = z.object({
  path: z.string().min(1),
  subpath: z.string().min(1),
  type: z.enum(["library", "cli", "service", "webapp"]),
});

export const manifestInfoSchema = z.object({
  type: manifestTypeSchema,
  path: z.string().min(1),
  content: z.record(z.unknown()),
});

export const sourceInfoSchema = z.object({
  path: z.string().min(1),
  manifests: z.array(manifestInfoSchema),
  language: z.string().min(1).optional(),
});

export const entryDetectionResultSchema: z.ZodType<EntryDetectionResult> = z.lazy(() =>
  z.object({
    package: z.object({
      name: z.string().min(1),
      kind: packageKindSchema,
      language: z.string().min(1),
      version: z.string().min(1).optional(),
    }),
    entries: z.array(entryFileSchema),
    subPackages: z.array(entryDetectionResultSchema).optional(),
  })
);

export const patternDetectionResultSchema = z.object({
  endpoints: z.array(
    z.object({
      handler: z.string().min(1),
      method: z.string().min(1),
      path: z.string().min(1),
      file: z.string().min(1),
      line: z.number().int().positive(),
    })
  ).optional(),
  implicitDeps: z.array(
    z.object({
      verb: z.enum(["produce", "consume", "depends_on", "serve"]),
      target: z.string().min(1),
      file: z.string().min(1),
      line: z.number().int().positive(),
    })
  ).optional(),
  configRefs: z.array(
    z.object({
      key: z.string().min(1),
      file: z.string().min(1),
      line: z.number().int().positive(),
    })
  ).optional(),
});

export type EntryFile = z.infer<typeof entryFileSchema>;
export type ManifestInfo = z.infer<typeof manifestInfoSchema>;
export type SourceInfo = z.infer<typeof sourceInfoSchema>;
export type EntryDetectionResult = {
  package: {
    name: string;
    kind: PackageKind;
    language: string;
    version?: string | undefined;
  };
  entries: EntryFile[];
  subPackages?: EntryDetectionResult[] | undefined;
};
export type PatternDetectionResult = z.infer<typeof patternDetectionResultSchema>;

export interface FileSystem {
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  readJson<T = unknown>(path: string): Promise<T>;
}

export interface ExtractionPlugin {
  id: string;
  languages: string[];
  packageManagers: string[];
  manifestTypes?: ManifestInfo["type"][];
  canHandle(source: SourceInfo): boolean;
  detectEntries(manifest: ManifestInfo, fs: FileSystem): Promise<EntryDetectionResult>;
  extractSymbols(entries: EntryFile[], fs: FileSystem): Promise<ExtractionResult>;
  detectPatterns?(fs: FileSystem): Promise<PatternDetectionResult>;
}
