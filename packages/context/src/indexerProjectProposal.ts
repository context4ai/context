import { createHash } from "node:crypto";
import { z } from "zod";
import {
  indexerRegistryDigests,
  indexerRegistrySchema,
  parseIndexerRegistry,
  validateFinalizedIndexerRegistry,
} from "./indexerRegistry.js";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

const packageCoordinateSchema = z.string().regex(
  /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u,
);
const lockIntegritySchema = z.string().regex(
  /^(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/u,
);

const dependencyAuthorizationResolutionSchema = z.object({
  package: packageCoordinateSchema,
  version: indexerSemverSchema,
  lock_integrity: lockIntegritySchema,
  resolved_digest: indexerDigestSchema,
}).strict();

export const indexerDependencyAuthorizationReceiptSchema = z.object({
  protocol: z.literal("context.indexer.dependency-authorization-receipt/v1"),
  request_intent_set_digest: indexerDigestSchema,
  resolutions: z.array(dependencyAuthorizationResolutionSchema).min(1),
  authority_ref: z.string().min(1),
  authority_scope_digest: indexerDigestSchema,
  install_scripts: z.literal(false),
  receipt_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.resolutions.map((item) => item.package), context, "resolutions");
});

export type IndexerDependencyAuthorizationReceipt = z.infer<
  typeof indexerDependencyAuthorizationReceiptSchema
>;

const dependencyIntentSchema = z.object({
  package: packageCoordinateSchema,
  version: indexerSemverSchema,
  kind: z.enum(["runtime", "development"]),
  importers: z.array(portableIndexerPathSchema).min(1),
  state: z.enum(["locked", "requires-authorization"]),
  lock_integrity: lockIntegritySchema.optional(),
  resolved_digest: indexerDigestSchema.optional(),
  authorization_receipt_digest: indexerDigestSchema.optional(),
  install_scripts: z.literal(false),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.importers, context, "importers");
  const complete = value.lock_integrity !== undefined &&
    value.resolved_digest !== undefined &&
    value.authorization_receipt_digest !== undefined;
  if (value.state === "locked" && !complete) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "locked dependency intents require lock, resolved, and authorization receipt digests",
    });
  }
  if (value.state === "requires-authorization" && complete) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "unresolved dependency intents cannot claim locked identity",
    });
  }
});

export const indexerDependencyIntentSetSchema = z.object({
  protocol: z.literal("context.indexer.dependency-intent-set/v1"),
  intents: z.array(dependencyIntentSchema),
  authorization_receipts: z.array(indexerDependencyAuthorizationReceiptSchema),
  intent_set_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.intents.map((intent) => intent.package), context, "intents");
  addDuplicateIssues(
    value.authorization_receipts.map((receipt) => receipt.receipt_digest),
    context,
    "authorization_receipts",
  );
});

export type IndexerDependencyIntentSet = z.infer<typeof indexerDependencyIntentSetSchema>;

const registrySnapshotSchema = z.object({
  document_digest: indexerDigestSchema,
  requirement_set_digest: indexerDigestSchema,
  indexer_selection_digest: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
}).strict();

const fileTargetSchema = z.object({
  path: portableIndexerPathSchema,
  operation: z.enum(["write", "delete"]),
  base_digest: indexerDigestSchema.nullable(),
  target_digest: indexerDigestSchema.nullable(),
  content: z.string().max(4 * 1024 * 1024).optional(),
}).strict().superRefine((value, context) => {
  if (
    value.operation === "write" &&
    (value.content === undefined || value.target_digest === null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "write targets require content and target_digest",
    });
  }
  if (
    value.operation === "delete" &&
    (value.content !== undefined || value.target_digest !== null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "delete targets cannot contain target content or digest",
    });
  }
});

const indexerProjectProposalBaseSchema = z.object({
  protocol: z.literal("context.indexer.project-proposal/v1"),
  project_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u),
  mode: z.enum(["registry-only", "customization"]),
  requirement_set_digest: indexerDigestSchema,
  base_registry: registrySnapshotSchema,
  target_registry: registrySnapshotSchema,
  target_document: indexerRegistrySchema,
  targets: z.array(fileTargetSchema).min(1),
  dependencies: indexerDependencyIntentSetSchema,
  capability_gap_digest: indexerDigestSchema.nullable(),
  finalized_validation_report_digests: z.array(indexerDigestSchema).min(1),
  program_execution_policy_digest: indexerDigestSchema.nullable(),
  proposal_digest: indexerDigestSchema,
}).strict();

export const indexerProjectProposalSchema = indexerProjectProposalBaseSchema.superRefine((value, context) => {
  addDuplicateIssues(value.targets.map((target) => target.path), context, "targets");
  addDuplicateIssues(
    value.finalized_validation_report_digests,
    context,
    "finalized_validation_report_digests",
  );
});

