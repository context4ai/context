import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  indexerRegistryDigests,
  parseIndexerRegistry,
  type IndexerRegistry,
} from "@c4a/context";

export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

export function protocol(
  value: Record<string, unknown>,
  expected: string,
  label: string,
): void {
  if (value.protocol !== expected) {
    throw new TypeError(`${label}.protocol must be ${expected}`);
  }
}

export async function currentRegistry(projectRoot: string): Promise<IndexerRegistry> {
  return parseIndexerRegistry(await readFile(
    join(projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
}

export async function assertCurrentRequirement(
  projectRoot: string,
  digest: unknown,
): Promise<IndexerRegistry> {
  const registry = await currentRegistry(projectRoot);
  if (
    typeof digest !== "string" ||
    digest !== indexerRegistryDigests(registry).requirementSetDigest
  ) {
    throw new TypeError("main Indexer lifecycle input targets a stale requirement set");
  }
  return registry;
}

export function assertRequirementRefs(
  registry: IndexerRegistry,
  refs: readonly unknown[],
): void {
  const allowed = new Set(registry.requirements.map((item) => `requirement:${item.id}`));
  for (const ref of refs) {
    if (typeof ref !== "string" || !allowed.has(ref)) {
      throw new TypeError(`main Indexer lifecycle references unknown requirement ${String(ref)}`);
    }
  }
}
