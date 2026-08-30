import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveIndexerSectionCollection,
  type IndexerArtifactSectionProjection,
  type IndexerOperatorContract,
  type IndexerProfileContract,
  type IndexerProviderManifest,
} from "@c4a/context";

const DENSITY_MODES = ["macro", "meso", "micro", "single-pass"] as const;
const CANDIDATE_RESOLUTIONS = [
  "accept-correction",
  "dismiss-with-rationale",
  "keep-unresolved",
] as const;
const BOUNDARY_DECISIONS = [
  "promote-reader-artifact",
  "retain-section-group",
] as const;

interface MarkdownRoutingArtifact {
  artifact_id: string;
  artifact_kind: string;
  boundary_decision: typeof BOUNDARY_DECISIONS[number];
  sections: IndexerArtifactSectionProjection[];
}

interface MarkdownRoutingCase {
  id: string;
  profile: string;
  source_role: string;
  density_mode: typeof DENSITY_MODES[number];
  candidate_signal: string;
  candidate_resolution: typeof CANDIDATE_RESOLUTIONS[number];
  artifacts: MarkdownRoutingArtifact[];
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

function nonEmptyId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
    throw new TypeError(`${label} must be a stable lower-case id`);
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

function nonEmptyArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  return value;
}

function parseSection(value: unknown): IndexerArtifactSectionProjection {
  const section = record(value, "Markdown routing Section");
  exactKeys(section, [
    "section_key",
    "owner_indexer_id",
    "document_kind",
    "reader_goal",
    "artifact_kind",
  ], "Markdown routing Section");
  return {
    section_key: nonEmptyId(section.section_key, "section_key"),
    owner_indexer_id: nonEmptyId(section.owner_indexer_id, "owner_indexer_id"),
    document_kind: nonEmptyId(section.document_kind, "document_kind"),
    reader_goal: nonEmptyId(section.reader_goal, "reader_goal"),
    artifact_kind: nonEmptyId(section.artifact_kind, "artifact_kind"),
  };
}

function parseArtifact(value: unknown): MarkdownRoutingArtifact {
  const artifact = record(value, "Markdown routing Artifact");
  exactKeys(artifact, [
    "artifact_id",
    "artifact_kind",
    "boundary_decision",
    "sections",
  ], "Markdown routing Artifact");
  const sections = nonEmptyArray(artifact.sections, "Artifact sections").map(parseSection);
  if (new Set(sections.map((section) => section.section_key)).size !== sections.length) {
    throw new TypeError("Markdown routing Artifact Section keys must be unique");
  }
  const artifactKind = nonEmptyId(artifact.artifact_kind, "artifact_kind");
  if (sections.some((section) => section.artifact_kind !== artifactKind)) {
    throw new TypeError("Markdown routing Section artifact_kind must match its Artifact");
  }
  return {
    artifact_id: nonEmptyId(artifact.artifact_id, "artifact_id"),
    artifact_kind: artifactKind,
    boundary_decision: enumValue(
      artifact.boundary_decision,
      BOUNDARY_DECISIONS,
      "boundary_decision",
    ),
    sections,
  };
}

function parseCase(value: unknown): MarkdownRoutingCase {
  const fixture = record(value, "Markdown routing case");
  exactKeys(fixture, [
    "id",
    "profile",
    "source_role",
    "density_mode",
    "candidate_signal",
    "candidate_resolution",
    "artifacts",
  ], "Markdown routing case");
  const artifacts = nonEmptyArray(fixture.artifacts, "routing artifacts").map(parseArtifact);
  if (new Set(artifacts.map((artifact) => artifact.artifact_id)).size !== artifacts.length) {
    throw new TypeError("Markdown routing Artifact ids must be unique within a case");
  }
  if (typeof fixture.candidate_signal !== "string" || fixture.candidate_signal.length === 0) {
    throw new TypeError("candidate_signal must be non-empty");
  }
  return {
    id: nonEmptyId(fixture.id, "routing case id"),
    profile: nonEmptyId(fixture.profile, "routing profile"),
    source_role: nonEmptyId(fixture.source_role, "routing source role"),
    density_mode: enumValue(fixture.density_mode, DENSITY_MODES, "density_mode"),
    candidate_signal: fixture.candidate_signal,
    candidate_resolution: enumValue(
      fixture.candidate_resolution,
      CANDIDATE_RESOLUTIONS,
      "candidate_resolution",
    ),
    artifacts,
  };
}

function assertExactCoverage(
  actual: ReadonlySet<string>,
  expected: readonly string[],
  label: string,
): void {
  if (actual.size !== expected.length || expected.some((value) => !actual.has(value))) {
    throw new TypeError(`${label} must cover ${expected.join(", ")}`);
  }
}