export type IndexerProjectProposal = z.infer<typeof indexerProjectProposalSchema>;
export type IndexerProjectFileTarget = IndexerProjectProposal["targets"][number];

function contentDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function canonicalOrder(values: readonly string[], field: string): void {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (values.some((value, index) => value !== sorted[index])) {
    throw new TypeError(`${field} must use canonical order`);
  }
}

function dependencyIntentSetPayload(
  value: IndexerDependencyIntentSet,
): Omit<IndexerDependencyIntentSet, "intent_set_digest"> {
  return {
    protocol: value.protocol,
    intents: value.intents,
    authorization_receipts: value.authorization_receipts,
  };
}

function dependencyAuthorizationReceiptPayload(
  value: IndexerDependencyAuthorizationReceipt,
): Omit<IndexerDependencyAuthorizationReceipt, "receipt_digest"> {
  return {
    protocol: value.protocol,
    request_intent_set_digest: value.request_intent_set_digest,
    resolutions: value.resolutions,
    authority_ref: value.authority_ref,
    authority_scope_digest: value.authority_scope_digest,
    install_scripts: value.install_scripts,
  };
}

export function indexerDependencyAuthorizationReceiptDigest(
  value: Omit<IndexerDependencyAuthorizationReceipt, "receipt_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function validateIndexerDependencyAuthorizationReceipt(
  value: unknown,
): IndexerDependencyAuthorizationReceipt {
  const receipt = indexerDependencyAuthorizationReceiptSchema.parse(value);
  canonicalOrder(
    receipt.resolutions.map((resolution) => resolution.package),
    "dependency authorization resolutions",
  );
  if (
    indexerDependencyAuthorizationReceiptDigest(
      dependencyAuthorizationReceiptPayload(receipt),
    ) !== receipt.receipt_digest
  ) {
    throw new TypeError("dependency authorization receipt digest is invalid");
  }
  return receipt;
}

export function buildIndexerDependencyIntentSet(
  intents: readonly z.input<typeof dependencyIntentSchema>[],
  authorizationReceipts: readonly IndexerDependencyAuthorizationReceipt[] = [],
): IndexerDependencyIntentSet {
  const parsed = intents.map((intent) => dependencyIntentSchema.parse(intent))
    .sort((left, right) => compareIndexerCanonicalText(left.package, right.package));
  const receipts = authorizationReceipts
    .map(validateIndexerDependencyAuthorizationReceipt)
    .sort((left, right) => compareIndexerCanonicalText(left.receipt_digest, right.receipt_digest));
  if (new Set(parsed.map((intent) => intent.package)).size !== parsed.length) {
    throw new TypeError("dependency intents must contain one exact version per package");
  }
  const base = {
    protocol: "context.indexer.dependency-intent-set/v1" as const,
    intents: parsed,
    authorization_receipts: receipts,
  };
  return validateIndexerDependencyIntentSet({
    ...base,
    intent_set_digest: indexerProtocolDigest(base),
  });
}

export function validateIndexerDependencyIntentSet(
  value: unknown,
): IndexerDependencyIntentSet {
  const set = indexerDependencyIntentSetSchema.parse(value);
  canonicalOrder(set.intents.map((intent) => intent.package), "dependency intents");
  canonicalOrder(
    set.authorization_receipts.map((receipt) => receipt.receipt_digest),
    "dependency authorization receipts",
  );
  const usedReceipts = new Set<string>();
  for (const intent of set.intents) {
    if (intent.state === "requires-authorization") continue;
    const receipt = set.authorization_receipts.find((candidate) =>
      candidate.receipt_digest === intent.authorization_receipt_digest
    );
    const resolution = receipt?.resolutions.find((candidate) =>
      candidate.package === intent.package && candidate.version === intent.version
    );
    if (
      receipt === undefined ||
      resolution === undefined ||
      resolution.lock_integrity !== intent.lock_integrity ||
      resolution.resolved_digest !== intent.resolved_digest
    ) {
      throw new TypeError(`locked dependency intent has no exact authorization receipt: ${intent.package}`);
    }
    usedReceipts.add(receipt.receipt_digest);
  }
  if (set.authorization_receipts.some((receipt) => !usedReceipts.has(receipt.receipt_digest))) {
    throw new TypeError("dependency intent set contains an unused authorization receipt");
  }
  if (indexerProtocolDigest(dependencyIntentSetPayload(set)) !== set.intent_set_digest) {
    throw new TypeError("dependency intent set digest is invalid");
  }
  return set;
}

