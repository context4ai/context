import { createHash } from "node:crypto";
import {
  lstat,
  readdir,
  readFile,
  realpath,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  buildIndexerCustomizationPlan,
  indexerProtocolDigest,
  validateIndexerCustomizationPlan,
  type IndexerCustomizationPlan,
  type IndexerProviderManifest,
  type IndexerRegistryEntry,
} from "@c4a/context";
import { assertNoCanonicalQuestionDefinition } from "./canonicalQuestionOwnership.js";

const MAX_CUSTOMIZATION_FILE_BYTES = 1024 * 1024;
const MAX_CUSTOMIZATION_TOTAL_BYTES = 4 * 1024 * 1024;
const ORIGIN_RE = /^(?:\/\/|<!--)\s*@context-indexer-origin\s+([a-z0-9][a-z0-9._/-]*)@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?\s+profile=([a-z0-9][a-z0-9._/-]*)\s*(?:-->)?$/u;

type CustomizationMode = "none" | "extend" | "replace";
type CustomizationCapability =
  | "instructions-append"
  | "template-override"
  | "program-extend";

export interface IndexerCustomizationCapabilityGap {
  protocol: "context.indexer.customization-capability-gap/v1";
  project_ref: string;
  indexer_id: string;
  provider_integrity: string;
  gap_digest: string;
  extend_insufficient: true;
}

export interface IndexerCustomizationFile {
  path: string;
  digest: string;
  byte_length: number;
  capability: CustomizationCapability;
  origin: {
    skill: string;
    version: string;
    profile: string;
  };
  upstream_state: "current" | "origin-version-differs";
}

