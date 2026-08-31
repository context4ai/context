import { z } from "zod";
import {
  indexerArtifactResultDigest,
  indexerArtifactResultSchema,
  indexerEvidenceBindingSchema,
  type IndexerArtifactResult,
} from "./indexerArtifactResult.js";
import { indexerKnowledgeCollectionSchema } from "./indexerCollectionMapping.js";
import { materializeIndexerStructuredContent } from "./indexerContentLayers.js";
import {
  authorizeIndexerLayoutChange,
  indexerLayoutChangeConfirmationSchema,
} from "./indexerLayoutChange.js";
import {
  validateIndexerLayoutProposal,
  type IndexerLayoutProposal,
} from "./indexerLayoutResolver.js";
import {
  validateIndexerLayoutProposalSet,
} from "./indexerLayoutProposalSet.js";
import {
  indexerLayoutTransitionSchema,
  validateIndexerLayoutTransition,
} from "./indexerLayoutTransition.js";
import { indexerMainAcceptedRecordSchema } from "./indexerMainLifecycle.js";
import { indexerMainRunResultSchema } from "./indexerMainRunProtocol.js";
import {
  validateIndexerRunEnvelope,
  type IndexerRunEnvelope,
} from "./indexerRunEnvelope.js";
import {
  auditIndexerPhysicalArtifacts,
  indexerPhysicalArtifactAuditSchema,
} from "./indexerPhysicalArtifactAudit.js";
import { indexerArtifactManifestSchema } from "./indexerPhysicalArtifactManifest.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";
import { indexerSharedArtifactFingerprintSchema } from
  "./indexerSharedArtifactFingerprint.js";
import {
  validateIndexerRenderedArtifact,
  type IndexerRenderedArtifact,
} from "./indexerTemplateRendering.js";

const compileResultBindingSchema = z.object({
  workset_digest: indexerDigestSchema,
  execution_request_digest: indexerDigestSchema,
  acceptance_digest: indexerDigestSchema,
  run_result_digest: indexerDigestSchema,
  indexer_result_digest: indexerDigestSchema,
  artifact_result_digest: indexerDigestSchema,
  layout_proposal_digest: indexerDigestSchema,
  run_envelope_digest: indexerDigestSchema,
  shared_artifact_fingerprint: indexerSharedArtifactFingerprintSchema,
  indexer_id: indexerIdSchema,
  provider_layer_ref: z.string().min(1),
  provider_integrity: indexerDigestSchema,
  provider_bundle_digest: indexerDigestSchema,
  config_fingerprint: indexerDigestSchema,
  customization_fingerprint: indexerDigestSchema.nullable(),
  binding_digest: indexerDigestSchema,
}).strict();

const candidateFilePayloadSchema = z.object({
  artifact_ref: z.string().min(1),
  node_ref: z.string().min(1),
  internal_view_ref: z.string().min(1),
  collection: indexerKnowledgeCollectionSchema,
  artifact_kind: indexerIdSchema,
  output_path: portableIndexerPathSchema,
  indexer_id: indexerIdSchema,
  source_ref: z.string().min(1),
  evidence_bindings: z.array(indexerEvidenceBindingSchema),
  acceptance_digest: indexerDigestSchema,
  indexer_result_digest: indexerDigestSchema,
  artifact_result_digest: indexerDigestSchema,
  layout_proposal_digest: indexerDigestSchema,
  result_binding_digest: indexerDigestSchema,
  shared_artifact_fingerprint_digest: indexerDigestSchema,
  section_refs: z.array(z.string().min(1)).min(1),
  sections: z.array(z.object({
    section_ref: z.string().min(1),
    section_key: indexerIdSchema,
    evidence_refs: z.array(z.string().min(1)),
    markdown: z.string().min(1),
    markdown_digest: indexerDigestSchema,
  }).strict()).min(1),
  markdown: z.string().min(1),
  markdown_digest: indexerDigestSchema,
}).strict();

const candidateFileSchema = candidateFilePayloadSchema.extend({
  file_digest: indexerDigestSchema,
}).strict();

