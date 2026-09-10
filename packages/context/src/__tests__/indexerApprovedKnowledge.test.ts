import { expect, test } from "bun:test";
import { buildIndexerApprovedKnowledge, projectIndexerApprovedKnowledge, validateIndexerApprovedKnowledge } from "../indexerApprovedKnowledge.js";
import { indexerEvidenceBindingDigest } from "../indexerArtifactResult.js";

const digest = `sha256:${"1".repeat(64)}`;
const subject = { protocol: "context.subject-key/v1" as const, namespace: "example", kind: "service", local_key: "orders" };
const source = { source_ref: "repo:example", module_ref: "module:service", version: "commit-1" };
const dependency = { artifact_ref: "artifact:orders", section_refs: [], required: true };

function snapshot() {
  const binding = { evidence_ref: "evidence:orders", kind: "code" as const, source_ref: source.source_ref,
    module_ref: source.module_ref, locator: { path: "src/orders.ts", start_line: 1, end_line: 4 },
    content_digest: digest, coverage_tier: "ast-catalog" as const };
  return buildIndexerApprovedKnowledge({ protocol: "context.indexer.approved-knowledge/v1",
    artifact_ref: dependency.artifact_ref, subject_key: subject, path: "codeindex/orders/api.md", approved_content_digest: digest,
    source_versions: [source], dependencies: [],
    sections: [{ section_ref: "section:entry", markdown: "The approved article describes the order entry.", fact_refs: ["fact:entry"], evidence_refs: [binding.evidence_ref] }],
    facts: [{ fact_ref: "fact:entry", fact_kind: "code-symbol", subject_key: subject, value: { name: "createOrder" }, evidence_refs: [binding.evidence_ref] }],
    evidence_bindings: [{ ...binding, binding_digest: indexerEvidenceBindingDigest(binding) }],
  });
}

function input() {
  return { dependencies: [dependency], snapshots: [snapshot()], approved_versions: new Map([[dependency.artifact_ref, digest]]),
    authorized_sources: [source], evidence_kinds: new Set(["code"]), subject_key: { ...subject, local_key: "journey" } };
}

test("approved interpretation and source facts remain distinct in a version-bound supporting projection", () => {
  const projected = projectIndexerApprovedKnowledge(input());
  expect(projected.status).toBe("ready");
  expect(projected.facts[0]?.subject_key.local_key).toBe("journey");
  expect(projected.facts[0]?.value).toMatchObject({ original_fact_ref: "fact:entry", original_subject: subject, value: { name: "createOrder" } });
  expect(projected.reading_sections[0]).toMatchObject({ evidence_role: "approved-interpretation", approved_content_digest: digest, evidence_refs: ["evidence:orders"] });
  expect(projected.versions[0]?.artifact_ref).toBe(dependency.artifact_ref);
});

test("missing or changed required dependencies remain pending, while absent optional dependencies can be omitted", () => {
  expect(projectIndexerApprovedKnowledge({ ...input(), snapshots: [] })).toMatchObject({ status: "waiting", pending: [{ reason: "not-approved" }] });
  expect(projectIndexerApprovedKnowledge({ ...input(), approved_versions: new Map() })).toMatchObject({ status: "waiting", pending: [{ reason: "approval-changed" }] });
  expect(projectIndexerApprovedKnowledge({ ...input(), authorized_sources: [{ ...source, version: "commit-2" }] })).toMatchObject({ status: "waiting", pending: [{ reason: "source-version-changed" }] });
  expect(projectIndexerApprovedKnowledge({ ...input(), snapshots: [], dependencies: [{ ...dependency, required: false }] })).toMatchObject({ status: "ready", facts: [], pending: [{ required: false }] });
});

test("supporting knowledge cannot bypass source authorization, Provider capabilities or stable section identity", () => {
  expect(() => projectIndexerApprovedKnowledge({ ...input(), authorized_sources: [] })).toThrow("read scope");
  expect(() => projectIndexerApprovedKnowledge({ ...input(), evidence_kinds: new Set(["documentation"]) })).toThrow("evidence kind");
  expect(projectIndexerApprovedKnowledge({ ...input(), dependencies: [{ ...dependency, section_refs: ["section:removed"] }] })).toMatchObject({ status: "waiting", facts: [], pending: [{ reason: "section-unavailable" }] });
});

test("snapshot and evidence integrity are verified before exposing stored facts", () => {
  const changed = snapshot();
  changed.facts[0]!.value = { name: "unverifiedReplacement" };
  expect(() => validateIndexerApprovedKnowledge(changed)).toThrow("integrity");
  const { snapshot_digest: _, ...payload } = snapshot(); void _;
  expect(() => buildIndexerApprovedKnowledge({ ...payload, evidence_bindings: [{ ...payload.evidence_bindings[0]!, locator: { path: "private.ts", start_line: 1, end_line: 4 } }] })).toThrow("binding changed");
});