export interface IndexerCustomizationView {
  protocol: "context.indexer.customization-view/v1";
  indexer_id: string;
  mode: CustomizationMode;
  provider: {
    skill: string;
    version: string;
    integrity: string;
  };
  files: IndexerCustomizationFile[];
  plan: IndexerCustomizationPlan;
  upstream_review_required: boolean;
  fingerprint: string;
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function portablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function collectCustomizationFiles(root: string, path = root): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : 1)) {
    const absolute = join(path, entry.name);
    const status = await lstat(absolute);
    if (status.isSymbolicLink()) {
      throw new TypeError(`Indexer customization must not contain symlinks: ${portablePath(root, absolute)}`);
    }
    if (status.isDirectory()) {
      files.push(...await collectCustomizationFiles(root, absolute));
      continue;
    }
    if (!status.isFile()) {
      throw new TypeError(`Indexer customization contains a non-file entry: ${portablePath(root, absolute)}`);
    }
    files.push(absolute);
  }
  return files.sort((left, right) => {
    const leftPath = portablePath(root, left);
    const rightPath = portablePath(root, right);
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
}

function requiredCapability(path: string): CustomizationCapability {
  if (path === "instructions.md") return "instructions-append";
  if (/^templates\/[a-z0-9][a-z0-9._-]*\.md$/u.test(path)) return "template-override";
  if (path === "index.ts" || path === "variables.ts" || path === "helpers.ts") {
    return "program-extend";
  }
  throw new TypeError(`Indexer customization contains an unsupported path: ${path}`);
}

function parseOrigin(source: string, path: string): IndexerCustomizationFile["origin"] {
  const firstLine = source.split(/\r?\n/u, 1)[0] ?? "";
  const match = ORIGIN_RE.exec(firstLine);
  if (match === null) {
    throw new TypeError(`${path} must start with one @context-indexer-origin comment`);
  }
  return {
    skill: match[1]!,
    version: [match[2], match[3], match[4]].join(".") +
      (match[5] === undefined ? "" : `-${match[5]}`) +
      (match[6] === undefined ? "" : `+${match[6]}`),
    profile: match[7]!,
  };
}

function activeProfiles(indexer: IndexerRegistryEntry): Set<string> {
  return new Set([
    indexer.profile.primary.id,
    ...(indexer.profile.additional ?? []).map((profile) => profile.id),
  ]);
}

function validateTemplateOverride(input: {
  path: string;
  profile: string;
  manifest: IndexerProviderManifest;
}): void {
  if (!input.path.startsWith("templates/")) return;
  const id = input.path.slice("templates/".length, -".md".length);
  const match = (input.manifest.provider.templates ?? []).filter((template) =>
    template.id === id && template.profile === input.profile
  );
  if (match.length !== 1) {
    throw new TypeError(
      `${input.path} must override exactly one Provider template id/profile pair`,
    );
  }
}

function validateReplaceGap(input: {
  mode: CustomizationMode;
  gap: IndexerCustomizationCapabilityGap | undefined;
  projectRef: string;
  indexerId: string;
  providerIntegrity: string;
}): void {
  if (input.mode !== "replace") return;
  const gap = input.gap;
  if (
    gap?.protocol !== "context.indexer.customization-capability-gap/v1" ||
    gap.project_ref !== input.projectRef ||
    gap.indexer_id !== input.indexerId ||
    gap.provider_integrity !== input.providerIntegrity ||
    gap.extend_insufficient !== true ||
    !/^sha256:[a-f0-9]{64}$/u.test(gap.gap_digest)
  ) {
    throw new TypeError("replace customization requires an exact current capability-gap proof");
  }
}

function customizationFingerprint(
  value: Omit<IndexerCustomizationView, "fingerprint" | "upstream_review_required">,
): string {
  return indexerProtocolDigest({
    protocol: value.protocol,
    indexer_id: value.indexer_id,
    mode: value.mode,
    provider: value.provider,
    files: value.files,
    plan_digest: value.plan.plan_digest,
  });
}

function resolveCustomizationPlan(input: {
  declared: IndexerCustomizationPlan | undefined;
  mode: CustomizationMode;
  projectRef: string;
  indexer: IndexerRegistryEntry;
  providerIntegrity: string;
  files: readonly IndexerCustomizationFile[];
}): IndexerCustomizationPlan {
  if (input.mode === "none") {
    const primary = input.indexer.providers.find((provider) => provider.role === "primary")!;
    const hasConfig = Object.keys(primary.config ?? {}).length > 0;
    if (hasConfig) {
      const configSelectionDigest = indexerProtocolDigest({
        indexer_id: input.indexer.id,
        provider_id: primary.id,
        provider_integrity: input.providerIntegrity,
        config: primary.config ?? {},
      });
      const plan = input.declared === undefined
        ? buildIndexerCustomizationPlan({
            project_ref: input.projectRef,
            indexer_id: input.indexer.id,
            provider_integrity: input.providerIntegrity,
            capability_gap_digest: configSelectionDigest,
            selected_step: "config",
            rejected_smaller_steps: [{
              step: "provider-only",
              disposition: "insufficient",
              reason_code: "provider-config-selected",
              evidence_digest: configSelectionDigest,
            }],
            affected_scope_refs: input.indexer.read_scope.refs,
            introduces_external_dependencies: false,
          })
        : validateIndexerCustomizationPlan(input.declared);
      if (
        plan.project_ref !== input.projectRef ||
        plan.indexer_id !== input.indexer.id ||
        plan.provider_integrity !== input.providerIntegrity ||
        plan.workspace_mode !== "registry-only" ||
        plan.selected_step !== "config"
      ) {
        throw new TypeError("config customization plan does not match the selected Provider");
      }
      return plan;
    }
    if (input.declared !== undefined) {
      throw new TypeError("Provider-only selection must not supply an escalation plan");
    }
    return buildIndexerCustomizationPlan({
      project_ref: input.projectRef,
      indexer_id: input.indexer.id,
      provider_integrity: input.providerIntegrity,
      capability_gap_digest: null,
      selected_step: "provider-only",
      rejected_smaller_steps: [],
      affected_scope_refs: input.indexer.read_scope.refs,
      introduces_external_dependencies: false,
    });
  }
  if (input.declared === undefined) {
    throw new TypeError("customized Indexer requires a minimal customization ladder plan");
  }
  const plan = validateIndexerCustomizationPlan(input.declared);
  const expectedStep = input.mode === "replace"
    ? "replace"
    : input.files.some((file) => file.capability === "program-extend")
      ? "program-extend"
      : input.files.some((file) => file.capability === "template-override")
        ? "template-override"
        : "instructions-append";
  if (
    plan.project_ref !== input.projectRef ||
    plan.indexer_id !== input.indexer.id ||
    plan.provider_integrity !== input.providerIntegrity ||
    plan.workspace_mode !== input.mode ||
    plan.selected_step !== expectedStep
  ) {
    throw new TypeError("customization ladder plan does not match the loaded workspace state");
  }
  return plan;
}

async function statusIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (missing) return undefined;
    throw error;
  }
}

async function loadDeclaredCustomizationFiles(input: {
  paths: readonly string[];
  customizationRoot: string;
  primarySkill: string;
  primaryVersion: string;
  profiles: ReadonlySet<string>;
  supports: ReadonlySet<string>;
  manifest: IndexerProviderManifest;
}): Promise<IndexerCustomizationFile[]> {
  const files: IndexerCustomizationFile[] = [];
  let totalBytes = 0;
  for (const absolute of input.paths) {
    const path = portablePath(input.customizationRoot, absolute);
    const capability = requiredCapability(path);
    if (!input.supports.has(capability)) {
      throw new TypeError(`Provider does not support customization capability ${capability}`);
    }
    const bytes = await readFile(absolute);
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > MAX_CUSTOMIZATION_FILE_BYTES || totalBytes > MAX_CUSTOMIZATION_TOTAL_BYTES) {
      throw new TypeError("Indexer customization exceeds its fixed byte budget");
    }
    if (bytes.includes(0)) throw new TypeError(`${path} must be a UTF-8 text file`);
    const source = bytes.toString("utf8");
    assertNoCanonicalQuestionDefinition(path, source);
    const origin = parseOrigin(source, path);
    if (origin.skill !== input.primarySkill) {
      throw new TypeError(`${path} origin does not match the primary Provider skill`);
    }
    if (!input.profiles.has(origin.profile) || !input.manifest.provides.profiles.includes(origin.profile)) {
      throw new TypeError(`${path} origin profile is not active for this Indexer`);
    }
    validateTemplateOverride({ path, profile: origin.profile, manifest: input.manifest });
    files.push({
      path,
      digest: digest(bytes),
      byte_length: bytes.byteLength,
      capability,
      origin,
      upstream_state: origin.version === input.primaryVersion
        ? "current"
        : "origin-version-differs",
    });
  }
  return files;
}