const candidateCompilePayloadSchema = z.object({
  protocol: z.literal("context.indexer.candidate-compile/v1"),
  layout_proposal_set_digest: indexerDigestSchema,
  layout_transition_digest: indexerDigestSchema,
  accepted_result_set_digest: indexerDigestSchema,
  result_bindings: z.array(compileResultBindingSchema).min(1),
  files: z.array(candidateFileSchema).min(1),
  artifact_manifest: indexerArtifactManifestSchema,
  physical_artifact_audit: indexerPhysicalArtifactAuditSchema,
}).strict();

export const indexerCandidateCompileSchema = candidateCompilePayloadSchema.extend({
  compile_digest: indexerDigestSchema,
}).strict();

export type IndexerCandidateCompile = z.infer<typeof indexerCandidateCompileSchema>;

export interface IndexerAcceptedAuthorResultInput {
  run_result: unknown;
  accepted_record: unknown;
  run_envelope: unknown;
  rendered_artifacts?: readonly unknown[];
}

interface ValidatedAcceptedAuthorResult {
  runResult: z.infer<typeof indexerMainRunResultSchema>;
  acceptedRecord: z.infer<typeof indexerMainAcceptedRecordSchema>;
  runEnvelope: IndexerRunEnvelope;
  artifactResult: IndexerArtifactResult;
  renderedArtifacts: IndexerRenderedArtifact[];
}

function artifactResultPayload(
  result: IndexerArtifactResult,
): Omit<IndexerArtifactResult, "output_digest"> {
  const { output_digest: _digest, ...payload } = result;
  void _digest;
  return payload;
}

function validateAcceptedAuthorResult(
  value: IndexerAcceptedAuthorResultInput,
): ValidatedAcceptedAuthorResult {
  const runResult = indexerMainRunResultSchema.parse(value.run_result);
  const acceptedRecord = indexerMainAcceptedRecordSchema.parse(value.accepted_record);
  const runEnvelope = validateIndexerRunEnvelope(value.run_envelope);
  if (
    runResult.result.stage !== "author" ||
    acceptedRecord.stage !== "author" ||
    runEnvelope.stage !== "author"
  ) {
    throw new TypeError("Candidate compile accepts only author Indexer Results");
  }
  const artifactResult = indexerArtifactResultSchema.parse(runResult.result.result);
  if (
    indexerArtifactResultDigest(artifactResultPayload(artifactResult)) !==
      artifactResult.output_digest
  ) {
    throw new TypeError("Candidate compile requires a current explicit ArtifactResult digest");
  }
  const { acceptance_digest: _acceptanceDigest, ...acceptancePayload } = acceptedRecord;
  void _acceptanceDigest;
  if (
    indexerProtocolDigest(acceptancePayload) !== acceptedRecord.acceptance_digest ||
    acceptedRecord.workset_digest !== runResult.result.workset_digest ||
    acceptedRecord.execution_request_digest !==
      runResult.result.execution_request_digest ||
    acceptedRecord.result_digest !== indexerProtocolDigest(artifactResult) ||
    acceptedRecord.run_envelope_digest !== runEnvelope.envelope_digest
  ) {
    throw new TypeError("Candidate compile Result is not bound to its accepted author record");
  }
  if (
    runEnvelope.workset_digest !== acceptedRecord.workset_digest ||
    runEnvelope.execution_request_digest !== acceptedRecord.execution_request_digest ||
    runEnvelope.indexer_id !== artifactResult.indexer_id ||
    runEnvelope.source_ref !== artifactResult.source_ref ||
    runEnvelope.module_ref !== artifactResult.module_ref ||
    runEnvelope.logical_unit_ref !== artifactResult.logical_unit.logical_unit_ref ||
    runEnvelope.provider_layer_ref !== artifactResult.provider_layer_ref ||
    runEnvelope.provider_integrity !== artifactResult.provider_integrity ||
    runEnvelope.provider_bundle_digest !== artifactResult.provider_bundle_digest ||
    runEnvelope.config_fingerprint !== artifactResult.config_fingerprint ||
    runEnvelope.customization_fingerprint !== artifactResult.customization_fingerprint ||
    runEnvelope.plan_binding_digest !== artifactResult.partition_plan_binding_digest ||
    runEnvelope.source_role !== artifactResult.source_role ||
    artifactResult.input_digest !== acceptedRecord.execution_request_digest
  ) {
    throw new TypeError("Candidate compile run envelope does not bind its ArtifactResult");
  }
  const renderedArtifacts = (value.rendered_artifacts ?? []).map(
    validateIndexerRenderedArtifact,
  );
  if (
    new Set(renderedArtifacts.map((artifact) => artifact.artifact_id)).size !==
      renderedArtifacts.length ||
    renderedArtifacts.some((artifact) =>
      artifact.artifact_result_digest !== artifactResult.output_digest
    )
  ) {
    throw new TypeError("Candidate compile rendered Artifacts do not bind one explicit Result");
  }
  return { runResult, acceptedRecord, runEnvelope, artifactResult, renderedArtifacts };
}

