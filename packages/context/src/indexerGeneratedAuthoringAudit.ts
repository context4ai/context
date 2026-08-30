import { z } from "zod";
import type { IndexerArtifactResult } from "./indexerArtifactResult.js";
import {
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";

const structuredClaimOwnerSchema = z.object({
  artifact_id: indexerIdSchema,
  section_key: indexerIdSchema,
}).strict();

const structuredClaimSchema = z.object({
  claim_ref: indexerCanonicalRefSchema,
  claim_kind: indexerIdSchema,
  subject_ref: indexerCanonicalRefSchema,
  owner: structuredClaimOwnerSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerStructuredClaimSetSchema = z.object({
  protocol: z.literal("context.indexer.structured-claim-set/v1"),
  author_workset_digest: indexerDigestSchema,
  logical_unit_ref: indexerCanonicalRefSchema,
  claims: z.array(structuredClaimSchema).min(1),
  claims_digest: indexerDigestSchema,
}).strict();

const generatedAuthoringFindingSchema = z.object({
  code: z.enum([
    "generated-placeholder",
    "empty-required-section",
  ]),
  artifact_id: indexerIdSchema,
  section_key: indexerIdSchema.nullable(),
  content_ref: z.string().min(1),
}).strict();

const semanticProseReviewTargetSchema = z.object({
  artifact_id: indexerIdSchema,
  section_key: indexerIdSchema.nullable(),
  content_ref: z.string().min(1),
  advisory_code: z.literal("semantic-prose-agent-review-required"),
}).strict();

export const indexerGeneratedAuthoringAuditSchema = z.object({
  protocol: z.literal("context.indexer.generated-authoring-audit/v1"),
  artifact_result_digest: indexerDigestSchema,
  hard_findings: z.array(generatedAuthoringFindingSchema),
  structured_claim_count: z.number().int().nonnegative(),
  evidence_covered_structured_claim_count: z.number().int().nonnegative(),
  semantic_prose_review_targets: z.array(semanticProseReviewTargetSchema),
  agent_review_required: z.boolean(),
  audit_digest: indexerDigestSchema,
}).strict();

export type IndexerStructuredClaimSet = z.infer<
  typeof indexerStructuredClaimSetSchema
>;
export type IndexerGeneratedAuthoringAudit = z.infer<
  typeof indexerGeneratedAuthoringAuditSchema
>;

function assertCanonicalUnique(values: readonly string[], label: string): void {
  const expected = [...new Set(values)].sort(compareIndexerCanonicalText);
  if (
    expected.length !== values.length ||
    expected.some((value, index) => value !== values[index])
  ) {
    throw new TypeError(`${label} must be unique and canonically sorted`);
  }
}

function structuredClaimSetPayload(
  value: Omit<IndexerStructuredClaimSet, "claims_digest">,
): unknown {
  return value;
}

export function buildIndexerStructuredClaimSet(input: {
  author_workset_digest: string;
  logical_unit_ref: string;
  claims: readonly z.input<typeof structuredClaimSchema>[];
}): IndexerStructuredClaimSet {
  const payload = indexerStructuredClaimSetSchema.omit({ claims_digest: true }).parse({
    protocol: "context.indexer.structured-claim-set/v1",
    author_workset_digest: input.author_workset_digest,
    logical_unit_ref: input.logical_unit_ref,
    claims: input.claims,
  });
  return indexerStructuredClaimSetSchema.parse({
    ...payload,
    claims_digest: indexerProtocolDigest(structuredClaimSetPayload(payload)),
  });
}

export function validateIndexerStructuredClaimSet(input: {
  value: unknown;
  expected_author_workset_digest: string;
  expected_logical_unit_ref: string;
  authorized_subject_refs: readonly string[];
  known_evidence_refs: readonly string[];
  section_evidence_inventory: readonly {
    artifact_id: string;
    section_key: string;
    evidence_refs: readonly string[];
  }[];
}): IndexerStructuredClaimSet {
  const value = indexerStructuredClaimSetSchema.parse(input.value);
  if (
    value.author_workset_digest !== input.expected_author_workset_digest ||
    value.logical_unit_ref !== input.expected_logical_unit_ref
  ) {
    throw new TypeError("structured claim set does not match its author workset/logical unit");
  }
  if (
    value.claims_digest !== indexerProtocolDigest(structuredClaimSetPayload({
      protocol: value.protocol,
      author_workset_digest: value.author_workset_digest,
      logical_unit_ref: value.logical_unit_ref,
      claims: value.claims,
    }))
  ) {
    throw new TypeError("structured claim set digest is invalid");
  }
  assertCanonicalUnique(
    value.claims.map((claim) => claim.claim_ref),
    "structured claims.claim_ref",
  );
  const authorizedSubjects = new Set(input.authorized_subject_refs);
  const knownEvidence = new Set(input.known_evidence_refs);
  const ownerEvidence = new Map(input.section_evidence_inventory.map((section) => [
    `${section.artifact_id}\u0000${section.section_key}`,
    new Set(section.evidence_refs),
  ]));
  for (const claim of value.claims) {
    assertCanonicalUnique(claim.evidence_refs, `${claim.claim_ref}.evidence_refs`);
    if (!authorizedSubjects.has(claim.subject_ref)) {
      throw new TypeError(`structured claim ${claim.claim_ref} has an unauthorized subject`);
    }
    if (claim.evidence_refs.some((ref) => !knownEvidence.has(ref))) {
      throw new TypeError(`structured claim ${claim.claim_ref} references unknown evidence`);
    }
    const evidence = ownerEvidence.get(
      `${claim.owner.artifact_id}\u0000${claim.owner.section_key}`,
    );
    if (evidence === undefined) {
      throw new TypeError(`structured claim ${claim.claim_ref} references an unknown owner Section`);
    }
    if (claim.evidence_refs.some((ref) => !evidence.has(ref))) {
      throw new TypeError(
        `structured claim ${claim.claim_ref} evidence is not carried by its owner Section`,
      );
    }
  }
  return value;
}

export function containsIndexerControlledAuthoringPlaceholder(
  markdown: string,
): boolean {
  if (/\{\{|\}\}|<!--/u.test(markdown)) return true;
  if (
    /\[(?:TODO|TBD|待补充|待生成|placeholder(?:[^\]]*)?|example|your\s+[^\]]+)\]/iu
      .test(markdown) ||
    /<(?:TODO|TBD|待补充|待生成|placeholder(?:[^>]*)?|example|your[-_ ][^>]+)>/iu
      .test(markdown)
  ) {
    return true;
  }
  return markdown.split("\n").some((line) => {
    const marker = line.trim()
      .replace(/^#{1,6}\s+/u, "")
      .replace(/^[-*+]\s+/u, "")
      .trim();
    return /^(?:TODO|TBD|待补充|待生成|占位|placeholder|coming soon)[.!。！?？…]*$/iu
      .test(marker);
  });
}

function hasSubstantiveMarkdown(markdown: string): boolean {
  return markdown.split("\n").some((line) => {
    const value = line.trim();
    return value.length > 0 &&
      !/^#{1,6}(?:\s+.*)?$/u.test(value) &&
      !/^[-|:\s]+$/u.test(value) &&
      !/^<!--.*-->$/u.test(value) &&
      !containsIndexerControlledAuthoringPlaceholder(value);
  });
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
}

function auditPayload(
  value: Omit<IndexerGeneratedAuthoringAudit, "audit_digest">,
): unknown {
  return value;
}

export function buildIndexerGeneratedAuthoringAudit(
  result: IndexerArtifactResult,
): IndexerGeneratedAuthoringAudit {
  const hardFindings: IndexerGeneratedAuthoringAudit["hard_findings"] = [];
  const reviewTargets: IndexerGeneratedAuthoringAudit["semantic_prose_review_targets"] = [];
  for (const artifact of result.artifacts) {
    if (artifact.representation === "sections") {
      for (const section of artifact.sections) {
        let sectionHasSubstance = false;
        for (const block of section.blocks) {
          if (block.layer === "deterministic-block") {
            sectionHasSubstance = true;
            continue;
          }
          const contentRef = `block:${block.block_id}`;
          reviewTargets.push({
            artifact_id: artifact.artifact_id,
            section_key: section.section_key,
            content_ref: contentRef,
            advisory_code: "semantic-prose-agent-review-required",
          });
          if (containsIndexerControlledAuthoringPlaceholder(block.markdown)) {
            hardFindings.push({
              code: "generated-placeholder",
              artifact_id: artifact.artifact_id,
              section_key: section.section_key,
              content_ref: contentRef,
            });
          }
          if (hasSubstantiveMarkdown(block.markdown)) sectionHasSubstance = true;
        }
        if (!sectionHasSubstance) {
          hardFindings.push({
            code: "empty-required-section",
            artifact_id: artifact.artifact_id,
            section_key: section.section_key,
            content_ref: `section:${section.section_key}`,
          });
        }
      }
      continue;
    }
    for (const [variableId, variable] of Object.entries(artifact.variables)) {
      if (variable.fact_refs.length > 0) continue;
      const contentRef = `variable:${variableId}`;
      reviewTargets.push({
        artifact_id: artifact.artifact_id,
        section_key: null,
        content_ref: contentRef,
        advisory_code: "semantic-prose-agent-review-required",
      });
      if (
        stringLeaves(variable.value).some(
          containsIndexerControlledAuthoringPlaceholder,
        )
      ) {
        hardFindings.push({
          code: "generated-placeholder",
          artifact_id: artifact.artifact_id,
          section_key: null,
          content_ref: contentRef,
        });
      }
    }
  }
  hardFindings.sort((left, right) =>
    compareIndexerCanonicalText(
      `${left.artifact_id}\u0000${left.section_key ?? ""}\u0000${left.content_ref}\u0000${left.code}`,
      `${right.artifact_id}\u0000${right.section_key ?? ""}\u0000${right.content_ref}\u0000${right.code}`,
    )
  );
  reviewTargets.sort((left, right) =>
    compareIndexerCanonicalText(
      `${left.artifact_id}\u0000${left.section_key ?? ""}\u0000${left.content_ref}`,
      `${right.artifact_id}\u0000${right.section_key ?? ""}\u0000${right.content_ref}`,
    )
  );
  const claimCount = result.structured_claims?.claims.length ?? 0;
  const payload = indexerGeneratedAuthoringAuditSchema.omit({ audit_digest: true }).parse({
    protocol: "context.indexer.generated-authoring-audit/v1",
    artifact_result_digest: result.output_digest,
    hard_findings: hardFindings,
    structured_claim_count: claimCount,
    evidence_covered_structured_claim_count: claimCount,
    semantic_prose_review_targets: reviewTargets,
    agent_review_required: reviewTargets.length > 0,
  });
  return indexerGeneratedAuthoringAuditSchema.parse({
    ...payload,
    audit_digest: indexerProtocolDigest(auditPayload(payload)),
  });
}

export function validateIndexerGeneratedAuthoringAudit(
  value: unknown,
): IndexerGeneratedAuthoringAudit {
  const audit = indexerGeneratedAuthoringAuditSchema.parse(value);
  if (
    audit.evidence_covered_structured_claim_count !== audit.structured_claim_count ||
    audit.agent_review_required !== (audit.semantic_prose_review_targets.length > 0)
  ) {
    throw new TypeError("generated authoring audit coverage/review state is inconsistent");
  }
  const { audit_digest: _digest, ...payload } = audit;
  void _digest;
  if (audit.audit_digest !== indexerProtocolDigest(auditPayload(payload))) {
    throw new TypeError("generated authoring audit digest is invalid");
  }
  return audit;
}

export function assertIndexerGeneratedAuthoringAuditClear(
  audit: IndexerGeneratedAuthoringAudit,
): void {
  validateIndexerGeneratedAuthoringAudit(audit);
  if (audit.hard_findings.length > 0) {
    const finding = audit.hard_findings[0]!;
    throw new TypeError(
      `generated authoring audit failed: ${finding.code} at ${finding.artifact_id}/${finding.content_ref}`,
    );
  }
}
