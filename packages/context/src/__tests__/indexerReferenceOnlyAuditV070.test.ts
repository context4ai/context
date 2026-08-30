import { describe, expect, test } from "bun:test";
import {
  assertNoReferenceOnlyReaderTargets,
  buildIndexerReaderTargetFactInventory,
  buildIndexerReaderTargetProjection,
  buildIndexerReferenceOnlyReaderTargetAudit,
  indexerReaderTargetFactInventoryDigest,
  indexerReferenceOnlyReaderTargetAuditDigest,
  validateIndexerReaderTargetFactInventory,
  validateIndexerReaderTargetProjection,
  validateIndexerReferenceOnlyReaderTargetAudit,
  type IndexerReaderTargetFactInventory,
  type IndexerReaderTargetObservationInput,
  type IndexerReferenceOnlyReaderTargetAudit,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function observation(input: {
  identity: string;
  kind: IndexerReaderTargetObservationInput["observation_kind"];
  evidence: string;
  content?: string;
}): IndexerReaderTargetObservationInput {
  return {
    canonical_identity_ref: input.identity,
    observation_kind: input.kind,
    source_ref: "repo:sample@revision",
    module_ref: "module:library",
    content_digest: digest(input.content ?? "b"),
    evidence_refs: [input.evidence],
  };
}

describe("reference-only reader target gate", () => {
  const factInventory = buildIndexerReaderTargetFactInventory({
    source_scope_digest: digest("a"),
    observations: [
      observation({
        identity: "symbol:button",
        kind: "public-export",
        evidence: "evidence:button-export",
      }),
      observation({
        identity: "subject:component-family",
        kind: "partition-subject",
        evidence: "evidence:component-family",
      }),
      observation({
        identity: "symbol:helper-alias",
        kind: "import-alias",
        evidence: "evidence:helper-import",
      }),
      observation({
        identity: "symbol:button",
        kind: "symbol-reference",
        evidence: "evidence:button-callsite",
        content: "c",
      }),
    ],
  });

  test("accepts declared and partition identities even when references also exist", () => {
    const projection = buildIndexerReaderTargetProjection({
      artifact_set_digest: digest("d"),
      targets: [{
        canonical_identity_ref: "symbol:button",
        target_kind: "public-capability",
        landing_refs: ["section:button", "artifact:button-content"],
      }, {
        canonical_identity_ref: "subject:component-family",
        target_kind: "logical-unit",
        landing_refs: ["artifact:component-family"],
      }],
    });
    const audit = buildIndexerReferenceOnlyReaderTargetAudit({
      fact_inventory: factInventory,
      target_projection: projection,
    });
    expect(audit).toMatchObject({
      target_count: 2,
      authoritative_target_count: 2,
      reference_only_target_count: 0,
      unsubstantiated_target_count: 0,
      pass: true,
      metric: {
        metric_id: "reference-only-reader-targets",
        actual: 0,
        denominator: 2,
      },
    });
    expect(assertNoReferenceOnlyReaderTargets({
      value: audit,
      fact_inventory: factInventory,
      target_projection: projection,
    })).toEqual(audit);
  });

  test("rejects import aliases and lightweight evidence as sole target authority", () => {
    const lightweight = buildIndexerReaderTargetFactInventory({
      source_scope_digest: digest("a"),
      observations: [
        ...factInventory.observations,
        observation({
          identity: "config:theme-token",
          kind: "lightweight-evidence",
          evidence: "evidence:theme-config",
        }),
      ],
    });
    const projection = buildIndexerReaderTargetProjection({
      artifact_set_digest: digest("e"),
      targets: [{
        canonical_identity_ref: "symbol:helper-alias",
        target_kind: "symbol",
        landing_refs: ["artifact:helper"],
      }, {
        canonical_identity_ref: "config:theme-token",
        target_kind: "configuration",
        landing_refs: ["artifact:theme-token"],
      }],
    });
    const audit = buildIndexerReferenceOnlyReaderTargetAudit({
      fact_inventory: lightweight,
      target_projection: projection,
    });
    expect(audit).toMatchObject({
      reference_only_target_count: 2,
      unsubstantiated_target_count: 0,
      pass: false,
      metric: { actual: 2, denominator: 2 },
    });
    expect(() => assertNoReferenceOnlyReaderTargets({
      value: audit,
      fact_inventory: lightweight,
      target_projection: projection,
    })).toThrow(/reference-only-reader-targets/);
  });

  test("separates a target with no identity fact from a reference-only target", () => {
    const projection = buildIndexerReaderTargetProjection({
      artifact_set_digest: digest("f"),
      targets: [{
        canonical_identity_ref: "symbol:helper-alias",
        target_kind: "symbol",
        landing_refs: ["artifact:helper"],
      }, {
        canonical_identity_ref: "symbol:invented",
        target_kind: "symbol",
        landing_refs: ["artifact:invented"],
      }],
    });
    const audit = buildIndexerReferenceOnlyReaderTargetAudit({
      fact_inventory: factInventory,
      target_projection: projection,
    });
    expect(audit).toMatchObject({
      reference_only_target_count: 1,
      unsubstantiated_target_count: 1,
      pass: false,
    });
    expect(audit.metric.actual).toBe(1);
  });

  test("canonicalizes observations and prevents aliases from creating parallel targets", () => {
    const merged = buildIndexerReaderTargetFactInventory({
      source_scope_digest: digest("a"),
      observations: [
        observation({
          identity: "symbol:button",
          kind: "public-export",
          evidence: "evidence:button-export",
        }),
        observation({
          identity: "symbol:button",
          kind: "public-export",
          evidence: "evidence:secondary-export",
        }),
      ],
    });
    expect(merged.observations).toHaveLength(1);
    expect(merged.observations[0]!.evidence_refs).toEqual([
      "evidence:button-export",
      "evidence:secondary-export",
    ]);
    expect(() => buildIndexerReaderTargetProjection({
      artifact_set_digest: digest("d"),
      targets: [{
        canonical_identity_ref: "symbol:button",
        target_kind: "public-capability",
        landing_refs: ["artifact:button"],
      }, {
        canonical_identity_ref: "symbol:button",
        target_kind: "alias",
        landing_refs: ["artifact:button-alias"],
      }],
    })).toThrow(/cannot create multiple reader targets/);
  });

  test("rejects forged inventories, projections, and digest-consistent audit passes", () => {
    const forgedInventory = structuredClone(factInventory);
    forgedInventory.observations[0]!.observation_kind = "symbol-reference";
    const inventoryPayload = Object.fromEntries(
      Object.entries(forgedInventory).filter(([key]) => key !== "inventory_digest"),
    ) as Omit<IndexerReaderTargetFactInventory, "inventory_digest">;
    forgedInventory.inventory_digest = indexerReaderTargetFactInventoryDigest(inventoryPayload);
    expect(() => validateIndexerReaderTargetFactInventory({
      value: forgedInventory,
    })).toThrow(/non-canonical|invalid/);
    expect(() => validateIndexerReaderTargetFactInventory({
      value: factInventory,
      known_evidence_refs: ["evidence:other"],
    })).toThrow(/unknown evidence/);

    const projection = buildIndexerReaderTargetProjection({
      artifact_set_digest: digest("d"),
      targets: [{
        canonical_identity_ref: "symbol:helper-alias",
        target_kind: "symbol",
        landing_refs: ["artifact:helper"],
      }],
    });
    const forgedProjection = structuredClone(projection);
    forgedProjection.targets[0]!.reader_target_ref = "reader-target:forged";
    expect(() => validateIndexerReaderTargetProjection(forgedProjection)).toThrow(
      /non-canonical|invalid/,
    );

    const forgedAudit = structuredClone(buildIndexerReferenceOnlyReaderTargetAudit({
      fact_inventory: factInventory,
      target_projection: projection,
    }));
    forgedAudit.pass = true;
    forgedAudit.reference_only_target_count = 0;
    forgedAudit.reference_only_target_refs = [];
    forgedAudit.metric.actual = 0;
    forgedAudit.metric.target_refs = [];
    const auditPayload = Object.fromEntries(
      Object.entries(forgedAudit).filter(([key]) => key !== "audit_digest"),
    ) as Omit<IndexerReferenceOnlyReaderTargetAudit, "audit_digest">;
    forgedAudit.audit_digest = indexerReferenceOnlyReaderTargetAuditDigest(auditPayload);
    expect(() => validateIndexerReferenceOnlyReaderTargetAudit({
      value: forgedAudit,
      fact_inventory: factInventory,
      target_projection: projection,
    })).toThrow(/does not match current inputs/);
  });
});