function resultBinding(input: {
  accepted: ValidatedAcceptedAuthorResult;
  proposal: IndexerLayoutProposal;
}) {
  const { acceptedRecord, artifactResult, runEnvelope, runResult } = input.accepted;
  const payload = {
    workset_digest: acceptedRecord.workset_digest,
    execution_request_digest: acceptedRecord.execution_request_digest,
    acceptance_digest: acceptedRecord.acceptance_digest,
    run_result_digest: indexerProtocolDigest(runResult),
    indexer_result_digest: acceptedRecord.result_digest,
    artifact_result_digest: artifactResult.output_digest,
    layout_proposal_digest: input.proposal.proposal_digest,
    run_envelope_digest: runEnvelope.envelope_digest,
    shared_artifact_fingerprint: runEnvelope.shared_artifact_fingerprint,
    indexer_id: artifactResult.indexer_id,
    provider_layer_ref: artifactResult.provider_layer_ref,
    provider_integrity: artifactResult.provider_integrity,
    provider_bundle_digest: artifactResult.provider_bundle_digest,
    config_fingerprint: artifactResult.config_fingerprint,
    customization_fingerprint: artifactResult.customization_fingerprint,
  };
  return compileResultBindingSchema.parse({
    ...payload,
    binding_digest: indexerProtocolDigest(payload),
  });
}

function assertSectionIntegrity(input: {
  proposal: IndexerLayoutProposal;
  artifactId: string;
  sectionKey: string;
  contentDigest: string;
  evidenceRefs: readonly string[];
}): void {
  const layoutArtifact = input.proposal.artifacts.find((artifact) =>
    artifact.artifact_id === input.artifactId
  );
  const section = layoutArtifact?.sections.find((candidate) =>
    candidate.section_key === input.sectionKey
  );
  if (
    section === undefined ||
    section.state === "material-gap" ||
    section.content_digest !== input.contentDigest ||
    canonicalIndexerJson(section.evidence_refs) !== canonicalIndexerJson(input.evidenceRefs)
  ) {
    throw new TypeError(
      `Candidate compile Section ${input.artifactId}/${input.sectionKey} is stale for layout`,
    );
  }
}

function structuredArtifactSections(input: {
  result: IndexerArtifactResult;
  proposal: IndexerLayoutProposal;
  artifact: Extract<IndexerArtifactResult["artifacts"][number], { representation: "sections" }>;
}) {
  return input.artifact.sections.map((section) => {
    const blocks = materializeIndexerStructuredContent({
      blocks: section.blocks,
      facts: input.result.facts,
    });
    const evidenceRefs = [...new Set(blocks.flatMap((block) => block.evidence_refs))]
      .sort(compareIndexerCanonicalText);
    assertSectionIntegrity({
      proposal: input.proposal,
      artifactId: input.artifact.artifact_id,
      sectionKey: section.section_key,
      contentDigest: indexerProtocolDigest({ content_blocks: blocks }),
      evidenceRefs,
    });
    const markdown = blocks.map((block) => block.markdown).join("\n\n");
    const layoutSection = input.proposal.artifacts
      .find((candidate) => candidate.artifact_id === input.artifact.artifact_id)!
      .sections.find((candidate) => candidate.section_key === section.section_key)!;
    return {
      section_ref: layoutSection.section_ref,
      section_key: section.section_key,
      evidence_refs: evidenceRefs,
      markdown,
      markdown_digest: indexerProtocolDigest({
        protocol: "context.indexer.physical-section-markdown/v1",
        markdown,
      }),
    };
  });
}