export async function loadIndexerCustomization(input: {
  workspaceRoot: string;
  projectRef: string;
  indexer: IndexerRegistryEntry;
  manifest: IndexerProviderManifest;
  providerIntegrity: string;
  replaceCapabilityGap?: IndexerCustomizationCapabilityGap;
  customizationPlan?: IndexerCustomizationPlan;
}): Promise<IndexerCustomizationView> {
  if (!isAbsolute(input.workspaceRoot)) throw new TypeError("workspace root must be absolute");
  const primary = input.indexer.providers.find((provider) => provider.role === "primary");
  if (primary === undefined) throw new TypeError("Indexer has no primary Provider");
  if (
    primary.skill !== input.manifest.id ||
    primary.version !== input.manifest.version ||
    primary.integrity !== input.providerIntegrity
  ) {
    throw new TypeError("customization Provider does not match the primary registry layer");
  }
  const mode: CustomizationMode = input.indexer.customization?.mode ?? "none";
  const customizationRoot = join(input.workspaceRoot, "src", "indexer", input.indexer.id);
  const rootStatus = await statusIfPresent(customizationRoot);
  if (mode === "none") {
    if (rootStatus !== undefined) {
      throw new TypeError("undeclared Indexer customization directory is not allowed");
    }
    const base = {
      protocol: "context.indexer.customization-view/v1" as const,
      indexer_id: input.indexer.id,
      mode,
      provider: {
        skill: primary.skill,
        version: primary.version,
        integrity: primary.integrity,
      },
      files: [],
      plan: resolveCustomizationPlan({
        declared: input.customizationPlan,
        mode,
        projectRef: input.projectRef,
        indexer: input.indexer,
        providerIntegrity: input.providerIntegrity,
        files: [],
      }),
    };
    return {
      ...base,
      upstream_review_required: false,
      fingerprint: customizationFingerprint(base),
    };
  }
  if (rootStatus === undefined || !rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new TypeError("declared Indexer customization must be a real fixed directory");
  }
  const realWorkspace = await realpath(input.workspaceRoot);
  const realRoot = await realpath(customizationRoot);
  if (!isWithin(realWorkspace, realRoot)) {
    throw new TypeError("Indexer customization directory escapes the workspace");
  }
  validateReplaceGap({
    mode,
    gap: input.replaceCapabilityGap,
    projectRef: input.projectRef,
    indexerId: input.indexer.id,
    providerIntegrity: input.providerIntegrity,
  });

  const supports = new Set(input.manifest.customization?.supports ?? []);
  const profiles = activeProfiles(input.indexer);
  const paths = await collectCustomizationFiles(customizationRoot);
  if (paths.length === 0) throw new TypeError("declared Indexer customization is empty");
  const files = await loadDeclaredCustomizationFiles({
    paths,
    customizationRoot,
    primarySkill: primary.skill,
    primaryVersion: primary.version,
    profiles,
    supports,
    manifest: input.manifest,
  });
  if (files.some((file) => file.capability === "program-extend") &&
    !files.some((file) => file.path === "index.ts")) {
    throw new TypeError("program customization requires the fixed index.ts entry");
  }
  if (mode === "replace" && !files.some((file) => file.path === "index.ts")) {
    throw new TypeError("replace customization requires index.ts");
  }
  const base = {
    protocol: "context.indexer.customization-view/v1" as const,
    indexer_id: input.indexer.id,
    mode,
    provider: {
      skill: primary.skill,
      version: primary.version,
      integrity: primary.integrity,
    },
    files,
    plan: resolveCustomizationPlan({
      declared: input.customizationPlan,
      mode,
      projectRef: input.projectRef,
      indexer: input.indexer,
      providerIntegrity: input.providerIntegrity,
      files,
    }),
  };
  return {
    ...base,
    upstream_review_required: files.some((file) => file.upstream_state !== "current"),
    fingerprint: customizationFingerprint(base),
  };
}
