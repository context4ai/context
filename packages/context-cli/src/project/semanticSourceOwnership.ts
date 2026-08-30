import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import YAML from "yaml";
import {
  BUNDLED_CODE_PROFILE_IDS,
  BUNDLED_MARKDOWN_PROFILE_IDS,
} from "./indexerBaseContractCatalog.js";
import {
  inspectMarkdownCliAuthorityInventory,
  type MarkdownCliAuthorityReport,
} from "./markdownCliAuthorityInventory.js";
import {
  findCanonicalQuestionDefinitionKeys,
  findCanonicalQuestionPayloads,
  type CanonicalQuestionPayloadFinding,
} from "./canonicalQuestionOwnership.js";

export { findCanonicalQuestionPayloads } from "./canonicalQuestionOwnership.js";

type Domain = "code" | "markdown";

interface OwnershipMap {
  schema: "context.semantic-source-ownership-map/v1";
  mode: "blocking";
  cli_authority_inventory: string;
  migration_matrices: Array<{ kind: Domain; path: string }>;
  legacy_inventory: Array<{
    kind: "file" | "directory";
    path: string;
    migration: Domain;
  }>;
  provider_bundles: Array<{ domain: Domain; path: string }>;
  owner_rules: SemanticOwnerRule[];
  blocking_prerequisites: {
    migration_disposition: "complete" | "pending";
    forward_fixtures: "complete" | "pending";
    phase_g_cutover: boolean;
  };
}

export interface SemanticOwnerRule {
  semantic_kind: string;
  canonical_owner: string;
  allowed_paths: string[];
  legacy_paths: string[];
}

export interface LegacySemanticSourceReport {
  source: string;
  migration: Domain;
  matrix_schema: string;
  source_digest: string;
  current_digest: string | null;
  digest_matches: boolean;
  semantic_unit_ids: string[];
  dispositions: string[];
  authorities: string[];
  targets: string[];
}

export interface AliasProfileFinding {
  bundle: string;
  profile: string;
  reason: "unknown-profile" | "duplicate-profile";
}

export interface SemanticSourceOwnershipReport {
  schema: "context.semantic-source-ownership-report/v1";
  mode: "blocking";
  owner_map_digest: string;
  owner_snapshot: SemanticOwnerRule[];
  blocking_prerequisites: OwnershipMap["blocking_prerequisites"];
  blocking_eligible: boolean;
  blocking_reasons: string[];
  cli_authority: MarkdownCliAuthorityReport;
  legacy_sources: LegacySemanticSourceReport[];
  duplicate_taxonomies: Array<{
    source: string;
    canonical_owner: string;
    dispositions: string[];
    targets: string[];
  }>;
  canonical_question_payloads: CanonicalQuestionPayloadFinding[];
  alias_profiles: AliasProfileFinding[];
  missing_canonical_profiles: Array<{ bundle: string; profile: string }>;
  undispositioned_sources: Array<{ source: string; migration: Domain }>;
  missing_migration_sources: string[];
  summary: {
    legacy_source_count: number;
    duplicate_taxonomy_count: number;
    canonical_question_payload_count: number;
    alias_profile_count: number;
    undispositioned_source_count: number;
    missing_migration_source_count: number;
    cli_authority_capability_count: number;
    cli_authority_issue_count: number;
  };
}

interface CodeMigrationMatrix {
  schema: string;
  semantic_source_ownership: SemanticSourceOwnershipBinding;
  items: Array<{
    source: string;
    source_digest: string;
    disposition: string;
    targets: string[];
    semantic_anchors?: string[];
  }>;
}

interface MarkdownMigrationMatrix {
  schema: string;
  semantic_source_ownership: SemanticSourceOwnershipBinding;
  sources: Array<{
    source: string;
    source_digest: string;
    blocks: Array<{
      id: string;
      disposition: string;
      authority: string;
      targets: string[];
    }>;
  }>;
}