function templateArtifactSections(input: {
  proposal: IndexerLayoutProposal;
  artifact: Extract<IndexerArtifactResult["artifacts"][number], { representation: "template" }>;
  rendered: IndexerRenderedArtifact;
}) {
  const renderedBySection = new Map(input.rendered.sections.map((section) => [
    section.section_key,
    section,
  ]));
  const layoutArtifact = input.proposal.artifacts.find((candidate) =>
    candidate.artifact_id === input.artifact.artifact_id
  );
  if (
    layoutArtifact === undefined ||
    layoutArtifact.sections.some((section) => section.state === "material-gap")
  ) {
    throw new TypeError(`Candidate compile Artifact ${input.artifact.artifact_id} has unresolved material`);
  }
  return layoutArtifact.sections.map((layoutSection) => {
    const section = renderedBySection.get(layoutSection.section_key);
    if (section === undefined) {
      throw new TypeError(
        `Candidate compile rendered Artifact lacks Section ${layoutSection.section_key}`,
      );
    }
    assertSectionIntegrity({
      proposal: input.proposal,
      artifactId: input.artifact.artifact_id,
      sectionKey: section.section_key,
      contentDigest: section.content_digest,
      evidenceRefs: section.evidence_refs,
    });
    return {
      section_ref: layoutSection.section_ref,
      section_key: section.section_key,
      evidence_refs: section.evidence_refs,
      markdown: section.markdown,
      markdown_digest: indexerProtocolDigest({
        protocol: "context.indexer.physical-section-markdown/v1",
        markdown: section.markdown,
      }),
    };
  });
}

function candidateFiles(input: {
  accepted: ValidatedAcceptedAuthorResult;
  proposal: IndexerLayoutProposal;
  binding: z.infer<typeof compileResultBindingSchema>;
}) {
  const layoutById = new Map(input.proposal.artifacts.map((artifact) => [
    artifact.artifact_id,
    artifact,
  ]));
  const renderedById = new Map(input.accepted.renderedArtifacts.map((artifact) => [
    artifact.artifact_id,
    artifact,
  ]));
  return input.accepted.artifactResult.artifacts.map((artifact) => {
    const layout = layoutById.get(artifact.artifact_id);
    if (layout === undefined) {
      throw new TypeError(`Candidate compile Result Artifact ${artifact.artifact_id} has no layout`);
    }
    const sections = artifact.representation === "sections"
      ? structuredArtifactSections({
          result: input.accepted.artifactResult,
          proposal: input.proposal,
          artifact,
        })
      : (() => {
          const rendered = renderedById.get(artifact.artifact_id);
          if (rendered === undefined) {
            throw new TypeError(
              `Candidate compile template Artifact ${artifact.artifact_id} is not rendered`,
            );
          }
          return templateArtifactSections({
            proposal: input.proposal,
            artifact,
            rendered,
          });
        })();
    const markdown = sections.map((section) => section.markdown).join("\n\n");
    const evidenceRefs = new Set(layout.sections.flatMap((section) =>
      section.evidence_refs
    ));
    const evidenceBindings = input.accepted.artifactResult.evidence_bindings
      .filter((binding) => evidenceRefs.has(binding.evidence_ref))
      .sort((left, right) => compareIndexerCanonicalText(
        left.evidence_ref,
        right.evidence_ref,
      ));
    if (evidenceBindings.length !== evidenceRefs.size) {
      throw new TypeError(
        `Candidate compile Artifact ${artifact.artifact_id} has unresolved evidence bindings`,
      );
    }
    const payload = candidateFilePayloadSchema.parse({
      artifact_ref: layout.artifact_ref,
      node_ref: layout.node_ref,
      internal_view_ref: layout.internal_view_ref,
      collection: layout.collection,
      artifact_kind: layout.artifact_kind,
      output_path: layout.output_path,
      indexer_id: input.accepted.artifactResult.indexer_id,
      source_ref: input.accepted.artifactResult.source_ref,
      evidence_bindings: evidenceBindings,
      acceptance_digest: input.binding.acceptance_digest,
      indexer_result_digest: input.binding.indexer_result_digest,
      artifact_result_digest: input.binding.artifact_result_digest,
      layout_proposal_digest: input.binding.layout_proposal_digest,
      result_binding_digest: input.binding.binding_digest,
      shared_artifact_fingerprint_digest:
        input.binding.shared_artifact_fingerprint.fingerprint_digest,
      section_refs: layout.sections.map((section) => section.section_ref)
        .sort(compareIndexerCanonicalText),
      sections,
      markdown,
      markdown_digest: indexerProtocolDigest({
        protocol: "context.indexer.physical-markdown/v1",
        markdown,
      }),
    });
    return candidateFileSchema.parse({
      ...payload,
      file_digest: indexerProtocolDigest(payload),
    });
  });
}

