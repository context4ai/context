import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  resolveIndexerArtifactPolicyEligibility,
  type IndexerOperatorContract,
  type IndexerProfileContract,
  type IndexerProviderManifest,
} from "@c4a/context";

interface ChapterFixture {
  protocol: "context.indexer.chapter-fixture/v1";
  id: string;
  anonymized: true;
  profile: string;
  canonical_facts: Record<string, unknown>;
  artifact_policy_variant: string;
  artifact_kind: string;
  reader_question_ref: string;
  title: string;
  sections: string[];
  evidence_condition: string;
  empty_behavior: "omit-chapter";
}

const PORTABILITY_FORBIDDEN_LITERAL = /(?:@context-(?:internal|private)|\b(?:customer|private|project)-specific\b|https?:\/\/[^\s`"']+|git@[^\s`"']+|\/Users\/|\/home\/[^/\s]+\/|[A-Za-z]:\\)/iu;
const TEXT_EXTENSIONS = new Set([".json", ".md", ".yaml", ".yml"]);
const MARKDOWN_RESOURCE_REFERENCE = /`([^`\n]+\.md)`/gu;
const SELECTED_RESOURCE_REFERENCE = /\bselects?\s+`([a-z0-9][a-z0-9-]*)`/gu;
const LEGACY_TEMPLATE_TOKENS = ["`material-required`"] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

function strings(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value)
    || value.length < 2
    || value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new TypeError(`${label} must contain at least two non-empty strings`);
  }
  return value as string[];
}

function parseChapterFixture(value: unknown): ChapterFixture {
  const fixture = record(value, "chapter fixture");
  exactKeys(fixture, [
    "protocol",
    "id",
    "anonymized",
    "profile",
    "canonical_facts",
    "artifact_policy_variant",
    "artifact_kind",
    "reader_question_ref",
    "title",
    "sections",
    "evidence_condition",
    "empty_behavior",
  ], "chapter fixture");
  const canonicalFacts = record(fixture.canonical_facts, "chapter canonical_facts");
  const sections = strings(fixture.sections, "chapter sections");
  if (
    fixture.protocol !== "context.indexer.chapter-fixture/v1"
    || typeof fixture.id !== "string"
    || !/^anonymous-[a-z0-9][a-z0-9-]*-chapter$/u.test(fixture.id)
    || fixture.anonymized !== true
    || typeof fixture.profile !== "string"
    || fixture.profile.length === 0
    || typeof fixture.artifact_policy_variant !== "string"
    || fixture.artifact_policy_variant.length === 0
    || typeof fixture.artifact_kind !== "string"
    || fixture.artifact_kind.length === 0
    || typeof fixture.reader_question_ref !== "string"
    || !fixture.reader_question_ref.startsWith("question:")
    || typeof fixture.title !== "string"
    || fixture.title.trim().length === 0
    || typeof fixture.evidence_condition !== "string"
    || fixture.evidence_condition.trim().length === 0
    || fixture.empty_behavior !== "omit-chapter"
  ) {
    throw new TypeError("chapter fixture field values are invalid");
  }
  return {
    protocol: fixture.protocol,
    id: fixture.id,
    anonymized: true,
    profile: fixture.profile,
    canonical_facts: canonicalFacts,
    artifact_policy_variant: fixture.artifact_policy_variant,
    artifact_kind: fixture.artifact_kind,
    reader_question_ref: fixture.reader_question_ref,
    title: fixture.title,
    sections,
    evidence_condition: fixture.evidence_condition,
    empty_behavior: fixture.empty_behavior,
  };
}

export async function validateBundledIndexerCodeChapterFixtures(input: {
  source: string;
  expectedProfiles: readonly string[];
  manifest: IndexerProviderManifest;
  profileContract: IndexerProfileContract;
  operatorContract: IndexerOperatorContract;
}): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(
      join(input.source, "tests", "fixtures", "chapters.json"),
      "utf8",
    )) as unknown;
  } catch {
    throw new TypeError("context-code-indexer chapter fixture catalog is invalid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError("context-code-indexer chapter fixture catalog must be an array");
  }
  const fixtures = parsed.map(parseChapterFixture);
  if (
    fixtures.length !== input.expectedProfiles.length
    || fixtures.some((fixture, index) => fixture.profile !== input.expectedProfiles[index])
  ) {
    throw new TypeError("Code chapter fixtures must cover every profile exactly once in canonical order");
  }
  if (new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length) {
    throw new TypeError("Code chapter fixture ids must be unique");
  }
  const providerVariants = (input.manifest.provides.logical_units ?? []).find((unit) =>
    unit.id === "semantic-subject"
  )?.artifacts?.supported_policy_variants;
  if (providerVariants === undefined) {
    throw new TypeError("context-code-indexer must declare semantic-subject Artifact policy variants");
  }
  for (const fixture of fixtures) {
    const profile = input.profileContract.profiles.find((item) => item.id === fixture.profile);
    if (profile === undefined) throw new TypeError(`unknown chapter profile ${fixture.profile}`);
    const eligibility = resolveIndexerArtifactPolicyEligibility({
      profile_id: fixture.profile,
      canonical_facts: fixture.canonical_facts,
      provider_supported_variants: providerVariants,
      profile_contract: input.profileContract,
      operator_contract: input.operatorContract,
    });
    const variant = eligibility.eligible_variants.find((item) =>
      item.id === fixture.artifact_policy_variant
    );
    if (variant === undefined) {
      throw new TypeError(`chapter fixture ${fixture.id} selects an ineligible Bundle variant`);
    }
    if (![
      ...variant.required_artifact_kinds,
      ...variant.discretionary_artifact_kinds,
    ].includes(fixture.artifact_kind)) {
      throw new TypeError(`chapter fixture ${fixture.id} selects an unsupported Artifact kind`);
    }
    if (!profile.reader_question_contracts.some((question) =>
      question.ref === fixture.reader_question_ref
    )) {
      throw new TypeError(`chapter fixture ${fixture.id} references an unregistered reader question`);
    }
  }
  const variants = new Set(fixtures.map((fixture) => fixture.artifact_policy_variant));
  if (!["compact", "standard", "expanded"].every((variant) => variants.has(variant))) {
    throw new TypeError("Code chapter fixtures must exercise compact, standard, and expanded variants");
  }
}

export async function validateBundledIndexerCodeTemplateReferences(input: {
  source: string;
  manifest: IndexerProviderManifest;
}): Promise<void> {
  const templates = input.manifest.provider.templates ?? [];
  const composers = input.manifest.provides.composers ?? [];
  const markdownResources = [
    ...(input.manifest.provider.instructions ?? []).map((item) => item.path),
    ...templates.map((item) => item.path),
    ...composers.flatMap((item) =>
      item.contract === undefined ? [] : [item.contract.instruction]
    ),
    ...(input.manifest.customization?.guide === undefined
      ? []
      : [input.manifest.customization.guide]),
    ...(input.manifest.quality_guidance?.repair === undefined
      ? []
      : [input.manifest.quality_guidance.repair]),
  ];
  const resourcesByName = new Map<string, string>();
  for (const path of markdownResources) {
    if (extname(path) !== ".md") continue;
    const name = basename(path);
    const existing = resourcesByName.get(name);
    if (existing !== undefined && existing !== path) {
      throw new TypeError(
        `context-code-indexer Markdown resource basename is ambiguous: ${name}`,
      );
    }
    resourcesByName.set(name, path);
  }
  const selectableIds = new Set([
    ...input.manifest.provides.profiles,
    ...composers.map((item) => item.id),
  ]);

  for (const template of templates) {
    const content = await readFile(join(input.source, template.path), "utf8");
    for (const match of content.matchAll(MARKDOWN_RESOURCE_REFERENCE)) {
      const reference = match[1]!;
      if (!resourcesByName.has(reference)) {
        throw new TypeError(
          `${template.path} references unknown Markdown resource ${reference}`,
        );
      }
    }
    for (const match of content.matchAll(SELECTED_RESOURCE_REFERENCE)) {
      const reference = match[1]!;
      if (!selectableIds.has(reference)) {
        throw new TypeError(
          `${template.path} selects unregistered profile or composer ${reference}`,
        );
      }
    }
    for (const token of LEGACY_TEMPLATE_TOKENS) {
      if (content.includes(token)) {
        throw new TypeError(`${template.path} contains legacy template token ${token}`);
      }
    }
  }
}

export async function validateBundledIndexerPortableVocabulary(input: {
  source: string;
  paths: readonly string[];
}): Promise<void> {
  for (const path of input.paths) {
    if (!TEXT_EXTENSIONS.has(extname(path))) continue;
    const content = await readFile(join(input.source, path), "utf8");
    if (PORTABILITY_FORBIDDEN_LITERAL.test(content)) {
      throw new TypeError(`bundled Indexer runtime resource contains a non-portable private literal: ${path}`);
    }
  }
}
