import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  indexerArtifactResultDigest,
  indexerArtifactResultSchema,
  indexerCanonicalRefSchema,
  containsIndexerControlledAuthoringPlaceholder,
  indexerProtocolDigest,
  indexerRenderedArtifactDigest,
  indexerRenderedArtifactSchema,
  indexerTemplateContractSchema,
  isPortableIndexerPath,
  loadIndexerProviderManifest,
  type IndexerArtifactResult,
  type IndexerJson,
  type IndexerProviderManifest,
  type IndexerRenderedArtifact,
  type IndexerTemplateContract,
  type ResolvedProviderBundle,
} from "@c4a/context";
import { parseDocument } from "yaml";
import { collectIndexerBundleFiles } from "./indexerDistributionBuild.js";
import type { IndexerCustomizationView } from "./indexerCustomization.js";
import {
  validateStagedIndexerProviderBundle,
  type StagedIndexerProviderBundle,
} from "./indexerProviderStage.js";
import {
  renderIndexerTemplateSectionLayers,
  validateIndexerTemplateVariableLayers,
} from "./indexerTemplateContentLayers.js";

const MAX_TEMPLATE_BYTES = 1024 * 1024;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const SECTION_START = /^<!-- context:indexer-section ([a-z0-9][a-z0-9._/-]*) -->$/u;
const SECTION_END = /^<!-- \/context:indexer-section -->$/u;
const PLACEHOLDER = /\{\{\s*(variable|block):([a-z0-9][a-z0-9._/-]*)\s*\}\}/gu;

export interface MaterializedIndexerTemplate {
  protocol: "context.indexer.materialized-template/v1";
  provider_fingerprint: string;
  provider_integrity: string;
  customization_fingerprint: string | null;
  template_id: string;
  profile: string;
  origin: "provider" | "customization-override";
  resource_ref: string;
  source_digest: string;
  contract: IndexerTemplateContract;
  section_bodies: Record<string, string>;
  payload_digest: string;
  context_receipt: {
    staged_receipt_digest: string;
    customization_view_fingerprint: string;
    receipt_digest: string;
  };
}

export interface IndexerTemplateQuestionBinding {
  section_key: string;
  question_ref: string;
  question_target_key: string;
}

type IndexerTemplateArtifact = Extract<
  IndexerArtifactResult["artifacts"][number],
  { representation: "template" }
>;

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameFiles(
  actual: readonly { path: string; digest: string }[],
  expected: readonly { path: string; digest: string }[],
): boolean {
  return actual.length === expected.length && actual.every((file, index) =>
    file.path === expected[index]?.path && file.digest === expected[index]?.digest
  );
}

async function assertStageCurrent(staged: StagedIndexerProviderBundle): Promise<void> {
  const actual = await collectIndexerBundleFiles(staged.stage_path);
  if (!sameFiles(actual, staged.files)) {
    throw new TypeError("staged Provider changed after template selection");
  }
}

interface SelectedTemplateResource {
  origin: "provider" | "customization-override";
  path: string;
  expectedDigest: string;
}

function selectTemplateResource(input: {
  manifest: IndexerProviderManifest;
  staged: StagedIndexerProviderBundle;
  customization: IndexerCustomizationView;
  workspaceRoot: string;
  templateId: string;
  profile: string;
}): SelectedTemplateResource {
  const matches = (input.manifest.provider.templates ?? []).filter((template) =>
    template.id === input.templateId && template.profile === input.profile
  );
  if (matches.length !== 1) {
    throw new TypeError("template id/profile must resolve to exactly one Provider resource");
  }
  const providerTemplate = matches[0]!;
  const overridePath = `templates/${input.templateId}.md`;
  const override = input.customization.files.find((file) => file.path === overridePath);
  if (
    override !== undefined &&
    (override.origin.profile !== input.profile || override.origin.skill !== input.manifest.id)
  ) {
    throw new TypeError("template override profile does not match the selected template");
  }
  const providerDigest = input.staged.files.find(
    (file) => file.path === providerTemplate.path,
  )?.digest;
  const expectedDigest = override?.digest ?? providerDigest;
  if (expectedDigest === undefined) {
    throw new TypeError("selected template is absent from the staged ledger");
  }
  return override === undefined
    ? {
        origin: "provider",
        path: join(input.staged.stage_path, providerTemplate.path),
        expectedDigest,
      }
    : {
        origin: "customization-override",
        path: join(
          input.workspaceRoot,
          "src",
          "indexer",
          input.customization.indexer_id,
          override.path,
        ),
        expectedDigest,
      };
}