function assertTransitionAuthority(input: {
  transition: z.infer<typeof indexerLayoutTransitionSchema>;
  proposalDigests: readonly string[];
  confirmations: readonly unknown[];
}): void {
  const reportTargets = input.transition.change_reports.map((report) =>
    report.target_proposal_digest
  ).sort(compareIndexerCanonicalText);
  const proposalTargets = [...input.proposalDigests].sort(compareIndexerCanonicalText);
  if (canonicalIndexerJson(reportTargets) !== canonicalIndexerJson(proposalTargets)) {
    throw new TypeError("Candidate compile layout transition does not cover the current proposal set");
  }
  const confirmations = input.confirmations.map((value) =>
    indexerLayoutChangeConfirmationSchema.parse(value)
  );
  const byReport = new Map(confirmations.map((confirmation) => [
    confirmation.report_digest,
    confirmation,
  ]));
  if (byReport.size !== confirmations.length) {
    throw new TypeError("Candidate compile layout confirmations must be unique");
  }
  for (const report of input.transition.change_reports) {
    const confirmation = byReport.get(report.report_digest);
    if (report.requires_confirmation && confirmation === undefined) {
      throw new TypeError("Candidate compile requires the exact layout change confirmation");
    }
    authorizeIndexerLayoutChange({
      report,
      ...(confirmation === undefined ? {} : { confirmation }),
    });
    if (confirmation !== undefined) byReport.delete(report.report_digest);
  }
  if (byReport.size > 0) {
    throw new TypeError("Candidate compile received an unrelated layout confirmation");
  }
}

