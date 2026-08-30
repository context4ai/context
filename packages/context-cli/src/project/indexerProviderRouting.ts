import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  buildIndexerProviderRouteInput,
  buildIndexerProviderRouteReport,
  canonicalIndexerJson,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateIndexerProviderRouteInput,
  type IndexerProviderRouteInput,
  type IndexerProviderRouteReport,
} from "@c4a/context";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function routeInput(value: unknown): IndexerProviderRouteInput {
  if (!isRecord(value)) {
    throw new TypeError("Indexer Provider route input must be an object");
  }
  if (value.input_digest !== undefined) {
    return validateIndexerProviderRouteInput(value);
  }
  return buildIndexerProviderRouteInput({
    project_ref: String(value.project_ref ?? ""),
    registry: value.registry,
    visible_skills: Array.isArray(value.visible_skills) ? value.visible_skills : [],
    community_fallback_attempted: value.community_fallback_attempted === true,
  });
}

export async function routeProjectIndexerProviderSelection(input: {
  projectRoot: string;
  value: unknown;
}): Promise<IndexerProviderRouteReport> {
  const route = routeInput(input.value);
  const current = parseIndexerRegistry(await readFile(
    join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  const currentDigests = indexerRegistryDigests(current);
  const targetDigests = indexerRegistryDigests(route.registry);
  if (
    currentDigests.requirementSetDigest !== targetDigests.requirementSetDigest ||
    canonicalIndexerJson(current.requirements) !==
      canonicalIndexerJson(route.registry.requirements)
  ) {
    throw new TypeError(
      "Indexer Provider route cannot modify or target stale requirements",
    );
  }
  return buildIndexerProviderRouteReport(route);
}