async function validateSemanticInstructionCoverage(input: {
  source: string;
  expectedProfiles: readonly string[];
  manifest: IndexerProviderManifest;
  profileContract: IndexerProfileContract;
}): Promise<void> {
  const paths = ["references/classification.md", "references/structure-and-artifacts.md"];
  const instructions = input.manifest.provider.instructions;
  if (instructions === undefined) {
    throw new TypeError("context-markdown-indexer must declare semantic instructions");
  }
  for (const path of paths) {
    const instruction = instructions.find((item) => item.path === path);
    if (
      instruction === undefined
      || instruction.profiles.length !== input.expectedProfiles.length
      || instruction.profiles.some((profile, index) => profile !== input.expectedProfiles[index])
    ) {
      throw new TypeError(`${path} must cover every Markdown profile in canonical order`);
    }
  }
  const contents = await Promise.all(paths.map((path) =>
    readFile(join(input.source, path), "utf8")
  ));
  const classification = contents[0];
  const structure = contents[1];
  if (classification === undefined || structure === undefined) {
    throw new TypeError("Markdown semantic instruction files are incomplete");
  }
  const markdownProfiles = input.profileContract.profiles.filter((profile) =>
    input.expectedProfiles.includes(profile.id)
  );
  for (const mapping of markdownProfiles.flatMap((profile) => profile.layout_mappings)) {
    if (
      !classification.includes(`\`${mapping.document_kind}\``)
      || !classification.includes(`\`${mapping.reader_goal}\``)
    ) {
      throw new TypeError("Markdown classification guidance misses a registered projection intent");
    }
  }
  for (const anchor of [
    ...DENSITY_MODES,
    ...CANDIDATE_RESOLUTIONS,
    ...BOUNDARY_DECISIONS,
  ]) {
    if (!structure.includes(`\`${anchor}\``)) {
      throw new TypeError(`Markdown structure guidance misses semantic anchor ${anchor}`);
    }
  }
  if (/\b(?:collection|output_path|knowledge)\s*:/u.test(`${classification}\n${structure}`)) {
    throw new TypeError("Markdown semantic guidance must not declare a collection or output path");
  }
}

export async function validateBundledIndexerMarkdownRoutingFixtures(input: {
  source: string;
  expectedProfiles: readonly string[];
  manifest: IndexerProviderManifest;
  profileContract: IndexerProfileContract;
  operatorContract: IndexerOperatorContract;
}): Promise<void> {
  await validateSemanticInstructionCoverage(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(
      join(input.source, "tests", "fixtures", "routing.json"),
      "utf8",
    )) as unknown;
  } catch {
    throw new TypeError("context-markdown-indexer routing fixture catalog is invalid JSON");
  }
  const root = record(parsed, "Markdown routing fixture set");
  exactKeys(root, ["protocol", "anonymized", "cases"], "Markdown routing fixture set");
  if (
    root.protocol !== "context.indexer.markdown-routing-fixture-set/v1"
    || root.anonymized !== true
  ) {
    throw new TypeError("Markdown routing fixture set protocol or anonymity is invalid");
  }
  const cases = nonEmptyArray(root.cases, "Markdown routing cases").map(parseCase);
  if (new Set(cases.map((fixture) => fixture.id)).size !== cases.length) {
    throw new TypeError("Markdown routing case ids must be unique");
  }
  assertExactCoverage(new Set(cases.map((fixture) => fixture.density_mode)), DENSITY_MODES, "density fixtures");
  assertExactCoverage(
    new Set(cases.map((fixture) => fixture.candidate_resolution)),
    CANDIDATE_RESOLUTIONS,
    "candidate-resolution fixtures",
  );
  assertExactCoverage(
    new Set(cases.flatMap((fixture) => fixture.artifacts.map((artifact) =>
      artifact.boundary_decision
    ))),
    BOUNDARY_DECISIONS,
    "Artifact/Section boundary fixtures",
  );
  const manifestRoles = new Set(input.manifest.provides.source_roles ?? []);
  let mixedCollectionCase = false;
  let retainedMultiSectionGroup = false;
  for (const fixture of cases) {
    if (!input.expectedProfiles.includes(fixture.profile)) {
      throw new TypeError(`routing fixture uses unknown Markdown profile ${fixture.profile}`);
    }
    if (!manifestRoles.has(fixture.source_role)) {
      throw new TypeError(`routing fixture uses unsupported source role ${fixture.source_role}`);
    }
    const caseCollections = new Set<string>();
    for (const artifact of fixture.artifacts) {
      const artifactCollections = new Set(artifact.sections.map((projection) =>
        resolveIndexerSectionCollection({
          profile: fixture.profile,
          source_role: fixture.source_role,
          projection,
          profile_contract: input.profileContract,
          operator_contract: input.operatorContract,
        }).collection
      ));
      if (artifactCollections.size !== 1) {
        throw new TypeError(`routing fixture Artifact ${artifact.artifact_id} crosses collections`);
      }
      caseCollections.add([...artifactCollections][0]!);
      retainedMultiSectionGroup ||= artifact.boundary_decision === "retain-section-group"
        && artifact.sections.length > 1;
    }
    mixedCollectionCase ||= caseCollections.size > 1 && fixture.artifacts.length > 1;
  }
  if (!mixedCollectionCase) {
    throw new TypeError("Markdown routing fixtures must exercise a mixed multi-collection document");
  }
  if (!retainedMultiSectionGroup) {
    throw new TypeError("Markdown routing fixtures must keep a local heading as a Section");
  }
}