export function buildIndexerCandidateCompile(input: {
  layout_proposal_set: unknown;
  layout_transition: unknown;
  layout_change_confirmations?: readonly unknown[];
  accepted_results: readonly IndexerAcceptedAuthorResultInput[];
  profile_contract: unknown;
  operator_contract: unknown;
  subject_key_schema_set: unknown;
}): IndexerCandidateCompile {
  const layoutSet = validateIndexerLayoutProposalSet(input.layout_proposal_set);
  const transition = validateIndexerLayoutTransition(input.layout_transition);
  if (transition.layout_proposal_set_digest !== layoutSet.set_digest) {
    throw new TypeError("Candidate compile layout transition is stale for the proposal set");
  }
  assertTransitionAuthority({
    transition,
    proposalDigests: layoutSet.proposals.map((proposal) => proposal.proposal_digest),
    confirmations: input.layout_change_confirmations ?? [],
  });
  const accepted = input.accepted_results.map(validateAcceptedAuthorResult);
  if (accepted.length === 0) {
    throw new TypeError("Candidate compile requires at least one explicit accepted IndexerResult");
  }
  const fingerprintByIndexer = new Map<string, string>();
  for (const item of accepted) {
    const fingerprint = item.runEnvelope.shared_artifact_fingerprint.fingerprint_digest;
    const current = fingerprintByIndexer.get(item.artifactResult.indexer_id);
    if (current !== undefined && current !== fingerprint) {
      throw new TypeError("Candidate compile mixes fingerprints for the same Indexer");
    }
    fingerprintByIndexer.set(item.artifactResult.indexer_id, fingerprint);
  }
  const acceptedByResult = new Map(accepted.map((item) => [
    item.artifactResult.output_digest,
    item,
  ]));
  const proposalByResult = new Map(layoutSet.proposals.map((proposal) => [
    proposal.artifact_result_digest,
    proposal,
  ]));
  if (
    acceptedByResult.size !== accepted.length ||
    proposalByResult.size !== layoutSet.proposals.length ||
    acceptedByResult.size !== proposalByResult.size ||
    [...acceptedByResult.keys()].some((digest) => !proposalByResult.has(digest))
  ) {
    throw new TypeError("Candidate compile requires one accepted IndexerResult per layout proposal");
  }
  const entries = accepted.map((item) => {
    const proposal = proposalByResult.get(item.artifactResult.output_digest)!;
    if (
      canonicalIndexerJson(proposal.shared_artifact_fingerprint) !==
        canonicalIndexerJson(item.runEnvelope.shared_artifact_fingerprint)
    ) {
      throw new TypeError("Candidate compile layout fingerprint is stale for its run envelope");
    }
    validateIndexerLayoutProposal({
      proposal,
      artifact_result: item.artifactResult,
      profile_contract: input.profile_contract,
      operator_contract: input.operator_contract,
      subject_key_schema_set: input.subject_key_schema_set,
      rendered_artifacts: item.renderedArtifacts,
    });
    const binding = resultBinding({ accepted: item, proposal });
    return {
      accepted: item,
      proposal,
      binding,
      files: candidateFiles({ accepted: item, proposal, binding }),
    };
  }).sort((left, right) => compareIndexerCanonicalText(
    left.binding.artifact_result_digest,
    right.binding.artifact_result_digest,
  ));
  const files = entries.flatMap((entry) => entry.files)
    .sort((left, right) => compareIndexerCanonicalText(left.output_path, right.output_path));
  if (new Set(files.map((file) => file.output_path)).size !== files.length) {
    throw new TypeError("Candidate compile produced colliding output paths");
  }
  const physical = auditIndexerPhysicalArtifacts({
    layout_proposal_set: layoutSet,
    artifact_bundles: entries.map((entry) => entry.accepted.artifactResult.artifact_bundle),
    files: files.map((file) => ({
      output_path: file.output_path,
      markdown: file.markdown,
    })),
  });
  if (physical.audit.state !== "passed") {
    throw new TypeError("Candidate compile physical Artifact audit did not pass");
  }
  const bindings = entries.map((entry) => entry.binding);
  const payload = candidateCompilePayloadSchema.parse({
    protocol: "context.indexer.candidate-compile/v1",
    layout_proposal_set_digest: layoutSet.set_digest,
    layout_transition_digest: transition.transition_digest,
    accepted_result_set_digest: indexerProtocolDigest(bindings.map((binding) =>
      binding.acceptance_digest
    )),
    result_bindings: bindings,
    files,
    artifact_manifest: physical.manifest,
    physical_artifact_audit: physical.audit,
  });
  return indexerCandidateCompileSchema.parse({
    ...payload,
    compile_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerCandidateCompile(input: Parameters<
  typeof buildIndexerCandidateCompile
>[0] & { compile: unknown }): IndexerCandidateCompile {
  const compile = indexerCandidateCompileSchema.parse(input.compile);
  const expected = buildIndexerCandidateCompile(input);
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(compile)) {
    throw new TypeError("Candidate compile is stale or forged");
  }
  return compile;
}
