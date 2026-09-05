import { posix } from "node:path";
import {
  canonicalIndexerInventoryMembers,
  indexerProtocolDigest,
  type IndexerInventoryMember,
  type IndexerInventoryMemberKind,
  type IndexerParserFact,
  type IndexerParserFactView,
  type IndexerProfileContractEntry,
} from "@c4a/context";

export type IndexerConsumerFactRole = "consumer-anchor" | "supporting-fact";

export interface IndexerConsumerFactProjection {
  fact_ref: string;
  role: IndexerConsumerFactRole;
}

export interface IndexerConsumerWorksetProjection {
  family_key: string;
  unresolved: boolean;
  fact_items: IndexerConsumerFactProjection[];
  file_refs: string[];
}

export interface IndexerConsumerInventoryShard {
  inventory: IndexerInventoryMember[];
  projection: IndexerConsumerWorksetProjection;
  question_carrier_score: number;
}

export interface IndexerCapturedDocumentInventoryItem {
  member: IndexerInventoryMember;
  path: string;
}

interface IndexerConsumerPlanningContract {
  inventory_domain_id: string;
  inventory_selector: "all-inventory";
  strategy: "canonical-semantic-subject" | "public-target-family" | "provider-defined";
}

const DIRECT_ANCHOR_KINDS: Readonly<Record<string, IndexerInventoryMemberKind>> = {
  component: "component",
  "contract-endpoint": "route",
  "contract-operation": "protocol-method",
  "contract-type": "entry",
  entry: "entry",
  handler: "handler",
  "mdx-esm-export": "entry",
  method: "method",
  "protocol-service": "service",
  "protocol-method": "protocol-method",
  "protocol-type": "entry",
  route: "route",
  "rush-project": "project",
  "rush-subspace": "project",
  "rush-workspace": "project",
  service: "service",
  "sql-object": "store",
  "style-component-candidate": "component",
  "style-token": "entry",
  store: "store",
};

const FAMILY_CONTAINERS = new Set([
  "adapters",
  "commands",
  "components",
  "consumers",
  "features",
  "handlers",
  "jobs",
  "modules",
  "plugins",
  "repositories",
  "routes",
  "services",
]);

