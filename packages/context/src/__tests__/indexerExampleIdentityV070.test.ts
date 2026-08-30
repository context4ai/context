import { describe, expect, test } from "bun:test";
import {
  assertIndexerExampleIdentityAuditPassed,
  buildIndexerExampleIdentityAudit,
  buildIndexerExampleInventory,
  indexerExampleIdentityAuditDigest,
  indexerExampleInventoryDigest,
  validateIndexerExampleIdentityAudit,
  validateIndexerExampleInventory,
  type IndexerExampleIdentityAudit,
  type IndexerExampleInventory,
  type IndexerExampleObservationInput,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SCOPE_DIGEST = digest("a");

function observation(
  path: string,
  overrides: Partial<IndexerExampleObservationInput> = {},
): IndexerExampleObservationInput {
  return {
    public_target_ref: "target:button",
    scenario_key: "basic-usage",
    source_ref: "repo:sample@revision",
    module_ref: "module:components",
    full_relative_path: path,
    content_digest: digest("b"),
    evidence_refs: ["evidence:button-example"],
    ...overrides,
  };
}

function inventory(
  observations: readonly IndexerExampleObservationInput[],
): IndexerExampleInventory {
  return buildIndexerExampleInventory({
    source_scope_digest: SCOPE_DIGEST,
    observations,
  });
}

function rehashInventory(value: IndexerExampleInventory): void {
  const payload = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "inventory_digest"),
  ) as Omit<IndexerExampleInventory, "inventory_digest">;
  value.inventory_digest = indexerExampleInventoryDigest(payload);
}

function rehashAudit(value: IndexerExampleIdentityAudit): void {
  const payload = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "audit_digest"),
  ) as Omit<IndexerExampleIdentityAudit, "audit_digest">;
  value.audit_digest = indexerExampleIdentityAuditDigest(payload);
}

describe("full-path example identity and collision gate", () => {
  test("keeps equal basenames in different directories as distinct examples", () => {
    const current = inventory([
      observation("stories/button/basic.tsx"),
      observation("sandboxes/button/basic.tsx"),
    ]);
    const audit = buildIndexerExampleIdentityAudit(current);
    expect(current.observations.map((item) => item.full_relative_path).sort()).toEqual([
      "sandboxes/button/basic.tsx",
      "stories/button/basic.tsx",
    ]);
    expect(new Set(current.observations.map((item) => item.example_ref)).size).toBe(2);
    expect(assertIndexerExampleIdentityAuditPassed({ value: audit, inventory: current })).toEqual(
      audit,
    );
  });

  test("uses public target and scenario as independent identity dimensions", () => {
    const current = inventory([
      observation("stories/basic.tsx"),
      observation("stories/basic.tsx", { scenario_key: "disabled-state" }),
      observation("stories/basic.tsx", { public_target_ref: "target:icon-button" }),
    ]);
    const audit = buildIndexerExampleIdentityAudit(current);
    expect(new Set(current.observations.map((item) => item.example_ref)).size).toBe(3);
    expect(audit).toMatchObject({ pass: true, collision_count: 0, unique_example_count: 3 });
  });

  test("normalizes portable full paths and merges duplicate observation evidence", () => {
    const current = inventory([
      observation("./stories\\button\\basic.tsx"),
      observation("stories/button/basic.tsx", {
        evidence_refs: ["evidence:secondary"],
      }),
    ]);
    expect(current.observations).toHaveLength(1);
    expect(current.observations[0]).toMatchObject({
      full_relative_path: "stories/button/basic.tsx",
      evidence_refs: ["evidence:button-example", "evidence:secondary"],
    });
    expect(() => inventory([observation("../outside/basic.tsx")])).toThrow();
    expect(() => inventory([observation("/absolute/basic.tsx")])).toThrow();
  });

  test("reports one hard collision for distinct observations sharing the exact identity", () => {
    const current = inventory([
      observation("stories/button/basic.tsx"),
      observation("stories/button/basic.tsx", {
        source_ref: "repo:mirror@revision",
        content_digest: digest("c"),
        evidence_refs: ["evidence:mirror-example"],
      }),
    ]);
    const audit = buildIndexerExampleIdentityAudit(current);
    expect(audit).toMatchObject({
      pass: false,
      observation_count: 2,
      unique_example_count: 1,
      collision_count: 1,
    });
    expect(audit.collisions[0]).toMatchObject({
      public_target_ref: "target:button",
      scenario_key: "basic-usage",
      full_relative_path: "stories/button/basic.tsx",
    });
    expect(() => assertIndexerExampleIdentityAuditPassed({
      value: audit,
      inventory: current,
    })).toThrow(/example-identity-collision/);
  });

  test("rejects forged example refs, source scope, and unknown evidence", () => {
    const current = inventory([observation("stories/button/basic.tsx")]);
    const forged = structuredClone(current);
    forged.observations[0]!.example_ref = "example:forged";
    rehashInventory(forged);
    expect(() => validateIndexerExampleInventory({ value: forged })).toThrow(
      /non-canonical|invalid digest/,
    );
    expect(() => validateIndexerExampleInventory({
      value: current,
      expected_source_scope_digest: digest("d"),
    })).toThrow(/another source scope/);
    expect(() => validateIndexerExampleInventory({
      value: current,
      known_evidence_refs: ["evidence:other"],
    })).toThrow(/unknown evidence/);
  });

  test("recomputes the audit and rejects a digest-consistent forged pass", () => {
    const current = inventory([
      observation("stories/button/basic.tsx"),
      observation("stories/button/basic.tsx", {
        content_digest: digest("e"),
      }),
    ]);
    const forged = structuredClone(buildIndexerExampleIdentityAudit(current));
    forged.pass = true;
    forged.collision_count = 0;
    forged.collisions = [];
    rehashAudit(forged);
    expect(() => validateIndexerExampleIdentityAudit({
      value: forged,
      inventory: current,
    })).toThrow(/does not match its current inventory/);
  });
});
