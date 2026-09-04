import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IndexerProviderManifest } from "@c4a/context";
import { BUNDLED_INDEXER_METRIC_IDS } from "./indexerBaseContracts.js";

const BUNDLED_CODE_METRIC_GUIDANCE = Object.fromEntries(
  BUNDLED_INDEXER_METRIC_IDS.map((metricId) => [
    metricId,
    `bundle:context-code-indexer/references/metrics.md#${metricId}`,
  ]),
) as Readonly<Record<typeof BUNDLED_INDEXER_METRIC_IDS[number], string>>;

const REQUIRED_SUBHEADINGS = [
  "Meaning",
  "Revise",
  "Positive example",
  "Anti-example",
] as const;
const NUMERIC_THRESHOLD = /\b(?:recommended|hard(?: gate)?|threshold)\b[^\n]*(?:\d|%)/iu;

function metricSections(markdown: string): Array<{ id: string; body: string }> {
  const matches = [...markdown.matchAll(/^## ([a-z0-9][a-z0-9-]*)\s*$/gmu)];
  return matches.map((match, index) => ({
    id: match[1]!,
    body: markdown.slice(
      (match.index ?? 0) + match[0].length,
      matches[index + 1]?.index ?? markdown.length,
    ),
  }));
}

export async function validateBundledIndexerMetricGuidance(input: {
  source: string;
  manifest: IndexerProviderManifest;
  expectedMetricIds: readonly string[];
}): Promise<void> {
  const quality = input.manifest.quality_guidance;
  if (
    quality?.repair !== "references/metrics.md" ||
    quality.metric_ids.length !== input.expectedMetricIds.length ||
    quality.metric_ids.some((metricId, index) => metricId !== input.expectedMetricIds[index])
  ) {
    throw new TypeError(
      "context-code-indexer quality guidance must bind the exact CLI metric catalog",
    );
  }
  const markdown = await readFile(join(input.source, quality.repair), "utf8");
  if (NUMERIC_THRESHOLD.test(markdown)) {
    throw new TypeError("Indexer Skill metric guidance must not copy numeric thresholds");
  }
  const sections = metricSections(markdown);
  if (
    sections.length !== input.expectedMetricIds.length ||
    sections.some((section, index) => section.id !== input.expectedMetricIds[index])
  ) {
    throw new TypeError(
      "Indexer Skill metric guidance must cover every CLI metric exactly once in canonical catalog order",
    );
  }
  for (const section of sections) {
    for (const heading of REQUIRED_SUBHEADINGS) {
      if (!section.body.includes(`### ${heading}`)) {
        throw new TypeError(
          `metric guidance ${section.id} is missing the ${heading} revision section`,
        );
      }
    }
    const expectedRef = `bundle:context-code-indexer/references/metrics.md#${section.id}`;
    if (
      BUNDLED_CODE_METRIC_GUIDANCE[
        section.id as keyof typeof BUNDLED_CODE_METRIC_GUIDANCE
      ] !== expectedRef
    ) {
      throw new TypeError(`metric guidance ${section.id} has no matching CLI audit reference`);
    }
  }
}