export function authorizeIndexerDependencies(input: {
  dependencies: unknown;
  resolutions: readonly z.input<typeof dependencyAuthorizationResolutionSchema>[];
  authority_ref: string;
  authority_scope_digest: string;
}): {
  receipt: IndexerDependencyAuthorizationReceipt;
  dependencies: IndexerDependencyIntentSet;
} {
  const dependencies = validateIndexerDependencyIntentSet(input.dependencies);
  if (
    dependencies.intents.length === 0 ||
    dependencies.intents.some((intent) => intent.state !== "requires-authorization") ||
    dependencies.authorization_receipts.length > 0
  ) {
    throw new TypeError("dependency authorization requires one entirely unresolved intent set");
  }
  const resolutions = input.resolutions
    .map((value) => dependencyAuthorizationResolutionSchema.parse(value))
    .sort((left, right) => compareIndexerCanonicalText(left.package, right.package));
  const expected = dependencies.intents.map((intent) => `${intent.package}@${intent.version}`);
  const actual = resolutions.map((resolution) => `${resolution.package}@${resolution.version}`);
  if (
    expected.length !== actual.length ||
    expected.some((identity, index) => identity !== actual[index])
  ) {
    throw new TypeError("dependency authorization resolutions do not close the exact intent set");
  }
  const receiptPayload: Omit<IndexerDependencyAuthorizationReceipt, "receipt_digest"> = {
    protocol: "context.indexer.dependency-authorization-receipt/v1",
    request_intent_set_digest: dependencies.intent_set_digest,
    resolutions,
    authority_ref: input.authority_ref,
    authority_scope_digest: indexerDigestSchema.parse(input.authority_scope_digest),
    install_scripts: false,
  };
  const receipt = validateIndexerDependencyAuthorizationReceipt({
    ...receiptPayload,
    receipt_digest: indexerDependencyAuthorizationReceiptDigest(receiptPayload),
  });
  const locked = dependencies.intents.map((intent, index) => ({
    ...intent,
    state: "locked" as const,
    lock_integrity: resolutions[index]!.lock_integrity,
    resolved_digest: resolutions[index]!.resolved_digest,
    authorization_receipt_digest: receipt.receipt_digest,
  }));
  return {
    receipt,
    dependencies: buildIndexerDependencyIntentSet(locked, [receipt]),
  };
}

function proposalPayload(
  value: IndexerProjectProposal,
): Omit<IndexerProjectProposal, "proposal_digest"> {
  return {
    protocol: value.protocol,
    project_ref: value.project_ref,
    mode: value.mode,
    requirement_set_digest: value.requirement_set_digest,
    base_registry: value.base_registry,
    target_registry: value.target_registry,
    target_document: value.target_document,
    targets: value.targets,
    dependencies: value.dependencies,
    capability_gap_digest: value.capability_gap_digest,
    finalized_validation_report_digests: value.finalized_validation_report_digests,
    program_execution_policy_digest: value.program_execution_policy_digest,
  };
}

function isCustomizationRelativePath(path: string): boolean {
  return /^(?:index|variables|helpers)\.ts$/u.test(path) ||
    path === "instructions.md" ||
    /^templates\/[a-z0-9][a-z0-9._/-]*\.md$/u.test(path);
}

function isCustomizationPath(proposal: IndexerProjectProposal, path: string): boolean {
  return proposal.target_document.indexers.some((indexer) => {
    if (indexer.customization === undefined) return false;
    const prefix = `src/indexer/${indexer.id}/`;
    return path.startsWith(prefix) && isCustomizationRelativePath(path.slice(prefix.length));
  });
}

