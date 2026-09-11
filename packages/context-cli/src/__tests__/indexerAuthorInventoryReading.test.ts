import { expect, test } from "bun:test";
import { authorInventoryReading } from "../project/indexerAuthorInventoryReading.js";
import { authorReadingFixture } from "./indexerBatchReading.fixture.js";

test("member navigation uses exact selected fact/container identities, retaining names without inferred roles", () => {
  const { view } = authorReadingFixture(0, 0);
  const base = view.items[0]!;
  const add = (category: string, ref: string, value: unknown, container_ref?: string) => view.items.push({
    ...base, category, ref, value, provenance: { ...base.provenance, ...(container_ref ? { container_ref } : {}) },
  } as typeof base);
  for (const member_id of ["fact:component", "file:owned", "fact:unselected", "file:other"]) {
    add("inventory-member", member_id, { member_id, kind: "symbol" });
  }
  add("dependency", "dep:1", { kind: "selected-fact", fact_ref: "fact:component" });
  add("dependency", "dep:2", { kind: "selected-fact", fact_ref: "fact:props" });
  add("fact", "display:component", { fact_ref: "fact:component", kind: "code-symbol",
    payload: { name: "Control", kind: "component", propsType: "Options" } }, "file:owned");
  add("fact", "display:props", { fact_ref: "fact:props", kind: "code-symbol",
    payload: { name: "Options", kind: "interface" } }, "file:owned");
  add("fact", "fact:unselected", { kind: "code-symbol", payload: { name: "ControlProps", kind: "interface" } }, "file:other");
  const before = JSON.stringify(view);
  expect(authorInventoryReading(view)).toEqual([
    { member_id: "fact:component", kind: "symbol", facts: [{ ref: "fact:component", name: "Control", kind: "component", propsType: "Options" }] },
    { member_id: "file:owned", kind: "symbol", facts: [{ ref: "fact:component", name: "Control", kind: "component", propsType: "Options" }, { ref: "fact:props", name: "Options", kind: "interface" }] },
    { member_id: "fact:unselected", kind: "symbol" }, { member_id: "file:other", kind: "symbol" },
  ]);
  expect(JSON.stringify(view)).toBe(before);
});