interface SemanticSourceOwnershipBinding {
  path: string;
  digest: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON: ${String(error)}`);
  }
}

function assertOwnershipMap(value: OwnershipMap): void {
  if (value.schema !== "context.semantic-source-ownership-map/v1" || value.mode !== "blocking") {
    throw new TypeError("semantic source ownership map must use blocking v1");
  }
  if (value.migration_matrices.length !== 2 || value.provider_bundles.length !== 2) {
    throw new TypeError("semantic source ownership map must cover Code and Markdown exactly once");
  }
  if (new Set(value.owner_rules.map((rule) => rule.semantic_kind)).size !== value.owner_rules.length) {
    throw new TypeError("semantic source ownership rules must have unique semantic kinds");
  }
  if (value.blocking_prerequisites.migration_disposition !== "complete" ||
    value.blocking_prerequisites.forward_fixtures !== "complete") {
    throw new TypeError("blocking semantic source ownership requires complete migration and fixtures");
  }
}

function assertOwnershipBinding(input: {
  matrix: CodeMigrationMatrix | MarkdownMigrationMatrix;
  ownerMapPath: string;
  ownerMapDigest: string;
}): void {
  if (
    input.matrix.semantic_source_ownership?.path !== input.ownerMapPath ||
    input.matrix.semantic_source_ownership.digest !== input.ownerMapDigest
  ) {
    throw new TypeError(`${input.matrix.schema} is not bound to the current semantic owner map`);
  }
}

async function pathIsFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function repositoryPath(repositoryRoot: string, absolute: string): string {
  return relative(repositoryRoot, absolute).split(sep).join("/");
}

async function collectLegacyInventory(
  repositoryRoot: string,
  map: OwnershipMap,
): Promise<Array<{ source: string; migration: Domain }>> {
  const result: Array<{ source: string; migration: Domain }> = [];
  for (const item of map.legacy_inventory) {
    const absolute = join(repositoryRoot, item.path);
    if (item.kind === "file") {
      if (await pathIsFile(absolute)) result.push({ source: item.path, migration: item.migration });
      continue;
    }
    for (const file of await collectFiles(absolute)) {
      result.push({ source: repositoryPath(repositoryRoot, file), migration: item.migration });
    }
  }
  return result.sort((left, right) => compareText(left.source, right.source));
}

function codeMigrationSources(matrix: CodeMigrationMatrix): LegacySemanticSourceReport[] {
  return matrix.items.map((item) => ({
    source: item.source,
    migration: "code",
    matrix_schema: matrix.schema,
    source_digest: item.source_digest,
    current_digest: null,
    digest_matches: false,
    semantic_unit_ids: item.semantic_anchors ?? [],
    dispositions: [item.disposition],
    authorities: [],
    targets: unique(item.targets),
  }));
}

function markdownMigrationSources(matrix: MarkdownMigrationMatrix): LegacySemanticSourceReport[] {
  return matrix.sources.map((source) => ({
    source: source.source,
    migration: "markdown",
    matrix_schema: matrix.schema,
    source_digest: source.source_digest,
    current_digest: null,
    digest_matches: false,
    semantic_unit_ids: source.blocks.map((block) => block.id).sort(compareText),
    dispositions: unique(source.blocks.map((block) => block.disposition)),
    authorities: unique(source.blocks.map((block) => block.authority)),
    targets: unique(source.blocks.flatMap((block) => block.targets)),
  }));
}

function matchesPathRule(path: string, rule: string): boolean {
  return rule.endsWith("/**") ? path.startsWith(rule.slice(0, -2)) : path === rule;
}

export function findAliasProfiles(input: {
  bundle: string;
  actual: readonly string[];
  expected: readonly string[];
}): { aliases: AliasProfileFinding[]; missing: Array<{ bundle: string; profile: string }> } {
  const expected = new Set(input.expected);
  const seen = new Set<string>();
  const aliases: AliasProfileFinding[] = [];
  for (const profile of input.actual) {
    if (seen.has(profile)) {
      aliases.push({ bundle: input.bundle, profile, reason: "duplicate-profile" });
    } else if (!expected.has(profile)) {
      aliases.push({ bundle: input.bundle, profile, reason: "unknown-profile" });
    }
    seen.add(profile);
  }
  return {
    aliases,
    missing: input.expected
      .filter((profile) => !seen.has(profile))
      .map((profile) => ({ bundle: input.bundle, profile })),
  };
}

async function inspectProviderBundles(repositoryRoot: string, map: OwnershipMap): Promise<{
  canonicalQuestionPayloads: CanonicalQuestionPayloadFinding[];
  aliasProfiles: AliasProfileFinding[];
  missingProfiles: Array<{ bundle: string; profile: string }>;
}> {
  const canonicalQuestionPayloads: CanonicalQuestionPayloadFinding[] = [];
  const aliasProfiles: AliasProfileFinding[] = [];
  const missingProfiles: Array<{ bundle: string; profile: string }> = [];
  for (const bundle of map.provider_bundles) {
    canonicalQuestionPayloads.push(...await inspectCanonicalQuestionPayloadsInBundle({
      repositoryRoot,
      bundlePath: bundle.path,
    }));
    const root = join(repositoryRoot, bundle.path);
    const manifestPath = join(root, "context-indexer.yaml");
    const manifest = YAML.parse(await readFile(manifestPath, "utf8")) as {
      provides?: { profiles?: unknown };
    };
    const actual = Array.isArray(manifest.provides?.profiles)
      ? manifest.provides.profiles.filter((profile): profile is string => typeof profile === "string")
      : [];
    const expected = bundle.domain === "code"
      ? BUNDLED_CODE_PROFILE_IDS
      : BUNDLED_MARKDOWN_PROFILE_IDS;
    const profileResult = findAliasProfiles({ bundle: bundle.path, actual, expected });
    aliasProfiles.push(...profileResult.aliases);
    missingProfiles.push(...profileResult.missing);
  }
  return { canonicalQuestionPayloads, aliasProfiles, missingProfiles };
}

export async function inspectCanonicalQuestionPayloadsInBundle(input: {
  repositoryRoot: string;
  bundlePath: string;
}): Promise<CanonicalQuestionPayloadFinding[]> {
  const findings: CanonicalQuestionPayloadFinding[] = [];
  for (const absolute of await collectFiles(join(input.repositoryRoot, input.bundlePath))) {
    const extension = extname(absolute);
    const path = repositoryPath(input.repositoryRoot, absolute);
    const text = await readFile(absolute, "utf8");
    if ([".json", ".yaml", ".yml"].includes(extension)) {
      const parsed = extension === ".json"
        ? JSON.parse(text) as unknown
        : YAML.parse(text) as unknown;
      findings.push(...findCanonicalQuestionPayloads(path, parsed));
      continue;
    }
    const payloadKeys = findCanonicalQuestionDefinitionKeys(text);
    if (payloadKeys.length >= 3) {
      findings.push({ path, pointer: "$text", payload_keys: payloadKeys });
    }
  }
  return findings;
}

export async function buildSemanticSourceOwnershipReport(input: {
  repositoryRoot: string;
  ownerMapPath?: string;
}): Promise<SemanticSourceOwnershipReport> {
  const ownerMapPath = input.ownerMapPath ??
    "plugins/context/migrations/0.7.0-semantic-source-ownership.json";
  const ownerMapBytes = await readFile(join(input.repositoryRoot, ownerMapPath));
  const map = parseJson<OwnershipMap>(ownerMapBytes, ownerMapPath);
  assertOwnershipMap(map);
  const ownerMapDigest = sha256(ownerMapBytes);
  const migrationReports: LegacySemanticSourceReport[] = [];
  for (const matrixRef of map.migration_matrices) {
    const bytes = await readFile(join(input.repositoryRoot, matrixRef.path));
    if (matrixRef.kind === "code") {
      const matrix = parseJson<CodeMigrationMatrix>(bytes, matrixRef.path);
      assertOwnershipBinding({ matrix, ownerMapPath, ownerMapDigest });
      migrationReports.push(...codeMigrationSources(matrix));
    } else {
      const matrix = parseJson<MarkdownMigrationMatrix>(bytes, matrixRef.path);
      assertOwnershipBinding({ matrix, ownerMapPath, ownerMapDigest });
      migrationReports.push(...markdownMigrationSources(matrix));
    }
  }
  for (const source of migrationReports) {
    const absolute = join(input.repositoryRoot, source.source);
    if (await pathIsFile(absolute)) source.current_digest = sha256(await readFile(absolute));
    source.digest_matches = source.current_digest === source.source_digest;
  }
  migrationReports.sort((left, right) => compareText(left.source, right.source));
  const inventory = await collectLegacyInventory(input.repositoryRoot, map);
  const migrationBySource = new Map(migrationReports.map((source) => [source.source, source]));
  const undispositionedSources = inventory.filter((item) => !migrationBySource.has(item.source));
  const inventoryPaths = new Set(inventory.map((item) => item.source));
  const missingMigrationSources = migrationReports
    .filter((source) => !inventoryPaths.has(source.source) || source.current_digest === null)
    .map((source) => source.source);
  const taxonomyRule = map.owner_rules.find((rule) =>
    rule.semantic_kind === "profile-taxonomy-template-editorial"
  );
  if (taxonomyRule === undefined) throw new TypeError("owner map has no taxonomy owner rule");
  const duplicateTaxonomies = migrationReports
    .filter((source) => taxonomyRule.legacy_paths.some((rule) => matchesPathRule(source.source, rule)))
    .map((source) => ({
      source: source.source,
      canonical_owner: taxonomyRule.canonical_owner,
      dispositions: source.dispositions,
      targets: source.targets,
    }));
  const provider = await inspectProviderBundles(input.repositoryRoot, map);
  const cliAuthority = await inspectMarkdownCliAuthorityInventory({
    repositoryRoot: input.repositoryRoot,
    inventoryPath: map.cli_authority_inventory,
  });
  const blockingReasons = [
    ...(map.blocking_prerequisites.migration_disposition === "complete"
      ? [] : ["migration-disposition-not-complete"]),
    ...(map.blocking_prerequisites.forward_fixtures === "complete"
      ? [] : ["forward-fixtures-not-complete"]),
    ...(undispositionedSources.length === 0 ? [] : ["undispositioned-semantic-source"]),
    ...(missingMigrationSources.length === 0 ? [] : ["missing-or-stale-migration-source"]),
    ...(provider.canonicalQuestionPayloads.length === 0
      ? [] : ["canonical-question-payload-duplicate"]),
    ...(provider.aliasProfiles.length === 0 ? [] : ["profile-alias-drift"]),
    ...(provider.missingProfiles.length === 0 ? [] : ["canonical-profile-missing"]),
    ...(cliAuthority.issues.length === 0 ? [] : ["cli-authority-capability-drift"]),
    ...(map.blocking_prerequisites.phase_g_cutover && migrationReports.length > 0
      ? ["legacy-semantic-sources-retained-after-cutover"] : []),
  ];
  const summary = {
    legacy_source_count: migrationReports.length,
    duplicate_taxonomy_count: duplicateTaxonomies.length,
    canonical_question_payload_count: provider.canonicalQuestionPayloads.length,
    alias_profile_count: provider.aliasProfiles.length,
    undispositioned_source_count: undispositionedSources.length,
    missing_migration_source_count: missingMigrationSources.length,
    cli_authority_capability_count: cliAuthority.capabilities.length,
    cli_authority_issue_count: cliAuthority.issues.length,
  };
  return {
    schema: "context.semantic-source-ownership-report/v1",
    mode: "blocking",
    owner_map_digest: ownerMapDigest,
    owner_snapshot: map.owner_rules,
    blocking_prerequisites: map.blocking_prerequisites,
    blocking_eligible: blockingReasons.length === 0,
    blocking_reasons: unique(blockingReasons),
    cli_authority: cliAuthority,
    legacy_sources: migrationReports,
    duplicate_taxonomies: duplicateTaxonomies,
    canonical_question_payloads: provider.canonicalQuestionPayloads,
    alias_profiles: provider.aliasProfiles,
    missing_canonical_profiles: provider.missingProfiles,
    undispositioned_sources: undispositionedSources,
    missing_migration_sources: missingMigrationSources,
    summary,
  };
}

export async function assertSemanticSourceOwnership(input: {
  repositoryRoot: string;
  ownerMapPath?: string;
}): Promise<SemanticSourceOwnershipReport> {
  const report = await buildSemanticSourceOwnershipReport(input);
  if (!report.blocking_eligible) {
    throw new TypeError(
      `semantic source ownership is not release-safe: ${report.blocking_reasons.join(", ")}`,
    );
  }
  return report;
}