function isDependencyTarget(path: string): boolean {
  return ["package.json", "bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]
    .includes(path);
}

function validateTargetPaths(proposal: IndexerProjectProposal): void {
  canonicalOrder(proposal.targets.map((target) => target.path), "proposal targets");
  const registryTarget = proposal.targets.find((target) => target.path === "src/indexers.yaml");
  if (
    registryTarget === undefined ||
    registryTarget.operation !== "write" ||
    registryTarget.content === undefined
  ) {
    throw new TypeError("project proposal requires one complete src/indexers.yaml target");
  }
  for (const target of proposal.targets) {
    if (
      target.path !== "src/indexers.yaml" &&
      !isCustomizationPath(proposal, target.path) &&
      !isDependencyTarget(target.path)
    ) {
      throw new TypeError(`project proposal target is outside the fixed workspace surface: ${target.path}`);
    }
    if (target.operation === "write" && contentDigest(target.content!) !== target.target_digest) {
      throw new TypeError(`project proposal target digest is invalid: ${target.path}`);
    }
  }
  if (registryTarget.target_digest !== proposal.target_registry.document_digest) {
    throw new TypeError("registry target digest does not match the target registry snapshot");
  }
  if (registryTarget.base_digest !== proposal.base_registry.document_digest) {
    throw new TypeError("registry target base digest does not match the base registry snapshot");
  }
  const totalBytes = proposal.targets.reduce(
    (total, target) => total + Buffer.byteLength(target.content ?? "", "utf8"),
    0,
  );
  if (totalBytes > 16 * 1024 * 1024) {
    throw new TypeError("project proposal target payload exceeds the fixed byte budget");
  }
  const parsedTarget = parseIndexerRegistry(registryTarget.content, "proposal:src/indexers.yaml");
  if (indexerProtocolDigest(parsedTarget) !== indexerProtocolDigest(proposal.target_document)) {
    throw new TypeError("registry target content does not match target_document");
  }
}

function validateRegistrySnapshots(proposal: IndexerProjectProposal): void {
  const targetDigests = indexerRegistryDigests(proposal.target_document);
  validateFinalizedIndexerRegistry(proposal.target_document);
  if (
    proposal.requirement_set_digest !== proposal.base_registry.requirement_set_digest ||
    proposal.requirement_set_digest !== proposal.target_registry.requirement_set_digest ||
    proposal.target_registry.requirement_set_digest !== targetDigests.requirementSetDigest ||
    proposal.target_registry.indexer_selection_digest !== targetDigests.indexerSelectionDigest ||
    proposal.target_registry.registry_digest !== targetDigests.registryDigest
  ) {
    throw new TypeError("project proposal changes or misbinds its requirement/registry authority");
  }
}

function validateProposalMode(proposal: IndexerProjectProposal): void {
  const customizationTargets = proposal.targets.filter((target) =>
    isCustomizationPath(proposal, target.path)
  );
  const dependencyTargets = proposal.targets.filter((target) => isDependencyTarget(target.path));
  if (proposal.mode === "registry-only") {
    if (
      proposal.capability_gap_digest !== null ||
      customizationTargets.length > 0 ||
      dependencyTargets.length > 0 ||
      proposal.dependencies.intents.length > 0
    ) {
      throw new TypeError("registry-only proposal cannot contain customization or dependency changes");
    }
  } else if (proposal.capability_gap_digest === null || customizationTargets.length === 0) {
    throw new TypeError("customization proposal requires an exact capability gap and changed local file");
  }
  if (
    (proposal.dependencies.intents.length === 0 && dependencyTargets.length > 0) ||
    (proposal.dependencies.intents.length > 0 && dependencyTargets.length === 0)
  ) {
    throw new TypeError("dependency intents and package/lock targets must be proposed together");
  }
  if (proposal.dependencies.intents.length > 0) {
    const dependencyPaths = new Set(dependencyTargets.map((target) => target.path));
    const lockCount = [...dependencyPaths].filter((path) => path !== "package.json").length;
    if (!dependencyPaths.has("package.json") || lockCount !== 1) {
      throw new TypeError("dependency proposal requires package.json and exactly one lock target");
    }
    if (dependencyTargets.some((target) => target.operation !== "write")) {
      throw new TypeError("dependency package/lock targets must be complete write snapshots");
    }
    const customizationPaths = new Set(customizationTargets.map((target) => target.path));
    for (const intent of proposal.dependencies.intents) {
      if (intent.importers.some((path) => !path.endsWith(".ts") || !customizationPaths.has(path))) {
        throw new TypeError("dependency intent importers must be changed customization program files");
      }
    }
  }
  const hasProgramTarget = customizationTargets.some((target) => target.path.endsWith(".ts"));
  if (hasProgramTarget !== (proposal.program_execution_policy_digest !== null)) {
    throw new TypeError("customization program targets require one exact execution policy digest");
  }
}

export function validateIndexerProjectProposal(
  value: unknown,
  options: { apply_ready?: boolean } = {},
): IndexerProjectProposal {
  const proposal = indexerProjectProposalSchema.parse(value);
  validateIndexerDependencyIntentSet(proposal.dependencies);
  validateTargetPaths(proposal);
  validateRegistrySnapshots(proposal);
  validateProposalMode(proposal);
  canonicalOrder(
    proposal.finalized_validation_report_digests,
    "finalized validation report digests",
  );
  if (
    options.apply_ready === true &&
    proposal.dependencies.intents.some((intent) => intent.state !== "locked")
  ) {
    throw new TypeError("project proposal has unauthorized/unlocked dependency intents");
  }
  if (indexerProtocolDigest(proposalPayload(proposal)) !== proposal.proposal_digest) {
    throw new TypeError("project proposal digest is invalid");
  }
  return proposal;
}

export function buildIndexerProjectProposal(
  input: Omit<z.input<typeof indexerProjectProposalSchema>, "proposal_digest">,
): IndexerProjectProposal {
  const base = indexerProjectProposalBaseSchema.omit({ proposal_digest: true }).parse(input);
  return validateIndexerProjectProposal({
    ...base,
    proposal_digest: indexerProtocolDigest(base),
  });
}

export function indexerProjectContentDigest(content: string): string {
  return contentDigest(content);
}
