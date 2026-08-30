import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  buildValidatedIndexerCustomizationDraft,
  canonicalIndexerJson,
  indexerProtocolDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateValidatedIndexerCustomizationDraft,
  type ValidatedIndexerCustomizationDraft,
} from "@c4a/context";

const STAGE_ROOT = join(".tmp", "context-runtime", "indexer-customization-drafts");
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export interface IndexerCustomizationDraftStageReceipt {
  protocol: "context.indexer.customization-draft-stage-receipt/v1";
  validation_digest: string;
  staged_file_count: number;
  reused: boolean;
  receipt_digest: string;
}

export interface IndexerCustomizationValidationResult {
  protocol: "context.indexer.customization-validation-result/v1";
  validated: ValidatedIndexerCustomizationDraft;
  stage_receipt: IndexerCustomizationDraftStageReceipt;
  outcome: "selection-validation-required";
  selection_proposal_input: ValidatedIndexerCustomizationDraft["selection_proposal_input"];
  result_digest: string;
}

export function projectIndexerCustomizationDraftStagePath(
  projectRoot: string,
  validationDigest: string,
): string {
  if (!DIGEST.test(validationDigest)) {
    throw new TypeError("Indexer customization validation digest is invalid");
  }
  return join(projectRoot, STAGE_ROOT, validationDigest.slice("sha256:".length));
}

async function statusIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function receipt(
  validated: ValidatedIndexerCustomizationDraft,
  reused: boolean,
): IndexerCustomizationDraftStageReceipt {
  const payload = {
    protocol: "context.indexer.customization-draft-stage-receipt/v1" as const,
    validation_digest: validated.validation_digest,
    staged_file_count: validated.files.length,
    reused,
  };
  return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
}

async function verifyStage(
  root: string,
  expected?: ValidatedIndexerCustomizationDraft,
): Promise<ValidatedIndexerCustomizationDraft> {
  const raw = await readFile(join(root, "validated.json"), "utf8");
  const validated = validateValidatedIndexerCustomizationDraft(
    JSON.parse(raw) as unknown,
  );
  if (
    expected !== undefined &&
    canonicalIndexerJson(validated) !== canonicalIndexerJson(expected)
  ) {
    throw new TypeError("content-addressed Indexer customization stage is corrupt");
  }
  for (const file of validated.files) {
    const content = await readFile(join(root, ...file.path.split("/")));
    const actual = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (actual !== file.content_digest) {
      throw new TypeError(`staged Indexer customization file is corrupt: ${file.path}`);
    }
  }
  return validated;
}

async function assertDraftBase(input: {
  projectRoot: string;
  validated: ValidatedIndexerCustomizationDraft;
}): Promise<void> {
  const current = parseIndexerRegistry(await readFile(
    join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  const currentDigests = indexerRegistryDigests(current);
  const targetDigests = indexerRegistryDigests(input.validated.target_registry);
  if (
    currentDigests.requirementSetDigest !== targetDigests.requirementSetDigest ||
    canonicalIndexerJson(current.requirements) !==
      canonicalIndexerJson(input.validated.target_registry.requirements)
  ) {
    throw new TypeError("Indexer customization draft targets stale requirements");
  }
  if (
    current.indexers.length > 0 &&
    currentDigests.indexerSelectionDigest !==
      input.validated.source_indexer_selection_digest
  ) {
    throw new TypeError("Indexer customization draft would overwrite a different current selection");
  }
  for (const file of input.validated.files) {
    if (await statusIfPresent(join(input.projectRoot, ...file.path.split("/"))) !== undefined) {
      throw new TypeError(`minimal Indexer customization draft cannot overwrite ${file.path}`);
    }
  }
}

async function writeStage(input: {
  projectRoot: string;
  validated: ValidatedIndexerCustomizationDraft;
}): Promise<IndexerCustomizationDraftStageReceipt> {
  const root = projectIndexerCustomizationDraftStagePath(
    input.projectRoot,
    input.validated.validation_digest,
  );
  if (await statusIfPresent(root) !== undefined) {
    await verifyStage(root, input.validated);
    return receipt(input.validated, true);
  }
  const parent = dirname(root);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(join(parent, ".staging-"));
  try {
    for (const file of input.validated.files) {
      const destination = join(temporary, ...file.path.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, "utf8");
    }
    await writeFile(
      join(temporary, "validated.json"),
      `${JSON.stringify(input.validated, null, 2)}\n`,
      "utf8",
    );
    await verifyStage(temporary, input.validated);
    await rename(temporary, root);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return receipt(input.validated, false);
}

export async function validateAndStageProjectIndexerCustomizationDraft(input: {
  projectRoot: string;
  draft: unknown;
}): Promise<IndexerCustomizationValidationResult> {
  const validated = buildValidatedIndexerCustomizationDraft(input.draft);
  await assertDraftBase({ projectRoot: input.projectRoot, validated });
  const stageReceipt = await writeStage({ projectRoot: input.projectRoot, validated });
  const payload = {
    protocol: "context.indexer.customization-validation-result/v1" as const,
    validated,
    stage_receipt: stageReceipt,
    outcome: "selection-validation-required" as const,
    selection_proposal_input: validated.selection_proposal_input,
  };
  return { ...payload, result_digest: indexerProtocolDigest(payload) };
}

export async function loadStagedProjectIndexerCustomizationDraft(input: {
  projectRoot: string;
  validation_digest: string;
}): Promise<ValidatedIndexerCustomizationDraft> {
  return verifyStage(projectIndexerCustomizationDraftStagePath(
    input.projectRoot,
    input.validation_digest,
  ));
}
