import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IndexerProviderManifest } from "@c4a/context";
import { sensitiveSourceLiteralCandidates } from "./sensitiveSourceLiteral.js";

const EQUIVALENCE_RULES = [
  "evidence-first",
  "complete-evidence-read",
  "mixed-section-intents",
  "reuse-exact-subject",
  "independent-subject",
  "local-heading-stays-section",
  "navigation-only",
  "density-only-guides-reading",
  "duplicate-same-boundary",
  "conflicting-evidence",
  "source-backed-relation",
  "source-authored-uncertainty",
  "canonical-layout-identity",
  "layout-collision",
  "destructive-layout-change",
  "eligible-omission",
  "protected-knowledge-retention",
  "missing-input",
  "stale-recovery",
  "three-attempt-guidance",
] as const;

const AUTHORITIES = [
  "community-instructions",
  "context-layout",
  "context-revision",
] as const;

const CONTEXT_LAYOUT_RULES = new Set([
  "canonical-layout-identity",
  "layout-collision",
  "destructive-layout-change",
  "stale-recovery",
]);
const CONTEXT_REVISION_RULES = new Set(["three-attempt-guidance"]);
const NON_PORTABLE_SOURCE_LITERAL = /(?:https?:\/\/|ssh:\/\/|git@|\/Users\/|\/home\/[^/\s]+\/|[A-Za-z]:\\)/iu;

interface MigrationEquivalenceCase {
  id: string;
  rule_id: typeof EQUIVALENCE_RULES[number];
  authority: typeof AUTHORITIES[number];
  source_shape: string;
  expected_decision: string;
  forbidden_decision: string;
  recovery: string;
}

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

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
    throw new TypeError(`${label} must be a stable lower-case id`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length < 12) {
    throw new TypeError(`${label} must be descriptive text`);
  }
  return value;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${label} must be one of ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function parseCase(value: unknown): MigrationEquivalenceCase {
  const fixture = record(value, "Markdown migration-equivalence case");
  exactKeys(fixture, [
    "id",
    "rule_id",
    "authority",
    "source_shape",
    "expected_decision",
    "forbidden_decision",
    "recovery",
  ], "Markdown migration-equivalence case");
  const parsed = {
    id: id(fixture.id, "migration-equivalence case id"),
    rule_id: enumValue(fixture.rule_id, EQUIVALENCE_RULES, "migration-equivalence rule"),
    authority: enumValue(fixture.authority, AUTHORITIES, "migration-equivalence authority"),
    source_shape: text(fixture.source_shape, "migration-equivalence source_shape"),
    expected_decision: id(fixture.expected_decision, "expected_decision"),
    forbidden_decision: id(fixture.forbidden_decision, "forbidden_decision"),
    recovery: text(fixture.recovery, "migration-equivalence recovery"),
  };
  if (parsed.expected_decision === parsed.forbidden_decision) {
    throw new TypeError(`migration-equivalence case ${parsed.id} has no semantic contrast`);
  }
  const expectedAuthority = CONTEXT_LAYOUT_RULES.has(parsed.rule_id)
    ? "context-layout"
    : CONTEXT_REVISION_RULES.has(parsed.rule_id)
      ? "context-revision"
      : "community-instructions";
  if (parsed.authority !== expectedAuthority) {
    throw new TypeError(`migration-equivalence rule ${parsed.rule_id} has the wrong authority`);
  }
  const publishedText = `${parsed.source_shape}\n${parsed.recovery}`;
  if (sensitiveSourceLiteralCandidates(publishedText).length > 0) {
    throw new TypeError(`migration-equivalence case ${parsed.id} contains a sensitive literal`);
  }
  if (NON_PORTABLE_SOURCE_LITERAL.test(publishedText)) {
    throw new TypeError(`migration-equivalence case ${parsed.id} is not community-anonymous`);
  }
  return parsed;
}

function assertExactCoverage(actual: readonly string[], expected: readonly string[], label: string): void {
  if (
    actual.length !== expected.length
    || new Set(actual).size !== actual.length
    || actual.some((value, index) => value !== expected[index])
  ) {
    throw new TypeError(`${label} must be complete and canonically ordered`);
  }
}

async function validateSemanticPlanningInstruction(input: {
  source: string;
  expectedProfiles: readonly string[];
  manifest: IndexerProviderManifest;
}): Promise<string> {
  const path = "references/semantic-planning.md";
  const instruction = input.manifest.provider.instructions?.find((item) => item.path === path);
  if (
    instruction === undefined
    || instruction.profiles.length !== input.expectedProfiles.length
    || instruction.profiles.some((profile, index) => profile !== input.expectedProfiles[index])
  ) {
    throw new TypeError(`${path} must cover every Markdown profile in canonical order`);
  }
  const content = await readFile(join(input.source, path), "utf8");
  for (const anchor of [
    "Read every authorized evidence item",
    "reuse-existing",
    "create-independent",
    "request-material",
    "unsupported",
    "Titles and headings are evidence, not identity",
    "Relation and structured-claim gate",
    "Source-authored uncertainty",
    "Content-purpose precision",
    "three accepted revision",
    "do not invent aliases, slugs, collections",
  ]) {
    if (!content.includes(anchor)) {
      throw new TypeError(`Markdown semantic planning guidance misses ${anchor}`);
    }
  }
  if (/\b(?:collection|output_path|knowledge)\s*:/u.test(content)) {
    throw new TypeError("Markdown semantic planning guidance must not declare storage authority");
  }
  return content;
}

export async function validateBundledIndexerMarkdownMigrationFixtures(input: {
  source: string;
  expectedProfiles: readonly string[];
  manifest: IndexerProviderManifest;
}): Promise<void> {
  const guidance = await validateSemanticPlanningInstruction(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(
      join(input.source, "tests", "fixtures", "migration-equivalence.json"),
      "utf8",
    )) as unknown;
  } catch {
    throw new TypeError("context-markdown-indexer migration-equivalence fixture is invalid JSON");
  }
  const root = record(parsed, "Markdown migration-equivalence fixture set");
  exactKeys(root, ["protocol", "anonymized", "cases"], "Markdown migration-equivalence fixture set");
  if (
    root.protocol !== "context.indexer.markdown-migration-equivalence-fixture-set/v1"
    || root.anonymized !== true
    || !Array.isArray(root.cases)
  ) {
    throw new TypeError("Markdown migration-equivalence fixture protocol or anonymity is invalid");
  }
  const cases = root.cases.map(parseCase);
  assertExactCoverage(
    cases.map((fixture) => fixture.rule_id),
    EQUIVALENCE_RULES,
    "Markdown migration-equivalence rules",
  );
  if (new Set(cases.map((fixture) => fixture.id)).size !== cases.length) {
    throw new TypeError("Markdown migration-equivalence fixture ids must be unique");
  }
  for (const required of [
    "evidence",
    "subject",
    "Section",
    "claim",
    "duplicate",
    "conflict",
    "stale",
  ]) {
    if (!guidance.includes(required)) {
      throw new TypeError(`Markdown semantic planning guidance misses ${required}`);
    }
  }
}