const SOURCE_ROOT_SEGMENTS = new Set(["app", "lib", "source", "sources", "src"]);
const CONSUMER_MANIFEST_NAMES = new Set([
  "build.gradle",
  "cargo.toml",
  "composer.json",
  "gemfile",
  "go.mod",
  "package.json",
  "pom.xml",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "rush.json",
  "settings.gradle",
]);
const GENERATED_SEGMENTS = new Set([
  ".generated",
  "_generated",
  "build",
  "coverage",
  "dist",
  "generated",
  "vendor",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textField(value: unknown, field: string): string | null {
  const candidate = record(value)?.[field];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function normalizedPathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function isTestOrStoryPath(path: string): boolean {
  const lower = path.toLocaleLowerCase("en-US");
  return /(^|\/)(__mocks__|__tests__|examples?|fixtures?|test|tests|stories|story)(\/|$)/u
    .test(lower) ||
    /\.(spec|test|stories|story)\.[^/]+$/u.test(lower);
}

function isGeneratedPath(path: string): boolean {
  return normalizedPathSegments(path).some((segment) =>
    GENERATED_SEGMENTS.has(segment.toLocaleLowerCase("en-US"))
  );
}

function isSupportingOnlyPath(path: string): boolean {
  return isGeneratedPath(path) || isTestOrStoryPath(path);
}

function isConsumerManifestPath(path: string): boolean {
  return CONSUMER_MANIFEST_NAMES.has(posix.basename(path).toLocaleLowerCase("en-US"));
}

function hasUnresolvedConsumerMaterial(file: IndexerParserFactView["files"][number]): boolean {
  if (file.disposition === "unsupported") return true;
  if (
    file.disposition !== "analyzed" ||
    isSupportingOnlyPath(file.normalized_path)
  ) {
    return false;
  }
  return file.facts.length === 0 || file.facts.some((fact) =>
    !explicitlyPrivate(fact.payload)
  );
}

function publicVisibility(value: unknown): boolean {
  const visibility = textField(value, "visibility");
  return visibility === "exported" || visibility === "public";
}

function explicitlyPrivate(value: unknown): boolean {
  const visibility = textField(value, "visibility");
  return visibility === "internal" || visibility === "private";
}

function anchorMemberKind(fact: IndexerParserFact): IndexerInventoryMemberKind | null {
  if (explicitlyPrivate(fact.payload)) return null;
  const direct = DIRECT_ANCHOR_KINDS[fact.kind];
  if (direct !== undefined) return direct;
  if (
    fact.denominator === "protocol-item" &&
    (fact.kind.includes("operation") || fact.kind.includes("protocol"))
  ) {
    return "protocol-method";
  }
  if (
    fact.denominator === "symbol" &&
    (publicVisibility(fact.payload) || fact.kind === "exported-symbol")
  ) {
    return textField(fact.payload, "kind") === "component" ? "component" : "entry";
  }
  return null;
}

function pathWithoutExtension(path: string): string {
  return path.replace(/\.[^./]+$/u, "");
}

function canonicalPathFamily(path: string): string {
  const original = normalizedPathSegments(path);
  const generatedIndex = original.findIndex((segment) =>
    GENERATED_SEGMENTS.has(segment.toLocaleLowerCase("en-US"))
  );
  const segments = generatedIndex < 0 ? original : original.slice(0, generatedIndex);
  const directorySegments = generatedIndex < 0 ? segments.slice(0, -1) : segments;
  const packagesIndex = directorySegments.indexOf("packages");
  if (packagesIndex >= 0 && directorySegments[packagesIndex + 1] !== undefined) {
    const packageRoot = directorySegments.slice(packagesIndex, packagesIndex + 2);
    const nestedContainerIndex = directorySegments.findIndex((segment, index) =>
      index > packagesIndex + 1 && FAMILY_CONTAINERS.has(segment)
    );
    if (
      nestedContainerIndex >= 0 &&
      directorySegments[nestedContainerIndex + 1] !== undefined
    ) {
      return [...packageRoot, ...directorySegments.slice(
        nestedContainerIndex,
        nestedContainerIndex + 2,
      )].join("/");
    }
    return packageRoot.join("/");
  }
  const containerIndex = directorySegments.findIndex((segment) =>
    FAMILY_CONTAINERS.has(segment)
  );
  if (containerIndex >= 0 && directorySegments[containerIndex + 1] !== undefined) {
    return directorySegments.slice(containerIndex, containerIndex + 2).join("/");
  }
  const meaningful = directorySegments.filter((segment) => !SOURCE_ROOT_SEGMENTS.has(segment));
  if (meaningful[0] !== undefined) return meaningful[0];
  const fileName = segments.at(-1) ?? original.at(-1) ?? "public-api";
  const stem = posix.basename(pathWithoutExtension(fileName));
  return stem === "index" || stem.length === 0 ? "public-api" : stem;
}

function semanticSubjectFamily(fact: IndexerParserFact): string | null {
  if (fact.kind === "code-symbol" || fact.kind === "exported-symbol") return null;
  const payload = record(fact.payload);
  if (fact.kind === "contract-endpoint" || fact.kind === "contract-operation") {
    const contractBoundary = fact.kind === "contract-endpoint"
      ? textField(payload, "path_or_type")
      : textField(payload, "parent");
    if (contractBoundary !== null) return `contract:${contractBoundary}`;
  }
  if (fact.kind === "protocol-service" || fact.kind === "protocol-method") {
    const protocolBoundary = fact.kind === "protocol-service"
      ? textField(payload, "name")
      : textField(payload, "service");
    if (protocolBoundary !== null) return `protocol:${protocolBoundary}`;
  }
  const declaredFamily = [
    textField(payload, "parent"),
    textField(payload, "service"),
    textField(payload, "package_name"),
    textField(payload, "project_name"),
    textField(payload, "name"),
  ].find((value) => value !== null);
  if (declaredFamily !== undefined) {
    const familyKind = fact.kind === "contract-operation" || fact.kind === "contract-type"
      ? "contract"
      : fact.kind;
    return `${familyKind}:${declaredFamily}`;
  }
  const qualified = fact.locator.qualified_item_path.replace(/@\d+$/u, "");
  const root = qualified.split(/(?:\/|\.)method:/u)[0]?.trim();
  if (root === undefined || root.length === 0) return null;
  return `${fact.kind}:${root}`;
}

function familyKey(input: {
  fact: IndexerParserFact;
  strategyId: string;
}): string {
  if (input.strategyId === "canonical-semantic-subject") {
    const semantic = semanticSubjectFamily(input.fact);
    if (semantic !== null) return semantic;
  }
  return canonicalPathFamily(input.fact.locator.normalized_path);
}

function canonicalFactItems(
  values: readonly IndexerConsumerFactProjection[],
): IndexerConsumerFactProjection[] {
  return [...values].sort((left, right) => left.fact_ref.localeCompare(right.fact_ref));
}

function canonicalFileRefs(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Keeps document capture bounded without deciding its reader-facing topic.
 * Each document is an independently recoverable Partition input; the existing
 * batch planner packs several inputs into one Agent call, and global Subject
 * convergence later merges documents that describe the same reader subject.
 */
export function planCapturedDocumentInventoryShards(
  items: readonly IndexerCapturedDocumentInventoryItem[],
): IndexerConsumerInventoryShard[] {
  return [...items]
    .sort((left, right) =>
      left.path.localeCompare(right.path) ||
      left.member.member_id.localeCompare(right.member.member_id)
    )
    .map((item) => {
      if (item.member.member_kind !== "document") {
        throw new TypeError("captured document planning requires document inventory members");
      }
      return {
        inventory: [item.member],
        projection: {
          family_key: `document-input:${item.path}`,
          unresolved: true,
          fact_items: [],
          file_refs: [],
        },
        question_carrier_score: 1,
      };
    });
}

function compileConsumerPlanningContract(
  profile: IndexerProfileContractEntry,
  strategyId: string,
): IndexerConsumerPlanningContract {
  const inventoryDomain = profile.inventory_domains.find((domain) =>
    domain.selector.operator === "all-inventory"
  );
  if (inventoryDomain === undefined) {
    throw new TypeError(
      `profile ${profile.id} cannot plan consumer worksets without an all-inventory domain`,
    );
  }
  return {
    inventory_domain_id: inventoryDomain.id,
    inventory_selector: "all-inventory",
    strategy: strategyId === "canonical-semantic-subject" ||
        strategyId === "public-target-family"
      ? strategyId
      : "provider-defined",
  };
}

function providerDefinedInventoryShard(input: {
  factView: IndexerParserFactView;
}): IndexerConsumerInventoryShard[] {
  const visibleFiles = input.factView.files.filter((file) =>
    file.disposition !== "excluded" && !isGeneratedPath(file.normalized_path)
  );
  const anchors = visibleFiles.flatMap((file) =>
    isTestOrStoryPath(file.normalized_path)
      ? []
      : file.facts.flatMap((fact) => {
          const memberKind = anchorMemberKind(fact);
          return memberKind === null
            ? []
            : [{ fact, member: { member_id: fact.fact_ref, member_kind: memberKind } }];
        })
  );
  const inventory = canonicalIndexerInventoryMembers([
    ...anchors.map(({ member }) => member),
    ...visibleFiles
      .filter((file) => file.disposition === "unsupported")
      .map((file) => ({ member_id: file.file_ref, member_kind: "entry" as const })),
  ]);
  const anchorRefs = new Set(anchors.map(({ fact }) => fact.fact_ref));
  const factItems = canonicalFactItems(visibleFiles.flatMap((file) =>
    file.facts.map((fact) => ({
      fact_ref: fact.fact_ref,
      role: anchorRefs.has(fact.fact_ref)
        ? "consumer-anchor" as const
        : "supporting-fact" as const,
    }))
  ));
  if (inventory.length === 0 && factItems.length === 0 && visibleFiles.length === 0) {
    return [];
  }
  return [{
    inventory,
    projection: {
      family_key: `provider-defined:${indexerProtocolDigest({
        source_ref: input.factView.authorized_scope.source_ref,
        module_refs: input.factView.authorized_scope.module_refs,
        inventory_digest: input.factView.inventory_digest,
      })}`,
      unresolved: true,
      fact_items: factItems,
      file_refs: canonicalFileRefs(visibleFiles.map((file) => file.file_ref)),
    },
    question_carrier_score: anchors.length,
  }];
}

function unresolvedInventoryShard(input: {
  factView: IndexerParserFactView;
  files: IndexerParserFactView["files"];
  includePrivate: boolean;
}): IndexerConsumerInventoryShard | null {
  const factItems = input.files.flatMap((file) => {
    if (file.disposition !== "analyzed" || isGeneratedPath(file.normalized_path)) return [];
    return file.facts
      .filter((fact) => input.includePrivate || !explicitlyPrivate(fact.payload) ||
        isSupportingOnlyPath(file.normalized_path))
      .map((fact) => ({
        fact_ref: fact.fact_ref,
        role: "supporting-fact" as const,
      }));
  });
  const selectedFactRefs = new Set(factItems.map((item) => item.fact_ref));
  const visibleFiles = input.files.filter((file) =>
    file.disposition === "unsupported" ||
    (file.disposition === "analyzed" &&
      (input.includePrivate || !isGeneratedPath(file.normalized_path)) &&
      (input.includePrivate || file.facts.length === 0 ||
        file.facts.some((fact) => selectedFactRefs.has(fact.fact_ref))))
  );
  if (factItems.length === 0 && visibleFiles.length === 0) return null;
  const sourceRef = input.factView.authorized_scope.source_ref;
  return {
    inventory: canonicalIndexerInventoryMembers(visibleFiles.map((file) => ({
      member_id: file.file_ref,
      member_kind: "entry" as const,
    }))),
    projection: {
      family_key: `unresolved:${indexerProtocolDigest({
        source_ref: sourceRef,
        module_refs: input.factView.authorized_scope.module_refs,
      })}`,
      unresolved: true,
      fact_items: canonicalFactItems(factItems),
      file_refs: canonicalFileRefs(visibleFiles.map((file) => file.file_ref)),
    },
    question_carrier_score: input.includePrivate ? factItems.length : 0,
  };
}

export function validateIndexerConsumerWorksetProjection(input: {
  value: unknown;
  factView: IndexerParserFactView;
  inventory: readonly IndexerInventoryMember[];
}): IndexerConsumerWorksetProjection {
  const value = record(input.value);
  if (value === null || typeof value.family_key !== "string" || value.family_key.length === 0) {
    throw new TypeError("consumer workset projection requires a family_key");
  }
  if (typeof value.unresolved !== "boolean" || !Array.isArray(value.fact_items) ||
      !Array.isArray(value.file_refs)) {
    throw new TypeError("consumer workset projection shape is invalid");
  }
  const facts = new Map(input.factView.files.flatMap((file) =>
    file.facts.map((fact) => [fact.fact_ref, fact] as const)
  ));
  const files = new Set(input.factView.files.map((file) => file.file_ref));
  const factItems = value.fact_items.map((item) => {
    const candidate = record(item);
    if (
      candidate === null || typeof candidate.fact_ref !== "string" ||
      (candidate.role !== "consumer-anchor" && candidate.role !== "supporting-fact") ||
      !facts.has(candidate.fact_ref)
    ) {
      throw new TypeError("consumer workset projection contains an invalid Fact item");
    }
    return {
      fact_ref: candidate.fact_ref,
      role: candidate.role,
    } as IndexerConsumerFactProjection;
  });
  const fileRefs = value.file_refs.map((fileRef) => {
    if (typeof fileRef !== "string" || !files.has(fileRef)) {
      throw new TypeError("consumer workset projection contains an invalid file ref");
    }
    return fileRef;
  });
  const projection = {
    family_key: value.family_key,
    unresolved: value.unresolved,
    fact_items: canonicalFactItems(factItems),
    file_refs: canonicalFileRefs(fileRefs),
  };
  const inventoryIds = new Set(canonicalIndexerInventoryMembers(input.inventory)
    .map((member) => member.member_id));
  const anchorIds = new Set(projection.fact_items
    .filter((item) => item.role === "consumer-anchor")
    .map((item) => item.fact_ref));
  if (!projection.unresolved && [...inventoryIds].some((id) => !anchorIds.has(id))) {
    throw new TypeError("consumer workset inventory must be backed by projected anchors");
  }
  if (new Set(projection.fact_items.map((item) => item.fact_ref)).size !==
      projection.fact_items.length) {
    throw new TypeError("consumer workset projection contains duplicate Fact refs");
  }
  return projection;
}

export function planIndexerConsumerInventoryShards(input: {
  factView: IndexerParserFactView;
  profile: IndexerProfileContractEntry;
  strategyId: string;
}): IndexerConsumerInventoryShard[] {
  // The Provider contract owns the inventory denominator. Context only applies
  // generic, mechanically provable routing to that declared denominator.
  // Unknown or narrower domains must not silently fall back to path-based tasks.
  const contract = compileConsumerPlanningContract(input.profile, input.strategyId);
  if (contract.strategy === "provider-defined") {
    return providerDefinedInventoryShard({ factView: input.factView });
  }
  const anchorGroups = new Map<string, Array<{
    fact: IndexerParserFact;
    member: IndexerInventoryMember;
  }>>();
  for (const file of input.factView.files) {
    if (file.disposition !== "analyzed" || isSupportingOnlyPath(file.normalized_path)) continue;
    for (const fact of file.facts) {
      const memberKind = anchorMemberKind(fact);
      if (memberKind === null) continue;
      const key = familyKey({ fact, strategyId: input.strategyId });
      const group = anchorGroups.get(key) ?? [];
      group.push({ fact, member: { member_id: fact.fact_ref, member_kind: memberKind } });
      anchorGroups.set(key, group);
    }
  }
  if (anchorGroups.size === 0) {
    const readableFiles = input.factView.files.filter(hasUnresolvedConsumerMaterial);
    const unresolved = unresolvedInventoryShard({
      factView: input.factView,
      files: readableFiles,
      includePrivate: false,
    });
    return unresolved === null ? [] : [unresolved];
  }
  const anchorFamilyKeysByPath = new Map<string, Set<string>>();
  for (const [key, anchors] of anchorGroups) {
    for (const { fact } of anchors) {
      const keys = anchorFamilyKeysByPath.get(fact.locator.normalized_path) ?? new Set();
      keys.add(key);
      anchorFamilyKeysByPath.set(fact.locator.normalized_path, keys);
    }
  }
  const filesByFamily = new Map<string, typeof input.factView.files>();
  for (const file of input.factView.files) {
    if (file.disposition === "excluded") continue;
    if (isConsumerManifestPath(file.normalized_path)) {
      for (const key of anchorGroups.keys()) {
        const files = filesByFamily.get(key) ?? [];
        files.push(file);
        filesByFamily.set(key, files);
      }
      continue;
    }
    const directFamilies = anchorFamilyKeysByPath.get(file.normalized_path);
    const familyKeys = directFamilies === undefined
      ? [canonicalPathFamily(file.normalized_path)]
      : [...directFamilies];
    for (const key of familyKeys) {
      if (!anchorGroups.has(key)) continue;
      const files = filesByFamily.get(key) ?? [];
      files.push(file);
      filesByFamily.set(key, files);
    }
  }
  const assignedFileRefs = new Set([...filesByFamily.values()].flatMap((files) =>
    files.map((file) => file.file_ref)
  ));
  const unresolved = unresolvedInventoryShard({
    factView: input.factView,
    files: input.factView.files.filter((file) =>
      file.disposition !== "excluded" && !assignedFileRefs.has(file.file_ref)
    ),
    includePrivate: false,
  });
  const anchored = [...anchorGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, anchors]) => {
      const anchorRefs = new Set(anchors.map(({ fact }) => fact.fact_ref));
      const familyFiles = filesByFamily.get(key) ?? input.factView.files.filter((file) =>
        anchors.some(({ fact }) => fact.locator.normalized_path === file.normalized_path)
      );
      const factItems = familyFiles.flatMap((file) =>
        isGeneratedPath(file.normalized_path)
          ? []
          : file.facts.map((fact) => ({
              fact_ref: fact.fact_ref,
              role: anchorRefs.has(fact.fact_ref)
                ? "consumer-anchor" as const
                : "supporting-fact" as const,
            }))
      );
      for (const { fact } of anchors) {
        if (!factItems.some((item) => item.fact_ref === fact.fact_ref)) {
          factItems.push({ fact_ref: fact.fact_ref, role: "consumer-anchor" });
        }
      }
      const inventory = canonicalIndexerInventoryMembers(
        anchors.map(({ member }) => member),
      );
      return {
        inventory,
        projection: {
          family_key: key,
          unresolved: false,
          fact_items: canonicalFactItems(factItems),
          file_refs: canonicalFileRefs(familyFiles.map((file) => file.file_ref)),
        },
        question_carrier_score: anchors.length,
      };
    });
  return unresolved === null ? anchored : [...anchored, unresolved];
}
