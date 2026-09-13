import { expect, test } from "bun:test";
import { resolveProductionExclusions } from "../project/productionExclusions.js";
import type { ProductionRequirements } from "../project/productionRequirements.js";

test("content exclusions reuse one source read and expire conservatively; permanent exclusions do not read sources", async () => {
  const scope = { targets: [{ source_ref: "note:decision.md" }] };
  const fixed = { scope, reason: "User excludes this input" };
  const conditional = { scope, reason: "No additional reader value in this snapshot", source_baselines: { "note:decision.md": "before" } };
  const requirements: ProductionRequirements = { requirements: [{ id: "decisions", purpose: "Explain decisions",
    target_scope: scope, exclusions: [fixed, conditional, conditional] }] };
  let calls = 0;
  const same = await resolveProductionExclusions(requirements, async () => { calls++; return "before"; });
  expect(calls).toBe(1);
  expect(same.requirements).toEqual(requirements);
  expect(same.reassess).toEqual([]);
  for (const read of [async () => "after", async (): Promise<string> => { throw new Error("Unavailable source"); }]) {
    const changed = await resolveProductionExclusions(requirements, read);
    expect(changed.requirements.requirements[0]!.exclusions).toEqual([fixed]);
    expect(changed.reassess).toEqual(["note:decision.md"]);
  }
  expect(requirements.requirements[0]!.exclusions).toHaveLength(3);
  calls = 0;
  await resolveProductionExclusions({ requirements: [{ ...requirements.requirements[0]!, exclusions: [fixed] }] },
    async () => { calls++; return "unused"; });
  expect(calls).toBe(0);
});