async function readTemplateSource(input: {
  selected: SelectedTemplateResource;
  workspaceRoot: string;
}): Promise<string> {
  if (input.selected.origin === "customization-override") {
    const status = await lstat(input.selected.path);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new TypeError("template override must remain a real file");
    }
    const realWorkspace = await realpath(input.workspaceRoot);
    const realTemplate = await realpath(input.selected.path);
    const rel = relative(realWorkspace, realTemplate);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new TypeError("template override escapes the workspace");
    }
  }
  const bytes = await readFile(input.selected.path);
  if (bytes.byteLength > MAX_TEMPLATE_BYTES) {
    throw new TypeError("Indexer template exceeds its byte limit");
  }
  if (sha256(bytes) !== input.selected.expectedDigest) {
    throw new TypeError("selected template changed after validation");
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("Indexer template must be valid UTF-8");
  }
  if (source.includes("\0")) throw new TypeError("Indexer template contains a NUL byte");
  return source;
}

function splitFrontmatter(source: string): { metadata: unknown; body: string } {
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new TypeError("Indexer template must start with YAML frontmatter");
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new TypeError("Indexer template frontmatter is not terminated");
  const document = parseDocument(normalized.slice(4, end), {
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    const issues = [...document.errors, ...document.warnings]
      .map((issue) => issue.message)
      .join("; ");
    throw new TypeError(`Indexer template frontmatter is invalid: ${issues}`);
  }
  return { metadata: document.toJS({ maxAliasCount: 0 }), body: normalized.slice(end + 5) };
}

function parseSectionBodies(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const outside: string[] = [];
  let current: { key: string; lines: string[] } | undefined;
  for (const line of body.split("\n")) {
    const start = SECTION_START.exec(line);
    if (start !== null) {
      if (current !== undefined) throw new TypeError("Indexer template Sections must not nest");
      current = { key: start[1]!, lines: [] };
      continue;
    }
    if (SECTION_END.test(line)) {
      if (current === undefined) throw new TypeError("Indexer template has an unmatched Section end");
      if (sections[current.key] !== undefined) {
        throw new TypeError(`Indexer template repeats Section ${current.key}`);
      }
      sections[current.key] = current.lines.join("\n").trim();
      current = undefined;
      continue;
    }
    if (current === undefined) outside.push(line);
    else current.lines.push(line);
  }
  if (current !== undefined) throw new TypeError(`Indexer template Section ${current.key} is not closed`);
  if (outside.some((line) => line.trim().length > 0)) {
    throw new TypeError("Indexer template body must place all Markdown inside declared Sections");
  }
  return sections;
}

function validateTemplateBody(
  contract: IndexerTemplateContract,
  sectionBodies: Readonly<Record<string, string>>,
): void {
  const contractKeys = new Set(contract.sections.map((section) => section.section_key));
  const blockContracts = new Map(contract.deterministic_blocks.map((block) => [block.id, block]));
  const variableContracts = new Map(contract.variables.map((variable) => [variable.id, variable]));
  const bodyKeys = Object.keys(sectionBodies);
  if (
    bodyKeys.length !== contractKeys.size ||
    bodyKeys.some((key) => !contractKeys.has(key))
  ) {
    throw new TypeError("Indexer template contract and body Section sets differ");
  }
  for (const section of contract.sections) {
    const body = sectionBodies[section.section_key]!;
    if (body.length === 0) throw new TypeError(`Indexer template Section ${section.section_key} is empty`);
    const directVariables = new Set<string>();
    const variables = new Set<string>();
    const blocks = new Set<string>();
    for (const match of body.matchAll(PLACEHOLDER)) {
      (match[1] === "variable" ? directVariables : blocks).add(match[2]!);
    }
    directVariables.forEach((id) => variables.add(id));
    for (const blockId of blocks) {
      const sourceVariableId = blockContracts.get(blockId)?.source_variable_id;
      if (sourceVariableId !== undefined) variables.add(sourceVariableId);
    }
    const stripped = body.replace(PLACEHOLDER, "");
    if (/\{\{|\}\}/u.test(stripped)) {
      throw new TypeError(`Indexer template Section ${section.section_key} has an unsupported directive`);
    }
    if ([...directVariables].some((id) => {
      const type = variableContracts.get(id)?.type;
      return type !== "string" && type !== "number" && type !== "boolean";
    })) {
      throw new TypeError(
        `Indexer template Section ${section.section_key} must render collection/json variables through a block`,
      );
    }
    const declaredVariables = new Set(section.variable_ids);
    const declaredBlocks = new Set(section.deterministic_block_ids);
    if (
      variables.size !== declaredVariables.size ||
      [...variables].some((id) => !declaredVariables.has(id)) ||
      blocks.size !== declaredBlocks.size ||
      [...blocks].some((id) => !declaredBlocks.has(id))
    ) {
      throw new TypeError(
        `Indexer template Section ${section.section_key} placeholder declarations are not exact`,
      );
    }
  }
}

function materializedPayload(
  value: Omit<MaterializedIndexerTemplate, "payload_digest" | "context_receipt">,
): unknown {
  return {
    protocol: value.protocol,
    provider_fingerprint: value.provider_fingerprint,
    provider_integrity: value.provider_integrity,
    customization_fingerprint: value.customization_fingerprint,
    template_id: value.template_id,
    profile: value.profile,
    origin: value.origin,
    resource_ref: value.resource_ref,
    source_digest: value.source_digest,
    contract: value.contract,
    section_bodies: value.section_bodies,
  };
}

export async function materializeIndexerTemplate(input: {
  bundle: ResolvedProviderBundle;
  staged: StagedIndexerProviderBundle;
  customization: IndexerCustomizationView;
  workspaceRoot: string;
  templateId: string;
  profile: string;
}): Promise<MaterializedIndexerTemplate> {
  if (!isAbsolute(input.workspaceRoot)) throw new TypeError("workspace root must be absolute");
  if (!isPortableIndexerPath(input.customization.indexer_id)) {
    throw new TypeError("template customization has an unsafe Indexer identity");
  }
  validateStagedIndexerProviderBundle(input.staged, input.bundle);
  await assertStageCurrent(input.staged);
  if (input.customization.provider.integrity !== input.bundle.resolved.integrity) {
    throw new TypeError("template customization does not match the resolved Provider");
  }
  const manifest = await loadIndexerProviderManifest(input.staged.stage_path);
  if (
    manifest.id !== input.customization.provider.skill ||
    manifest.version !== input.customization.provider.version
  ) {
    throw new TypeError("template customization does not match the staged Provider identity");
  }
  const selected = selectTemplateResource({
    manifest,
    staged: input.staged,
    customization: input.customization,
    workspaceRoot: input.workspaceRoot,
    templateId: input.templateId,
    profile: input.profile,
  });
  const source = await readTemplateSource({
    selected,
    workspaceRoot: input.workspaceRoot,
  });
  const contractSource = selected.origin === "customization-override"
    ? source.replace(/^[^\n]*(?:\n|$)/u, "")
    : source;
  const parsed = splitFrontmatter(contractSource);
  const contract = indexerTemplateContractSchema.parse(parsed.metadata);
  if (contract.template_id !== input.templateId || contract.profile !== input.profile) {
    throw new TypeError("Indexer template frontmatter does not match its manifest identity");
  }
  const sectionBodies = parseSectionBodies(parsed.body);
  validateTemplateBody(contract, sectionBodies);
  const resourceRef = selected.origin === "provider"
    ? `provider-template:${manifest.id}@${manifest.version}#${input.profile}/${input.templateId}`
    : `customization-template:${input.customization.indexer_id}#${input.profile}/${input.templateId}`;
  const base: Omit<MaterializedIndexerTemplate, "payload_digest" | "context_receipt"> = {
    protocol: "context.indexer.materialized-template/v1",
    provider_fingerprint: input.staged.provider_fingerprint,
    provider_integrity: input.staged.bundle_integrity,
    customization_fingerprint: input.customization.mode === "none"
      ? null
      : input.customization.fingerprint,
    template_id: input.templateId,
    profile: input.profile,
    origin: selected.origin,
    resource_ref: resourceRef,
    source_digest: selected.expectedDigest,
    contract,
    section_bodies: sectionBodies,
  };
  const payloadDigest = indexerProtocolDigest(materializedPayload(base));
  const receiptBase = {
    protocol: "context.indexer.template-materialization-receipt/v1" as const,
    payload_digest: payloadDigest,
    staged_receipt_digest: input.staged.receipt_digest,
    customization_fingerprint: input.customization.fingerprint,
  };
  return {
    ...base,
    payload_digest: payloadDigest,
    context_receipt: {
      staged_receipt_digest: receiptBase.staged_receipt_digest,
      customization_view_fingerprint: receiptBase.customization_fingerprint,
      receipt_digest: indexerProtocolDigest(receiptBase),
    },
  };
}

export function validateMaterializedIndexerTemplate(
  value: MaterializedIndexerTemplate,
): void {
  if (
    !DIGEST_RE.test(value.provider_fingerprint) ||
    !DIGEST_RE.test(value.provider_integrity) ||
    (value.customization_fingerprint !== null &&
      !DIGEST_RE.test(value.customization_fingerprint)) ||
    !DIGEST_RE.test(value.source_digest) ||
    !DIGEST_RE.test(value.payload_digest)
  ) {
    throw new TypeError("materialized Indexer template identity digest is invalid");
  }
  const payloadDigest = indexerProtocolDigest(materializedPayload(value));
  if (payloadDigest !== value.payload_digest) {
    throw new TypeError("materialized Indexer template payload digest is invalid");
  }
  const receiptDigest = indexerProtocolDigest({
    protocol: "context.indexer.template-materialization-receipt/v1",
    payload_digest: value.payload_digest,
    staged_receipt_digest: value.context_receipt.staged_receipt_digest,
    customization_fingerprint: value.context_receipt.customization_view_fingerprint,
  });
  if (value.context_receipt.receipt_digest !== receiptDigest) {
    throw new TypeError("materialized Indexer template receipt is invalid");
  }
  indexerTemplateContractSchema.parse(value.contract);
  if (
    value.template_id !== value.contract.template_id ||
    value.profile !== value.contract.profile
  ) {
    throw new TypeError("materialized Indexer template identity is inconsistent");
  }
  validateTemplateBody(value.contract, value.section_bodies);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return value !== null && !Array.isArray(value) && typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}

function variableAvailable(value: IndexerJson): boolean {
  if (value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function validateVariableValue(
  contract: IndexerTemplateContract["variables"][number],
  value: IndexerJson,
): void {
  const valid = contract.type === "string" ? typeof value === "string"
    : contract.type === "string-list" ? Array.isArray(value) && value.every((item) => typeof item === "string")
    : contract.type === "string-map" ? isStringMap(value)
    : contract.type === "number" ? typeof value === "number" && Number.isFinite(value)
    : contract.type === "boolean" ? typeof value === "boolean"
    : true;
  if (!valid) throw new TypeError(`template variable ${contract.id} has the wrong type`);
  if (
    contract.maximum_length !== undefined &&
    typeof value === "string" &&
    value.length > contract.maximum_length
  ) {
    throw new TypeError(`template variable ${contract.id} exceeds maximum_length`);
  }
  if (
    contract.maximum_items !== undefined &&
    (Array.isArray(value) ? value.length : isStringMap(value) ? Object.keys(value).length : 0) >
      contract.maximum_items
  ) {
    throw new TypeError(`template variable ${contract.id} exceeds maximum_items`);
  }
}

function hasSubstantiveBody(markdown: string): boolean {
  return markdown.split("\n").some((line) => {
    const value = line.trim();
    return value.length > 0 &&
      !/^#{1,6}\s+/u.test(value) &&
      !/^[-|:\s]+$/u.test(value);
  });
}

function assertNoTemplateResidue(sectionKey: string, markdown: string): void {
  if (containsIndexerControlledAuthoringPlaceholder(markdown)) {
    throw new TypeError(`rendered Section ${sectionKey} contains template residue or placeholder prose`);
  }
  if (!hasSubstantiveBody(markdown)) {
    throw new TypeError(`rendered Section ${sectionKey} has a title but no body`);
  }
}

function validatedResult(result: IndexerArtifactResult): IndexerArtifactResult {
  const parsed = indexerArtifactResultSchema.parse(result);
  const payload = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== "output_digest"),
  ) as Omit<IndexerArtifactResult, "output_digest">;
  if (indexerArtifactResultDigest(payload) !== parsed.output_digest) {
    throw new TypeError("template rendering requires an intact ArtifactResult");
  }
  return parsed;
}

function exactQuestionBindings(
  contract: IndexerTemplateContract,
  bindings: readonly IndexerTemplateQuestionBinding[],
): Map<string, IndexerTemplateQuestionBinding> {
  const required = contract.sections.filter((section) => section.presence === "required");
  const map = new Map(bindings.map((binding) => [binding.section_key, binding]));
  if (
    map.size !== bindings.length ||
    map.size !== required.length ||
    new Set(bindings.map((binding) => binding.question_target_key)).size !== bindings.length ||
    required.some((section) => map.get(section.section_key)?.question_ref !== section.question_ref)
  ) {
    throw new TypeError("required template Sections need exact CLI-owned question bindings");
  }
  bindings.forEach((binding) => indexerCanonicalRefSchema.parse(binding.question_target_key));
  return map;
}

function validateRenderApplicability(input: {
  result: IndexerArtifactResult;
  artifact: IndexerTemplateArtifact;
  template: MaterializedIndexerTemplate;
  applicabilityConditionRefs: readonly string[];
}): Map<string, IndexerTemplateArtifact["section_projections"][number]> {
  const conditionSet = new Set(input.applicabilityConditionRefs);
  if (conditionSet.size !== input.applicabilityConditionRefs.length) {
    throw new TypeError("template applicability conditions must be unique");
  }
  input.applicabilityConditionRefs.forEach((condition) =>
    indexerCanonicalRefSchema.parse(condition)
  );
  const contract = input.template.contract;
  if (
    input.result.provider_integrity !== input.template.provider_integrity ||
    input.result.customization_fingerprint !== input.template.customization_fingerprint ||
    input.artifact.template_id !== contract.template_id ||
    !contract.applicability.artifact_policy_variants.includes(
      input.artifact.artifact_policy_variant,
    ) ||
    contract.applicability.condition_refs.some(
      (condition) => !conditionSet.has(condition),
    )
  ) {
    throw new TypeError("template does not apply to the selected Provider/Artifact/condition identity");
  }
  const projectionMap = new Map(
    input.artifact.section_projections.map((projection) => [projection.section_key, projection]),
  );
  if (
    projectionMap.size !== input.artifact.section_projections.length ||
    projectionMap.size !== contract.sections.length ||
    contract.sections.some(
      (section) => projectionMap.get(section.section_key)?.reader_goal !== section.reader_goal,
    )
  ) {
    throw new TypeError("template Section projections do not exactly match the template contract");
  }
  return projectionMap;
}

export function renderIndexerTemplateArtifact(input: {
  artifactResult: IndexerArtifactResult;
  artifactId: string;
  template: MaterializedIndexerTemplate;
  questionBindings: readonly IndexerTemplateQuestionBinding[];
  applicabilityConditionRefs: readonly string[];
}): IndexerRenderedArtifact {
  validateMaterializedIndexerTemplate(input.template);
  const result = validatedResult(input.artifactResult);
  const artifact = result.artifacts.find((candidate) => candidate.artifact_id === input.artifactId);
  if (artifact?.representation !== "template") {
    throw new TypeError("template rendering requires one template Artifact");
  }
  const contract = input.template.contract;
  const projectionMap = validateRenderApplicability({
    result,
    artifact,
    template: input.template,
    applicabilityConditionRefs: input.applicabilityConditionRefs,
  });
  const questionBindings = exactQuestionBindings(contract, input.questionBindings);
  const evidenceKinds = new Map(result.evidence_bindings.map((evidence) => [evidence.evidence_ref, evidence.kind]));
  const variableContracts = new Map(contract.variables.map((variable) => [variable.id, variable]));
  const blocks = new Map(contract.deterministic_blocks.map((block) => [block.id, block]));
  for (const [id, binding] of Object.entries(artifact.variables)) {
    const variableContract = variableContracts.get(id);
    if (variableContract === undefined) throw new TypeError(`Artifact supplies undeclared template variable ${id}`);
    if (
      new Set(binding.evidence_refs).size !== binding.evidence_refs.length ||
      binding.evidence_refs.some((ref) => !evidenceKinds.has(ref))
    ) {
      throw new TypeError(`template variable ${id} has invalid evidence bindings`);
    }
    validateVariableValue(variableContract, binding.value);
  }
  validateIndexerTemplateVariableLayers({ result, artifact, contract });
  const sections: IndexerRenderedArtifact["sections"] = [];
  const gaps: IndexerRenderedArtifact["material_question_gaps"] = [];
  for (const section of contract.sections) {
    const referencedVariables = new Set(section.variable_ids);
    for (const blockId of section.deterministic_block_ids) {
      referencedVariables.add(blocks.get(blockId)!.source_variable_id);
    }
    const bindings = [...referencedVariables].map((id) => ({
      contract: variableContracts.get(id)!,
      binding: artifact.variables[id],
    }));
    const missingRequired = bindings.some(({ contract: variable, binding }) =>
      variable.required && (binding === undefined || !variableAvailable(binding.value))
    );
    const evidenceRefs = [...new Set(bindings.flatMap(({ binding }) => binding?.evidence_refs ?? []))].sort();
    const acceptedKinds = new Set(section.accepted_evidence_kinds);
    const validEvidenceRefs = evidenceRefs.filter((ref) => acceptedKinds.has(evidenceKinds.get(ref)!));
    const missingEvidence = validEvidenceRefs.length < section.minimum_evidence_items ||
      bindings.some(({ contract: variable, binding }) =>
        variable.evidence_required &&
        !(binding?.evidence_refs.some((ref) => acceptedKinds.has(evidenceKinds.get(ref)!)) ?? false)
      );
    const hasData = bindings.some(({ binding }) =>
      binding !== undefined && variableAvailable(binding.value)
    );
    if (missingRequired || missingEvidence || !hasData) {
      if (section.presence === "optional") continue;
      const question = questionBindings.get(section.section_key)!;
      const proposal = result.material_question_proposals.find((candidate) =>
        candidate.question_ref === question.question_ref &&
        candidate.question_target_key === question.question_target_key &&
        candidate.answer_landing_hint?.artifact_id === artifact.artifact_id &&
        candidate.answer_landing_hint.section_key === section.section_key
      );
      const disposition = result.question_target_dispositions.find((candidate) =>
        candidate.question_target_key === question.question_target_key
      );
      if (
        proposal === undefined ||
        disposition?.state !== "material-gap" ||
        disposition.material_question_proposal_ref !== proposal.proposal_ref
      ) {
        throw new TypeError(`required Section ${section.section_key} lacks its material question transition`);
      }
      gaps.push({
        section_key: section.section_key,
        question_ref: question.question_ref,
        question_target_key: question.question_target_key,
        material_question_proposal_ref: proposal.proposal_ref,
      });
      continue;
    }
    if (section.presence === "required") {
      const question = questionBindings.get(section.section_key)!;
      const disposition = result.question_target_dispositions.find((candidate) =>
        candidate.question_target_key === question.question_target_key
      );
      const acceptedEvidenceDigests = new Set(
        validEvidenceRefs.map((ref) => result.evidence_bindings.find(
          (evidence) => evidence.evidence_ref === ref,
        )!.binding_digest),
      );
      if (
        disposition?.state !== "answered" ||
        !acceptedEvidenceDigests.has(disposition.evidence_binding_digest)
      ) {
        throw new TypeError(`rendered required Section ${section.section_key} is not evidence-answered`);
      }
    }
    const layered = renderIndexerTemplateSectionLayers({
      body: input.template.section_bodies[section.section_key]!,
      section,
      result,
      artifact,
      contract,
      acceptedEvidenceRefs: new Set(validEvidenceRefs),
    });
    const markdown = layered.markdown;
    assertNoTemplateResidue(section.section_key, markdown);
    const projection = projectionMap.get(section.section_key)!;
    sections.push({
      ...projection,
      markdown,
      content_blocks: layered.contentBlocks,
      evidence_refs: layered.evidenceRefs,
      content_digest: indexerProtocolDigest({
        markdown,
        content_blocks: layered.contentBlocks,
        evidence_refs: layered.evidenceRefs,
      }),
    });
  }
  const renderedBytes = sections.reduce(
    (total, section) => total + Buffer.byteLength(section.markdown, "utf8"),
    0,
  );
  if (renderedBytes > contract.maximum_rendered_bytes) {
    throw new TypeError("rendered Artifact exceeds the template expansion budget");
  }
  const payload: Omit<IndexerRenderedArtifact, "rendered_digest"> = {
    protocol: "context.indexer.rendered-artifact/v1",
    artifact_result_digest: result.output_digest,
    artifact_id: artifact.artifact_id,
    artifact_kind: artifact.artifact_kind,
    artifact_policy_variant: artifact.artifact_policy_variant,
    template_id: artifact.template_id,
    profile: contract.profile,
    template_digest: input.template.payload_digest,
    template_origin: input.template.origin,
    sections,
    material_question_gaps: gaps,
    review_ready: gaps.length === 0,
  };
  return indexerRenderedArtifactSchema.parse({
    ...payload,
    rendered_digest: indexerRenderedArtifactDigest(payload),
  });
}
